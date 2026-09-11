//! Source identities and managed-file references, independent of merge policy.
use super::*;
use rusqlite::OptionalExtension;
use serde_json::Value;
use std::collections::BTreeSet;

const SAFE_INTEGER: i64 = 9_007_199_254_740_991;
fn identity(text: &str) -> bool {
    !text.trim().is_empty() && text.len() <= 4096 && !text.contains('\0')
}

fn events(conn: &Connection, control: &Control) -> Result<u64, CommandError> {
    let mut statement = conn.prepare("SELECT id,type,schema_version,hlc_wall_ms,hlc_counter,hlc_device,actor_id,origin,created_at,payload_json FROM domain_events ORDER BY hlc_wall_ms,hlc_counter,hlc_device")?;
    let mut rows = statement.query([])?;
    let mut count = 0;
    while let Some(row) = rows.next()? {
        control.check()?;
        let version: i64 = row.get(2)?;
        let wall: i64 = row.get(3)?;
        let counter: i64 = row.get(4)?;
        if version != 1
            || !(0..=SAFE_INTEGER).contains(&wall)
            || !(0..=SAFE_INTEGER).contains(&counter)
        {
            return Err(invalid("invalid event version or logical clock"));
        }
        for index in [0, 1, 5, 6, 7, 8] {
            if !identity(&row.get::<_, String>(index)?) {
                return Err(invalid("invalid event identity"));
            }
        }
        let payload: Value = serde_json::from_str(&row.get::<_, String>(9)?)
            .map_err(|_| invalid("invalid event payload JSON"))?;
        if !payload.is_object() {
            return Err(invalid("event payload must be an object"));
        }
        // Unknown event types remain opaque forward-compatible facts. We do not
        // run permissive projection code here and call that payload validation.
        count += 1;
    }
    // The checked schema and full integrity_check enforce both id and HLC
    // uniqueness. Cross-archive same-id/different-payload conflicts are MERGE work.
    Ok(count)
}

fn blobs(
    conn: &Connection,
    archive: &AuthenticatedBackup,
    control: &Control,
) -> Result<u64, CommandError> {
    let mut members: BTreeMap<_, _> = archive
        .manifest
        .files
        .iter()
        .filter(|entry| entry.path.starts_with("blobs/"))
        .map(|entry| (entry.path.as_str(), entry))
        .collect();
    let mut statement = conn.prepare("SELECT key,storage_uri,byte_size,sha256 FROM blob_objects WHERE deleted_at IS NULL ORDER BY key")?;
    let mut rows = statement.query([])?;
    let mut count = 0;
    while let Some(row) = rows.next()? {
        control.check()?;
        let key: String = row.get(0)?;
        let uri: Option<String> = row.get(1)?;
        let size: Option<i64> = row.get(2)?;
        let hash: Option<String> = row.get(3)?;
        let expected = format!("blobs/{}", storage::blob_file_name(&key));
        if key.is_empty() || uri.as_deref() != Some(&expected) {
            return Err(invalid("invalid or unavailable blob reference"));
        }
        let member = members
            .remove(expected.as_str())
            .ok_or_else(|| invalid("registered blob is missing from archive"))?;
        if size.is_some_and(|size| size < 0 || size as u64 != member.byte_size)
            || hash.as_deref().is_some_and(|hash| hash != member.sha256)
        {
            return Err(invalid("blob registry differs from authenticated member"));
        }
        count += 1;
    }
    if !members.is_empty() {
        return Err(invalid("archive contains unregistered blob members"));
    }
    let missing: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM books b WHERE (b.format != 'virtual' AND NOT EXISTS(SELECT 1 FROM blob_objects o WHERE o.key='bookfile:'||b.id AND o.deleted_at IS NULL)) OR (b.cover_status='ready' AND (b.cover_blob_key IS NULL OR NOT EXISTS(SELECT 1 FROM blob_objects o WHERE o.key=b.cover_blob_key AND o.deleted_at IS NULL))))", [], |row| row.get(0))?;
    if missing {
        return Err(invalid("book original or ready cover is missing"));
    }
    Ok(count)
}

fn credentials(
    conn: &Connection,
    archive: &AuthenticatedBackup,
    control: &Control,
) -> Result<u64, CommandError> {
    let has_key = archive
        .manifest
        .files
        .iter()
        .any(|entry| entry.path == "secret.key" && entry.byte_size == 32);
    let mut statement = conn.prepare("SELECT value_json FROM app_kv WHERE substr(key,1,length('read-aware-secret:'))='read-aware-secret:'")?;
    let mut rows = statement.query([])?;
    let mut count = 0;
    while let Some(row) = rows.next()? {
        control.check()?;
        if !has_key {
            return Err(invalid("credential key is missing"));
        }
        // This helper only reads an existing key, never creates one. Plaintext
        // is not included in the report or any caller-visible error context.
        let _ = crate::secrets::decrypt_existing(archive.directory(), &row.get::<_, String>(0)?)?;
        count += 1;
    }
    Ok(count)
}

