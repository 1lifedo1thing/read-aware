//! Host-internal conditional transaction. Public callers supply semantic operations,
//! never SQL, event envelopes or KV keys; the host freezes and authorizes those first.
use super::*;
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AtomicAggregateGuard {
    pub aggregate_type: String,
    pub aggregate_id: String,
    pub revision: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AtomicSettingChange {
    pub key: String,
    pub expected: Option<String>,
    pub value: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AtomicDocumentChanges {
    pub plugin_id: String,
    pub changes: Vec<PluginDocumentMutation>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AtomicCommitInput {
    pub guards: Vec<AtomicAggregateGuard>,
    pub events: Vec<EventRow>,
    pub settings: Vec<AtomicSettingChange>,
    pub documents: Vec<AtomicDocumentChanges>,
}
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum AtomicCommitResult {
    Conflict { domain: String, index: usize },
    Applied { events: super::events::CommitReport, documents: Vec<PluginDocumentCommitResult> },
}
fn invalid(message: &str) -> CommandError { CommandError::new("transaction/invalid-operation", message) }

/// Event IDs are immutable and include local and merged writes. Hash every ID,
/// rather than MAX(HLC): an older merged event can still change the projection.
pub(crate) fn atomic_aggregate_revision(conn: &Connection, kind: &str, id: &str) -> Result<String, CommandError> {
    let mut stmt = conn.prepare("SELECT id FROM domain_events WHERE aggregate_type=?1 AND aggregate_id=?2 ORDER BY id")?;
    let mut rows = stmt.query(params![kind, id])?;
    let mut hash = Sha256::new();
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        hash.update((id.len() as u64).to_le_bytes()); hash.update(id.as_bytes());
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub(crate) fn atomic_commit_inner(conn: &mut Connection, input: AtomicCommitInput) -> Result<AtomicCommitResult, CommandError> {
    let total = input.events.len() + input.settings.len() + input.documents.iter().map(|group| group.changes.len()).sum::<usize>();
    if total == 0 || total > 100 || input.guards.len() > 100 { return Err(invalid("Expected 1..100 operations")); }
    let bytes = input.events.iter().map(|event| event.payload.to_string().len()).sum::<usize>()
        + input.settings.iter().map(|setting| setting.expected.as_ref().map_or(0, String::len) + setting.value.as_ref().map_or(0, String::len)).sum::<usize>();
    let bytes = bytes + input.documents.iter().flat_map(|group| &group.changes).map(|change| match &change.operation {
        PluginDocumentOperation::Put { json, .. } => json.len(), _ => 0,
    }).sum::<usize>();
    if bytes > 8 * 1024 * 1024 { return Err(invalid("Transaction exceeds 8 MiB")); }
    let mut guards = std::collections::HashSet::new();
    for guard in &input.guards {
        if guard.aggregate_type.is_empty() || guard.aggregate_type.len() > 64 || guard.aggregate_id.is_empty() || guard.aggregate_id.len() > 1024
            || guard.revision.len() != 64 || !guard.revision.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !guards.insert((guard.aggregate_type.as_str(), guard.aggregate_id.as_str())) { return Err(invalid("Invalid or duplicate aggregate guard")); }
    }
    let mut event_ids = std::collections::HashSet::new();
    for event in &input.events {
        if !event_ids.insert(&event.id) || !guards.contains(&(event.aggregate_type.as_deref().unwrap_or(""), event.aggregate_id.as_deref().unwrap_or(""))) {
            return Err(invalid("Every distinct event requires an aggregate guard"));
        }
    }
    let mut keys = std::collections::HashSet::new();
    for setting in &input.settings {
        if setting.key.is_empty() || setting.key.len() > 256 || !keys.insert(&setting.key) { return Err(invalid("Invalid or duplicate setting key")); }
        // These preferences invoke OS operations outside SQLite. Do not claim
        // they can roll back with local event/document changes.
        if setting.key == crate::desktop_preferences::GENERAL_KEY {
            let before = crate::desktop_preferences::parse(setting.expected.as_deref())?;
            let after = crate::desktop_preferences::parse(setting.value.as_deref())?;
            if before.launch_at_startup != after.launch_at_startup || before.file_associations != after.file_associations {
                return Err(invalid("Native preference effects cannot join an atomic transaction"));
            }
        }
        // Existing KV codecs include raw enum strings as well as JSON. Compare
        // exact durable bytes; semantic validation belongs to the settings catalog.
    }
    let mut owners = std::collections::HashSet::new();
    for group in &input.documents {
        if !owners.insert(&group.plugin_id) { return Err(invalid("Duplicate document owner")); }
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if super::events::projections_stale_conn(&tx)? { return Err(CommandError::new("transaction/conflict", "Projections require rebuilding")); }
    for (index, guard) in input.guards.iter().enumerate() {
        if atomic_aggregate_revision(&tx, &guard.aggregate_type, &guard.aggregate_id)? != guard.revision {
            return Ok(AtomicCommitResult::Conflict { domain: "events".into(), index });
        }
    }
    for event in &input.events {
        if tx.query_row("SELECT 1 FROM domain_events WHERE id=?1", [&event.id], |_| Ok(())).optional()?.is_some() {
            return Err(invalid("Event was already committed; inspect its receipt before retrying"));
        }
    }
    for (index, setting) in input.settings.iter().enumerate() {
        let current: Option<String> = tx.query_row("SELECT value_json FROM app_kv WHERE key=?1", [&setting.key], |row| row.get(0)).optional()?;
        if current != setting.expected { return Ok(AtomicCommitResult::Conflict { domain: "settings".into(), index }); }
    }
    let events = super::events::commit_events_in_transaction(&tx, &input.events)?;
    set_kv_batch_in_transaction(&tx, input.settings.into_iter().map(|setting| (setting.key, setting.value)).collect())?;
    let mut documents = Vec::new();
    for (index, group) in input.documents.into_iter().enumerate() {
        let result = super::plugin_document_operations::plugin_docs_apply_in_transaction(&tx, &group.plugin_id, group.changes)?;
        if matches!(result, PluginDocumentCommitResult::Conflict { .. }) {
            // Dropping this transaction rolls back preceding events/settings too.
            return Ok(AtomicCommitResult::Conflict { domain: "documents".into(), index });
        }
        documents.push(result);
    }
    tx.commit()?;
    Ok(AtomicCommitResult::Applied { events, documents })
}

#[tauri::command]
pub async fn atomic_commit(input: AtomicCommitInput, app: tauri::AppHandle) -> Result<AtomicCommitResult, CommandError> {
    crate::storage::blocking("atomic_commit", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        atomic_commit_inner(&mut conn, input)
    }).await
}

#[tauri::command]
pub async fn atomic_aggregate_revisions(aggregates: Vec<(String, String)>, app: tauri::AppHandle) -> Result<Vec<String>, CommandError> {
    if aggregates.len() > 100 || aggregates.iter().any(|(kind, id)| kind.is_empty() || kind.len() > 64 || id.is_empty() || id.len() > 1024) {
        return Err(invalid("Invalid aggregate revision query"));
    }
    crate::storage::blocking("atomic_aggregate_revisions", move || {
        let db = tauri::Manager::state::<Db>(&app);
        let mut conn = db.0.lock()?;
        let tx = conn.transaction()?;
        aggregates.iter().map(|(kind, id)| atomic_aggregate_revision(&tx, kind, id)).collect()
    }).await
}

#[cfg(test)]
#[path = "atomic_commit_tests.rs"]
mod tests;
