use super::*;
use crate::storage::{apply, events};

fn choose(plan: &RowPlan, target_memory: bool) -> String {
    let mut revision = plan.row_decisions(|| Ok(())).unwrap().revision;
    for table in plan.tables.keys() {
        let mut after = 0;
        loop {
            let page = plan.page(table, after, 100).unwrap();
            let edits = page
                .entries
                .iter()
                .filter(|e| e.selectable)
                .map(|e| choices::RowChoiceEdit {
                    table: table.clone(),
                    entry_id: e.entry_id,
                    choice: if target_memory && table == "memories" {
                        choices::RowChoice::Target
                    } else {
                        choices::RowChoice::Source
                    },
                })
                .collect::<Vec<_>>();
            if !edits.is_empty() {
                revision = plan
                    .choose_rows(
                        choices::RowChoiceRequest {
                            expected_revision: revision,
                            edits,
                        },
                        || Ok(()),
                    )
                    .unwrap()
                    .revision;
            }
            match page.next_after {
                Some(next) => after = next,
                None => break,
            }
        }
    }
    revision
}
fn content(conn: &Connection, id: &str) -> String {
    conn.query_row("SELECT content FROM memories WHERE id=?1", [id], |r| {
        r.get(0)
    })
    .unwrap()
}
fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
fn raw_memory_event(conn: &Connection, id: &str, memory_id: &str, text: &str) {
    let payload = serde_json::json!({"memoryId":memory_id,"scope":"global","kind":"fact","content":text,"importance":1});
    conn.execute("INSERT INTO domain_events(id,type,hlc_wall_ms,hlc_counter,hlc_device,aggregate_type,aggregate_id,payload_json,created_at) VALUES (?1,'memory.promoted',1,0,'source','memory',?2,?3,'then')",params![id,memory_id,payload.to_string()]).unwrap();
}

