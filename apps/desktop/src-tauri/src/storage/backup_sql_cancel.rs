//! Interrupt SQL scans even when they produce no rows for a long time.
use rusqlite::Connection;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub(super) fn install(conn: &Connection, cancelled: Arc<AtomicBool>) {
    conn.progress_handler(1000, Some(move || cancelled.load(Ordering::Acquire)));
}
pub(super) struct Guard<'a>(&'a Connection);
impl<'a> Guard<'a> {
    pub(super) fn new(conn: &'a Connection, cancelled: Arc<AtomicBool>) -> Self {
        install(conn, cancelled);
        Self(conn)
    }
}
impl Drop for Guard<'_> {
    fn drop(&mut self) {
        self.0.progress_handler(0, None::<fn() -> bool>);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_row_structure_sql_cancel_interrupts_before_first_result_and_releases_hook() {
        let conn = Connection::open_in_memory().unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        let triggered = flag.clone();
        conn.create_scalar_function(
            "request_cancel",
            0,
            rusqlite::functions::FunctionFlags::SQLITE_UTF8,
            move |_| {
                triggered.store(true, Ordering::Release);
                Ok(1)
            },
        )
        .unwrap();
        {
            let _guard = Guard::new(&conn, flag.clone());
            let error=conn.query_row("WITH RECURSIVE n(x) AS (SELECT request_cancel() UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) FROM n",[],|r|r.get::<_,i64>(0)).unwrap_err();
            assert_eq!(
                error.sqlite_error_code(),
                Some(rusqlite::ErrorCode::OperationInterrupted)
            );
        }
        assert!(flag.load(Ordering::Acquire));
        assert_eq!(conn.query_row("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10000) SELECT count(*) FROM n",[],|r|r.get::<_,i64>(0)).unwrap(),10000);
    }
}