fn programs(
    archive: &AuthenticatedBackup,
    control: &Control,
) -> Result<BTreeSet<String>, CommandError> {
    let mut roots = BTreeSet::new();
    let files: BTreeMap<_, _> = archive
        .manifest
        .files
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect();
    for entry in &archive.manifest.files {
        if !entry.path.starts_with("plugins/") && !entry.path.starts_with("bundled-plugins/") {
            continue;
        }
        let mut parts = entry.path.split('/');
        let folder = parts.next().unwrap();
        let id = parts.next().unwrap_or("");
        if !crate::plugins::valid_plugin_id(id) || parts.next().is_none() {
            return Err(invalid("invalid installed plugin path"));
        }
        roots.insert(format!("{folder}/{id}"));
    }
    for root in &roots {
        control.check()?;
        let path = format!("{root}/manifest.json");
        let file = files
            .get(path.as_str())
            .ok_or_else(|| invalid("plugin manifest is missing"))?;
        if file.byte_size > 1024 * 1024 {
            return Err(invalid("plugin manifest exceeds limit"));
        }
        let manifest: Value =
            serde_json::from_reader(std::fs::File::open(archive.directory().join(path))?)?;
        if manifest.get("id").and_then(Value::as_str) != root.rsplit('/').next()
            || !manifest
                .get("schemaVersion")
                .and_then(Value::as_i64)
                .is_some_and(|version| (1..=SAFE_INTEGER).contains(&version))
        {
            return Err(invalid(
                "plugin manifest identity or schema version is invalid",
            ));
        }
    }
    // Program installation/permission validation and any storage migration still
    // run through the host during restore. Preflight never activates plugin code.
    Ok(roots)
}

fn plugin_data(conn: &Connection, control: &Control) -> Result<(), CommandError> {
    let mut statement = conn.prepare("SELECT plugin_id,collection,id FROM plugin_documents")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        control.check()?;
        if !crate::plugins::valid_plugin_id(&row.get::<_, String>(0)?) {
            return Err(invalid("invalid plugin document owner"));
        }
        // Source links may outlive a deleted book; do not invent a cascading FK.
    }
    let mut statement = conn.prepare("SELECT key,value_json FROM app_kv WHERE substr(key,1,length('read-aware-plugin-host.schema.'))='read-aware-plugin-host.schema.'")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        control.check()?;
        let key: String = row.get(0)?;
        let id = key.strip_prefix("read-aware-plugin-host.schema.").unwrap();
        let value: Value = serde_json::from_str(&row.get::<_, String>(1)?)?;
        if !crate::plugins::valid_plugin_id(id)
            || !value
                .as_i64()
                .is_some_and(|version| (1..=SAFE_INTEGER).contains(&version))
        {
            return Err(invalid("invalid stored plugin schema version"));
        }
    }
    Ok(())
}

fn virtual_books(conn: &Connection, control: &Control) -> Result<(), CommandError> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value_json FROM app_kv WHERE key='read-aware-virtual-books'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let registry: Value = match raw {
        Some(raw) => serde_json::from_str(&raw)?,
        None => serde_json::json!({}),
    };
    let registry = registry
        .as_object()
        .ok_or_else(|| invalid("invalid virtual book registry"))?;
    for binding in registry.values() {
        control.check()?;
        if !binding
            .get("pluginId")
            .and_then(Value::as_str)
            .is_some_and(crate::plugins::valid_plugin_id)
            || !binding
                .get("providerId")
                .and_then(Value::as_str)
                .is_some_and(identity)
            || !binding.get("key").is_some_and(Value::is_string)
        {
            return Err(invalid("invalid virtual book binding"));
        }
    }
    let mut statement = conn.prepare("SELECT id FROM books WHERE format='virtual'")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        control.check()?;
        if !registry.contains_key(&row.get::<_, String>(0)?) {
            return Err(invalid("virtual book is missing its content binding"));
        }
    }
    // A disabled/missing provider and offline remote content are availability,
    // not structural corruption. Preserve the binding and private data for the
    // restore preview; do not claim that a provider is ready or can read offline.
    Ok(())
}

pub(super) fn validate(
    conn: &Connection,
    archive: &AuthenticatedBackup,
    control: &Control,
    report: &mut PreflightReport,
) -> Result<(), CommandError> {
    report.events = events(conn, control)?;
    report.blobs = blobs(conn, archive, control)?;
    report.credentials = credentials(conn, archive, control)?;
    report.plugin_programs = programs(archive, control)?.len() as u64;
    plugin_data(conn, control)?;
    virtual_books(conn, control)?;
    let broken_chat: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM ai_messages m WHERE NOT EXISTS(SELECT 1 FROM ai_conversations c WHERE c.id=m.conversation_id))", [], |row| row.get(0))?;
    if broken_chat {
        return Err(invalid("chat message has no conversation"));
    }
    // Other source links (annotations, memory evidence, bundle provenance) may
    // deliberately outlive removal or point behind an incomplete synced log.
    // Their reconciliation belongs to merge planning, not blanket rejection.
    Ok(())
}
