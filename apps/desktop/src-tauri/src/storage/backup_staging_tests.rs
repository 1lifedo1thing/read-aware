use super::*;
use std::process::{Child, Command, Stdio};

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[test]
fn backup_staging_child_process() {
    let Some(root) = std::env::var_os("READAWARE_BACKUP_LEASE_CHILD") else {
        return;
    };
    let root = PathBuf::from(root);
    let stage = BackupDirectory::new_fixture(&root).unwrap();
    fs::write(stage.path().join("secret.key"), b"synthetic key material").unwrap();
    fs::write(
        root.join(CONTROL).join("child-ready"),
        stage
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .as_bytes(),
    )
    .unwrap();
    loop {
        std::thread::park();
    }
}
#[test]
fn backup_staging_preserves_live_cross_process_work_and_removes_it_only_after_process_death() {
    let root = tempfile::tempdir().unwrap();
    let owner = BackupStaging::fixture(root.path());
    let mut child = ChildGuard(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "storage::backup_staging::tests::backup_staging_child_process",
                "--nocapture",
            ])
            .env("READAWARE_BACKUP_LEASE_CHILD", root.path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap(),
    );
    let ready = root.path().join(CONTROL).join("child-ready");
    let start = std::time::Instant::now();
    while !ready.exists() {
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "lease child exited before readiness"
        );
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "lease child did not become ready"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    let path = root.path().join(fs::read_to_string(&ready).unwrap());
    let parent = BackupDirectory::new_fixture(root.path()).unwrap();
    let parent_path = parent.path().to_owned();
    let report = owner.cleanup().unwrap();
    assert_eq!(report.active, 2);
    assert_eq!(report.removed, 0);
    assert!(path.join("secret.key").exists());
    drop(parent);
    assert!(!parent_path.exists());
    assert!(child.0.try_wait().unwrap().is_none());
    child.0.kill().unwrap();
    child.0.wait().unwrap();
    let report = BackupStaging::fixture(root.path()).cleanup().unwrap();
    assert_eq!(report.active, 0);
    assert_eq!(report.removed, 1);
    assert!(!path.exists());
    assert_eq!(fixture_entries(root.path()).unwrap().count(), 0);
}
#[test]
fn backup_staging_registry_serializes_creation_and_cleanup_and_drop_defers_safely() {
    let root = tempfile::tempdir().unwrap();
    let owner = BackupStaging::fixture(root.path());
    let stage = BackupDirectory::new_fixture(root.path()).unwrap();
    let path = stage.path().to_owned();
    let registry = owner.registry().unwrap();
    assert_eq!(
        BackupDirectory::new_fixture(root.path()).unwrap_err().code,
        "db/locked"
    );
    assert_eq!(owner.cleanup().unwrap_err().code, "db/locked");
    drop(stage);
    assert!(
        path.exists(),
        "busy cleanup keeps the orphan for a later pass"
    );
    drop(registry);
    assert_eq!(owner.cleanup().unwrap().removed, 1);
    assert!(!path.exists());
}
#[test]
fn backup_staging_never_follows_links_or_deletes_unrecognized_payloads() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let owner = BackupStaging::fixture(root.path());
    fs::write(outside.path().join("keep"), "not staging").unwrap();
    let unknown = root.path().join("stage-aaaaaaaaaaaaaaaa");
    fs::create_dir(&unknown).unwrap();
    fs::write(unknown.join("payload"), "missing lease").unwrap();
    let empty = root.path().join("stage-bbbbbbbbbbbbbbbb");
    fs::create_dir(&empty).unwrap();
    let foreign = root.path().join("stage-cccccccccccccccc");
    fs::create_dir(&foreign).unwrap();
    let db = Connection::open(foreign.join(LEASE)).unwrap();
    db.execute_batch("PRAGMA application_id=123;").unwrap();
    drop(db);
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.path(), root.path().join("stage-dddddddddddddddd")).unwrap();
    let report = owner.cleanup().unwrap();
    assert_eq!(report.removed, 1);
    assert!(report.skipped >= 2);
    assert!(!empty.exists());
    assert!(unknown.join("payload").exists());
    assert!(foreign.join(LEASE).exists());
    assert!(outside.path().join("keep").exists());
    #[cfg(unix)]
    {
        let linked = root.path().join("linked-root");
        std::os::unix::fs::symlink(outside.path(), &linked).unwrap();
        assert!(BackupDirectory::new_fixture(&linked).is_err());
        assert!(!outside.path().join(CONTROL).exists());
    }
}
#[test]
fn backup_staging_is_private_and_normal_drop_removes_payload_and_lease() {
    let root = tempfile::tempdir().unwrap();
    let stage = BackupDirectory::new_fixture(root.path()).unwrap();
    let path = stage.path().to_owned();
    fs::write(stage.path().join("database.sqlite"), "synthetic plaintext").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for dir in [root.path(), stage.path(), &root.path().join(CONTROL)] {
            assert_eq!(
                fs::metadata(dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
    }
    assert!(path.join(LEASE).exists());
    drop(stage);
    assert!(!path.exists());
    assert_eq!(fixture_entries(root.path()).unwrap().count(), 0);
}

#[test]
fn backup_staging_interrupted_cleanup_retains_ownership_until_all_payload_is_removed() {
    let root = tempfile::tempdir().unwrap();
    let owner = BackupStaging::fixture(root.path());
    let mut stage = BackupDirectory::new_fixture(root.path()).unwrap();
    fs::write(stage.path().join("one"), "first payload").unwrap();
    fs::write(stage.path().join("two"), "second payload").unwrap();
    let path = stage.directory.take().unwrap().keep();
    let lease = stage.lease.take();
    drop(stage);
    let _registry = owner.registry().unwrap();
    let result = erase(&path, lease, || {
        Err(CommandError::new(
            "backup/cancelled",
            "injected interruption",
        ))
    });
    assert!(result.is_err());
    assert!(path.join(LEASE).exists());
    assert_eq!(
        fs::read_dir(&path).unwrap().count(),
        2,
        "one payload plus its lease still exist"
    );
    drop(_registry);
    assert_eq!(owner.cleanup().unwrap().removed, 1);
    assert!(!path.exists());
}
