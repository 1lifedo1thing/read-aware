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

#[test]
fn backup_row_choices_are_atomic_versioned_drafts_and_never_change_live_data() {
    use super::choices::{RowChoice, RowChoiceEdit, RowChoiceRequest};
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("db"));
    memory(&target, "changed", "target");
    memory(&target, "target-only", "target");
    let source = incoming(|conn, _| {
        memory(conn, "changed", "source");
        memory(conn, "source-only", "source");
        document(conn, "notes", "one");
    });
    let plan = backup_archive::plan_events_fixture(source, &mut target, stage.path(), || Ok(()))
        .unwrap()
        .plan_rows(&mut target, || Ok(()))
        .unwrap();
    let page = plan.page("memories", 0, 100).unwrap();
    let changed = page
        .entries
        .iter()
        .find(|r| r.kind == RowMatchKind::Different)
        .unwrap()
        .entry_id;
    let only = page
        .entries
        .iter()
        .find(|r| r.kind == RowMatchKind::SourceOnly)
        .unwrap()
        .entry_id;
    let target_only = page
        .entries
        .iter()
        .find(|r| r.kind == RowMatchKind::TargetOnly)
        .unwrap()
        .entry_id;
    assert!(
        !page
            .entries
            .iter()
            .find(|r| r.entry_id == target_only)
            .unwrap()
            .selectable
    );
    let plugin = plan.page("plugin_documents", 0, 100).unwrap().entries[0].entry_id;
    let edit = |table: &str, entry_id, choice| RowChoiceEdit {
        table: table.into(),
        entry_id,
        choice,
    };
    let request = |revision: &str, edits| RowChoiceRequest {
        expected_revision: revision.into(),
        edits,
    };
    let rev = &page.decision_revision;
    let state = serde_json::to_value(plan.row_decisions(|| Ok(())).unwrap()).unwrap();
    assert_eq!(state["unresolved"], 2);
    let no_op = plan
        .choose_rows(
            request(rev, vec![edit("memories", changed, RowChoice::Clear)]),
            || Ok(()),
        )
        .unwrap();
    assert_eq!(&no_op.revision, rev);
    assert_eq!(no_op.changed, 0);
    // A valid first edit cannot survive a later invalid or forbidden edit.
    for (table, id) in [
        ("plugin_documents", plugin),
        ("memories", target_only),
        ("app_kv", changed),
        ("memories", changed),
    ] {
        assert!(plan
            .choose_rows(
                request(
                    rev,
                    vec![
                        edit("memories", changed, RowChoice::Source),
                        edit(table, id, RowChoice::Source)
                    ]
                ),
                || Ok(())
            )
            .is_err());
        assert_eq!(
            serde_json::to_value(plan.row_decisions(|| Ok(())).unwrap()).unwrap(),
            state
        );
    }
    let mut checks = 0;
    let error = plan
        .choose_rows(
            request(
                rev,
                vec![
                    edit("memories", changed, RowChoice::Source),
                    edit("memories", only, RowChoice::Target),
                ],
            ),
            || {
                checks += 1;
                if checks == 3 {
                    Err(CommandError::new(
                        "backup/cancelled",
                        "cancel after first edit",
                    ))
                } else {
                    Ok(())
                }
            },
        )
        .err()
        .unwrap();
    assert_eq!(error.code, "backup/cancelled");
    assert_eq!(
        serde_json::to_value(plan.row_decisions(|| Ok(())).unwrap()).unwrap(),
        state
    );
    let saved = plan
        .choose_rows(
            request(
                rev,
                vec![
                    edit("memories", changed, RowChoice::Source),
                    edit("memories", only, RowChoice::Target),
                ],
            ),
            || Ok(()),
        )
        .unwrap();
    assert_ne!(&saved.revision, rev);
    assert_eq!(saved.changed, 2);
    assert_eq!(
        plan.choose_rows(
            request(rev, vec![edit("memories", changed, RowChoice::Target)]),
            || Ok(())
        )
        .err()
        .unwrap()
        .code,
        "backup/changed"
    );
    let next = plan.page("memories", 0, 100).unwrap();
    assert_eq!(next.decision_revision, saved.revision);
    assert_eq!(
        next.entries
            .iter()
            .find(|r| r.entry_id == changed)
            .unwrap()
            .selection
            .as_deref(),
        Some("source")
    );
    let stats = serde_json::to_value(plan.row_decisions(|| Ok(())).unwrap()).unwrap();
    assert_eq!(stats["unresolved"], 0);
    assert_eq!(stats["source"], 1);
    assert_eq!(stats["target"], 1);
    let clear = plan
        .choose_rows(
            request(
                &saved.revision,
                vec![edit("memories", changed, RowChoice::Clear)],
            ),
            || Ok(()),
        )
        .unwrap();
    assert_eq!(clear.changed, 1);
    assert_eq!(
        serde_json::to_value(plan.row_decisions(|| Ok(())).unwrap()).unwrap()["unresolved"],
        1
    );
    assert_eq!(
        target
            .query_row("SELECT content FROM memories WHERE id='changed'", [], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "target"
    );
    assert_eq!(
        target
            .query_row(
                "SELECT count(*) FROM memories WHERE id='source-only'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        plan.events
            .source
            .connection()
            .query_row("SELECT content FROM memories WHERE id='changed'", [], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "source"
    );
}

#[test]
fn backup_row_structure_reports_versioned_required_links_without_rejecting_soft_provenance() {
    use super::choices::{RowChoice, RowChoiceEdit, RowChoiceRequest};
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("db"));
    target.execute_batch("INSERT INTO entity_redirects VALUES ('b','c','now','event'); INSERT INTO book_aliases VALUES ('b','c');").unwrap();
    let source = incoming(|conn, _| {
        conn.execute_batch("INSERT INTO entities VALUES ('entity','person','Name','now','now','event');
            INSERT INTO entity_aliases VALUES ('entity','Name','now');
            INSERT INTO context_bundles VALUES ('bundle','user_profile_context','global',NULL,'{}','now','event');
            INSERT INTO context_bundle_items VALUES ('bundle',0,'memory','gone','rev');
            INSERT INTO ai_conversations(id,created_at,updated_at) VALUES ('chat','now','now');
            INSERT INTO ai_messages(id,conversation_id,role,seq,content,created_at) VALUES ('message','chat','user',0,'hello','now');
            INSERT INTO books(id,title,author,format,file_name,file_size,created_at,updated_at) VALUES ('virtual','Book','Author','virtual','virtual',0,'now','now');
            INSERT INTO app_kv VALUES ('read-aware-virtual-books','{\"virtual\":{\"pluginId\":\"proof\",\"providerId\":\"feed\",\"key\":\"entry\"}}','now');
            INSERT INTO entity_redirects VALUES ('a','b','now','event'); INSERT INTO book_aliases VALUES ('a','b');
            INSERT INTO annotations(id,book_id,type,text,created_at,updated_at) VALUES ('retained','removed-book','note','retained provenance','now','now');").unwrap();
    });
    let plan = backup_archive::plan_events_fixture(source, &mut target, stage.path(), || Ok(()))
        .unwrap()
        .plan_rows(&mut target, || Ok(()))
        .unwrap();
    let initial = plan.row_decisions(|| Ok(())).unwrap().revision;
    assert_eq!(
        plan.check_rows(initial.clone(), || Ok(()))
            .err()
            .unwrap()
            .code,
        "backup/incomplete"
    );
    let source_tables = [
        "entity_aliases",
        "context_bundle_items",
        "ai_messages",
        "books",
        "entity_redirects",
        "book_aliases",
        "annotations",
    ];
    let edits: Vec<_> = plan
        .tables
        .keys()
        .flat_map(|table| {
            plan.page(table, 0, 100)
                .unwrap()
                .entries
                .into_iter()
                .filter(|r| r.selectable)
                .map(|r| RowChoiceEdit {
                    table: table.clone(),
                    entry_id: r.entry_id,
                    choice: if source_tables.contains(&table.as_str()) {
                        RowChoice::Source
                    } else {
                        RowChoice::Target
                    },
                })
                .collect::<Vec<_>>()
        })
        .collect();
    let revision = plan
        .choose_rows(
            RowChoiceRequest {
                expected_revision: initial,
                edits,
            },
            || Ok(()),
        )
        .unwrap()
        .revision;
    let private = plan.events.directory.path();
    let candidate_exists = || {
        std::fs::read_dir(private).unwrap().any(|e| {
            e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("row-candidate-")
        })
    };
    assert_eq!(
        plan.check_rows(revision.clone(), || if candidate_exists() {
            Err(CommandError::new(
                "backup/cancelled",
                "cancel candidate copy",
            ))
        } else {
            Ok(())
        })
        .err()
        .unwrap()
        .code,
        "backup/cancelled"
    );
    assert!(!candidate_exists());
    assert!(plan.row_issues(revision.clone(), 0, 10, || Ok(())).is_err());
    let report = plan.check_rows(revision.clone(), || Ok(())).unwrap();
    assert!(!report.constraints_passed);
    assert_eq!(report.issues, 6);
    assert!(!candidate_exists());
    let first =
        serde_json::to_value(plan.row_issues(revision.clone(), 0, 2, || Ok(())).unwrap()).unwrap();
    assert_eq!(first["entries"].as_array().unwrap().len(), 2);
    assert_eq!(first["nextAfter"], 2);
    let second = serde_json::to_value(
        plan.row_issues(revision.clone(), 2, 100, || Ok(()))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(second["entries"].as_array().unwrap().len(), 4);
    assert!(second["nextAfter"].is_null());
    assert!(first["entries"]
        .as_array()
        .unwrap()
        .iter()
        .chain(second["entries"].as_array().unwrap())
        .all(|e| e["entryId"].is_number()));
    assert!(!first.to_string().contains("hello"));
    let mut checks = 0;
    assert_eq!(
        plan.check_rows(revision.clone(), || {
            checks += 1;
            Ok(())
        })
        .unwrap()
        .issues,
        6
    );
    assert_eq!(checks, 1); // Same-revision evidence reuses the completed cache.
    let mut edits = Vec::new();
    for table in [
        "entities",
        "context_bundles",
        "ai_conversations",
        "app_kv",
        "entity_redirects",
        "book_aliases",
    ] {
        for row in plan
            .page(table, 0, 100)
            .unwrap()
            .entries
            .into_iter()
            .filter(|r| r.selectable)
        {
            edits.push(RowChoiceEdit {
                table: table.into(),
                entry_id: row.entry_id,
                choice: if ["entity_redirects", "book_aliases"].contains(&table) {
                    RowChoice::Target
                } else {
                    RowChoice::Source
                },
            });
        }
    }
    let next = plan
        .choose_rows(
            RowChoiceRequest {
                expected_revision: revision.clone(),
                edits,
            },
            || Ok(()),
        )
        .unwrap()
        .revision;
    assert_eq!(
        plan.row_issues(revision, 0, 100, || Ok(()))
            .err()
            .unwrap()
            .code,
        "backup/changed"
    );
    assert!(plan.row_issues(next.clone(), 0, 100, || Ok(())).is_err());
    let repaired = plan.check_rows(next.clone(), || Ok(())).unwrap();
    assert!(repaired.constraints_passed);
    assert_eq!(repaired.issues, 0);
    assert!(
        serde_json::to_value(plan.row_issues(next, 0, 100, || Ok(())).unwrap()).unwrap()["entries"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(!candidate_exists());
    assert_eq!(
        target
            .query_row("SELECT count(*) FROM ai_messages", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        target
            .query_row(
                "SELECT keep_id FROM entity_redirects WHERE merged_id='b'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "c"
    );
}

#[test]
fn backup_row_structure_handles_unique_swaps_and_conflicts_without_running_target_triggers() {
    use super::choices::{RowChoice, RowChoiceEdit, RowChoiceRequest};
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(&root.path().join("db"));
    for (id, text) in [("a", "A"), ("b", "B"), ("c", "C")] {
        memory(&target, id, text);
    }
    // Additional live constraint demonstrates that an insert may be invalid on
    // this target even when the independently preflighted source is sound.
    target.execute_batch("CREATE UNIQUE INDEX proof_unique_content ON memories(content); CREATE TRIGGER proof_no_insert BEFORE INSERT ON memories BEGIN SELECT RAISE(ABORT,'must not run in candidate'); END;").unwrap();
    let source = incoming(|conn, _| {
        memory(conn, "a", "B");
        memory(conn, "b", "A");
        memory(conn, "d", "C");
    });
    let plan = backup_archive::plan_events_fixture(source, &mut target, stage.path(), || Ok(()))
        .unwrap()
        .plan_rows(&mut target, || Ok(()))
        .unwrap();
    let page = plan.page("memories", 0, 100).unwrap();
    let new = page
        .entries
        .iter()
        .find(|r| r.kind == RowMatchKind::SourceOnly)
        .unwrap()
        .entry_id;
    let edits = page
        .entries
        .into_iter()
        .filter(|r| r.selectable)
        .map(|r| RowChoiceEdit {
            table: "memories".into(),
            entry_id: r.entry_id,
            choice: if r.entry_id == new {
                RowChoice::Target
            } else {
                RowChoice::Source
            },
        })
        .collect();
    let rev = plan
        .choose_rows(
            RowChoiceRequest {
                expected_revision: page.decision_revision,
                edits,
            },
            || Ok(()),
        )
        .unwrap()
        .revision;
    assert!(
        plan.check_rows(rev.clone(), || Ok(()))
            .unwrap()
            .constraints_passed
    );
    let rev = plan
        .choose_rows(
            RowChoiceRequest {
                expected_revision: rev,
                edits: vec![RowChoiceEdit {
                    table: "memories".into(),
                    entry_id: new,
                    choice: RowChoice::Source,
                }],
            },
            || Ok(()),
        )
        .unwrap()
        .revision;
    let result = plan.check_rows(rev.clone(), || Ok(())).unwrap();
    assert!(!result.constraints_passed);
    assert_eq!(result.issues, 1);
    let page = serde_json::to_value(plan.row_issues(rev, 0, 100, || Ok(())).unwrap()).unwrap();
    assert_eq!(page["entries"][0]["kind"], "constraint");
    assert_eq!(page["entries"][0]["entryId"], new);
    assert_eq!(
        target
            .query_row("SELECT content FROM memories WHERE id='a'", [], |r| r
                .get::<_, String>(0))
            .unwrap(),
        "A"
    );
    assert_eq!(
        target
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name='proof_no_insert'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}

#[test]
fn backup_row_structure_turns_malformed_virtual_bindings_into_record_evidence() {
    for raw in [
        "not-json",
        "[]",
        r#"{"a":"bad","b":{"pluginId":3,"providerId":"feed","key":"entry"}}"#,
    ] {
        let root = tempfile::tempdir().unwrap();
        let stage = tempfile::tempdir().unwrap();
        let mut target = db(&root.path().join("db"));
        kv(&target, "read-aware-virtual-books", raw);
        let source = incoming(|_, _| {});
        let plan =
            backup_archive::plan_events_fixture(source, &mut target, stage.path(), || Ok(()))
                .unwrap()
                .plan_rows(&mut target, || Ok(()))
                .unwrap();
        let rev = plan.row_decisions(|| Ok(())).unwrap().revision;
        let report = plan.check_rows(rev.clone(), || Ok(())).unwrap();
        assert_eq!(report.issues, 1);
        assert!(!report.constraints_passed);
        let page = serde_json::to_value(plan.row_issues(rev, 0, 100, || Ok(())).unwrap()).unwrap();
        assert_eq!(page["entries"][0]["kind"], "virtualBinding");
        assert_eq!(page["entries"][0]["table"], "app_kv");
        assert!(page["entries"][0]["entryId"].is_number());
    }
}
