use super::*;
use crate::storage::{
    self,
    backup_archive::{self, AuthenticatedBackup},
    backup_snapshot,
};
use std::{
    fs,
    sync::{atomic::AtomicBool, Arc},
};

fn db(path: &std::path::Path) -> Connection {
    let mut conn = Connection::open(path).unwrap();
    storage::apply_connection_pragmas(&conn).unwrap();
    storage::register_sql_functions(&conn).unwrap();
    storage::run_migrations(&mut conn).unwrap();
    storage::ensure_local_device(&conn).unwrap();
    conn
}
fn incoming(edit: impl FnOnce(&Connection, &std::path::Path)) -> backup_archive::PreflightedBackup {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut conn = db(&root.path().join("db"));
    edit(&conn, root.path());
    let snapshot =
        backup_snapshot::capture_fixture(&mut conn, root.path(), stage.path(), |_| Ok(())).unwrap();
    let directory = tempfile::tempdir().unwrap();
    for file in &snapshot.manifest.files {
        let to = directory.path().join(&file.path);
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::copy(snapshot.directory().join(&file.path), to).unwrap();
    }
    backup_archive::preflight(
        AuthenticatedBackup {
            directory: crate::storage::backup_staging::BackupDirectory::fixture(directory),
            manifest: snapshot.manifest.clone(),
        },
        Arc::new(AtomicBool::new(false)),
    )
    .unwrap()
}
fn memory(conn: &Connection, id: &str, content: &str) {
    conn.execute("INSERT INTO memories(id,scope,kind,content,importance,evidence_count,created_at,updated_at) VALUES (?1,'global','fact',?2,1,1,'now','now')", params![id,content]).unwrap();
}
fn kv(conn: &Connection, key: &str, value: &str) {
    conn.execute(
        "INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,'now')",
        params![key, value],
    )
    .unwrap();
}
fn document(conn: &Connection, collection: &str, id: &str) {
    conn.execute("INSERT INTO plugin_documents(plugin_id,collection,id,json,updated_at) VALUES ('proof',?1,?2,'{\"retained\":true}','now')", params![collection,id]).unwrap();
}
#[test]
fn backup_row_plan_covers_every_current_table_and_preserves_actual_legacy_and_presentation_differences(
) {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("db"));
    memory(&target, "same", "retained");
    memory(&target, "changed", "target");
    memory(&target, "target-only", "target-only");
    document(&target, "notes", "one");
    target.execute_batch("INSERT INTO ai_conversations(id,created_at,updated_at) VALUES ('chat','now','now'); INSERT INTO ai_messages(id,conversation_id,role,seq,content,created_at,parts_json,error) VALUES ('message','chat','assistant',0,'same content','now','[]','target presentation');").unwrap();
    let source = incoming(|conn, _| {
        memory(conn, "same", "retained");
        memory(conn, "changed", "source");
        memory(conn, "source-only", "source-only");
        document(conn, "notes", "one");
        conn.execute_batch("INSERT INTO ai_conversations(id,created_at,updated_at) VALUES ('chat','now','now'); INSERT INTO ai_messages(id,conversation_id,role,seq,content,created_at,parts_json,error) VALUES ('message','chat','assistant',0,'same content','now','[]','source presentation'); INSERT INTO vocabulary_entries(id,term,language,entry_json,added_at) VALUES ('old-word','word','en','{}','now');").unwrap();
    });
    let plan = backup_archive::plan_events_fixture(source, &mut target, stage.path(), || Ok(()))
        .unwrap()
        .plan_rows(&mut target, || Ok(()))
        .unwrap();
    let counts = plan.tables["memories"].comparisons.as_ref().unwrap();
    assert_eq!(
        (
            counts.source_only,
            counts.target_only,
            counts.same,
            counts.different
        ),
        (1, 1, 1, 1)
    );
    assert_eq!(
        plan.tables["ai_messages"]
            .comparisons
            .as_ref()
            .unwrap()
            .different,
        1
    );
    assert_eq!(
        plan.tables["plugin_documents"]
            .comparisons
            .as_ref()
            .unwrap()
            .generated_only,
        1
    );
    assert_eq!(
        plan.tables["plugin_documents"]
            .comparisons
            .as_ref()
            .unwrap()
            .same,
        1
    );
    assert_eq!(plan.tables["vocabulary_entries"].source_rows, 1);
    assert_eq!(
        plan.tables["vocabulary_entries"].policy,
        RowPolicy::LegacyData
    );
    assert_eq!(
        plan.tables["reading_sessions_pending"].policy,
        RowPolicy::RecoverReading
    );
    assert_eq!(plan.tables["annotations_fts"].policy, RowPolicy::Rebuild);
    assert!(plan.tables["domain_events"].comparisons.is_none());
    assert!(plan.tables["schema_migrations"].comparisons.is_none());
    assert!(
        plan.tables["local_device"]
            .comparisons
            .as_ref()
            .unwrap()
            .different
            > 0
    );
    assert_eq!(
        plan.tables["local_device"].policy,
        RowPolicy::PreserveDevice
    );
    let tx = target.transaction().unwrap();
    plan.events().verify_target(&tx, || Ok(())).unwrap();
    tx.rollback().unwrap();
    assert_eq!(
        target
            .query_row(
                "SELECT content FROM memories WHERE id='changed'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "target"
    );
    let mut cursor = 0;
    let mut seen = Vec::new();
    loop {
        let page = plan.page("memories", cursor, 2).unwrap();
        seen.extend(page.entries);
        if let Some(next) = page.next_after {
            cursor = next;
        } else {
            break;
        }
    }
    assert_eq!(seen.len(), 4);
    assert!(seen
        .iter()
        .all(|row| row.source_digest.is_some() || row.target_digest.is_some()));
    assert!(plan.page("memories", 0, 101).is_err());
    let docs = plan.page("plugin_documents", 0, 100).unwrap();
    assert!(docs.entries[0].generated_only);
}

