//! A union of stored row identities. It preserves evidence of differences and
//! routes each to a domain-specific decision; it does not choose a winning side.
use super::{revision, EventPlan};
use crate::error::CommandError;
use rusqlite::{params, Connection};
use std::collections::{BTreeMap, BTreeSet};

#[path = "backup_row_policy.rs"]
mod policy;
pub(crate) use policy::RowPolicy;
#[path = "backup_file_plan.rs"]
mod files;
#[path = "backup_row_scan.rs"]
mod scan;
pub(crate) use files::{FilePlan, FileMatchKind};

#[derive(Debug, Default)]
pub(crate) struct RowCounts {
    pub source_only: u64,
    pub target_only: u64,
    pub same: u64,
    pub different: u64,
    pub generated_only: u64,
}
#[derive(Debug)]
pub(crate) struct TablePlan {
    pub policy: RowPolicy,
    pub source_rows: u64,
    pub target_rows: u64,
    /// None means routed to another stage (schema, events, indexes, journal).
    pub comparisons: Option<RowCounts>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RowMatchKind {
    SourceOnly,
    TargetOnly,
    Same,
    Different,
}
#[derive(Debug)]
pub(crate) struct RowMatch {
    pub entry_id: i64,
    pub policy: RowPolicy,
    pub kind: RowMatchKind,
    pub source_digest: Option<String>,
    pub target_digest: Option<String>,
    pub generated_only: bool,
}
#[derive(Debug)]
pub(crate) struct RowPage {
    pub entries: Vec<RowMatch>,
    pub next_after: Option<i64>,
}
#[derive(Debug)]
pub(crate) struct RowPlan {
    events: EventPlan,
    pub tables: BTreeMap<String, TablePlan>,
}
impl RowPlan {
    pub(crate) fn plan_files(
        self,
        target: &mut Connection,
        data_dir: &std::path::Path,
        bundled: crate::plugins::BundledPrograms,
        check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<FilePlan, CommandError> {
        files::plan(self, target, data_dir, bundled, check)
    }
    #[cfg(test)]
    pub(crate) fn plan_fixture_files(
        self,
        target: &mut Connection,
        data_dir: &std::path::Path,
        check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<FilePlan, CommandError> {
        self.plan_files(
            target,
            data_dir,
            crate::plugins::BundledPrograms::fixture(data_dir),
            check,
        )
    }
    pub(crate) fn events(&self) -> &EventPlan {
        &self.events
    }
    pub(crate) fn page(
        &self,
        table: &str,
        after: i64,
        limit: usize,
    ) -> Result<RowPage, CommandError> {
        if !self.tables.contains_key(table) || after < 0 || !(1..=100).contains(&limit) {
            return Err(CommandError::new(
                "backup/invalid-archive",
                "invalid internal backup row page",
            ));
        }
        let mut statement = self.events.entries.prepare("SELECT entry_id,policy,source_digest,target_digest,source_full_digest,target_full_digest FROM row_matches WHERE table_name=?1 AND entry_id>?2 ORDER BY entry_id LIMIT ?3")?;
        let mut rows = statement.query(params![table, after, limit as i64 + 1])?;
        let mut entries = Vec::new();
        while let Some(row) = rows.next()? {
            let source: Option<String> = row.get(2)?;
            let target: Option<String> = row.get(3)?;
            let kind = match (&source, &target) {
                (None, Some(_)) => RowMatchKind::TargetOnly,
                (Some(_), None) => RowMatchKind::SourceOnly,
                (Some(source), Some(target)) if source == target => RowMatchKind::Same,
                (Some(_), Some(_)) => RowMatchKind::Different,
                _ => return Err(CommandError::internal("empty backup row comparison")),
            };
            let generated_only = kind == RowMatchKind::Same
                && row.get::<_, Option<String>>(4)? != row.get::<_, Option<String>>(5)?;
            entries.push(RowMatch {
                entry_id: row.get(0)?,
                policy: RowPolicy::from_name(&row.get::<_, String>(1)?)?,
                kind,
                source_digest: source,
                target_digest: target,
                generated_only,
            });
        }
        let next_after = if entries.len() > limit {
            entries.truncate(limit);
            entries.last().map(|row| row.entry_id)
        } else {
            None
        };
        Ok(RowPage {
            entries,
            next_after,
        })
    }
}

fn inventory(conn: &Connection) -> Result<BTreeSet<String>, CommandError> {
    let mut statement = conn.prepare("SELECT name FROM pragma_table_list WHERE schema='main' AND name!='sqlite_schema' AND type IN ('table','virtual','shadow') ORDER BY name")?;
    let rows = statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}
fn count(
    conn: &Connection,
    table: &str,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<u64, CommandError> {
    let mut statement = conn.prepare(&format!("SELECT 1 FROM {}", scan::quoted(table)))?;
    let mut rows = statement.query([])?;
    let mut count = 0;
    while rows.next()?.is_some() {
        check()?;
        count += 1;
    }
    Ok(count)
}
fn summarize(
    conn: &Connection,
    table: &str,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<RowCounts, CommandError> {
    let mut statement = conn.prepare("SELECT source_digest,target_digest,source_full_digest,target_full_digest FROM row_matches WHERE table_name=?1")?;
    let mut rows = statement.query([table])?;
    let mut counts = RowCounts::default();
    while let Some(row) = rows.next()? {
        check()?;
        let source: Option<String> = row.get(0)?;
        let target: Option<String> = row.get(1)?;
        match (&source, &target) {
            (Some(_), None) => counts.source_only += 1,
            (None, Some(_)) => counts.target_only += 1,
            (Some(source), Some(target)) if source == target => {
                counts.same += 1;
                counts.generated_only +=
                    u64::from(row.get::<_, Option<String>>(2)? != row.get::<_, Option<String>>(3)?);
            }
            (Some(_), Some(_)) => counts.different += 1,
            _ => return Err(CommandError::internal("empty backup row comparison")),
        }
    }
    Ok(counts)
}
pub(super) fn plan(
    mut events: EventPlan,
    target: &mut Connection,
    mut check: impl FnMut() -> Result<(), CommandError>,
) -> Result<RowPlan, CommandError> {
    let target = target.transaction()?;
    events.verify_target(&target, &mut check)?;
    let source = events.source.connection();
    let source_tables = inventory(source)?;
    let target_tables = inventory(&target)?;
    let names: BTreeSet<_> = source_tables.union(&target_tables).cloned().collect();
    // Resolve every table before creating any partial row decisions.
    for table in &names {
        policy::table(table)?;
    }
    let plan = events.entries.transaction()?;
    plan.execute_batch("CREATE TABLE row_matches (
        entry_id INTEGER PRIMARY KEY, table_name TEXT NOT NULL, row_key BLOB NOT NULL, policy TEXT NOT NULL,
        source_digest TEXT, target_digest TEXT, source_full_digest TEXT, target_full_digest TEXT,
        UNIQUE(table_name,row_key)
    ); CREATE INDEX row_matches_page ON row_matches(table_name,entry_id);")?;
    let mut tables = BTreeMap::new();
    for name in names {
        check()?;
        let policy = policy::table(&name)?;
        let source_exists = source_tables.contains(&name);
        let target_exists = target_tables.contains(&name);
        let source_rows = if source_exists {
            count(source, &name, &mut check)?
        } else {
            0
        };
        let target_rows = if target_exists {
            count(&target, &name, &mut check)?
        } else {
            0
        };
        if policy == RowPolicy::PluginJournal && (source_rows > 0 || target_rows > 0) {
            return Err(CommandError::new(
                "plugin/recovery-required",
                "plugin update must settle before restore row planning",
            ));
        }
        if name == "blobs" && (source_rows > 0 || target_rows > 0) {
            return Err(CommandError::new(
                "backup/incomplete",
                "inline blobs must be migrated before row planning",
            ));
        }
        let comparisons = if policy.compare_rows() {
            let a = if source_exists {
                Some(scan::columns(source, &name)?)
            } else {
                None
            };
            let b = if target_exists {
                Some(scan::columns(&target, &name)?)
            } else {
                None
            };
            if a.is_some() && b.is_some() && a != b {
                return Err(CommandError::new(
                    "backup/incomplete",
                    "source and target row shapes differ",
                ));
            }
            if let Some(columns) = &a {
                scan::rows(source, &plan, &name, policy, columns, true, &mut check)?;
            }
            if let Some(columns) = &b {
                scan::rows(&target, &plan, &name, policy, columns, false, &mut check)?;
            }
            Some(summarize(&plan, &name, &mut check)?)
        } else {
            None
        };
        tables.insert(
            name,
            TablePlan {
                policy,
                source_rows,
                target_rows,
                comparisons,
            },
        );
    }
    check()?;
    plan.commit()?;
    target.commit()?;
    Ok(RowPlan { events, tables })
}

#[cfg(test)]
#[path = "backup_row_plan_tests.rs"]
mod tests;
