use super::*;
fn database(root: &Path) -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open(root.join("db")).unwrap();
    crate::storage::apply_connection_pragmas(&conn).unwrap();
    crate::storage::register_sql_functions(&conn).unwrap();
    crate::storage::run_migrations(&mut conn).unwrap();
    crate::storage::ensure_local_device(&conn).unwrap();
    conn
}
const PASSWORD: &str = "a real import password";
fn archive(source: &Path, out: &Path, staging: &Path) -> std::path::PathBuf {
    let mut conn = database(source);
    conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES ('private','\"PRIVATE IMPORT CONTENT\"','now')", []).unwrap();
    crate::storage::put_blob_inner(
        &conn,
        source,
        "booktext:synthetic",
        None,
        b"PRIVATE FILE CONTENT",
    )
    .unwrap();
    let snapshot =
        crate::storage::backup_snapshot::capture_fixture(&mut conn, source, staging, |_| Ok(()))
            .unwrap();
    let path = out.join("source.age");
    backup_archive::write_archive(
        &snapshot,
        SecretString::from(PASSWORD.to_owned()),
        &path,
        || Ok(()),
    )
    .unwrap();
    path
}
#[test]
fn backup_import_real_archive_to_private_plan_preserves_target_and_rejects_wrong_owner_or_phase() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let path = archive(source.path(), out.path(), staging.path());
    let ciphertext = std::fs::read(&path).unwrap();
    let mut conn = database(target.path());
    let root = BackupStaging::fixture(staging.path());
    let tasks = BackupTasks::default();
    let id = uuid::Uuid::new_v4().to_string();
    let source_receipt = open_source(
        tasks.begin("main", &id).unwrap(),
        id.clone(),
        &path,
        SecretString::from(PASSWORD.to_owned()),
        &root,
        |_| Ok(()),
    )
    .unwrap();
    assert_eq!(source_receipt.blobs, 1);
    assert_eq!(source_receipt.format, 2);
    assert!(!serde_json::to_string(&source_receipt)
        .unwrap()
        .contains("PRIVATE"));
    assert!(tasks
        .begin("main", &uuid::Uuid::new_v4().to_string())
        .is_err());
    assert!(tasks.take("foreign", &id, Phase::Source).is_err());
    assert!(tasks.take("main", &id, Phase::Export).is_err());
    let receipt = build_plan(
        &tasks,
        "main",
        id.clone(),
        &mut conn,
        target.path(),
        crate::plugins::BundledPrograms::fixture(target.path()),
        &root,
        |_| Ok(()),
    )
    .unwrap();
    assert_eq!(receipt.files.source_only, 1);
    assert!(
        receipt.tables["app_kv"]
            .comparisons
            .as_ref()
            .unwrap()
            .source_only
            > 0
    );
    assert!(!serde_json::to_string(&receipt).unwrap().contains("PRIVATE"));
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM app_kv WHERE key='private'", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(std::fs::read(&path).unwrap(), ciphertext);
    assert!(tasks.take("main", &id, Phase::Source).is_err());
    let (lease, prepared) = tasks.take("main", &id, Phase::Plan).unwrap();
    let PreparedBackup::Plan(plan) = prepared else {
        panic!("expected plan")
    };
    let private = plan
        .rows()
        .events()
        .source()
        .archive()
        .directory()
        .to_owned();
    {
        let tx = conn.transaction().unwrap();
        plan.verify_target(&tx, target.path(), || Ok(())).unwrap();
    }
    conn.execute(
        "INSERT INTO app_kv(key,value_json,updated_at) VALUES ('changed','true','now')",
        [],
    )
    .unwrap();
    {
        let tx = conn.transaction().unwrap();
        assert_eq!(
            plan.verify_target(&tx, target.path(), || Ok(()))
                .unwrap_err()
                .code,
            "backup/changed"
        );
    }
    lease.publish(PreparedBackup::Plan(plan)).unwrap();
    tasks.cancel_owner("main");
    assert!(!private.exists());
    assert!(tasks.is_empty());
}
#[test]
fn backup_import_failure_and_cancellation_release_source_and_shared_reservation() {
    let source = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let path = archive(source.path(), out.path(), staging.path());
    let root = BackupStaging::fixture(staging.path());
    let tasks = BackupTasks::default();
    for cancel in [false, true] {
        let id = uuid::Uuid::new_v4().to_string();
        let lease = tasks.begin("main", &id).unwrap();
        let error = open_source(
            lease,
            id.clone(),
            &path,
            SecretString::from("incorrect password".to_owned()),
            &root,
            |_| {
                if cancel {
                    tasks.cancel("main", Some(&id))?;
                }
                Ok(())
            },
        )
        .err()
        .unwrap();
        assert_eq!(
            error.code,
            if cancel {
                "backup/cancelled"
            } else {
                "backup/unlock-failed"
            }
        );
        assert!(tasks.is_empty());
        assert_eq!(
            crate::storage::backup_staging::fixture_entries(staging.path())
                .unwrap()
                .count(),
            0
        );
        assert_eq!(root.cleanup().unwrap().active, 0);
    }
}

#[test]
fn backup_import_cancel_after_decryption_and_during_planning_erases_private_work() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let path = archive(source.path(), out.path(), staging.path());
    let root = BackupStaging::fixture(staging.path());
    let tasks = BackupTasks::default();
    let id = uuid::Uuid::new_v4().to_string();
    let error = open_source(
        tasks.begin("main", &id).unwrap(),
        id.clone(),
        &path,
        SecretString::from(PASSWORD.to_owned()),
        &root,
        |phase| {
            if phase == ImportProgress::CheckingSource {
                tasks.cancel("main", Some(&id))?;
            }
            Ok(())
        },
    )
    .err()
    .unwrap();
    assert_eq!(error.code, "backup/cancelled");
    assert!(tasks.is_empty());
    assert_eq!(
        crate::storage::backup_staging::fixture_entries(staging.path())
            .unwrap()
            .count(),
        0
    );
    assert_eq!(root.cleanup().unwrap().active, 0);

    let id = uuid::Uuid::new_v4().to_string();
    open_source(
        tasks.begin("main", &id).unwrap(),
        id.clone(),
        &path,
        SecretString::from(PASSWORD.to_owned()),
        &root,
        |_| Ok(()),
    )
    .unwrap();
    let mut conn = database(target.path());
    let error = build_plan(
        &tasks,
        "main",
        id.clone(),
        &mut conn,
        target.path(),
        crate::plugins::BundledPrograms::fixture(target.path()),
        &root,
        |phase| {
            if phase == ImportProgress::ComparingRows {
                tasks.cancel("main", Some(&id))?;
            }
            Ok(())
        },
    )
    .err()
    .unwrap();
    assert_eq!(error.code, "backup/cancelled");
    assert!(tasks.is_empty());
    assert_eq!(
        crate::storage::backup_staging::fixture_entries(staging.path())
            .unwrap()
            .count(),
        0
    );
    assert_eq!(root.cleanup().unwrap().active, 0);
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM app_kv WHERE key='private'", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