#[test]
fn backup_row_plan_routes_credentials_runtime_bindings_and_arbitrary_plugin_keys_without_disclosing_values(
) {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("db"));
    let source = incoming(|conn, root| {
        let credential = crate::secrets::encrypt(root, "very private credential").unwrap();
        for key in [
            "read-aware-secret:sync.session",
            "read-aware-secret:ai-api-key",
        ] {
            kv(conn, key, &credential);
        }
        kv(
            conn,
            "read-aware-sync-transport-journal",
            "private transport journal",
        );
        kv(conn, "read-aware-plugin.proof.schedule-state", "running");
        kv(
            conn,
            "read-aware-plugin.proof.settings\0suffix",
            "private plugin data",
        );
        kv(conn, "read-aware-plugin.proof.settings", "different key");
        kv(conn, "read-aware-virtual-books", "{}");
        kv(conn, "read-aware-plugin-host.schema.proof", "1");
        conn.execute(
            "INSERT INTO synced_preferences VALUES ('secret:ai-api-key','{}','now')",
            [],
        )
        .unwrap();
        document(conn, "a|b", "c");
        document(conn, "a", "b|c");
    });
    let plan = backup_archive::plan_events_fixture(source, &mut target, stage.path(), || Ok(()))
        .unwrap()
        .plan_rows(&mut target, || Ok(()))
        .unwrap();
    let policies = plan
        .page("app_kv", 0, 100)
        .unwrap()
        .entries
        .into_iter()
        .map(|entry| entry.policy)
        .collect::<Vec<_>>();
    assert_eq!(
        policies
            .iter()
            .filter(|&&value| value == RowPolicy::PreserveDevice)
            .count(),
        2
    );
    assert!(policies.contains(&RowPolicy::ResealCredential));
    assert!(policies.contains(&RowPolicy::ReviewRuntimeHistory));
    assert!(policies.contains(&RowPolicy::VirtualBindings));
    assert_eq!(
        policies
            .iter()
            .filter(|&&value| value == RowPolicy::PluginData)
            .count(),
        3
    );
    assert_eq!(
        plan.page("synced_preferences", 0, 100).unwrap().entries[0].policy,
        RowPolicy::TranslateRoamingSecret
    );
    assert_eq!(
        plan.tables["plugin_documents"]
            .comparisons
            .as_ref()
            .unwrap()
            .source_only,
        2
    );
    let bytes = fs::read(plan.events.entries.path().unwrap()).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("very private credential"));
    assert!(!String::from_utf8_lossy(&bytes).contains("private plugin data"));
}

