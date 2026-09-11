use super::*;
use rusqlite::params;
use serde_json::json;

fn database(path: &Path) -> Connection {
    let mut conn = Connection::open(path).unwrap();
    storage::apply_connection_pragmas(&conn).unwrap();
    storage::register_sql_functions(&conn).unwrap();
    storage::run_migrations(&mut conn).unwrap();
    storage::ensure_local_device(&conn).unwrap();
    conn
}
fn plugin(root: &Path, id: &str, version: &str) {
    fs::create_dir_all(root).unwrap();
    fs::write(
        root.join("manifest.json"),
        json!({"id":id,"version":version}).to_string(),
    )
    .unwrap();
    fs::write(root.join("main.js"), version).unwrap();
}
fn seed(conn: &Connection, id: &str, value: &str) {
    for (key, raw) in [
        (
            format!("read-aware-plugin.{id}.settings"),
            format!("\"{value}\""),
        ),
        (format!("read-aware-plugin-host.schema.{id}"), value.into()),
    ] {
        conn.execute(
            "INSERT OR REPLACE INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,'now')",
            params![key, raw],
        )
        .unwrap();
    }
    conn.execute("INSERT OR REPLACE INTO plugin_documents(plugin_id,collection,id,json,updated_at) VALUES (?1,'items','one',?2,'now')", params![id,format!("\"{value}\"")]).unwrap();
}
fn prepare(
    conn: &mut Connection,
    root: &Path,
    id: &str,
    installed: bool,
) -> storage::PluginUpdateJournal {
    if installed {
        plugin(&root.join(id), id, "1");
        seed(conn, id, "1");
    }
    let token = uuid::Uuid::new_v4().to_string();
    plugin(&root.join(".candidates").join(&token), id, "2");
    begin_at(conn, root, id, Some(token)).unwrap()
}
fn events(
    conn: &Connection,
    journal: &storage::PluginUpdateJournal,
    current: &storage::PluginDataSnapshot,
) -> Vec<storage::EventRow> {
    let device: String = conn
        .query_row("SELECT device_id FROM local_device WHERE id=1", [], |r| {
            r.get(0)
        })
        .unwrap();
    storage::plugin_preference_changes(&journal.baseline, current)
        .into_iter()
        .enumerate()
        .map(|(index, (key, value))| storage::EventRow {
            id: uuid::Uuid::new_v4().to_string(),
            event_type: "preference.changed".into(),
            hlc: storage::Hlc {
                wall_ms: 1000,
                counter: index as i64,
                device_id: device.clone(),
            },
            schema_version: None,
            aggregate_type: Some("preference".into()),
            aggregate_id: Some(key.clone()),
            actor_id: None,
            origin: Some("user".into()),
            created_at: None,
            payload: json!({"key":key,"value":value}),
        })
        .collect()
}

// The parent launches this exact test in another process, which exits without
// destructors at real persisted boundaries. Recovery uses a reopened WAL DB.
#[test]
fn plugin_update_crash_child() {
    let Ok(directory) = std::env::var("RA_PLUGIN_CRASH_ROOT") else {
        return;
    };
    let stage = std::env::var("RA_PLUGIN_CRASH_STAGE").unwrap();
    let root = Path::new(&directory).join("plugins");
    let mut conn = database(&Path::new(&directory).join("db.sqlite"));
    let journal = prepare(&mut conn, &root, "sample", stage != "first-install");
    if stage == "prepared" {
        std::process::exit(23);
    }
    if stage == "file-gap" {
        fs::create_dir_all(root.join(".rollback")).unwrap();
        fs::rename(root.join("sample"), root.join(".rollback/sample")).unwrap();
        std::process::exit(23);
    }
    plugins::commit_candidate_at(&root, journal.candidate_token.as_ref().unwrap()).unwrap();
    seed(&conn, "sample", "2");
    if stage == "accepted" {
        let current = storage::plugin_data_snapshot_inner(&mut conn, "sample").unwrap();
        let rows = events(&conn, &journal, &current);
        storage::accept_plugin_update(
            &mut conn,
            &journal.update_id,
            current.kv,
            current.schema,
            &rows,
        )
        .unwrap();
    }
    std::process::exit(23);
}

