use super::super::programs::ProgramRef;
use super::super::tests::{db, rows, source};
use super::*;
use serde_json::json;

#[test]
fn backup_program_stage_isolates_real_documents_and_cas_until_restore_and_cleans_code() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    target
        .execute(
            "INSERT INTO app_kv VALUES ('read-aware-plugin.proof.value','\"target\"','now')",
            [],
        )
        .unwrap();
    let input = source(|conn, root| {
        let dir = root.join("plugins/proof");
        fs::create_dir_all(dir.join("modules")).unwrap();
        fs::write(
            dir.join("manifest.json"),
            r#"{"id":"proof","version":"1.0.0","schemaVersion":2}"#,
        )
        .unwrap();
        fs::write(
            dir.join("main.js"),
            "import './modules/data.js'; export default { activate(){} };",
        )
        .unwrap();
        fs::write(dir.join("modules/data.js"), "export const value = 2;").unwrap();
        conn.execute_batch("INSERT INTO app_kv VALUES ('read-aware-plugin.proof.value','\"source\"','now'); INSERT INTO app_kv VALUES ('read-aware-plugin.proof.schedule-state','{}','now'); INSERT INTO app_kv VALUES ('read-aware-plugin-host.schema.proof','1','now'); INSERT INTO plugin_documents(plugin_id,collection,id,json,updated_at) VALUES ('proof','notes','one','{\"body\":\"old\"}','old'),('proof','notes','two','{}','old');").unwrap();
    });
    let plan = rows(input, &mut target, stage.path())
        .plan_fixture_files(&mut target, root.path(), || Ok(()))
        .unwrap();
    let tx = target.transaction().unwrap();
    let facts = plan.program_facts(&tx, root.path(), || Ok(())).unwrap();
    let candidate = &facts[0].candidates[0];
    let choices = BTreeMap::from([(
        "proof".into(),
        ProgramChoice {
            program: Some(ProgramRef {
                side: candidate.side,
                root: candidate.root.clone(),
                sha256: candidate.sha256.clone(),
            }),
            data: Side::Source,
        },
    )]);
    assert!(plan
        .stage_program(
            &tx,
            root.path(),
            ProgramStageRequest {
                id: "proof".into(),
                choices: choices.clone(),
                consented: false
            },
            || Ok(())
        )
        .is_err());
    let receipt = plan
        .stage_program(
            &tx,
            root.path(),
            ProgramStageRequest {
                id: "proof".into(),
                choices: choices.clone(),
                consented: true,
            },
            || Ok(()),
        )
        .unwrap();
    let code = root.path().join("plugins/.candidates").join(&receipt.token);
    assert!(code.join("modules/data.js").is_file());
    assert_eq!(receipt.storage.get("value").unwrap(), "\"source\"");
    assert!(!receipt.storage.contains_key("schedule-state"));
    let query = |value| {
        plan.stage_storage(
            &receipt.token,
            serde_json::from_value(value).unwrap(),
            || Ok(()),
        )
        .unwrap()
    };
    let page = query(json!({"kind":"docsPage","collection":"notes","query":{"limit":1}}));
    let revision = page["items"][0]["revision"].as_str().unwrap();
    let id = page["items"][0]["id"].as_str().unwrap();
    let mutation = json!({"kind":"docsApply","changes":[{"kind":"put","collection":"notes","id":id,"expectedRevision":revision,"json":"{\"migrated\":true}"}]});
    assert_eq!(query(mutation.clone())["status"], "applied");
    assert_eq!(query(mutation)["status"], "conflict");
    assert_eq!(
        query(
            json!({"kind":"docsPage","collection":"notes","query":{"limit":1,"cursor":page["nextCursor"]}})
        )["status"],
        "stale-cursor"
    );
    query(json!({"kind":"set","key":"value","json":"\"migrated\""}));
    let snapshot = query(json!({"kind":"snapshot","schemaVersion":2}));
    assert_eq!(snapshot["schema"], "2");
    assert_eq!(snapshot["kv"]["value"], "\"migrated\"");
    assert_eq!(
        storage::get_kv_inner(&tx, "read-aware-plugin.proof.value")
            .unwrap()
            .as_deref(),
        Some("\"target\"")
    );
    assert_eq!(
        storage::plugin_data_snapshot_conn(plan.rows.events().source().connection(), "proof")
            .unwrap()
            .kv["value"],
        "\"source\""
    );
    assert!(plan
        .stage_storage(
            "forged",
            ProgramStageQuery::Get {
                key: "value".into()
            },
            || Ok(())
        )
        .is_err());
    assert!(plan
        .stage_storage(
            &receipt.token,
            ProgramStageQuery::Remove {
                key: "value".into()
            },
            || Err(CommandError::new("backup/cancelled", "test"))
        )
        .is_err());
    assert_eq!(query(json!({"kind":"get","key":"value"})), "\"migrated\"");
    query(json!({"kind":"docsPut","collection":"notes","id":"new","json":"{\"new\":true}"}));
    assert_eq!(
        query(json!({"kind":"docsGet","collection":"notes","id":"new"}))["json"],
        "{\"new\":true}"
    );
    assert_eq!(
        query(json!({"kind":"docsList","collection":"notes","limit":10}))
            .as_array()
            .unwrap()
            .len(),
        3
    );
    query(json!({"kind":"docsDelete","collection":"notes","id":"new"}));
    assert!(query(json!({"kind":"docsGet","collection":"notes","id":"new"})).is_null());
    // Retrying one program replaces and retires its previous code and database.
    let replacement = plan
        .stage_program(
            &tx,
            root.path(),
            ProgramStageRequest {
                id: "proof".into(),
                choices,
                consented: true,
            },
            || Ok(()),
        )
        .unwrap();
    assert!(!code.exists());
    let replacement_code = root
        .path()
        .join("plugins/.candidates")
        .join(replacement.token);
    assert!(replacement_code.exists());
    drop(tx);
    drop(plan);
    assert!(!replacement_code.exists());
    assert!(!root.path().join("plugins/proof").exists());
}