#[test]
fn backup_row_plan_rejects_unknown_tables_unsettled_updates_and_stale_targets_and_cleans_partial_stages(
) {
    for case in 0..4 {
        let root = tempfile::tempdir().unwrap();
        let stage = tempfile::tempdir().unwrap();
        let mut target = db(&root.path().join("db"));
        if case == 0 {
            target
                .execute_batch("CREATE TABLE future_unknown(id TEXT PRIMARY KEY)")
                .unwrap();
        }
        if case == 1 {
            target.execute_batch("INSERT INTO plugin_update_journal(update_id,plugin_id,baseline_json,phase) VALUES ('pending','proof','{}','prepared')").unwrap();
        }
        let events = backup_archive::plan_events_fixture(
            incoming(|conn, _| memory(conn, "source", "private")),
            &mut target,
            stage.path(),
            || Ok(()),
        )
        .unwrap();
        let source_path = events.source().archive().directory().to_owned();
        if case == 2 {
            kv(&target, "after-preview", "changed");
        }
        let inserted = Arc::new(AtomicBool::new(false));
        let signal = inserted.clone();
        events
            .entries
            .update_hook(Some(move |_, _: &str, table: &str, _: i64| {
                if table == "row_matches" {
                    signal.store(true, std::sync::atomic::Ordering::Relaxed);
                }
            }));
        let error = events
            .plan_rows(&mut target, || {
                if case == 3 && inserted.load(std::sync::atomic::Ordering::Relaxed) {
                    Err(CommandError::new("backup/cancelled", "cancelled"))
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
        assert_eq!(
            error.code,
            match case {
                0 => "backup/incomplete",
                1 => "plugin/recovery-required",
                2 => "backup/changed",
                _ => "backup/cancelled",
            }
        );
        assert!(!source_path.exists());
        assert_eq!(
            crate::storage::backup_staging::fixture_entries(stage.path())
                .unwrap()
                .count(),
            0
        );
        assert!(target.is_autocommit());
    }
}

#[test]
fn backup_row_plan_reuses_the_event_target_view_during_concurrent_wal_changes() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let path = root.path().join("db");
    let mut target = db(&path);
    kv(&target, "shared", "same");
    let events = backup_archive::plan_events_fixture(
        incoming(|conn, _| kv(conn, "shared", "same")),
        &mut target,
        stage.path(),
        || Ok(()),
    )
    .unwrap();
    let inserted = Arc::new(AtomicBool::new(false));
    let signal = inserted.clone();
    events
        .entries
        .update_hook(Some(move |_, _: &str, table: &str, _: i64| {
            if table == "row_matches" {
                signal.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }));
    let writer = Connection::open(path).unwrap();
    let mut changed = false;
    let plan = events
        .plan_rows(&mut target, || {
            if !changed && inserted.load(std::sync::atomic::Ordering::Relaxed) {
                writer
                    .execute(
                        "UPDATE app_kv SET value_json='new value' WHERE key='shared'",
                        [],
                    )
                    .unwrap();
                changed = true;
            }
            Ok(())
        })
        .unwrap();
    assert!(changed);
    let rows = plan.page("app_kv", 0, 100).unwrap();
    assert_eq!(rows.entries.len(), 1);
    assert_eq!(rows.entries[0].kind, RowMatchKind::Same);
    assert_eq!(plan.tables["app_kv"].target_rows, 1);
    let tx = target
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    assert_eq!(
        plan.events()
            .verify_target(&tx, || Ok(()))
            .unwrap_err()
            .code,
        "backup/changed"
    );
    tx.rollback().unwrap();
}

#[test]
fn backup_row_review_reads_fixed_values_composite_keys_and_policy_boundaries() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("db"));
    memory(&target, "changed", "target before planning");
    document(&target, "with'quote", "same-id");
    document(&target, "other", "same-id");
    kv(&target, "read-aware-sync-test", "\"DEVICE PRIVATE\"");
    kv(&target, "read-aware-plugin.proof.schedule-runs", "[]");
    let long = format!("{}汉字\0tail", "a".repeat(4095));
    let source = incoming(|conn, _| {
        memory(conn, "changed", &long);
        memory(conn, "source-only", "only source");
        document(conn, "with'quote", "same-id");
        conn.execute(
            "UPDATE plugin_documents SET json='{\"source\":true}' WHERE collection=?1",
            ["with'quote"],
        )
        .unwrap();
    });
    let plan = backup_archive::plan_events_fixture(source, &mut target, stage.path(), || Ok(()))
        .unwrap()
        .plan_rows(&mut target, || Ok(()))
        .unwrap();
    let changed = plan
        .page("memories", 0, 100)
        .unwrap()
        .entries
        .into_iter()
        .find(|row| row.kind == RowMatchKind::Different)
        .unwrap()
        .entry_id;
    // Close the live connection altogether: review cannot accidentally fall back
    // to its database or observe newer values.
    target
        .execute(
            "UPDATE memories SET content='new live content' WHERE id='changed'",
            [],
        )
        .unwrap();
    drop(target);
    let fields = serde_json::to_value(
        plan.review_fields("memories".into(), changed, None, 2, &mut || Ok(()))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(fields["nextAfter"], 1);
    assert_eq!(fields["entries"][0]["name"], "id");
    assert_eq!(fields["entries"][0]["primary"], 1);
    let target = serde_json::to_value(
        plan.review_field(
            "memories".into(),
            changed,
            "content".into(),
            RowSide::Target,
            0,
            &mut || Ok(()),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(target["value"]["text"], "target before planning");
    let first = serde_json::to_value(
        plan.review_field(
            "memories".into(),
            changed,
            "content".into(),
            RowSide::Source,
            0,
            &mut || Ok(()),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(first["value"]["nextOffset"], 4095);
    let second = serde_json::to_value(
        plan.review_field(
            "memories".into(),
            changed,
            "content".into(),
            RowSide::Source,
            4095,
            &mut || Ok(()),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(second["value"]["text"], "汉字\0tail");
    assert_eq!(second["value"]["byteLength"], long.len());
    assert!(second["value"]["nextOffset"].is_null());
    for row in plan.page("app_kv", 0, 100).unwrap().entries {
        if matches!(
            row.policy,
            RowPolicy::PreserveDevice | RowPolicy::ReviewRuntimeHistory
        ) {
            let page = serde_json::to_value(
                plan.review_fields("app_kv".into(), row.entry_id, None, 100, &mut || Ok(()))
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(page["restricted"], true);
            assert_eq!(page["entries"], serde_json::json!([]));
            assert!(!page.to_string().contains("DEVICE PRIVATE"));
            assert!(plan
                .review_field(
                    "app_kv".into(),
                    row.entry_id,
                    "value_json".into(),
                    RowSide::Target,
                    0,
                    &mut || Ok(())
                )
                .is_err());
        }
    }
    let document = plan
        .page("plugin_documents", 0, 100)
        .unwrap()
        .entries
        .into_iter()
        .find(|row| row.kind == RowMatchKind::Different)
        .unwrap()
        .entry_id;
    let doc = serde_json::to_value(
        plan.review_field(
            "plugin_documents".into(),
            document,
            "json".into(),
            RowSide::Source,
            0,
            &mut || Ok(()),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(doc["value"]["text"], "{\"source\":true}");
    let only = plan
        .page("memories", 0, 100)
        .unwrap()
        .entries
        .into_iter()
        .find(|row| row.kind == RowMatchKind::SourceOnly)
        .unwrap()
        .entry_id;
    let missing = serde_json::to_value(
        plan.review_field(
            "memories".into(),
            only,
            "content".into(),
            RowSide::Target,
            0,
            &mut || Ok(()),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(missing["value"].is_null());
    for (table, entry, column, offset) in [
        ("app_kv", changed, "value_json", 0),
        ("memories", changed, "id\" FROM app_kv--", 0),
        ("memories", changed, "content", long.len() + 1),
    ] {
        assert!(plan
            .review_field(
                table.into(),
                entry,
                column.into(),
                RowSide::Source,
                offset,
                &mut || Ok(())
            )
            .is_err());
    }
    assert!(plan
        .review_fields("memories".into(), changed, Some(9999), 1, &mut || Ok(()))
        .is_err());
    assert_eq!(
        plan.review_fields("memories".into(), changed, None, 1, &mut || Err(
            CommandError::new("backup/cancelled", "cancel")
        ))
        .err()
        .unwrap()
        .code,
        "backup/cancelled"
    );
    let private = plan.events.directory.path().to_owned();
    drop(plan);
    assert!(!private.exists());
}
