use super::*;

#[test]
fn atomic_domains_roll_back_together_and_reject_changed_preview() {
    let mut conn = Connection::open_in_memory().unwrap();
    apply_connection_pragmas(&conn).unwrap();
    register_sql_functions(&conn).unwrap();
    run_migrations(&mut conn).unwrap();
    let revision = atomic_aggregate_revision(&conn, "book", "book").unwrap();
    let input = |expected: Option<&str>| serde_json::from_value::<AtomicCommitInput>(serde_json::json!({
        "guards": [{"aggregateType":"book","aggregateId":"book","revision":revision}],
        "events": [{"id":"atomic-event","type":"book.imported","hlc":{"wallMs":1000,"counter":0,"deviceId":"test"},
            "aggregateType":"book","aggregateId":"book","payload":{"bookId":"book","title":"Atomic book","author":"A","format":"epub","fileName":"book.epub","fileSize":42,"sourceBlobKey":"bookfile:book"}}],
        "settings": [{"key":"read-aware-theme","expected":null,"value":"\"paper\""}],
        "documents": [{"pluginId":"sample","changes":[{"collection":"notes","id":"one","expectedRevision":expected,
            "kind":"put","json":"{}","bookId":"book"}]}]
    })).unwrap();
    // The document conflict occurs after event/projection and setting writes.
    assert!(matches!(atomic_commit_inner(&mut conn, input(Some("00000000000000000000000000000000"))).unwrap(), AtomicCommitResult::Conflict { .. }));
    for table in ["domain_events", "books", "plugin_documents"] {
        assert_eq!(conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row.get::<_, i64>(0)).unwrap(), 0);
    }
    assert!(conn.query_row("SELECT value_json FROM app_kv WHERE key='read-aware-theme'", [], |row| row.get::<_, String>(0)).optional().unwrap().is_none());
    assert!(matches!(atomic_commit_inner(&mut conn, input(None)).unwrap(), AtomicCommitResult::Applied { .. }));
    assert_ne!(atomic_aggregate_revision(&conn, "book", "book").unwrap(), revision);
    assert!(matches!(atomic_commit_inner(&mut conn, input(None)).unwrap(), AtomicCommitResult::Conflict { .. }));
    assert_eq!(conn.query_row("SELECT title FROM books WHERE id='book'", [], |row| row.get::<_, String>(0)).unwrap(), "Atomic book");
    assert_eq!(conn.query_row("SELECT count(*) FROM plugin_documents", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
}
