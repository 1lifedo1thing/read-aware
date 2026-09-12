use super::super::tests::{db, rows, source};
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;

fn secret(conn: &Connection, root: &Path, slot: &str, value: &str) {
    let sealed = crate::secrets::encrypt(root, value).unwrap();
    conn.execute(
        "INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,'now')",
        rusqlite::params![format!("read-aware-secret:{slot}"), sealed],
    )
    .unwrap();
}
fn roaming(conn: &Connection, slot: &str, value: serde_json::Value) {
    conn.execute(
        "INSERT INTO synced_preferences(key,value_json,updated_at) VALUES (?1,?2,'now')",
        rusqlite::params![format!("secret:{slot}"), value.to_string()],
    )
    .unwrap();
}
fn plan(
    input: crate::storage::backup_archive::PreflightedBackup,
    target: &mut Connection,
    root: &Path,
    stage: &Path,
) -> FilePlan {
    rows(input, target, stage)
        .plan_fixture_files(target, root, || Ok(()))
        .unwrap()
}
#[test]
fn backup_credentials_opens_production_typescript_vectors_and_binds_slot_key_and_version() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("backup_credentials_vectors.json")).unwrap();
    let mut native = Vec::new();
    for vector in fixture["vectors"].as_array().unwrap() {
        let key = STANDARD.decode(vector["key"].as_str().unwrap()).unwrap();
        let slot = vector["slot"].as_str().unwrap();
        let sealed = vector["sealed"].as_str().unwrap();
        let opened = vector["opened"].as_str().unwrap();
        assert_eq!(crypto::open(&key, slot, sealed).unwrap().as_str(), opened);
        assert!(crypto::open(&key, "ai-api-key.other", sealed).is_err());
        assert!(crypto::open(&[77; 32], slot, sealed).is_err());
        let mut wire = STANDARD.decode(sealed).unwrap();
        wire[0] = 2;
        assert!(crypto::open(&key, slot, &STANDARD.encode(&wire)).is_err());
        wire[0] = 1;
        *wire.last_mut().unwrap() ^= 1;
        assert!(crypto::open(&key, slot, &STANDARD.encode(&wire)).is_err());
        let fresh = crypto::seal(&key, slot, opened).unwrap();
        assert_eq!(crypto::open(&key, slot, &fresh).unwrap().as_str(), opened);
        native.push(
            serde_json::json!({"key":vector["key"],"slot":slot,"sealed":fresh,"opened":opened}),
        );
    }
    // Optional synthetic artifact lets the production TS openSecret verify the
    // reverse direction in the focused native/TS compatibility check.
    if let Some(path) = std::env::var_os("READAWARE_BACKUP_SECRET_VECTOR_OUTPUT") {
        fs::write(path, serde_json::to_vec(&native).unwrap()).unwrap();
    }
}
#[test]
fn backup_credentials_compares_plaintext_and_prepares_target_keyed_values_without_mutating_history(
) {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    let slot = "ai-api-key.proof";
    secret(
        &target,
        root.path(),
        "sync.master-key",
        &STANDARD.encode([2; 32]),
    );
    secret(&target, root.path(), "sync.session", "target session");
    secret(&target, root.path(), slot, "same local");
    roaming(
        &target,
        slot,
        serde_json::json!({"sealed":crypto::seal(&[2;32],slot,"target roamed").unwrap()}),
    );
    let input = source(|conn, root| {
        secret(conn, root, "sync.master-key", &STANDARD.encode([1; 32]));
        secret(conn, root, "sync.session", "source session");
        secret(conn, root, slot, "same local");
        secret(conn, root, "plugin.proof", "private plugin credential");
        let value =
            serde_json::json!({"sealed":crypto::seal(&[1;32],slot,"source roamed").unwrap()});
        roaming(conn, slot, value.clone());
        let payload = serde_json::json!({"key":format!("secret:{slot}"),"value":value});
        conn.execute("INSERT INTO domain_events(id,type,hlc_wall_ms,hlc_counter,hlc_device,payload_json,created_at) VALUES ('historic-secret','preference.changed',100,0,'source-device',?1,'now')", [payload.to_string()]).unwrap();
    });
    let historical: String = input
        .connection()
        .query_row(
            "SELECT payload_json FROM domain_events WHERE id='historic-secret'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let plan = plan(input, &mut target, root.path(), stage.path());
    let key_before = fs::read(root.path().join("secret.key")).unwrap();
    let tx = target.transaction().unwrap();
    let facts = plan.credential_facts(&tx, root.path(), || Ok(())).unwrap();
    assert_eq!(facts.len(), 2);
    let fact = facts.iter().find(|fact| fact.slot == slot).unwrap();
    assert!(fact.source_local && fact.target_local);
    assert_eq!(fact.local_equal, Some(true));
    assert_eq!(fact.source_roaming, RoamingState::Value);
    assert_eq!(fact.target_roaming, RoamingState::Value);
    assert_eq!(fact.source_local_matches_roaming, Some(false));
    assert_eq!(fact.target_local_matches_roaming, Some(false));
    let prepared = plan
        .prepare_credentials(
            &tx,
            root.path(),
            &BTreeMap::from([
                (slot.to_owned(), CredentialChoice::SourceRoaming),
                ("plugin.proof".to_owned(), CredentialChoice::SourceLocal),
            ]),
            || Ok(()),
        )
        .unwrap();
    assert!(prepared.new_key.is_none());
    let op = prepared
        .operations
        .iter()
        .find(|op| op.slot == slot)
        .unwrap();
    assert_eq!(
        crate::secrets::decrypt_existing(root.path(), op.local_sealed.as_ref().unwrap()).unwrap(),
        "source roamed"
    );
    assert!(matches!(op.roaming, RoamingPublication::Ready));
    let source = prepared.plan.rows().events().source().connection();
    assert_eq!(
        source
            .query_row(
                "SELECT payload_json FROM domain_events WHERE id='historic-secret'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        historical
    );
    assert_eq!(
        tx.query_row("SELECT count(*) FROM domain_events", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let original = roamed(source, Some(&[1; 32]), slot).unwrap();
    assert_eq!(original.value.unwrap().as_str(), "source roamed");
    assert_eq!(
        crypto::local(&tx, root.path(), slot)
            .unwrap()
            .unwrap()
            .as_str(),
        "same local"
    );
    assert_eq!(
        crypto::local(&tx, root.path(), "sync.session")
            .unwrap()
            .unwrap()
            .as_str(),
        "target session"
    );
    assert!(!format!("{prepared:?}").contains("source roamed"));
    prepared
        .plan
        .verify_target(&tx, root.path(), || Ok(()))
        .unwrap();
    tx.rollback().unwrap();
    assert_eq!(
        fs::read(root.path().join("secret.key")).unwrap(),
        key_before
    );
}
#[test]
fn backup_credentials_fresh_target_stages_private_key_and_keeps_offline_deletion_publication() {
    for has_value in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let stage = tempfile::tempdir().unwrap();
        let mut target = db(root.path());
        let input = source(|conn, root| {
            roaming(conn, "ai-api-key.deleted", serde_json::Value::Null);
            if has_value {
                secret(conn, root, "ai-api-key.new", "source value");
            }
        });
        let plan = plan(input, &mut target, root.path(), stage.path());
        let tx = target.transaction().unwrap();
        let mut choices = BTreeMap::from([(
            "ai-api-key.deleted".to_owned(),
            CredentialChoice::SourceRoaming,
        )]);
        if has_value {
            choices.insert("ai-api-key.new".to_owned(), CredentialChoice::SourceLocal);
        }
        let prepared = plan
            .prepare_credentials(&tx, root.path(), &choices, || Ok(()))
            .unwrap();
        assert_eq!(prepared.new_key.is_some(), has_value);
        assert!(!root.path().join("secret.key").exists());
        assert!(prepared
            .operations
            .iter()
            .all(|op| matches!(op.roaming, RoamingPublication::PendingConnection)));
        assert!(prepared
            .operations
            .iter()
            .find(|op| op.slot == "ai-api-key.deleted")
            .unwrap()
            .local_sealed
            .is_none());
        if has_value {
            let verifier = tempfile::tempdir().unwrap();
            fs::write(
                verifier.path().join("secret.key"),
                prepared.new_key.as_ref().unwrap().as_slice(),
            )
            .unwrap();
            let op = prepared
                .operations
                .iter()
                .find(|op| op.slot == "ai-api-key.new")
                .unwrap();
            assert_eq!(
                crate::secrets::decrypt_existing(
                    verifier.path(),
                    op.local_sealed.as_ref().unwrap()
                )
                .unwrap(),
                "source value"
            );
        }
        assert_eq!(
            tx.query_row("SELECT count(*) FROM app_kv", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        tx.rollback().unwrap();
    }
}
#[test]
fn backup_credentials_rejects_missing_extra_sync_or_locked_choices_and_cleans_partial_preparation()
{
    for case in 0..5 {
        let root = tempfile::tempdir().unwrap();
        let stage = tempfile::tempdir().unwrap();
        let mut target = db(root.path());
        let input = source(|conn, root| {
            secret(conn, root, "ai-api-key.a", "first valid value");
            roaming(
                conn,
                "ai-api-key.z",
                serde_json::json!({"sealed":"old inaccessible ciphertext"}),
            );
        });
        let source_dir = input.archive().directory().to_owned();
        let plan = plan(input, &mut target, root.path(), stage.path());
        let tx = target.transaction().unwrap();
        let facts = plan.credential_facts(&tx, root.path(), || Ok(())).unwrap();
        assert_eq!(facts[1].source_roaming, RoamingState::Locked);
        let mut choices = BTreeMap::from([
            ("ai-api-key.a".to_owned(), CredentialChoice::SourceLocal),
            ("ai-api-key.z".to_owned(), CredentialChoice::SourceRoaming),
        ]);
        match case {
            0 => {
                choices.remove("ai-api-key.z");
            }
            1 => {
                choices.insert("extra".to_owned(), CredentialChoice::TargetLocal);
            }
            2 => {
                choices.insert("sync.session".to_owned(), CredentialChoice::SourceLocal);
            }
            _ => {}
        }
        let mut checks = 0;
        let error = plan
            .prepare_credentials(&tx, root.path(), &choices, || {
                checks += 1;
                if case == 4 && checks == 2 {
                    Err(CommandError::new("backup/cancelled", "cancelled"))
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
        assert_eq!(
            error.code,
            if case == 3 {
                "secrets/unavailable"
            } else if case == 4 {
                "backup/cancelled"
            } else {
                "backup/incomplete"
            }
        );
        assert!(!root.path().join("secret.key").exists());
        assert!(!source_dir.exists());
        assert_eq!(fs::read_dir(stage.path()).unwrap().count(), 0);
        assert_eq!(
            tx.query_row("SELECT count(*) FROM app_kv", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        tx.rollback().unwrap();
    }
}
#[test]
fn backup_credentials_target_choices_preserve_absence_or_translate_its_roaming_value() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    secret(
        &target,
        root.path(),
        "sync.master-key",
        &STANDARD.encode([3; 32]),
    );
    roaming(
        &target,
        "ai-api-key.roamed",
        serde_json::json!({"sealed":crypto::seal(&[3;32],"ai-api-key.roamed","target value").unwrap()}),
    );
    let input = source(|conn, root| secret(conn, root, "ai-api-key.absent", "do not import"));
    let plan = plan(input, &mut target, root.path(), stage.path());
    let tx = target.transaction().unwrap();
    let prepared = plan
        .prepare_credentials(
            &tx,
            root.path(),
            &BTreeMap::from([
                (
                    "ai-api-key.absent".to_owned(),
                    CredentialChoice::TargetLocal,
                ),
                (
                    "ai-api-key.roamed".to_owned(),
                    CredentialChoice::TargetRoaming,
                ),
            ]),
            || Ok(()),
        )
        .unwrap();
    let absent = &prepared.operations[0];
    assert!(absent.local_sealed.is_none());
    assert!(matches!(absent.roaming, RoamingPublication::Ready));
    assert_eq!(
        crate::secrets::decrypt_existing(
            root.path(),
            prepared.operations[1].local_sealed.as_ref().unwrap()
        )
        .unwrap(),
        "target value"
    );
    tx.rollback().unwrap();
}

#[test]
fn backup_credentials_preserves_a_pending_deletion_with_no_local_or_roaming_row() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    let input = source(|conn, _| {
        conn.execute(
            "INSERT INTO restored_credential_publications VALUES ('ai-api-key.deleted','now')",
            [],
        )
        .unwrap();
    });
    let plan = plan(input, &mut target, root.path(), stage.path());
    let tx = target.transaction().unwrap();
    let facts = plan.credential_facts(&tx, root.path(), || Ok(())).unwrap();
    assert_eq!(facts.len(), 1);
    assert!(!facts[0].source_local);
    assert!(facts[0].source_pending_publication);
    assert!(!facts[0].target_pending_publication);
    assert_eq!(facts[0].source_roaming, RoamingState::Absent);
    let prepared = plan
        .prepare_credentials(
            &tx,
            root.path(),
            &BTreeMap::from([(
                "ai-api-key.deleted".to_owned(),
                CredentialChoice::SourceLocal,
            )]),
            || Ok(()),
        )
        .unwrap();
    assert!(prepared.operations[0].local_sealed.is_none());
    prepared.enqueue_publications(&tx).unwrap();
    assert!(crate::storage::restored_credentials::contains(&tx, "ai-api-key.deleted").unwrap());
    tx.rollback().unwrap();
    assert!(
        !crate::storage::restored_credentials::contains(&target, "ai-api-key.deleted").unwrap()
    );
}
