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
fn db(root: &Path) -> Connection {
    let mut conn = Connection::open(root.join("db")).unwrap();
    storage::apply_connection_pragmas(&conn).unwrap();
    storage::register_sql_functions(&conn).unwrap();
    storage::run_migrations(&mut conn).unwrap();
    storage::ensure_local_device(&conn).unwrap();
    conn
}
fn source(edit: impl FnOnce(&Connection, &Path)) -> backup_archive::PreflightedBackup {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut conn = db(root.path());
    edit(&conn, root.path());
    let snapshot =
        backup_snapshot::capture(&mut conn, root.path(), stage.path(), |_| Ok(())).unwrap();
    let directory = tempfile::tempdir().unwrap();
    for file in &snapshot.manifest.files {
        let to = directory.path().join(&file.path);
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::copy(snapshot.directory().join(&file.path), to).unwrap();
    }
    backup_archive::preflight(
        AuthenticatedBackup {
            directory,
            manifest: snapshot.manifest.clone(),
        },
        Arc::new(AtomicBool::new(false)),
    )
    .unwrap()
}
fn plugin(root: &Path, folder: &str, body: &str) {
    let path = root.join(folder).join("proof");
    fs::create_dir_all(&path).unwrap();
    fs::write(
        path.join("manifest.json"),
        r#"{"id":"proof","version":"1.0.0","schemaVersion":1}"#,
    )
    .unwrap();
    fs::write(path.join("main.js"), body).unwrap();
}
fn blob(conn: &Connection, root: &Path, key: &str, content: &[u8]) {
    storage::put_blob_inner(conn, root, key, None, content).unwrap();
}
fn rows(
    source: backup_archive::PreflightedBackup,
    target: &mut Connection,
    stage: &Path,
) -> RowPlan {
    backup_archive::plan_events(source, target, stage, || Ok(()))
        .unwrap()
        .plan_rows(target, || Ok(()))
        .unwrap()
}
#[test]
fn backup_file_plan_compares_bytes_whole_programs_and_missing_or_orphan_targets_without_writes() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    for (key, bytes) in [
        ("same", b"same" as &[u8]),
        ("different", b"new"),
        ("target", b"kept"),
        ("missing", b"absent"),
        ("remote", b"remote"),
        ("corrupt", b"valid"),
    ] {
        blob(&target, root.path(), key, bytes);
    }
    for key in ["missing", "remote"] {
        fs::remove_file(root.path().join(format!("blobs/{key}"))).unwrap();
    }
    target
        .execute(
            "UPDATE blob_objects SET storage_uri=NULL WHERE key='remote'",
            [],
        )
        .unwrap();
    fs::write(root.path().join("blobs/corrupt"), b"other").unwrap();
    fs::write(root.path().join("blobs/orphan"), b"retain").unwrap();
    plugin(root.path(), "plugins", "new-program");
    plugin(root.path(), "bundled-plugins", "bundled-program");
    fs::create_dir_all(root.path().join("plugins/.candidates")).unwrap();
    fs::write(root.path().join("plugins/.candidates/private"), "unused").unwrap();
    crate::secrets::encrypt(root.path(), "target-secret").unwrap();
    let key_before = fs::read(root.path().join("secret.key")).unwrap();
    let input = source(|conn, root| {
        blob(conn, root, "same", b"same");
        blob(conn, root, "different", b"old");
        blob(conn, root, "source", b"source");
        blob(conn, root, "missing", b"absent");
        plugin(root, "plugins", "old-program");
        plugin(root, "bundled-plugins", "bundled-program");
        crate::secrets::encrypt(root, "source-secret").unwrap();
    });
    let plan = rows(input, &mut target, stage.path())
        .plan_files(&mut target, root.path(), || Ok(()))
        .unwrap();
    assert_eq!(plan.matches["blobs/same"].kind, FileMatchKind::Same);
    assert_eq!(
        plan.matches["blobs/different"].kind,
        FileMatchKind::Different
    );
    assert_eq!(plan.matches["blobs/source"].kind, FileMatchKind::SourceOnly);
    assert_eq!(plan.matches["blobs/target"].kind, FileMatchKind::TargetOnly);
    assert_eq!(
        plan.matches["blobs/remote"].kind,
        FileMatchKind::Unavailable
    );
    assert_eq!(
        plan.matches["blobs/missing"]
            .target_blob
            .as_ref()
            .unwrap()
            .availability,
        BlobAvailability::MissingLocalFile
    );
    assert_eq!(
        plan.matches["blobs/corrupt"]
            .target_blob
            .as_ref()
            .unwrap()
            .availability,
        BlobAvailability::RegistryMismatch
    );
    assert_eq!(
        plan.matches["blobs/orphan"]
            .target_blob
            .as_ref()
            .unwrap()
            .availability,
        BlobAvailability::UnregisteredFile
    );
    assert_eq!(
        plan.matches["secret.key"].policy,
        FilePolicy::PreserveCredentialKey
    );
    assert_eq!(plan.matches["secret.key"].kind, FileMatchKind::Different);
    assert_eq!(
        plan.programs
            .iter()
            .find(|p| p.root == "plugins/proof")
            .unwrap()
            .kind,
        FileMatchKind::Different
    );
    assert_eq!(
        plan.programs
            .iter()
            .find(|p| p.root == "bundled-plugins/proof")
            .unwrap()
            .kind,
        FileMatchKind::Same
    );
    assert!(plan
        .programs
        .iter()
        .all(|p| p.source.as_ref().unwrap().schema_version == 1
            && p.target.as_ref().unwrap().files == 2));
    assert!(!plan.matches.keys().any(|path| path.contains(".candidates")));
    let mut cursor = String::new();
    let mut seen = 0;
    loop {
        let page = plan.page(&cursor, 2).unwrap();
        seen += page.entries.len();
        if let Some(next) = page.next_after {
            cursor = next;
        } else {
            break;
        }
    }
    assert_eq!(seen, plan.matches.len());
    assert!(plan.page("", 101).is_err());
    plan.verify_source(|| Ok(())).unwrap();
    let tx = target.transaction().unwrap();
    plan.verify_target(&tx, root.path(), || Ok(())).unwrap();
    tx.rollback().unwrap();
    assert_eq!(
        fs::read(root.path().join("secret.key")).unwrap(),
        key_before
    );
    assert_eq!(
        fs::read(root.path().join("blobs/different")).unwrap(),
        b"new"
    );
    assert!(plan.rows().events().report.conflicting_events == 0);
}
#[test]
fn backup_file_plan_rejects_file_changes_even_with_unchanged_database_and_checks_source_again() {
    for change in 0..5 {
        let root = tempfile::tempdir().unwrap();
        let stage = tempfile::tempdir().unwrap();
        let mut target = db(root.path());
        plugin(root.path(), "plugins", "old");
        let plan = rows(
            source(|conn, root| blob(conn, root, "incoming", b"original")),
            &mut target,
            stage.path(),
        )
        .plan_files(&mut target, root.path(), || Ok(()))
        .unwrap();
        match change {
            0 => fs::write(root.path().join("plugins/proof/main.js"), "new").unwrap(),
            1 => fs::write(root.path().join("plugins/proof/added.txt"), "new").unwrap(),
            2 => fs::remove_file(root.path().join("plugins/proof/main.js")).unwrap(),
            3 => {
                crate::secrets::encrypt(root.path(), "new key").unwrap();
            }
            _ => {
                fs::create_dir_all(root.path().join("blobs")).unwrap();
                fs::write(root.path().join("blobs/orphan"), "new").unwrap();
            }
        }
        let tx = target.transaction().unwrap();
        plan.rows.events().verify_target(&tx, || Ok(())).unwrap();
        assert_eq!(
            plan.verify_target(&tx, root.path(), || Ok(()))
                .unwrap_err()
                .code,
            "backup/changed"
        );
        tx.rollback().unwrap();
        fs::write(
            plan.rows
                .events()
                .source()
                .archive()
                .directory()
                .join("blobs/incoming"),
            b"modified",
        )
        .unwrap();
        assert_eq!(
            plan.verify_source(|| Ok(())).unwrap_err().code,
            "backup/changed"
        );
    }
}
#[test]
fn backup_file_plan_cleans_cancelled_stages_and_interrupts_target_streaming() {
    let root = tempfile::tempdir().unwrap();
    let stage = tempfile::tempdir().unwrap();
    let mut target = db(root.path());
    let plan = rows(source(|_, _| {}), &mut target, stage.path());
    let private = plan.events().source().archive().directory().to_owned();
    let mut ticks = 0;
    // A target file created after row planning does not alter DB identity.
    fs::create_dir_all(root.path().join("blobs")).unwrap();
    fs::write(root.path().join("blobs/large"), vec![42; 8 * 1024 * 1024]).unwrap();
    let result = plan.plan_files(&mut target, root.path(), || {
        ticks += 1;
        // Count only callbacks from inventory streaming: use a standalone
        // collector cancellation proof below, and cancel this owned stage early.
        if ticks == 2 {
            Err(CommandError::new("backup/cancelled", "cancelled"))
        } else {
            Ok(())
        }
    });
    assert_eq!(result.unwrap_err().code, "backup/cancelled");
    assert!(!private.exists());
    assert_eq!(fs::read_dir(stage.path()).unwrap().count(), 0);
    assert!(target.is_autocommit());
    let mut chunks = 0;
    let mut progress = |event| {
        if let backup_snapshot::CaptureProgress::Files { copied_bytes } = event {
            if copied_bytes >= 2 * 1024 * 1024 {
                chunks += 1;
                return Err(CommandError::new(
                    "backup/cancelled",
                    "cancelled while hashing",
                ));
            }
        }
        Ok(())
    };
    let mut collector = backup_snapshot::files::FileCollector::inspect(root.path(), &mut progress);
    assert_eq!(collector.blobs().unwrap_err().code, "backup/cancelled");
    assert_eq!(chunks, 1);
    assert_eq!(
        fs::metadata(root.path().join("blobs/large")).unwrap().len(),
        8 * 1024 * 1024
    );
}
#[cfg(unix)]
#[test]
fn backup_file_plan_rejects_symlinks_and_cross_side_case_aliases() {
    for case in 0..3 {
        let root = tempfile::tempdir().unwrap();
        let stage = tempfile::tempdir().unwrap();
        let mut target = db(root.path());
        let input = source(|conn, root| blob(conn, root, "UPPER", b"source"));
        let plan = rows(input, &mut target, stage.path());
        match case {
            0 => std::os::unix::fs::symlink("missing-target", root.path().join("plugins")).unwrap(),
            1 => std::os::unix::fs::symlink("missing-key", root.path().join("secret.key")).unwrap(),
            _ => {
                fs::create_dir_all(root.path().join("blobs")).unwrap();
                fs::write(root.path().join("blobs/upper"), b"target").unwrap();
            }
        }
        assert!(plan
            .plan_files(&mut target, root.path(), || Ok(()))
            .is_err());
        assert_eq!(fs::read_dir(stage.path()).unwrap().count(), 0);
    }
}
