use super::*;
use serde_json::json;

fn at(page: i64) -> Value {
    json!({"currentLocation":page,"totalLocations":1000,"progressPercent":(page as f64 / 10.0).round(),
        "locator":format!("epubcfi(/6/2!/4/2/1:{page})"),"chapterHref":"chapter.xhtml","status":"reading"})
}

fn saved(conn: &Connection) -> Value {
    serde_json::from_str(&scalar::<String>(
        conn,
        "SELECT progress_json FROM books WHERE id='b1'",
    ))
    .unwrap()
}

#[test]
fn ordering_agrees_with_frontend_fixtures() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("reading_progress_cases.json")).unwrap();
    for case in cases {
        let order = super::super::reading_progress::compare(&case["left"], &case["right"]) as i32;
        assert_eq!(
            order,
            case["order"].as_i64().unwrap() as i32,
            "{}",
            case["name"]
        );
    }
}

#[test]
fn offline_furthest_position_converges_in_both_orders_and_survives_replay() {
    let far = session_event(
        "tablet",
        2000,
        "b1",
        60000,
        1000,
        2000,
        10,
        Some(observed(at(300), 2000)),
    );
    let near = session_event(
        "computer",
        3000,
        "b1",
        40000,
        2000,
        3000,
        10,
        Some(observed(at(200), 3000)),
    );
    for (local, remote) in [(&far, &near), (&near, &far)] {
        let (mut conn, dir) = conn_with_dir();
        commit_events_inner(&mut conn, &[imported("import", 1000, "b1", "Furthest")]).unwrap();
        commit_events_inner(&mut conn, std::slice::from_ref(local)).unwrap();
        super::super::events::apply_remote_events_inner(
            &mut conn,
            &dir,
            std::slice::from_ref(remote),
            None,
        )
        .unwrap();
        assert_eq!(saved(&conn)["currentLocation"], 300);
        assert_eq!(saved(&conn)["cfi"], at(300)["locator"]);
        super::super::events::apply_remote_events_inner(
            &mut conn,
            &dir,
            std::slice::from_ref(remote),
            None,
        )
        .unwrap();
        assert_eq!(
            scalar::<i64>(
                &conn,
                "SELECT total_ms FROM reading_time_totals WHERE book_id='b1'"
            ),
            100000
        );
        // An older observation from another offline device can still advance.
        let further = session_event(
            "further",
            1500,
            "b1",
            50000,
            1100,
            1400,
            10,
            Some(observed(at(400), 1200)),
        );
        super::super::events::apply_remote_events_inner(&mut conn, &dir, &[further], None).unwrap();
        assert_eq!(saved(&conn)["currentLocation"], 400);
        let before = saved(&conn);
        let tx = conn.transaction().unwrap();
        replay_into(&tx).unwrap();
        tx.commit().unwrap();
        assert_eq!(saved(&conn), before);
        assert_eq!(
            scalar::<i64>(
                &conn,
                "SELECT total_ms FROM reading_time_totals WHERE book_id='b1'"
            ),
            150000
        );
    }
}

#[test]
fn pending_session_keeps_furthest_page_and_flush_race_cannot_erase_it() {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &[imported("import", 1000, "b1", "Furthest")]).unwrap();
    reading_session_position_inner(&conn, "b1", "2026-09-07", 10, 2000, &at(300)).unwrap();
    let near =
        reading_session_position_inner(&conn, "b1", "2026-09-07", 10, 3000, &at(200)).unwrap();
    assert_eq!(near.progress["currentLocation"], 300);
    assert_eq!(near.position_at, Some(2000));
    let flush = session_event(
        "flush",
        4000,
        "b1",
        0,
        2000,
        3000,
        10,
        Some(observed(at(300), 2000)),
    );
    // A farther page arrives with an earlier wall clock while the old flush is in flight.
    reading_session_position_inner(&conn, "b1", "2026-09-07", 10, 1500, &at(301)).unwrap();
    reading_session_flush_inner(&mut conn, &[flush]).unwrap();
    assert_eq!(
        reading_sessions_pending_inner(&conn).unwrap()[0].progress["currentLocation"],
        301
    );
    let rest = session_event(
        "rest",
        5000,
        "b1",
        0,
        1500,
        3000,
        10,
        Some(observed(at(301), 1500)),
    );
    reading_session_flush_inner(&mut conn, &[rest]).unwrap();
    assert_eq!(saved(&conn)["currentLocation"], 301);
    assert!(reading_sessions_pending_inner(&conn).unwrap().is_empty());
}