#[test]
fn backup_restore_rows_commits_selected_history_legacy_settings_and_presentation_then_replays() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("db"));
    let device: String = target
        .query_row("SELECT device_id FROM local_device", [], |r| r.get(0))
        .unwrap();
    memory(&target, "target-only", "retained legacy target");
    memory(&target, "chosen", "target");
    kv(&target, "read-aware-sync-token", "\"target-session\"");
    let long = "恢复\0body".repeat(20_000);
    let source = incoming(|conn, _| {
        memory(conn, "chosen", &long);
        memory(conn, "no-event", "source row without a creation event");
        raw_memory_event(conn, "original-id", "chosen", "old event content");
        kv(conn, "read-aware-theme", "\"dark\"");
        kv(conn, "read-aware-sync-token", "\"source-session\"");
        conn.execute_batch("INSERT INTO vocabulary_entries(id,term,language,entry_json,added_at) VALUES ('word','restored','en','{}','now'); INSERT INTO ai_conversations(id,created_at,updated_at) VALUES ('chat','old','presentation-time'); INSERT INTO ai_messages(id,conversation_id,role,seq,content,created_at,parts_json,error) VALUES ('ok','chat','assistant',7,'answer','old','[{\"type\":\"text\"}]',NULL),('failed','chat','assistant',8,'failed display','old','[]','ai/network');").unwrap();
    });
    let plan = backup_archive::plan_events_fixture(source, &mut target, stage.path(), || Ok(()))
        .unwrap()
        .plan_rows(&mut target, || Ok(()))
        .unwrap();
    let revision = choose(&plan, false);
    let tx = target
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    let receipt = plan.restore_rows(&tx, &revision, || Ok(())).unwrap();
    assert!(receipt.chunks > 10);
    assert!(receipt.rows >= 5);
    assert_eq!(content(&tx, "chosen"), long);
    assert_eq!(content(&tx, "target-only"), "retained legacy target");
    assert_eq!(count(&tx, "vocabulary_entries"), 1);
    assert_eq!(
        tx.query_row(
            "SELECT value_json FROM app_kv WHERE key='read-aware-theme'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "\"dark\""
    );
    assert_eq!(
        tx.query_row(
            "SELECT value_json FROM app_kv WHERE key='read-aware-sync-token'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "\"target-session\""
    );
    assert_eq!(
        tx.query_row("SELECT seq FROM ai_messages WHERE id='ok'", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        7
    );
    assert_eq!(
        tx.query_row("SELECT error FROM ai_messages WHERE id='failed'", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "ai/network"
    );
    assert_eq!(
        tx.query_row("SELECT device_id FROM local_device", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        device
    );
    assert_eq!(tx.query_row("SELECT payload_json FROM domain_events WHERE id='original-id'",[],|r|r.get::<_,String>(0)).unwrap(),serde_json::json!({"memoryId":"chosen","scope":"global","kind":"fact","content":"old event content","importance":1}).to_string());
    assert!(
        tx.query_row(
            "SELECT max(length(payload_json)) FROM domain_events WHERE type='backup.restoreChunk'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap()
            < 24 * 1024
    );
    tx.commit().unwrap();
    let events_count = count(&target, "domain_events");
    assert_eq!(count(&target, "event_sync_state"), events_count);
    let tx = target.transaction().unwrap();
    events::replay_into(&tx).unwrap();
    assert_eq!(content(&tx, "chosen"), long);
    assert_eq!(
        content(&tx, "no-event"),
        "source row without a creation event"
    );
    assert_eq!(content(&tx, "target-only"), "retained legacy target");
    assert_eq!(count(&tx, "ai_messages"), 1); // Error stub is local, never replayed.
    assert_eq!(
        tx.query_row(
            "SELECT parts_json FROM ai_messages WHERE id='ok'",
            [],
            |r| r.get::<_, Option<String>>(0)
        )
        .unwrap(),
        None
    );
    tx.rollback().unwrap();
    // The same restore facts apply on a peer without deleting unseen peer rows.
    let mut peer = db(&root.path().join("peer"));
    memory(&peer, "unseen-peer-row", "keep me");
    let tx = peer.transaction().unwrap();
    let mut statement = target
        .prepare("SELECT * FROM domain_events ORDER BY hlc_wall_ms,hlc_counter,hlc_device")
        .unwrap();
    for event in statement.query_map([], events::row_to_event).unwrap() {
        let event = event.unwrap();
        events::insert_event_row(&tx, &event, events::EventSource::Remote).unwrap();
        apply::apply_event(&tx, &event).unwrap();
    }
    assert_eq!(content(&tx, "unseen-peer-row"), "keep me");
    assert_eq!(content(&tx, "chosen"), long);
    tx.commit().unwrap();
}

#[test]
fn backup_restore_rows_target_choice_survives_imported_history_and_cancel_rolls_back() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("db"));
    memory(&target, "chosen", "retain target");
    let source = incoming(|conn, _| {
        memory(conn, "chosen", "source");
        memory(conn, "skip", "skip source-only");
        raw_memory_event(conn, "old-source", "chosen", "source historical");
    });
    let plan = backup_archive::plan_events_fixture(source, &mut target, stage.path(), || Ok(()))
        .unwrap()
        .plan_rows(&mut target, || Ok(()))
        .unwrap();
    let revision = choose(&plan, true);
    // Fail after source envelopes have physically entered the open transaction.
    let tx = target.transaction().unwrap();
    let result = plan.restore_rows(&tx, &revision, || {
        if count(&tx, "domain_events") > 0 {
            Err(CommandError::new(
                "backup/cancelled",
                "injected cancellation",
            ))
        } else {
            Ok(())
        }
    });
    assert_eq!(result.err().unwrap().code, "backup/cancelled");
    tx.rollback().unwrap();
    assert_eq!(count(&target, "domain_events"), 0);
    assert_eq!(content(&target, "chosen"), "retain target");
    let tx = target.transaction().unwrap();
    plan.restore_rows(&tx, &revision, || Ok(())).unwrap();
    assert_eq!(count(&tx, "memories"), 1);
    assert_eq!(content(&tx, "chosen"), "retain target");
    events::replay_into(&tx).unwrap();
    assert_eq!(count(&tx, "memories"), 1);
    assert_eq!(content(&tx, "chosen"), "retain target");
    tx.commit().unwrap();
}

#[test]
fn backup_restore_rows_rejects_stale_target_and_event_identity_conflicts_without_writes() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("db"));
    raw_memory_event(&target, "same-id", "target", "target event");
    let source = incoming(|conn, _| {
        memory(conn, "source", "source");
        raw_memory_event(conn, "same-id", "source", "source event");
    });
    let plan = backup_archive::plan_events_fixture(source, &mut target, stage.path(), || Ok(()))
        .unwrap()
        .plan_rows(&mut target, || Ok(()))
        .unwrap();
    let revision = choose(&plan, false);
    let tx = target.transaction().unwrap();
    assert_eq!(
        plan.restore_rows(&tx, &revision, || Ok(()))
            .err()
            .unwrap()
            .code,
        "backup/incomplete"
    );
    tx.rollback().unwrap();
    assert_eq!(count(&target, "domain_events"), 1);
    memory(&target, "later", "new write");
    let tx = target.transaction().unwrap();
    assert_eq!(
        plan.restore_rows(&tx, &revision, || Ok(()))
            .err()
            .unwrap()
            .code,
        "backup/changed"
    );
    tx.rollback().unwrap();
    assert_eq!(content(&target, "later"), "new write");
}

#[test]
fn backup_restore_rows_bad_manifest_missing_chunks_and_forbidden_tables_roll_back() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use sha2::{Digest, Sha256};
    let root = tempfile::tempdir().unwrap();
    let mut sender = db(&root.path().join("sender"));
    let desired = db(&root.path().join("desired"));
    memory(&sender, "chosen", "before");
    memory(&desired, "chosen", "after");
    let tx = sender.transaction().unwrap();
    storage::backup_restore_events::reconcile(&tx, &desired, || Ok(())).unwrap();
    tx.commit().unwrap();
    let events = sender
        .prepare("SELECT * FROM domain_events ORDER BY hlc_wall_ms,hlc_counter,hlc_device")
        .unwrap()
        .query_map([], events::row_to_event)
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(events.len(), 2);
    for failure in [
        "digest",
        "missing",
        "private-table",
        "unknown-column",
        "local-presentation",
    ] {
        let mut receiver = db(&root.path().join(failure));
        memory(&receiver, "chosen", "before");
        let mut incoming = events.clone();
        match failure {
            "digest" => {
                incoming.last_mut().unwrap().payload["sha256"] = serde_json::json!("0".repeat(64))
            }
            "missing" => {
                incoming.remove(0);
            }
            _ => {
                let mut data = STANDARD
                    .decode(incoming[0].payload["data"].as_str().unwrap())
                    .unwrap();
                let mut rows = std::str::from_utf8(&data)
                    .unwrap()
                    .lines()
                    .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
                    .collect::<Vec<_>>();
                // The first delete has already executed when the last row is
                // rejected. No projection or event may escape this failure.
                let row = rows.last_mut().unwrap();
                if failure == "private-table" {
                    row["table"] = serde_json::json!("app_kv");
                } else if failure == "unknown-column" {
                    row["columns"][1] = serde_json::json!("arbitrary_column");
                } else {
                    row["table"] = serde_json::json!("ai_messages");
                    row["columns"] = serde_json::json!(["id", "parts_json"]);
                    row["values"] = serde_json::json!([{"type":"text","value":STANDARD.encode("chosen")},{"type":"text","value":STANDARD.encode("[]")}]);
                }
                data.clear();
                for row in rows {
                    data.extend_from_slice(serde_json::to_string(&row).unwrap().as_bytes());
                    data.push(b'\n');
                }
                incoming[0].payload["data"] = serde_json::json!(STANDARD.encode(&data));
                incoming.last_mut().unwrap().payload["sha256"] =
                    serde_json::json!(format!("{:x}", Sha256::digest(&data)));
            }
        }
        assert_eq!(
            events::commit_events_inner(&mut receiver, &incoming)
                .unwrap_err()
                .code,
            "backup/invalid-archive",
            "{failure}"
        );
        assert_eq!(content(&receiver, "chosen"), "before", "{failure}");
        assert_eq!(count(&receiver, "domain_events"), 0, "{failure}");
    }
}

