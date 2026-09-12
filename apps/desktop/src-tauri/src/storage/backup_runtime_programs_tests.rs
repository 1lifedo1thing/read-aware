use crate::error::CommandError;
use crate::storage::backup_snapshot::{files, BackupSnapshot};
use crate::{
    plugins::BundledPrograms,
    storage::{
        self,
        backup_archive::{self, AuthenticatedBackup},
    },
};
use rusqlite::Connection;
use std::path::Path;
use std::{
    fs,
    sync::{atomic::AtomicBool, Arc},
};
fn db(root: &Path) -> Connection {
    let mut conn = Connection::open(root.join("db")).unwrap();
    storage::apply_connection_pragmas(&conn).unwrap();
    storage::register_sql_functions(&conn).unwrap();
    storage::run_migrations(&mut conn).unwrap();
    storage::ensure_local_device(&conn).unwrap();
    conn
}
fn plugin(dir: &Path, id: &str, name: &str, body: &str) {
    fs::create_dir_all(dir.join("assets")).unwrap();
    fs::write(
        dir.join("manifest.json"),
        serde_json::json!({"id":id,"name":name,"version":"1.0.0","schemaVersion":1,"requires":{}})
            .to_string(),
    )
    .unwrap();
    fs::write(dir.join("main.js"), body).unwrap();
    fs::write(dir.join("assets/nested.txt"), "nested").unwrap();
}
fn authenticated(snapshot: &BackupSnapshot) -> backup_archive::PreflightedBackup {
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
#[test]
fn backup_runtime_programs_capture_and_plan_use_real_dist_not_stale_app_data() {
    let app = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut conn = db(app.path());
    plugin(
        &app.path().join("bundled-plugins/proof"),
        "proof",
        "Stale",
        "old",
    );
    plugin(
        &repo.path().join("proof/dist"),
        "proof",
        "Actual runtime",
        "live code",
    );
    fs::write(
        repo.path().join("proof/not-a-distribution-file.ts"),
        "source only",
    )
    .unwrap();
    let runtime = BundledPrograms::repo_fixture(repo.path());
    let snapshot = capture(&mut conn, app.path(), stage.path(), &runtime, |_| Ok(())).unwrap();
    assert_eq!(
        fs::read_to_string(snapshot.directory().join("bundled-plugins/proof/main.js")).unwrap(),
        "live code"
    );
    assert!(!snapshot
        .manifest
        .files
        .iter()
        .any(|f| f.path.contains("/dist/") || f.path.ends_with(".ts")));
    assert!(snapshot
        .manifest
        .files
        .iter()
        .any(|f| f.path == "bundled-plugins/proof/assets/nested.txt"));
    let plan = backup_archive::plan_events_fixture(
        authenticated(&snapshot),
        &mut conn,
        stage.path(),
        || Ok(()),
    )
    .unwrap()
    .plan_rows(&mut conn, || Ok(()))
    .unwrap()
    .plan_files(&mut conn, app.path(), runtime, || Ok(()))
    .unwrap();
    let tx = conn.transaction().unwrap();
    let facts = plan.program_facts(&tx, app.path(), || Ok(())).unwrap();
    assert!(
        facts[0].builtin,
        "dev runtime extra is trusted from target runtime, not the release embed list"
    );
    assert!(facts[0]
        .candidates
        .iter()
        .all(|c| c.manifest.contains("Actual runtime") && c.main_present));
    assert_eq!(facts[0].candidates[0].sha256, facts[0].candidates[1].sha256);
    fs::write(
        app.path().join("bundled-plugins/proof/main.js"),
        "irrelevant stale edit",
    )
    .unwrap();
    plan.verify_target(&tx, app.path(), || Ok(())).unwrap();
    fs::write(repo.path().join("proof/dist/main.js"), "new runtime code").unwrap();
    assert_eq!(
        plan.verify_target(&tx, app.path(), || Ok(()))
            .unwrap_err()
            .code,
        "backup/changed"
    );
}
#[test]
fn backup_runtime_programs_revalidation_sees_new_and_removed_dist_trees() {
    let app = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut conn = db(app.path());
    plugin(&repo.path().join("proof/dist"), "proof", "Proof", "one");
    let runtime = BundledPrograms::repo_fixture(repo.path());
    let snapshot = capture(&mut conn, app.path(), stage.path(), &runtime, |_| Ok(())).unwrap();
    let plan = backup_archive::plan_events_fixture(
        authenticated(&snapshot),
        &mut conn,
        stage.path(),
        || Ok(()),
    )
    .unwrap()
    .plan_rows(&mut conn, || Ok(()))
    .unwrap()
    .plan_files(&mut conn, app.path(), runtime, || Ok(()))
    .unwrap();
    let tx = conn.transaction().unwrap();
    plugin(
        &repo.path().join("extra/dist"),
        "extra",
        "Newly built",
        "new",
    );
    assert_eq!(
        plan.verify_target(&tx, app.path(), || Ok(()))
            .unwrap_err()
            .code,
        "backup/changed"
    );
    fs::remove_dir_all(repo.path().join("extra")).unwrap();
    plan.verify_target(&tx, app.path(), || Ok(())).unwrap();
    fs::remove_dir_all(repo.path().join("proof/dist")).unwrap();
    assert_eq!(
        plan.verify_target(&tx, app.path(), || Ok(()))
            .unwrap_err()
            .code,
        "backup/changed"
    );
}
#[test]
fn backup_runtime_programs_linked_or_cancelled_roots_never_publish_a_snapshot() {
    let app = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut conn = db(app.path());
    plugin(&repo.path().join("proof/dist"), "proof", "Proof", "one");
    let runtime = BundledPrograms::repo_fixture(repo.path());
    assert!(files::source_path(app.path(), Some(&runtime), "bundled-plugins/../outside").is_err());
    assert_eq!(
        runtime
            .ids(|| Err(CommandError::new("backup/cancelled", "cancel")))
            .unwrap_err()
            .code,
        "backup/cancelled"
    );
    #[cfg(unix)]
    {
        fs::rename(repo.path().join("proof/dist"), repo.path().join("original")).unwrap();
        std::os::unix::fs::symlink(repo.path().join("original"), repo.path().join("proof/dist"))
            .unwrap();
        assert!(capture(&mut conn, app.path(), stage.path(), &runtime, |_| Ok(())).is_err());
        assert_eq!(
            crate::storage::backup_staging::fixture_entries(stage.path())
                .unwrap()
                .count(),
            0
        );
    }
}

#[test]
fn backup_runtime_programs_rebuild_during_copy_cannot_publish_a_mixed_program() {
    let app = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut conn = db(app.path());
    plugin(
        &repo.path().join("proof/dist"),
        "proof",
        "Proof",
        "old code",
    );
    let runtime = BundledPrograms::repo_fixture(repo.path());
    let mut rebuilt = false;
    let error = capture(&mut conn, app.path(), stage.path(), &runtime, |progress| {
        if matches!(progress, crate::storage::backup_snapshot::CaptureProgress::Files { copied_bytes } if copied_bytes > 0) && !rebuilt {
            rebuilt = true;
            fs::write(repo.path().join("proof/dist/main.js"), "rebuilt code").unwrap();
        }
        Ok(())
    }).unwrap_err();
    assert!(rebuilt);
    assert_eq!(error.code, "backup/changed");
    assert_eq!(
        crate::storage::backup_staging::fixture_entries(stage.path())
            .unwrap()
            .count(),
        0
    );
    assert_eq!(
        fs::read_to_string(repo.path().join("proof/dist/main.js")).unwrap(),
        "rebuilt code"
    );
}

fn capture(
    conn: &mut Connection,
    data_dir: &Path,
    staging: &Path,
    bundled: &BundledPrograms,
    progress: impl FnMut(crate::storage::backup_snapshot::CaptureProgress) -> Result<(), CommandError>,
) -> Result<BackupSnapshot, CommandError> {
    crate::storage::backup_snapshot::capture(
        conn,
        data_dir,
        &crate::storage::backup_staging::BackupStaging::fixture(staging),
        bundled,
        progress,
    )
}