#[test]
fn legacy_events_and_cfi_starts_advance_inside_a_rounded_percentage() {
    let mut conn = migrated_conn();
    commit_events_inner(&mut conn, &[imported("import", 1000, "b1", "Furthest")]).unwrap();
    for (id, wall, page) in [("a", 2000, 300), ("b", 3000, 301), ("c", 4000, 300)] {
        let mut p = at(page);
        p["bookId"] = json!("b1");
        commit_events_inner(&mut conn, &[ev(id, wall, "book.progressed", p)]).unwrap();
    }
    assert_eq!(saved(&conn)["currentLocation"], 301);
    let mut p = at(301);
    p["locator"] = json!("epubcfi(/6/2!/4/2/1:302)");
    p["bookId"] = json!("b1");
    commit_events_inner(&mut conn, &[ev("d", 5000, "book.progressed", p)]).unwrap();
    assert_eq!(saved(&conn)["cfi"], "epubcfi(/6/2!/4/2/1:302)");
}

#[test]
fn upgrade_recovers_progress_without_double_counting_or_rebuilding_legacy_data() {
    let mut conn = test_conn();
    super::super::schema::run_migrations_up_to(&mut conn, 52).unwrap();
    commit_events_inner(
        &mut conn,
        &[
            imported("import", 1000, "b1", "Furthest"),
            session_event("far", 2000, "b1", 60000, 1000, 2000, 10, Some(at(300))),
            session_event("near", 3000, "b1", 40000, 2000, 3000, 10, Some(at(200))),
        ],
    )
    .unwrap();
    // Recreate the v52 last-observation-wins projection and an unrelated legacy field.
    conn.execute("UPDATE books SET progress_json=?1,progress_percent=20,progress_observed_at=3000,author='Legacy author' WHERE id='b1'",
        params![json!({"currentLocation":200,"totalLocations":1000,"progressPercent":20,"cfi":at(200)["locator"]}).to_string()]).unwrap();
    run_migrations(&mut conn).unwrap();
    assert_eq!(saved(&conn)["currentLocation"], 300);
    assert_eq!(
        scalar::<i64>(
            &conn,
            "SELECT total_ms FROM reading_time_totals WHERE book_id='b1'"
        ),
        100000
    );
    assert_eq!(
        scalar::<String>(&conn, "SELECT author FROM books WHERE id='b1'"),
        "Legacy author"
    );
    run_migrations(&mut conn).unwrap();
    assert_eq!(saved(&conn)["currentLocation"], 300);
}

#[test]
fn upgrade_defers_incomplete_log_replay_and_ignores_old_checkpoints() {
    let (mut conn, dir) = conn_with_dir();
    commit_events_inner(&mut conn, &[imported("import", 1000, "b1", "Furthest")]).unwrap();
    let checkpoint = create_checkpoint(&mut conn, &dir, "local", None).unwrap();
    conn.execute(
        "UPDATE projection_checkpoints SET schema_version=52 WHERE id=?1",
        params![checkpoint.id],
    )
    .unwrap();
    assert!(super::super::checkpoints::newest_checkpoint(&conn)
        .unwrap()
        .is_none());
    // Upgrade an actual incomplete v52 schema. Do not erase its checkpoint-derived books.
    conn.execute("DELETE FROM schema_migrations WHERE version=53", [])
        .unwrap();
    super::super::checkpoints::set_log_complete(&conn, false).unwrap();
    run_migrations(&mut conn).unwrap();
    assert!(super::super::events::projections_stale_conn(&conn).unwrap());
    assert!(
        super::super::events::finalize_staged_events_inner(&mut conn, &dir)
            .unwrap()
            .is_none()
    );
    assert_eq!(scalar::<i64>(&conn, "SELECT COUNT(*) FROM books"), 1);
    super::super::checkpoints::set_log_complete(&conn, true).unwrap();
    assert!(
        super::super::events::finalize_staged_events_inner(&mut conn, &dir)
            .unwrap()
            .is_some()
    );
}

#[test]
fn book_merge_and_upgrade_recovery_keep_precise_progress_with_aliases() {
    let mut conn = test_conn();
    super::super::schema::run_migrations_up_to(&mut conn, 52).unwrap();
    let mut keeper = at(300);
    keeper["bookId"] = json!("b1");
    let mut merged = at(301);
    merged["bookId"] = json!("b2");
    commit_events_inner(
        &mut conn,
        &[
            imported("import", 1000, "b1", "Furthest"),
            imported("duplicate", 1001, "b2", "Duplicate"),
            ev("keeper", 2000, "book.progressed", keeper),
            ev("merged", 2001, "book.progressed", merged),
            ev(
                "merge",
                3000,
                "book.merged",
                json!({"keepId":"b1","mergedId":"b2"}),
            ),
        ],
    )
    .unwrap();
    assert_eq!(
        saved(&conn)["currentLocation"],
        301,
        "merge must compare more than rounded percent"
    );
    conn.execute(
        "UPDATE books SET progress_json=?1,progress_percent=30 WHERE id='b1'",
        params![at(300).to_string()],
    )
    .unwrap();
    run_migrations(&mut conn).unwrap();
    assert_eq!(
        saved(&conn)["currentLocation"],
        301,
        "history of the merged id advances the keeper"
    );
    assert_eq!(scalar::<i64>(&conn, "SELECT COUNT(*) FROM books"), 1);
}
