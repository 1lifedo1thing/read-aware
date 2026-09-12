use super::super::tests::{db, rows, source};
use super::*;
use std::fs;

fn plugin(root: &Path, folder: &str, id: &str, schema: i64, main: bool) {
    let dir = root.join(folder).join(id);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("manifest.json"),serde_json::json!({"id":id,"name":"Proof","version":"1.0.0","schemaVersion":schema,"requires":{}}).to_string()).unwrap();
    if main {
        fs::write(
            dir.join("main.js"),
            format!("export const version = {schema};"),
        )
        .unwrap();
    }
}
fn reference(c: &ProgramCandidate) -> ProgramRef {
    ProgramRef {
        side: c.side,
        root: c.root.clone(),
        sha256: c.sha256.clone(),
    }
}
fn choose(facts: &[ProgramFacts], side: Side) -> BTreeMap<String, ProgramChoice> {
    facts
        .iter()
        .map(|f| {
            (
                f.id.clone(),
                ProgramChoice {
                    program: f.candidates.iter().find(|c| c.side == side).map(reference),
                    data: side,
                },
            )
        })
        .collect()
}
#[test]
fn backup_programs_bind_whole_code_and_namespace_choices_without_private_bodies_or_writes() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    plugin(root.path(), "plugins", "proof", 1, true);
    let input = source(|conn, root| {
        plugin(root, "plugins", "proof", 3, true);
        conn.execute_batch("INSERT INTO app_kv VALUES ('read-aware-plugin.proof.entry','private-value','now'); INSERT INTO app_kv VALUES ('read-aware-plugin-host.schema.proof','2','now'); INSERT INTO app_kv VALUES ('read-aware-plugin.orphan.entry','retained-data','now'); INSERT INTO plugin_documents(plugin_id,collection,id,json,updated_at) VALUES ('proof','notes','one','{\"body\":\"private-doc\"}','now');").unwrap();
    });
    let plan = rows(input, &mut target, stage.path())
        .plan_files(&mut target, root.path(), || Ok(()))
        .unwrap();
    let tx = target.transaction().unwrap();
    let facts = plan.program_facts(&tx, root.path(), || Ok(())).unwrap();
    assert_eq!(facts.len(), 2);
    let fact = facts.iter().find(|f| f.id == "proof").unwrap();
    assert_eq!(fact.source_data.schema, Some(2));
    assert_eq!(fact.source_data.kv_rows, 1);
    assert_eq!(fact.source_data.documents, 1);
    assert_eq!(fact.candidates.len(), 2);
    assert_ne!(fact.candidates[0].sha256, fact.candidates[1].sha256);
    let json = serde_json::to_string(&facts).unwrap();
    assert!(!json.contains("private-value"));
    assert!(!json.contains("private-doc"));
    assert!(json.contains("sourceData"));
    assert!(json.contains("mainPresent"));
    // Optional bridge proof: actual native catalog consumed by the host test.
    if let Ok(path) = std::env::var("READAWARE_PROGRAM_FACTS_PROOF") {
        fs::write(path, &json).unwrap();
    }
    let choices = choose(&facts, Side::Source);
    let decisions = plan
        .prepare_programs(&tx, root.path(), &choices, || Ok(()))
        .unwrap();
    let proof = decisions.iter().find(|d| d.id == "proof").unwrap();
    assert_eq!(proof.destination.as_deref(), Some("plugins/proof"));
    assert_eq!(proof.data_facts.schema, Some(2));
    assert!(decisions
        .iter()
        .find(|d| d.id == "orphan")
        .unwrap()
        .destination
        .is_none());
    assert_eq!(
        fs::read_to_string(root.path().join("plugins/proof/main.js")).unwrap(),
        "export const version = 1;"
    );
    assert_eq!(
        tx.query_row("SELECT count(*) FROM app_kv", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let mut bad = choices.clone();
    bad.remove("orphan");
    assert_eq!(
        plan.prepare_programs(&tx, root.path(), &bad, || Ok(()))
            .unwrap_err()
            .code,
        "backup/incomplete"
    );
    let mut bad = choices;
    bad.get_mut("proof")
        .unwrap()
        .program
        .as_mut()
        .unwrap()
        .sha256 = "0".repeat(64);
    assert_eq!(
        plan.prepare_programs(&tx, root.path(), &bad, || Ok(()))
            .unwrap_err()
            .code,
        "backup/changed"
    );
}
#[test]
fn backup_programs_never_replace_current_builtins_or_inherit_source_bundled_trust() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    plugin(root.path(), "bundled-plugins", "dictionary", 1, true);
    let input = source(|_, root| {
        plugin(root, "bundled-plugins", "dictionary", 2, true);
        plugin(root, "bundled-plugins", "former-builtin", 1, true);
    });
    let plan = rows(input, &mut target, stage.path())
        .plan_files(&mut target, root.path(), || Ok(()))
        .unwrap();
    let tx = target.transaction().unwrap();
    let facts = plan.program_facts(&tx, root.path(), || Ok(())).unwrap();
    assert!(facts[0].builtin);
    assert!(!facts[1].builtin);
    let mut choices = choose(&facts, Side::Source);
    assert_eq!(
        plan.prepare_programs(&tx, root.path(), &choices, || Ok(()))
            .unwrap_err()
            .code,
        "backup/incomplete"
    );
    let current = facts[0]
        .candidates
        .iter()
        .find(|c| c.side == Side::Target)
        .unwrap();
    choices.get_mut("dictionary").unwrap().program = Some(reference(current));
    let decisions = plan
        .prepare_programs(&tx, root.path(), &choices, || Ok(()))
        .unwrap();
    assert_eq!(
        decisions[0].destination.as_deref(),
        Some("bundled-plugins/dictionary")
    );
    assert_eq!(
        decisions[1].destination.as_deref(),
        Some("plugins/former-builtin")
    );
}
#[test]
fn backup_programs_reject_missing_entries_stale_files_and_cancellation_without_applying() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    let input = source(|_, root| plugin(root, "plugins", "proof", 1, false));
    let path = input.archive().directory().to_owned();
    let plan = rows(input, &mut target, stage.path())
        .plan_files(&mut target, root.path(), || Ok(()))
        .unwrap();
    let tx = target.transaction().unwrap();
    let facts = plan.program_facts(&tx, root.path(), || Ok(())).unwrap();
    assert!(!facts[0].candidates[0].main_present);
    assert_eq!(
        plan.prepare_programs(&tx, root.path(), &choose(&facts, Side::Source), || Ok(()))
            .unwrap_err()
            .code,
        "backup/incomplete"
    );
    assert_eq!(
        plan.program_facts(&tx, root.path(), || Err(CommandError::new(
            "backup/cancelled",
            "cancel"
        )))
        .unwrap_err()
        .code,
        "backup/cancelled"
    );
    fs::write(path.join("plugins/proof/manifest.json"), "changed").unwrap();
    assert_eq!(
        plan.program_facts(&tx, root.path(), || Ok(()))
            .unwrap_err()
            .code,
        "backup/changed"
    );
    tx.rollback().unwrap();
    drop(plan);
    assert!(!path.exists());
    assert!(!root.path().join("plugins").exists());
}
#[test]
fn backup_programs_reject_noncanonical_target_schema_and_keep_data_only_owners() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    target
        .execute(
            "INSERT INTO app_kv VALUES ('read-aware-plugin-host.schema.only-data','01','now')",
            [],
        )
        .unwrap();
    let plan = rows(source(|_, _| {}), &mut target, stage.path())
        .plan_files(&mut target, root.path(), || Ok(()))
        .unwrap();
    let tx = target.transaction().unwrap();
    assert_eq!(
        plan.program_facts(&tx, root.path(), || Ok(()))
            .unwrap_err()
            .code,
        "backup/incomplete"
    );
}
