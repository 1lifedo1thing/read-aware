use super::super::super::identity_work::{
    identity_work_append_inner as append, identity_work_read_inner as read,
};
use super::*;

#[test]
fn pages_are_ordered_immutable_idempotent_and_do_not_publish_profile_or_completion() {
    let mut conn = db();
    seed(&mut conn);
    let before = snapshot(&mut conn);
    let events = count(&conn, "domain_events");
    assert_eq!(read(&mut conn, &before.revision, 0).unwrap().page_count, 0);
    assert_eq!(
        append(&mut conn, &before.revision, 0, r#"{"cursor":1}"#)
            .unwrap()
            .status,
        "appended"
    );
    assert_eq!(
        append(&mut conn, &before.revision, 0, r#"{"cursor":1}"#)
            .unwrap()
            .status,
        "retained"
    );
    assert_eq!(
        append(&mut conn, &before.revision, 0, r#"{"cursor":2}"#)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert_eq!(
        append(&mut conn, &before.revision, 2, "{}")
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    append(&mut conn, &before.revision, 1, "{}").unwrap();
    let page = read(&mut conn, &before.revision, 0).unwrap();
    assert_eq!(page.page_count, 2);
    assert_eq!(page.json.as_deref(), Some(r#"{"cursor":1}"#));
    assert!(read(&mut conn, &before.revision, 2).unwrap().json.is_none());
    let after = snapshot(&mut conn);
    assert_eq!(after.revision, before.revision);
    assert_eq!(after.derived, before.derived);
    assert!(!after.settled);
    assert_eq!(count(&conn, "domain_events"), events);
}

#[test]
fn page_and_header_failure_roll_back_together_including_stale_job_replacement() {
    let mut conn = db();
    seed(&mut conn);
    let old = snapshot(&mut conn).revision;
    append(&mut conn, &old, 0, r#"{"saved":true}"#).unwrap();
    commit_events_inner(&mut conn, &[source("new", "global", 10)]).unwrap();
    let current = snapshot(&mut conn).revision;
    assert_eq!(
        read(&mut conn, &old, 0).unwrap_err().code,
        "memory/conflict"
    );
    assert_eq!(
        append(&mut conn, &old, 1, "{}").unwrap_err().code,
        "memory/conflict"
    );
    assert!(read(&mut conn, &current, 0).unwrap().json.is_none());
    conn.execute_batch("CREATE TRIGGER fail_page BEFORE INSERT ON identity_consolidation_pages BEGIN SELECT RAISE(ABORT,'page failure'); END;").unwrap();
    assert!(append(&mut conn, &current, 0, "{}").is_err());
    let stored: String = conn
        .query_row(
            "SELECT revision FROM identity_consolidation_work",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, old);
    assert_eq!(count(&conn, "identity_consolidation_pages"), 1);
    conn.execute_batch("DROP TRIGGER fail_page;").unwrap();
    append(&mut conn, &current, 0, "{}").unwrap();
    conn.execute_batch("CREATE TRIGGER fail_count BEFORE UPDATE ON identity_consolidation_work BEGIN SELECT RAISE(ABORT,'count failure'); END;").unwrap();
    assert!(append(&mut conn, &current, 1, "{}").is_err());
    assert_eq!(read(&mut conn, &current, 0).unwrap().page_count, 1);
    assert_eq!(count(&conn, "identity_consolidation_pages"), 1);
}

#[test]
fn work_survives_reopen_but_another_connection_cannot_overwrite_a_page_or_ignore_new_sources() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("identity.db");
    let mut first = Connection::open(&path).unwrap();
    prepare(&mut first);
    seed(&mut first);
    let revision = snapshot(&mut first).revision;
    append(&mut first, &revision, 0, "{}").unwrap();
    drop(first);
    let mut first = Connection::open(&path).unwrap();
    prepare(&mut first);
    let mut second = Connection::open(&path).unwrap();
    prepare(&mut second);
    assert_eq!(
        read(&mut first, &revision, 0).unwrap().json.as_deref(),
        Some("{}")
    );
    append(&mut first, &revision, 1, r#"{"winner":1}"#).unwrap();
    assert_eq!(
        append(&mut second, &revision, 1, r#"{"winner":2}"#)
            .unwrap_err()
            .code,
        "memory/conflict"
    );
    assert_eq!(
        append(&mut second, &revision, 1, r#"{"winner":1}"#)
            .unwrap()
            .status,
        "retained"
    );
    commit_events_inner(&mut second, &[source("external", "user", 12)]).unwrap();
    assert_eq!(
        append(&mut first, &revision, 2, "{}").unwrap_err().code,
        "memory/conflict"
    );
}

#[test]
fn final_publication_clears_scratch_atomically_and_wipe_includes_both_local_tables() {
    let mut conn = db();
    seed(&mut conn);
    let before = snapshot(&mut conn);
    append(&mut conn, &before.revision, 0, "{}").unwrap();
    conn.execute_batch("CREATE TRIGGER fail_clear BEFORE DELETE ON identity_consolidation_pages BEGIN SELECT RAISE(ABORT,'clear failure'); END;").unwrap();
    assert!(identity_commit_inner(
        &mut conn,
        &before.revision,
        &plan(&before, &[], 20),
        &[],
        true
    )
    .is_err());
    assert_eq!(snapshot(&mut conn).revision, before.revision);
    assert_eq!(count(&conn, "identity_consolidation_checkpoint"), 0);
    assert_eq!(count(&conn, "identity_consolidation_pages"), 1);
    conn.execute_batch("DROP TRIGGER fail_clear;").unwrap();
    identity_commit_inner(
        &mut conn,
        &before.revision,
        &plan(&before, &[], 20),
        &[],
        true,
    )
    .unwrap();
    assert_eq!(count(&conn, "identity_consolidation_work"), 0);
    assert_eq!(count(&conn, "identity_consolidation_pages"), 0);
    let after = snapshot(&mut conn);
    append(&mut conn, &after.revision, 0, "{}").unwrap();
    for table in [
        "identity_consolidation_work",
        "identity_consolidation_pages",
    ] {
        assert!(!super::super::super::apply::DERIVED_TABLES.contains(&table));
    }
    let dir = tempfile::tempdir().unwrap();
    super::super::super::schema::wipe_all_data_inner(&mut conn, dir.path()).unwrap();
    assert_eq!(count(&conn, "identity_consolidation_work"), 0);
    assert_eq!(count(&conn, "identity_consolidation_pages"), 0);
}

#[test]
fn invalid_and_oversized_pages_cannot_create_scratch() {
    let mut conn = db();
    seed(&mut conn);
    let revision = snapshot(&mut conn).revision;
    for value in [
        "null".to_owned(),
        "[]".to_owned(),
        "invalid".to_owned(),
        json!({"text":"x".repeat(48_000)}).to_string(),
    ] {
        assert_eq!(
            append(&mut conn, &revision, 0, &value).unwrap_err().code,
            "memory/invalid-input"
        );
    }
    for index in [-1, 4096] {
        assert_eq!(
            append(&mut conn, &revision, index, "{}").unwrap_err().code,
            "memory/invalid-input"
        );
    }
    assert_eq!(count(&conn, "identity_consolidation_work"), 0);
}
