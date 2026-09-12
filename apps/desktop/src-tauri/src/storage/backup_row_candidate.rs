//! Materialize only the selected row overlay in an ephemeral private DB. The
//! candidate is never a replacement live database or an executable restore.
use super::{
    choices,
    identity::{decode_key, BoundCell},
    scan, RowPlan,
};
use crate::error::CommandError;
use rusqlite::{params, params_from_iter, Connection};

pub(super) struct Candidate {
    pub connection: Connection,
    // Close SQLite (including rollback journals) before unlinking its directory.
    _directory: tempfile::TempDir,
}
fn predicate(columns: &[scan::Column]) -> String {
    let mut primary: Vec<_> = columns.iter().filter(|c| c.primary > 0).collect();
    primary.sort_by_key(|c| c.primary);
    primary
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{} IS ?{}", scan::quoted(&c.name), i + 1))
        .collect::<Vec<_>>()
        .join(" AND ")
}
impl RowPlan {
    pub(super) fn candidate(
        &self,
        check: &mut impl FnMut() -> Result<(), CommandError>,
        constraint: &mut impl FnMut(&str, i64) -> Result<(), CommandError>,
    ) -> Result<(Candidate, u64, bool), CommandError> {
        let directory = tempfile::Builder::new()
            .prefix("row-candidate-")
            .tempdir_in(self.events.directory.path())?;
        let mut conn = Connection::open(directory.path().join("rows.sqlite"))?;
        super::super::target_snapshot::copy(&self.events.target_snapshot, &mut conn, check)?;
        super::sql_cancel::install(&conn, self.events.source.cancellation());
        conn.execute_batch(
            "PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=OFF; PRAGMA trusted_schema=OFF;",
        )?;
        // Projection triggers and their application functions must never execute
        // in a candidate. Derived indexes and runtime tables remain out of scope.
        let triggers = conn
            .prepare("SELECT name FROM sqlite_schema WHERE type='trigger'")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let tx = conn.transaction()?;
        for name in triggers {
            check()?;
            tx.execute_batch(&format!("DROP TRIGGER {}", scan::quoted(&name)))?;
        }
        let mut count = 0;
        let mut complete = true;
        // Remove ALL replaced rows before inserting: a valid unique-value swap
        // must not conflict with an obsolete value in another selected row.
        for deleting in [true, false] {
            let mut query = self.events.entries.prepare("SELECT table_name,entry_id,row_key,policy,source_digest,target_digest FROM row_matches WHERE choice='source' ORDER BY table_name,entry_id")?;
            let mut rows = query.query([])?;
            while let Some(row) = rows.next()? {
                check()?;
                let table: String = row.get(0)?;
                let entry: i64 = row.get(1)?;
                let key: Vec<u8> = row.get(2)?;
                let policy = super::RowPolicy::from_name(&row.get::<_, String>(3)?)?;
                let source: Option<String> = row.get(4)?;
                let target: Option<String> = row.get(5)?;
                if !self.tables.contains_key(&table)
                    || !choices::selectable(policy, source.as_deref(), target.as_deref())
                {
                    return Err(CommandError::new(
                        "backup/changed",
                        "Invalid selected row in candidate",
                    ));
                }
                let columns = scan::columns(self.events.source.connection(), &table)?;
                let keys = decode_key(&key, columns.iter().filter(|c| c.primary > 0).count())?;
                let predicate = predicate(&columns);
                if deleting {
                    tx.execute(
                        &format!("DELETE FROM {} WHERE {predicate}", scan::quoted(&table)),
                        params_from_iter(keys.into_iter().map(BoundCell)),
                    )?;
                } else {
                    count += 1;
                    let mut source = self.events.source.connection().prepare(&format!(
                        "SELECT * FROM {} WHERE {predicate}",
                        scan::quoted(&table)
                    ))?;
                    let mut source_rows =
                        source.query(params_from_iter(keys.into_iter().map(BoundCell)))?;
                    let source_row = source_rows.next()?.ok_or_else(|| {
                        CommandError::new("backup/changed", "Selected source row disappeared")
                    })?;
                    let values = (0..columns.len())
                        .map(|i| source_row.get_ref(i).map(BoundCell))
                        .collect::<Result<Vec<_>, _>>()?;
                    let names = columns
                        .iter()
                        .map(|c| scan::quoted(&c.name))
                        .collect::<Vec<_>>()
                        .join(",");
                    let slots = (1..=columns.len())
                        .map(|i| format!("?{i}"))
                        .collect::<Vec<_>>()
                        .join(",");
                    match tx.execute(
                        &format!(
                            "INSERT OR ABORT INTO {} ({names}) VALUES ({slots})",
                            scan::quoted(&table)
                        ),
                        params_from_iter(values),
                    ) {
                        Ok(1) => {}
                        Err(error)
                            if error.sqlite_error_code()
                                == Some(rusqlite::ErrorCode::ConstraintViolation) =>
                        {
                            complete = false;
                            constraint(&table, entry)?;
                        }
                        Err(error) => return Err(error.into()),
                        _ => {
                            return Err(CommandError::internal(
                                "Unexpected candidate insert receipt",
                            ))
                        }
                    }
                }
            }
        }
        check()?;
        tx.commit()?;
        Ok((
            Candidate {
                connection: conn,
                _directory: directory,
            },
            count,
            complete,
        ))
    }
    pub(super) fn candidate_entry(
        &self,
        candidate: &Connection,
        table: &str,
        rowid: i64,
    ) -> Result<Option<i64>, CommandError> {
        use rusqlite::OptionalExtension;
        if !self.tables.contains_key(table) {
            return Err(CommandError::new(
                "backup/incomplete",
                "Unknown candidate reference table",
            ));
        }
        let mut columns = scan::columns(candidate, table)?;
        columns.retain(|c| c.primary > 0);
        columns.sort_by_key(|c| c.primary);
        if columns.is_empty() {
            return Ok(None);
        }
        let names = columns
            .iter()
            .map(|c| scan::quoted(&c.name))
            .collect::<Vec<_>>()
            .join(",");
        let mut statement = candidate.prepare(&format!(
            "SELECT {names} FROM {} WHERE rowid=?1",
            scan::quoted(table)
        ))?;
        let mut rows = statement.query([rowid])?;
        let row = rows
            .next()?
            .ok_or_else(|| CommandError::internal("Missing candidate issue row"))?;
        let mut key = (columns.len() as u64).to_le_bytes().to_vec();
        for i in 0..columns.len() {
            scan::key_cell(&mut key, row.get_ref(i)?)?;
        }
        Ok(self
            .events
            .entries
            .query_row(
                "SELECT entry_id FROM row_matches WHERE table_name=?1 AND row_key=?2",
                params![table, key],
                |r| r.get(0),
            )
            .optional()?)
    }
}