#[test]
fn plugin_update_reopens_and_recovers_every_commit_boundary() {
    for stage in [
        "prepared",
        "file-gap",
        "migrated",
        "first-install",
        "accepted",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "plugin_updates::tests::plugin_update_crash_child",
            ])
            .env("RA_PLUGIN_CRASH_ROOT", dir.path())
            .env("RA_PLUGIN_CRASH_STAGE", stage)
            .output()
            .unwrap();
        assert_eq!(
            status.status.code(),
            Some(23),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
        let root = dir.path().join("plugins");
        let mut conn = database(&dir.path().join("db.sqlite"));
        assert!(recover_at(&mut conn, &root).unwrap().is_empty());
        assert!(recover_at(&mut conn, &root).unwrap().is_empty());
        assert!(storage::list_plugin_updates(&conn).unwrap().is_empty());
        let snapshot = storage::plugin_data_snapshot_inner(&mut conn, "sample").unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM domain_events WHERE type='preference.changed'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        if stage == "first-install" {
            assert!(!root.join("sample").exists());
            assert!(snapshot.kv.is_empty());
            assert!(snapshot.documents.is_empty());
            assert_eq!(count, 0);
        } else {
            let value = if stage == "accepted" { "2" } else { "1" };
            assert_eq!(
                fs::read_to_string(root.join("sample/main.js")).unwrap(),
                value
            );
            assert_eq!(snapshot.schema.as_deref(), Some(value));
            assert_eq!(snapshot.kv["settings"], format!("\"{value}\""));
            assert_eq!(snapshot.documents.len(), 1);
            assert_eq!(snapshot.documents[0].json, format!("\"{value}\""));
            assert_eq!(count, if stage == "accepted" { 1 } else { 0 });
        }
    }
}

#[test]
fn plugin_update_acceptance_is_atomic_scoped_and_retryable_after_lost_ack() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db"));
    let journal = prepare(&mut conn, dir.path(), "sample", true);
    seed(&conn, "sample", "2");
    let current = storage::plugin_data_snapshot_inner(&mut conn, "sample").unwrap();
    let rows = events(&conn, &journal, &current);
    let mut wrong = rows.clone();
    wrong[0].payload["key"] = json!("read-aware-plugin.other.settings");
    assert!(storage::accept_plugin_update(
        &mut conn,
        &journal.update_id,
        current.kv.clone(),
        current.schema.clone(),
        &wrong
    )
    .is_err());
    assert!(storage::accept_plugin_update(
        &mut conn,
        &journal.update_id,
        journal.baseline.kv.clone(),
        current.schema.clone(),
        &rows
    )
    .is_err());
    conn.execute_batch("CREATE TEMP TRIGGER reject_accept BEFORE UPDATE ON plugin_update_journal BEGIN SELECT RAISE(ABORT,'reject decision'); END;").unwrap();
    assert!(storage::accept_plugin_update(
        &mut conn,
        &journal.update_id,
        current.kv.clone(),
        current.schema.clone(),
        &rows
    )
    .is_err());
    assert_eq!(
        conn.query_row("SELECT count(*) FROM domain_events", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        storage::read_plugin_update(&conn, &journal.update_id)
            .unwrap()
            .unwrap()
            .phase,
        "prepared"
    );
    conn.execute_batch("DROP TRIGGER reject_accept").unwrap();
    let receipt = storage::accept_plugin_update(
        &mut conn,
        &journal.update_id,
        current.kv.clone(),
        current.schema.clone(),
        &rows,
    )
    .unwrap();
    assert_eq!(receipt.phase, "accepted");
    assert_eq!(
        storage::accept_plugin_update(&mut conn, &journal.update_id, BTreeMap::new(), None, &[])
            .unwrap()
            .phase,
        "accepted"
    );
    assert!(rollback_at(&mut conn, dir.path(), &journal.update_id).is_err());
    assert_eq!(
        conn.query_row("SELECT count(*) FROM domain_events", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn plugin_update_failed_restore_keeps_baseline_and_other_owners_recover() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db"));
    let first = prepare(&mut conn, dir.path(), "first", true);
    let second = prepare(&mut conn, dir.path(), "second", true);
    for journal in [&first, &second] {
        plugins::commit_candidate_at(dir.path(), journal.candidate_token.as_ref().unwrap())
            .unwrap();
        seed(&conn, &journal.plugin_id, "2");
    }
    conn.execute_batch("CREATE TEMP TRIGGER reject_restore BEFORE INSERT ON app_kv WHEN new.key='read-aware-plugin.first.settings' BEGIN SELECT RAISE(ABORT,'restore failure'); END;").unwrap();
    let failures = recover_at(&mut conn, dir.path()).unwrap();
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].plugin_id, "first");
    assert_eq!(
        storage::plugin_data_snapshot_inner(&mut conn, "first")
            .unwrap()
            .schema
            .as_deref(),
        Some("2")
    );
    assert!(storage::read_plugin_update(&conn, &first.update_id)
        .unwrap()
        .is_some());
    assert!(storage::read_plugin_update(&conn, &second.update_id)
        .unwrap()
        .is_none());
    assert!(update_dir(dir.path(), &first.update_id)
        .unwrap()
        .join("previous/main.js")
        .exists());
    conn.execute_batch("DROP TRIGGER reject_restore").unwrap();
    assert!(recover_at(&mut conn, dir.path()).unwrap().is_empty());
    assert_eq!(
        storage::plugin_data_snapshot_inner(&mut conn, "first")
            .unwrap()
            .schema
            .as_deref(),
        Some("1")
    );
}

