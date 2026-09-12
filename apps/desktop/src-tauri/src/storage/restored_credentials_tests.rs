use super::*;
use crate::storage::{self, credential_crypto, Hlc};
use base64::{engine::general_purpose::STANDARD, Engine};
fn db(root: &Path) -> Connection {
    let mut conn = Connection::open(root.join("db")).unwrap();
    storage::apply_connection_pragmas(&conn).unwrap();
    storage::register_sql_functions(&conn).unwrap();
    storage::run_migrations(&mut conn).unwrap();
    storage::ensure_local_device(&conn).unwrap();
    conn
}
fn secret(conn: &Connection, root: &Path, slot: &str, value: &str) {
    let sealed = crate::secrets::encrypt(root, value).unwrap();
    conn.execute("INSERT INTO app_kv VALUES (?1,?2,'now') ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",rusqlite::params![format!("read-aware-secret:{slot}"),sealed]).unwrap();
}
fn event(conn: &Connection, slot: &str, clock: i64) -> EventRow {
    EventRow {
        id: uuid::Uuid::new_v4().to_string(),
        event_type: "preference.changed".into(),
        hlc: Hlc {
            wall_ms: clock,
            counter: 0,
            device_id: conn
                .query_row("SELECT device_id FROM local_device WHERE id=1", [], |row| {
                    row.get(0)
                })
                .unwrap(),
        },
        schema_version: Some(1),
        aggregate_type: Some("preference".into()),
        aggregate_id: Some(format!("secret:{slot}")),
        actor_id: Some("local".into()),
        origin: Some("system".into()),
        created_at: None,
        payload: serde_json::json!({"key":format!("secret:{slot}"),"value":"untrusted request contents"}),
    }
}
#[test]
fn restored_credentials_survives_restart_and_publishes_current_values_and_deletions_atomically() {
    let root = tempfile::tempdir().unwrap();
    let mut conn = db(root.path());
    secret(&conn, root.path(), "ai-api-key.a", "restored old value");
    let tx = conn.transaction().unwrap();
    enqueue(&tx, "ai-api-key.a").unwrap();
    enqueue(&tx, "ai-api-key.deleted").unwrap();
    tx.commit().unwrap();
    // An old projection must not overwrite either pending choice at boot.
    conn.execute(
        "INSERT INTO synced_preferences VALUES ('secret:ai-api-key.deleted','\"old\"','now')",
        [],
    )
    .unwrap();
    assert!(storage::preferences_load_all_inner(&conn)
        .unwrap()
        .is_empty());
    let offline = event(&conn, "ai-api-key.a", 100);
    assert!(
        publish(&mut conn, root.path(), vec![offline])
            .unwrap()
            .awaiting_connection
    );
    drop(conn);
    let mut conn = db(root.path());
    assert_eq!(pending(&conn).unwrap().len(), 2);
    secret(
        &conn,
        root.path(),
        "sync.master-key",
        &STANDARD.encode([5; 32]),
    );
    secret(&conn, root.path(), "ai-api-key.a", "new user value");
    let events = vec![
        event(&conn, "ai-api-key.a", 101),
        event(&conn, "ai-api-key.deleted", 102),
    ];
    let report = publish(&mut conn, root.path(), events.clone()).unwrap();
    assert_eq!(report.events.len(), 2);
    assert!(pending(&conn).unwrap().is_empty());
    assert_eq!(
        credential_crypto::open(
            &[5; 32],
            "ai-api-key.a",
            report.events[0].payload["value"]["sealed"]
                .as_str()
                .unwrap()
        )
        .unwrap()
        .as_str(),
        "new user value"
    );
    assert!(report.events[1].payload["value"].is_null());
    assert!(!serde_json::to_string(&report)
        .unwrap()
        .contains("new user value"));
    assert_eq!(storage::preferences_load_all_inner(&conn).unwrap().len(), 2);
    assert_eq!(
        conn.query_row(
            "SELECT count(*) FROM event_sync_state WHERE push_state='pending'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
    assert!(publish(&mut conn, root.path(), events)
        .unwrap()
        .events
        .is_empty());
    assert_eq!(
        conn.query_row("SELECT count(*) FROM domain_events", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
}
#[test]
fn restored_credentials_rolls_back_every_event_and_marker_on_failure_and_rejects_stale_clocks() {
    let root = tempfile::tempdir().unwrap();
    let mut conn = db(root.path());
    secret(
        &conn,
        root.path(),
        "sync.master-key",
        &STANDARD.encode([5; 32]),
    );
    let tx = conn.transaction().unwrap();
    enqueue(&tx, "ai-api-key.a").unwrap();
    enqueue(&tx, "ai-api-key.b").unwrap();
    tx.commit().unwrap();
    conn.execute_batch("CREATE TRIGGER fail_second BEFORE DELETE ON restored_credential_publications WHEN OLD.slot='ai-api-key.b' BEGIN SELECT RAISE(ABORT,'injected retirement failure'); END;").unwrap();
    let batch = vec![
        event(&conn, "ai-api-key.a", 100),
        event(&conn, "ai-api-key.b", 101),
    ];
    assert!(publish(&mut conn, root.path(), batch).is_err());
    assert_eq!(pending(&conn).unwrap().len(), 2);
    assert_eq!(
        conn.query_row("SELECT count(*) FROM domain_events", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    conn.execute_batch("DROP TRIGGER fail_second;").unwrap();
    let earlier = event(&conn, "ai-api-key.b", 99);
    let batch = vec![event(&conn, "ai-api-key.a", 100), earlier];
    assert_eq!(
        publish(&mut conn, root.path(), batch).unwrap_err().code,
        "backup/changed"
    );
    assert_eq!(pending(&conn).unwrap().len(), 2);
    assert_eq!(
        conn.query_row("SELECT count(*) FROM synced_preferences", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[test]
fn restored_credentials_is_local_bookkeeping_and_cannot_publish_unqueued_or_foreign_events() {
    let root = tempfile::tempdir().unwrap();
    let mut conn = db(root.path());
    secret(
        &conn,
        root.path(),
        "sync.master-key",
        &STANDARD.encode([5; 32]),
    );
    let unqueued = event(&conn, "ai-api-key.unknown", 100);
    assert!(publish(&mut conn, root.path(), vec![unqueued])
        .unwrap()
        .events
        .is_empty());
    let tx = conn.transaction().unwrap();
    assert!(enqueue(&tx, "sync.session").is_err());
    enqueue(&tx, "ai-api-key.a").unwrap();
    tx.commit().unwrap();
    let mut wrong = event(&conn, "ai-api-key.a", 100);
    wrong.hlc.device_id = "foreign".into();
    assert!(publish(&mut conn, root.path(), vec![wrong]).is_err());
    let mut wrong = event(&conn, "ai-api-key.a", 100);
    wrong.event_type = "book.removed".into();
    assert!(publish(&mut conn, root.path(), vec![wrong]).is_err());
    assert_eq!(pending(&conn).unwrap(), vec!["ai-api-key.a"]);
    let tx = conn.transaction().unwrap();
    storage::replay_into(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(pending(&conn).unwrap(), vec!["ai-api-key.a"]);
    storage::wipe_all_data_inner(&mut conn, root.path()).unwrap();
    assert!(pending(&conn).unwrap().is_empty());
}

#[test]
fn restored_credentials_bounds_large_batches_without_losing_the_unpublished_tail() {
    let root = tempfile::tempdir().unwrap();
    let mut conn = db(root.path());
    secret(
        &conn,
        root.path(),
        "sync.master-key",
        &STANDARD.encode([5; 32]),
    );
    let large = "x".repeat(9 * 1024 * 1024);
    for slot in ["ai-api-key.a", "ai-api-key.b"] {
        secret(&conn, root.path(), slot, &large);
    }
    let tx = conn.transaction().unwrap();
    enqueue(&tx, "ai-api-key.a").unwrap();
    enqueue(&tx, "ai-api-key.b").unwrap();
    tx.commit().unwrap();
    let batch = vec![
        event(&conn, "ai-api-key.a", 100),
        event(&conn, "ai-api-key.b", 101),
    ];
    assert_eq!(
        publish(&mut conn, root.path(), batch).unwrap().events.len(),
        1
    );
    assert_eq!(pending(&conn).unwrap(), vec!["ai-api-key.b"]);
    let next = event(&conn, "ai-api-key.b", 102);
    assert_eq!(
        publish(&mut conn, root.path(), vec![next])
            .unwrap()
            .events
            .len(),
        1
    );
    assert!(pending(&conn).unwrap().is_empty());
}
