//! Version-bound constraint evidence for the row overlay only. Does not prove
//! event semantics, blob availability, plugin compatibility or restore readiness.
use super::{choices, RowPlan};
use crate::error::CommandError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
#[path = "backup_row_relations.rs"]
mod relations;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RowStructureReceipt {
    pub revision: String,
    pub selected_source_rows: u64,
    pub issues: u64,
    pub constraints_passed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RowIssue {
    pub id: i64,
    pub kind: String,
    pub table: String,
    pub entry_id: Option<i64>,
    pub related_table: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RowIssuePage {
    pub revision: String,
    pub entries: Vec<RowIssue>,
    pub next_after: Option<i64>,
}
fn changed() -> CommandError {
    CommandError::new(
        "backup/changed",
        "Row constraint evidence is missing or stale",
    )
}
fn cached(conn: &Connection, expected: &str) -> Result<Option<RowStructureReceipt>, CommandError> {
    Ok(conn
        .query_row(
            "SELECT selected_source_rows,issues FROM row_structure_state WHERE revision=?1",
            [expected],
            |r| {
                let issues: u64 = r.get(1)?;
                Ok(RowStructureReceipt {
                    revision: expected.into(),
                    selected_source_rows: r.get(0)?,
                    issues,
                    constraints_passed: issues == 0,
                })
            },
        )
        .optional()?)
}
impl RowPlan {
    pub(crate) fn check_rows(
        &self,
        expected: String,
        mut observer: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<RowStructureReceipt, CommandError> {
        use std::sync::atomic::Ordering;
        let cancelled = self.events.source.cancellation();
        let _guard = super::sql_cancel::Guard::new(&self.events.entries, cancelled.clone());
        let mut check = || {
            if cancelled.load(Ordering::Acquire) {
                return Err(CommandError::new(
                    "backup/cancelled",
                    "Row constraint check cancelled",
                ));
            }
            observer()
        };
        let result = self.check_rows_inner(expected, &mut check);
        if cancelled.load(Ordering::Acquire) {
            return Err(CommandError::new(
                "backup/cancelled",
                "Row constraint check cancelled",
            ));
        }
        result
    }
    fn check_rows_inner(
        &self,
        expected: String,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<RowStructureReceipt, CommandError> {
        check()?;
        if choices::revision(&self.events.entries)? != expected {
            return Err(changed());
        }
        if let Some(receipt) = cached(&self.events.entries, &expected)? {
            return Ok(receipt);
        }
        if self.row_decisions(&mut check)?.unresolved != 0 {
            return Err(CommandError::new(
                "backup/incomplete",
                "Choose all applicable rows before checking the overlay",
            ));
        }
        let tx = self.events.entries.unchecked_transaction()?;
        tx.execute("DELETE FROM row_structure_issues", [])?;
        tx.execute("DELETE FROM row_structure_state", [])?;
        let mut issues = 0u64;
        let mut emit = |kind: &str,
                        table: &str,
                        entry_id: Option<i64>,
                        related: Option<&str>|
         -> Result<(), CommandError> {
            issues += 1;
            tx.execute("INSERT INTO row_structure_issues(id,kind,table_name,entry_id,related_table) VALUES (?1,?2,?3,?4,?5)", params![issues,kind,table,entry_id,related])?;
            Ok(())
        };
        let (candidate, selected_source_rows, complete) = self
            .candidate(&mut check, &mut |table, entry| {
                emit("constraint", table, Some(entry), None)
            })?;
        // An insertion conflict means the candidate omits that source row. Do
        // not pretend downstream missing references in that partial DB are the
        // final overlay; resolve the genuine insertion conflicts first.
        if complete {
            relations::validate(self, &candidate.connection, &mut check, &mut emit)?;
        }
        drop(candidate);
        check()?;
        tx.execute("INSERT INTO row_structure_state(revision,selected_source_rows,issues) VALUES (?1,?2,?3)",params![expected,selected_source_rows,issues])?;
        tx.commit()?;
        Ok(RowStructureReceipt {
            revision: expected,
            selected_source_rows,
            issues,
            constraints_passed: issues == 0,
        })
    }
    pub(crate) fn row_issues(
        &self,
        expected: String,
        after: i64,
        limit: usize,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<RowIssuePage, CommandError> {
        check()?;
        if !(0..=9_007_199_254_740_991).contains(&after) || !(1..=100).contains(&limit) {
            return Err(CommandError::new(
                "backup/invalid-archive",
                "Invalid row constraint page",
            ));
        }
        if choices::revision(&self.events.entries)? != expected
            || cached(&self.events.entries, &expected)?.is_none()
        {
            return Err(changed());
        }
        let mut statement = self.events.entries.prepare("SELECT id,kind,table_name,entry_id,related_table FROM row_structure_issues WHERE id>?1 ORDER BY id LIMIT ?2")?;
        let mut rows = statement.query(params![after, limit as i64 + 1])?;
        let mut entries = Vec::new();
        while let Some(row) = rows.next()? {
            check()?;
            entries.push(RowIssue {
                id: row.get(0)?,
                kind: row.get(1)?,
                table: row.get(2)?,
                entry_id: row.get(3)?,
                related_table: row.get(4)?,
            });
        }
        let next_after = if entries.len() > limit {
            entries.truncate(limit);
            entries.last().map(|e| e.id)
        } else {
            None
        };
        Ok(RowIssuePage {
            revision: expected,
            entries,
            next_after,
        })
    }
}
