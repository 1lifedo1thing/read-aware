//! Explicit row choices in the PRIVATE review plan. These are draft decisions,
//! not domain writes, event-conflict resolution, or a structurally valid restore.
use super::{RowPlan, RowPolicy};
use crate::error::CommandError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const MAX_SAFE: i64 = 9_007_199_254_740_991;
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RowChoice {
    Source,
    Target,
    Clear,
}
impl RowChoice {
    pub(super) fn name(self) -> Option<&'static str> {
        match self {
            Self::Source => Some("source"),
            Self::Target => Some("target"),
            Self::Clear => None,
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RowChoiceEdit {
    pub table: String,
    pub entry_id: i64,
    pub choice: RowChoice,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RowChoiceRequest {
    pub expected_revision: String,
    pub edits: Vec<RowChoiceEdit>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RowChoiceReceipt {
    pub revision: String,
    pub changed: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RowDecisionState {
    pub revision: String,
    pub unresolved: u64,
    pub source: u64,
    pub target: u64,
}
fn invalid() -> CommandError {
    CommandError::new("backup/invalid-archive", "Invalid backup row decision")
}

pub(super) fn selectable(policy: RowPolicy, source: Option<&str>, target: Option<&str>) -> bool {
    // Plugin JSON/schema must remain one namespace decision. Credentials,
    // runtime/identity and files have their own obligations, never generic rows.
    matches!(
        policy,
        RowPolicy::DomainState
            | RowPolicy::ConversationState
            | RowPolicy::LegacyData
            | RowPolicy::ReviewSettings
            | RowPolicy::VirtualBindings
            | RowPolicy::RoamingPreferences
    ) && source.is_some()
        && source != target
}
pub(super) fn revision(conn: &Connection) -> Result<String, CommandError> {
    Ok(conn.query_row(
        "SELECT revision FROM row_decision_state WHERE id=1",
        [],
        |r| r.get(0),
    )?)
}
impl RowPlan {
    pub(crate) fn choose_rows(
        &self,
        request: RowChoiceRequest,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<RowChoiceReceipt, CommandError> {
        check()?;
        if request.edits.is_empty()
            || request.edits.len() > 100
            || uuid::Uuid::parse_str(&request.expected_revision).is_err()
        {
            return Err(invalid());
        }
        let tx = self.events.entries.unchecked_transaction()?;
        if revision(&tx)? != request.expected_revision {
            return Err(CommandError::new(
                "backup/changed",
                "Backup row choices changed after review",
            ));
        }
        let mut seen = BTreeSet::new();
        let mut changed = 0;
        for edit in &request.edits {
            check()?;
            if edit.table.len() > 256
                || !self.tables.contains_key(&edit.table)
                || !(1..=MAX_SAFE).contains(&edit.entry_id)
                || !seen.insert(edit.entry_id)
            {
                return Err(invalid());
            }
            let mut statement = tx.prepare("SELECT policy,source_digest,target_digest,choice FROM row_matches WHERE table_name=?1 AND entry_id=?2")?;
            let mut rows = statement.query(params![edit.table, edit.entry_id])?;
            let row = rows.next()?.ok_or_else(invalid)?;
            let policy = RowPolicy::from_name(&row.get::<_, String>(0)?)?;
            let source: Option<String> = row.get(1)?;
            let target: Option<String> = row.get(2)?;
            if !selectable(policy, source.as_deref(), target.as_deref()) {
                return Err(invalid());
            }
            let previous: Option<String> = row.get(3)?;
            drop(rows);
            drop(statement);
            // A target choice on a source-only row explicitly leaves it absent.
            // Source absence can never silently delete a target-only record.
            if previous.as_deref() != edit.choice.name() {
                tx.execute(
                    "UPDATE row_matches SET choice=?1 WHERE entry_id=?2",
                    params![edit.choice.name(), edit.entry_id],
                )?;
                changed += 1;
            }
        }
        check()?;
        let revision = if changed == 0 {
            request.expected_revision
        } else {
            uuid::Uuid::new_v4().to_string()
        };
        tx.execute(
            "UPDATE row_decision_state SET revision=?1 WHERE id=1",
            [&revision],
        )?;
        tx.commit()?;
        Ok(RowChoiceReceipt { revision, changed })
    }
    pub(crate) fn row_decisions(
        &self,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<RowDecisionState, CommandError> {
        check()?;
        let mut state = RowDecisionState {
            revision: revision(&self.events.entries)?,
            unresolved: 0,
            source: 0,
            target: 0,
        };
        let mut statement = self.events.entries.prepare("SELECT policy,source_digest,target_digest,choice FROM row_matches WHERE source_digest IS NOT NULL AND (target_digest IS NULL OR source_digest!=target_digest)")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            check()?;
            let policy = RowPolicy::from_name(&row.get::<_, String>(0)?)?;
            let source: Option<String> = row.get(1)?;
            let target: Option<String> = row.get(2)?;
            if !selectable(policy, source.as_deref(), target.as_deref()) {
                continue;
            }
            match row.get::<_, Option<String>>(3)?.as_deref() {
                None => state.unresolved += 1,
                Some("source") => state.source += 1,
                Some("target") => state.target += 1,
                _ => return Err(invalid()),
            }
        }
        Ok(state)
    }
}
