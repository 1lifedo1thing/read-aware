use super::*;
use crate::storage::backup_snapshot::CODE_CANCELLED;
use crate::storage::{self, backup_snapshot};
use std::io::Cursor;
fn password() -> SecretString {
    SecretString::from("a test password with enough words".to_owned())
}
fn snapshot(root: &Path, staging: &Path) -> BackupSnapshot {
    let mut conn = rusqlite::Connection::open(root.join("db")).unwrap();
    storage::apply_connection_pragmas(&conn).unwrap();
    storage::register_sql_functions(&conn).unwrap();
    storage::run_migrations(&mut conn).unwrap();
    storage::ensure_local_device(&conn).unwrap();
    conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES ('read-aware-private','VERY PRIVATE DATABASE CONTENT','now')", []).unwrap();
    let sealed = crate::secrets::encrypt(root, "PRIVATE API CREDENTIAL").unwrap();
    conn.execute(
        "INSERT INTO app_kv(key,value_json,updated_at) VALUES ('read-aware-secret:test',?1,'now')",
        [&sealed],
    )
    .unwrap();
    storage::put_blob_inner(
        &conn,
        root,
        "bookfile:archive",
        None,
        &vec![37; CHUNK * 2 + 79],
    )
    .unwrap();
    // GNU long paths and Unicode are round-tripped without unbounded metadata.
    let plugin = root.join("plugins/archive");
    fs::create_dir_all(&plugin).unwrap();
    fs::write(
        plugin.join("manifest.json"),
        "{\"id\":\"archive\",\"schemaVersion\":1}",
    )
    .unwrap();
    fs::write(
        plugin.join(format!("{}中文.txt", "x".repeat(130))),
        "PLUGIN CONTENT",
    )
    .unwrap();
    backup_snapshot::capture_fixture(&mut conn, root, staging, |_| Ok(())).unwrap()
}
#[test]
fn backup_archive_real_password_roundtrip_authenticates_all_members_and_preserves_destination_on_failure(
) {
    let data = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let snapshot = snapshot(data.path(), staging.path());
    let destination = staging.path().join("backup.age");
    fs::write(&destination, "OLD FILE").unwrap();
    assert_eq!(
        write_archive(&snapshot, password(), &destination, || Err(
            CommandError::new(CODE_CANCELLED, "cancelled")
        ))
        .unwrap_err()
        .code,
        CODE_CANCELLED
    );
    assert_eq!(fs::read(&destination).unwrap(), b"OLD FILE");
    write_archive(&snapshot, password(), &destination, || Ok(())).unwrap();
    let ciphertext = fs::read(&destination).unwrap();
    assert!(ciphertext.starts_with(b"age-encryption.org/v1\n"));
    for secret in [
        "VERY PRIVATE DATABASE CONTENT",
        "PRIVATE API CREDENTIAL",
        "manifest.json",
        "bookfile:archive",
    ] {
        assert!(!String::from_utf8_lossy(&ciphertext).contains(secret));
    }
    let read_root = tempfile::tempdir().unwrap();
    let restored = read_archive(ciphertext.as_slice(), password(), read_root.path(), || {
        Ok(())
    })
    .unwrap();
    assert_eq!(restored.manifest, snapshot.manifest);
    for member in &snapshot.manifest.files {
        assert_eq!(
            fs::read(restored.directory().join(&member.path)).unwrap(),
            fs::read(snapshot.directory().join(&member.path)).unwrap()
        );
    }
    let copied = rusqlite::Connection::open(restored.directory().join("database.sqlite")).unwrap();
    let sealed: String = copied
        .query_row(
            "SELECT value_json FROM app_kv WHERE key='read-aware-secret:test'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        crate::secrets::decrypt(restored.directory(), &sealed).unwrap(),
        "PRIVATE API CREDENTIAL"
    );
    drop(copied);
    let restored_path = restored.directory().to_owned();
    let inspected = preflight(
        restored,
        std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
    )
    .unwrap();
    assert_eq!(inspected.report.credentials, 1);
    assert_eq!(inspected.report.blobs, 1);
    drop(inspected);
    assert!(!restored_path.exists());
    let mut checked = 0;
    assert_eq!(
        write_archive(&snapshot, password(), &destination, || {
            checked += 1;
            if checked > 4 {
                Err(CommandError::new(
                    CODE_CANCELLED,
                    "cancelled during member copy",
                ))
            } else {
                Ok(())
            }
        })
        .unwrap_err()
        .code,
        CODE_CANCELLED
    );
    assert_eq!(fs::read(&destination).unwrap(), ciphertext);
    let mut excessive_work = ciphertext.clone();
    let work = excessive_work
        .windows(4)
        .position(|bytes| bytes == b" 18\n")
        .unwrap();
    excessive_work[work + 2] = b'9';
    assert_eq!(
        read_archive(
            excessive_work.as_slice(),
            password(),
            read_root.path(),
            || Ok(())
        )
        .unwrap_err()
        .code,
        CODE_INVALID
    );
    let original = ciphertext.clone();
    fs::write(snapshot.directory().join("secret.key"), [0u8; 32]).unwrap();
    assert_eq!(
        write_archive(&snapshot, password(), &destination, || Ok(()))
            .unwrap_err()
            .code,
        "backup/changed"
    );
    assert_eq!(fs::read(&destination).unwrap(), original);
    // Both password failure and end-of-stream corruption leave no decrypted tree.
    assert_eq!(
        read_archive(
            ciphertext.as_slice(),
            SecretString::from("an entirely different test password".to_owned()),
            read_root.path(),
            || Ok(())
        )
        .unwrap_err()
        .code,
        CODE_UNLOCK
    );
    let mut damaged = ciphertext.clone();
    *damaged.last_mut().unwrap() ^= 1;
    assert_eq!(
        read_archive(damaged.as_slice(), password(), read_root.path(), || Ok(()))
            .unwrap_err()
            .code,
        CODE_UNLOCK
    );
    assert_eq!(
        read_archive(
            &ciphertext[..ciphertext.len() - 1],
            password(),
            read_root.path(),
            || Ok(())
        )
        .unwrap_err()
        .code,
        CODE_UNLOCK
    );
    assert_eq!(fs::read_dir(read_root.path()).unwrap().count(), 0);
}