#[test]
fn backup_restore_rows_preserves_sqlite_scalar_types_without_js_rounding() {
    let root = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("target"));
    let desired = db(&root.path().join("desired"));
    // SQLite preserves these historical values even when a TEXT-affinity column
    // contains invalid UTF-8 or a blob. The event codec must not coerce them.
    desired.execute_batch("INSERT INTO reading_time_totals(book_id,total_ms,last_read_at) VALUES ('large',9007199254740993,NULL);").unwrap();
    memory(&desired, "typed", "value");
    desired.execute_batch("UPDATE memories SET content=CAST(x'ff0061' AS TEXT),kind=x'0001ff',importance=0.125 WHERE id='typed'").unwrap();
    let tx = target.transaction().unwrap();
    storage::backup_restore_events::reconcile(&tx, &desired, || Ok(())).unwrap();
    tx.commit().unwrap();
    for _ in 0..2 {
        assert_eq!(
            target
                .query_row(
                    "SELECT total_ms FROM reading_time_totals WHERE book_id='large'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            9_007_199_254_740_993
        );
        assert_eq!(target.query_row("SELECT hex(content),typeof(content),hex(kind),typeof(kind),importance FROM memories WHERE id='typed'",[],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,f64>(4)?))).unwrap(),("FF0061".into(),"text".into(),"0001FF".into(),"blob".into(),0.125));
        let tx = target.transaction().unwrap();
        events::replay_into(&tx).unwrap();
        tx.commit().unwrap();
    }
}
