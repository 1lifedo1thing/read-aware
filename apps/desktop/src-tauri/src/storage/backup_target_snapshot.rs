//! Private, read-only target evidence. Never install this file as a live DB.
use crate::error::CommandError;
use rusqlite::{
    backup::{Backup, StepResult},
    Connection, OpenFlags, Transaction,
};
use std::path::Path;

pub(super) fn capture(
    target: &Transaction<'_>,
    path: &Path,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<Connection, CommandError> {
    let mut copied = Connection::open(path)?;
    {
        let backup = Backup::new(target, &mut copied)?;
        loop {
            check()?;
            match backup.step(256)? {
                StepResult::Done => break,
                StepResult::More => {}
                StepResult::Busy | StepResult::Locked => {
                    return Err(CommandError::new(
                        "db/locked",
                        "Target review snapshot is locked",
                    ))
                }
                _ => {
                    return Err(CommandError::new(
                        "backup/incomplete",
                        "Unexpected target snapshot state",
                    ))
                }
            }
        }
    }
    check()?;
    copied.query_row("PRAGMA journal_mode=DELETE", [], |row| {
        row.get::<_, String>(0)
    })?;
    drop(copied);
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    conn.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;")?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_target_snapshot_keeps_the_pinned_wal_revision_and_is_read_only() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("live.sqlite");
        let mut live = Connection::open(&path).unwrap();
        live.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE records(value TEXT); INSERT INTO records VALUES ('original');").unwrap();
        let writer = Connection::open(&path).unwrap();
        let tx = live.transaction().unwrap();
        let _: String = tx
            .query_row("SELECT value FROM records", [], |r| r.get(0))
            .unwrap();
        let mut changed = false;
        let copy = capture(&tx, &root.path().join("target.sqlite"), &mut || {
            if !changed {
                writer.execute("UPDATE records SET value='later'", [])?;
                changed = true;
            }
            Ok(())
        })
        .unwrap();
        assert_eq!(
            copy.query_row("SELECT value FROM records", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "original"
        );
        assert!(copy.execute("DELETE FROM records", []).is_err());
        tx.commit().unwrap();
        assert_eq!(
            live.query_row("SELECT value FROM records", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "later"
        );
        let tx = live.transaction().unwrap();
        assert_eq!(
            capture(&tx, &root.path().join("cancelled.sqlite"), &mut || Err(
                CommandError::new("backup/cancelled", "cancel")
            ))
            .err()
            .unwrap()
            .code,
            "backup/cancelled"
        );
    }
}