fn manifest(entries: &[(&str, &[u8])]) -> BackupManifest {
    BackupManifest {
        format: FORMAT,
        schema_version: storage::SCHEMA_VERSION,
        tables: BTreeMap::new(),
        excluded: vec![],
        files: entries
            .iter()
            .map(|(path, bytes)| CapturedFile {
                path: (*path).into(),
                byte_size: bytes.len() as u64,
                sha256: format!("{:x}", Sha256::digest(bytes)),
            })
            .collect(),
    }
}
fn plain_tar(manifest: &BackupManifest, entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut archive = tar::Builder::new(Vec::new());
    let bytes = serde_json::to_vec(manifest).unwrap();
    archive
        .append_data(
            &mut header(bytes.len() as u64),
            "manifest.json",
            bytes.as_slice(),
        )
        .unwrap();
    for (path, bytes) in entries {
        archive
            .append_data(&mut header(bytes.len() as u64), path, *bytes)
            .unwrap();
    }
    archive.into_inner().unwrap()
}
#[test]
fn backup_archive_rejects_bad_members_and_unbounded_metadata_without_extracting_partial_results() {
    let staging = tempfile::tempdir().unwrap();
    let good = manifest(&[("database.sqlite", b"test")]);
    let mut cases = vec![
        plain_tar(&good, &[]),
        plain_tar(
            &good,
            &[("database.sqlite", b"test"), ("database.sqlite", b"test")],
        ),
        plain_tar(&good, &[("database.sqlite", b"wrong")]),
        plain_tar(&good, &[("database.sqlite", b"evil")]),
        plain_tar(&good, &[("secret.key", b"test")]),
    ];
    let mut trailing = plain_tar(&good, &[("database.sqlite", b"test")]);
    trailing.extend_from_slice(b"UNEXPECTED SECOND ARCHIVE");
    cases.push(trailing);
    let mut link = tar::Builder::new(Vec::new());
    let encoded = serde_json::to_vec(&good).unwrap();
    link.append_data(
        &mut header(encoded.len() as u64),
        "manifest.json",
        encoded.as_slice(),
    )
    .unwrap();
    let mut linked = header(0);
    linked.set_entry_type(tar::EntryType::Symlink);
    linked.set_link_name("../../outside").unwrap();
    link.append_data(&mut linked, "database.sqlite", io::empty())
        .unwrap();
    cases.push(link.into_inner().unwrap());
    let mut oversized = good.clone();
    oversized.files[0].byte_size = MAX_BYTES + 1;
    cases.push(plain_tar(&oversized, &[]));
    let mut duplicate = good.clone();
    duplicate.files.push(duplicate.files[0].clone());
    cases.push(plain_tar(&duplicate, &[]));
    for bytes in cases {
        assert!(reader::extract(Cursor::new(bytes), staging.path(), &mut || Ok(())).is_err());
        assert_eq!(fs::read_dir(staging.path()).unwrap().count(), 0);
    }
    for path in [
        "../escape",
        "/absolute",
        "blobs/../escape",
        "plugins/proof/CON",
        "plugins/proof/COM¹.txt",
        "blobs/unsafe:stream",
        "blobs/file.",
        "blobs/file ",
        "blobs/a\\b",
        "logs/private",
        "blobs/a//b",
    ] {
        assert!(member_path(path).is_err(), "{path}");
    }
    let mut overlap = manifest(&[
        ("database.sqlite", b"test"),
        ("plugins/a", b"file"),
        ("plugins/A/b", b"nested"),
    ]);
    assert!(manifest_members(&overlap).is_err());
    overlap.files.pop();
    overlap.files.push(CapturedFile {
        path: "plugins/A".into(),
        ..overlap.files[1].clone()
    });
    assert!(manifest_members(&overlap).is_err());
}
#[test]
fn backup_archive_cancellation_and_header_limits_do_not_leave_plaintext() {
    let staging = tempfile::tempdir().unwrap();
    let good = manifest(&[("database.sqlite", b"test")]);
    let bytes = plain_tar(&good, &[("database.sqlite", b"test")]);
    let mut calls = 0;
    assert_eq!(
        reader::extract(bytes.as_slice(), staging.path(), &mut || {
            calls += 1;
            if calls > 2 {
                Err(CommandError::new(CODE_CANCELLED, "cancelled"))
            } else {
                Ok(())
            }
        })
        .unwrap_err()
        .code,
        CODE_CANCELLED
    );
    assert_eq!(fs::read_dir(staging.path()).unwrap().count(), 0);
    let huge_header = [
        b"age-encryption.org/v1\n-> scrypt ".as_slice(),
        &vec![b'A'; 1024 * 1024],
    ]
    .concat();
    assert!(read_archive(
        huge_header.as_slice(),
        password(),
        staging.path(),
        || Ok(())
    )
    .is_err());
    assert_eq!(fs::read_dir(staging.path()).unwrap().count(), 0);
    assert_eq!(
        password_policy(&SecretString::from("short".to_owned()))
            .unwrap_err()
            .code,
        CODE_PASSWORD
    );
}

#[test]
fn backup_archive_rejects_the_unreleased_v1_format_without_closed_reading_identity() {
    let mut manifest = BackupManifest {
        format: FORMAT,
        schema_version: storage::SCHEMA_VERSION,
        tables: BTreeMap::new(),
        excluded: vec![],
        files: vec![CapturedFile {
            path: "database.sqlite".into(),
            byte_size: 0,
            sha256: "0".repeat(64),
        }],
    };
    assert!(manifest_members(&manifest).is_ok());
    manifest.format = 1;
    assert_eq!(manifest_members(&manifest).unwrap_err().code, CODE_INVALID);
}