#[test]
fn plugin_update_missing_file_baseline_stays_quarantined() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db"));
    let journal = prepare(&mut conn, dir.path(), "missing", true);
    plugins::commit_candidate_at(dir.path(), journal.candidate_token.as_ref().unwrap()).unwrap();
    seed(&conn, "missing", "2");
    fs::remove_dir_all(
        update_dir(dir.path(), &journal.update_id)
            .unwrap()
            .join("previous"),
    )
    .unwrap();
    let failure = recover_at(&mut conn, dir.path()).unwrap();
    assert_eq!(failure.len(), 1);
    assert_eq!(failure[0].code, "plugin/recovery-required");
    assert_eq!(
        fs::read_to_string(dir.path().join("missing/main.js")).unwrap(),
        "2"
    );
    assert!(storage::read_plugin_update(&conn, &journal.update_id)
        .unwrap()
        .is_some());
}

#[test]
fn plugin_update_activation_recovery_and_wipe_do_not_restore_removed_user_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let mut conn = database(&path);
    seed(&conn, "builtin", "1");
    begin_at(&mut conn, dir.path(), "builtin", None).unwrap();
    seed(&conn, "builtin", "2");
    drop(conn);
    let mut conn = database(&path);
    assert!(recover_at(&mut conn, dir.path()).unwrap().is_empty());
    assert_eq!(
        storage::plugin_data_snapshot_inner(&mut conn, "builtin")
            .unwrap()
            .schema
            .as_deref(),
        Some("1")
    );
    begin_at(&mut conn, dir.path(), "builtin", None).unwrap();
    seed(&conn, "builtin", "2");
    storage::wipe_all_data_inner(&mut conn, dir.path()).unwrap();
    assert!(recover_at(&mut conn, dir.path()).unwrap().is_empty());
    assert!(storage::plugin_data_snapshot_inner(&mut conn, "builtin")
        .unwrap()
        .kv
        .is_empty());
}

#[test]
fn plugin_update_orphan_cleanup_preserves_unknown_entries_and_does_not_block_boot() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db"));
    let updates = dir.path().join(".updates");
    let orphan = updates.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&orphan).unwrap();
    fs::write(orphan.join("partial"), "old backup").unwrap();
    let unknown = updates.join("unrecognized");
    fs::create_dir_all(&unknown).unwrap();
    assert!(recover_at(&mut conn, dir.path()).unwrap().is_empty());
    assert!(!orphan.exists());
    assert!(unknown.exists());
    fs::remove_dir_all(&updates).unwrap();
    // A malformed cleanup directory cannot turn completed recovery into a
    // global boot failure. No pending journal depends on it.
    fs::write(&updates, "not a directory").unwrap();
    assert!(recover_at(&mut conn, dir.path()).unwrap().is_empty());
}

#[test]
fn plugin_update_preparation_retries_the_same_identity_without_replacing_baseline() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = database(&dir.path().join("db"));
    seed(&conn, "sample", "1");
    let id = uuid::Uuid::new_v4().to_string();
    let first = begin_with_id_at(&mut conn, dir.path(), "sample", None, &id).unwrap();
    seed(&conn, "sample", "2");
    let retry = begin_with_id_at(&mut conn, dir.path(), "sample", None, &id).unwrap();
    assert_eq!(retry.baseline.kv, first.baseline.kv);
    assert_eq!(storage::list_plugin_updates(&conn).unwrap().len(), 1);
    assert_eq!(
        begin_with_id_at(&mut conn, dir.path(), "another", None, &id)
            .unwrap_err()
            .code,
        "plugin/invalid-argument"
    );
    assert!(recover_at(&mut conn, dir.path()).unwrap().is_empty());
    assert_eq!(
        storage::plugin_data_snapshot_inner(&mut conn, "sample")
            .unwrap()
            .schema
            .as_deref(),
        Some("1")
    );
}
