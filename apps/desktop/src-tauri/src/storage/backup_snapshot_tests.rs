use super::*;
use std::fs;
fn database(path: &Path) -> Connection {
    let mut conn = Connection::open(path).unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    ensure_local_device(&conn).unwrap();
    conn
}
fn roots() -> (TempDir, TempDir) {
    (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap())
}
fn seed(conn: &Connection) {
    conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES ('read-aware-plugin.proof.settings','{\"saved\":true}','now')", []).unwrap();
    conn.execute("INSERT INTO plugin_documents(plugin_id,collection,id,json,updated_at) VALUES ('proof','notes','one','{\"text\":\"私人笔记\"}','now')", []).unwrap();
    conn.execute_batch("INSERT INTO ai_conversations(id,created_at,updated_at) VALUES ('global-proof','now','now');
        INSERT INTO ai_messages(id,conversation_id,role,seq,content,created_at,parts_json,error) VALUES ('message-proof','global-proof','assistant',1,'chat contents','now','[]','presentation error');
        INSERT INTO memories(id,scope,kind,content,importance,evidence_count,created_at,updated_at) VALUES ('memory-proof','global','fact','legacy memory',1,1,'now','now');
        INSERT INTO domain_events(id,type,hlc_wall_ms,hlc_counter,hlc_device,payload_json,created_at) VALUES ('event-proof','preference.changed',100,0,'device-proof','{\"key\":\"read-aware-theme\",\"value\":\"dark\"}','now');").unwrap();
    // A new table is automatically preserved, including binary and NULL cells.
    conn.execute_batch("CREATE TABLE future_user_data(id TEXT PRIMARY KEY, value BLOB, optional TEXT); INSERT INTO future_user_data VALUES ('one',X'0001FF',NULL);").unwrap();
}
fn write_plugin(root: &Path) {
    let path = root.join("plugins/proof");
    fs::create_dir_all(path.join("assets")).unwrap();
    fs::write(
        path.join("manifest.json"),
        "{\"id\":\"proof\",\"version\":\"1.0.0\"}",
    )
    .unwrap();
    fs::write(path.join("main.js"), "export default {};").unwrap();
    fs::write(path.join("assets/中文.txt"), "portable").unwrap();
}
#[test]
fn full_backup_snapshot_preserves_database_blobs_plugins_and_credentials_without_touching_source() {
    let (data, staging) = roots();
    let mut conn = database(&data.path().join("read-aware.db"));
    seed(&conn);
    write_plugin(data.path());
    let bytes = vec![42; 3 * 1024 * 1024 + 17];
    put_blob_inner(
        &conn,
        data.path(),
        "bookfile:proof",
        Some("application/epub+zip"),
        &bytes,
    )
    .unwrap();
    let sealed = crate::secrets::encrypt(data.path(), "PRIVATE-API-KEY").unwrap();
    conn.execute(
        "INSERT INTO app_kv(key,value_json,updated_at) VALUES ('read-aware-secret:test',?1,'now')",
        [&sealed],
    )
    .unwrap();
    fs::create_dir_all(data.path().join("plugins/.candidates/unused")).unwrap();
    fs::write(
        data.path().join("plugins/.candidates/unused/not-included"),
        "staged",
    )
    .unwrap();
    fs::write(data.path().join("unregistered-cache"), "cache").unwrap();
    let original_tables = table_counts(&conn).unwrap();
    let mut reported = 0;
    let snapshot = capture_fixture(&mut conn, data.path(), staging.path(), |progress| {
        if let CaptureProgress::Database {
            remaining_pages,
            total_pages,
        } = progress
        {
            assert!(total_pages > 0 && remaining_pages <= total_pages);
        }
        if let CaptureProgress::Files { copied_bytes } = progress {
            assert!(copied_bytes >= reported);
            reported = copied_bytes;
        }
        Ok(())
    })
    .unwrap();
    assert_eq!(snapshot.manifest.tables, original_tables);
    assert_eq!(table_counts(&conn).unwrap(), original_tables);
    assert_eq!(snapshot.manifest.files.len(), 6); // DB, source blob, three plugin files, credential key
    assert!(reported >= bytes.len() as u64);
    let copied = Connection::open(snapshot.directory().join("database.sqlite")).unwrap();
    assert_eq!(
        copied
            .query_row("SELECT value FROM future_user_data", [], |row| row
                .get::<_, Vec<u8>>(0))
            .unwrap(),
        vec![0, 1, 255]
    );
    assert_eq!(
        copied
            .query_row("SELECT json FROM plugin_documents", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "{\"text\":\"私人笔记\"}"
    );
    assert_eq!(
        crate::secrets::decrypt(snapshot.directory(), &sealed).unwrap(),
        "PRIVATE-API-KEY"
    );
    assert_eq!(snapshot.manifest.tables["domain_events"], 1);
    assert_eq!(snapshot.manifest.tables["memories"], 1);
    assert_eq!(snapshot.manifest.tables["ai_messages"], 1);
    assert_eq!(
        copied
            .query_row("SELECT error FROM ai_messages", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "presentation error"
    );
    assert!(!snapshot.directory().join("database.sqlite-wal").exists());
    snapshot.verify(|| Ok(())).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(snapshot.directory())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
    }
    let path = snapshot.directory().to_owned();
    drop(copied);
    drop(snapshot);
    assert!(!path.exists());
}

#[test]
fn full_backup_snapshot_is_one_pinned_wal_view_despite_a_second_connection_commit() {
    let (data, staging) = roots();
    let path = data.path().join("db");
    let mut conn = database(&path);
    seed(&conn);
    let other = database(&path);
    let mut changed = false;
    let snapshot = capture_fixture(&mut conn, data.path(), staging.path(), |progress| {
        if matches!(progress, CaptureProgress::Database { remaining_pages: 0, .. }) && !changed {
            changed = true;
            other.execute_batch("BEGIN; UPDATE app_kv SET value_json='false'; DELETE FROM plugin_documents; UPDATE future_user_data SET value=X'FF'; COMMIT;").unwrap();
        }
        Ok(())
    }).unwrap();
    assert!(changed);
    let copied = Connection::open(snapshot.directory().join("database.sqlite")).unwrap();
    assert_eq!(
        copied
            .query_row("SELECT count(*) FROM plugin_documents", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        copied
            .query_row("SELECT value FROM future_user_data", [], |row| row
                .get::<_, Vec<u8>>(0))
            .unwrap(),
        vec![0, 1, 255]
    );
    assert_eq!(
        other
            .query_row("SELECT count(*) FROM plugin_documents", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn full_backup_snapshot_missing_or_changed_blob_never_publishes_partial_preparation() {
    for mode in ["missing", "hash", "path", "remote", "concurrent"] {
        let (data, staging) = roots();
        let mut conn = database(&data.path().join("db"));
        put_blob_inner(&conn, data.path(), "bookfile:proof", None, b"original").unwrap();
        let path = data
            .path()
            .join("blobs")
            .join(blob_file_name("bookfile:proof"));
        match mode {
            "missing" => fs::remove_file(&path).unwrap(),
            "hash" => fs::write(&path, b"modified").unwrap(),
            "path" => {
                conn.execute("UPDATE blob_objects SET storage_uri='../outside'", [])
                    .unwrap();
            }
            "remote" => {
                conn.execute("UPDATE blob_objects SET storage_uri=NULL", [])
                    .unwrap();
            }
            _ => {}
        }
        let result = capture_fixture(&mut conn, data.path(), staging.path(), |progress| {
            if mode == "concurrent"
                && matches!(
                    progress,
                    CaptureProgress::Database {
                        remaining_pages: 0,
                        ..
                    }
                )
            {
                fs::write(&path, b"modified").unwrap();
            }
            Ok(())
        });
        assert!(result.is_err(), "{mode}");
        assert_eq!(fs::read_dir(staging.path()).unwrap().count(), 0);
        assert!(conn.is_autocommit());
    }
}

#[test]
fn full_backup_snapshot_blocks_pending_updates_and_does_not_generate_missing_secret_keys() {
    let (data, staging) = roots();
    let mut conn = database(&data.path().join("db"));
    let id = uuid::Uuid::new_v4().to_string();
    begin_plugin_update(&mut conn, &id, "proof", None, None).unwrap();
    assert_eq!(
        capture_fixture(&mut conn, data.path(), staging.path(), |_| Ok(()))
            .unwrap_err()
            .code,
        "plugin/recovery-required"
    );
    rollback_plugin_update(&mut conn, &id).unwrap();
    conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES ('read-aware-secret:test','unreadable','now')", []).unwrap();
    assert_eq!(
        capture_fixture(&mut conn, data.path(), staging.path(), |_| Ok(()))
            .unwrap_err()
            .code,
        "secrets/unavailable"
    );
    assert!(!data.path().join("secret.key").exists());
    assert_eq!(fs::read_dir(staging.path()).unwrap().count(), 0);
}

#[test]
fn full_backup_snapshot_cancel_and_staged_tampering_are_detected() {
    let (data, staging) = roots();
    let mut conn = database(&data.path().join("db"));
    for files_phase in [false, true] {
        let result = capture_fixture(&mut conn, data.path(), staging.path(), |progress| {
            if files_phase == matches!(progress, CaptureProgress::Files { .. }) {
                return Err(CommandError::new(CODE_CANCELLED, "cancelled"));
            }
            Ok(())
        });
        assert_eq!(result.unwrap_err().code, CODE_CANCELLED);
        assert_eq!(fs::read_dir(staging.path()).unwrap().count(), 0);
    }
    let snapshot = capture_fixture(&mut conn, data.path(), staging.path(), |_| Ok(())).unwrap();
    assert_eq!(
        snapshot
            .verify(|| Err(CommandError::new(CODE_CANCELLED, "cancelled")))
            .unwrap_err()
            .code,
        CODE_CANCELLED
    );
    fs::write(snapshot.directory().join("database.sqlite"), "tampered").unwrap();
    assert_eq!(snapshot.verify(|| Ok(())).unwrap_err().code, CODE_CHANGED);
}

#[cfg(unix)]
#[test]
fn full_backup_snapshot_rejects_symlink_sources_and_never_reads_the_target() {
    use std::os::unix::fs::symlink;
    let (data, staging) = roots();
    let mut conn = database(&data.path().join("db"));
    write_plugin(data.path());
    let secret = staging.path().join("outside");
    fs::write(&secret, "must not be captured").unwrap();
    symlink(&secret, data.path().join("plugins/proof/linked")).unwrap();
    assert_eq!(
        capture_fixture(&mut conn, data.path(), staging.path(), |_| Ok(()))
            .unwrap_err()
            .code,
        CODE_INCOMPLETE
    );
    assert_eq!(fs::read_dir(staging.path()).unwrap().count(), 1); // only the original outside file
}
