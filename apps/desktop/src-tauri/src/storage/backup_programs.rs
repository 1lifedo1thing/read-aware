//! Whole program and private namespace choices. This layer binds choices to
//! verified bytes; manifest semantics, consent and migration run in the host.
use super::{read_manifest, FilePlan};
use crate::error::CommandError;
use rusqlite::{Connection, Transaction};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Side {
    Source,
    Target,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramCandidate {
    pub side: Side,
    pub root: String,
    pub sha256: String,
    pub manifest: String,
    pub main: String,
    pub main_present: bool,
}
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DataFacts {
    pub kv_rows: u64,
    pub documents: u64,
    pub schema: Option<i64>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramFacts {
    pub id: String,
    /// Derived from this executable's compiled set, NEVER a backup manifest.
    pub builtin: bool,
    pub candidates: Vec<ProgramCandidate>,
    pub source_data: DataFacts,
    pub target_data: DataFacts,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProgramRef {
    pub side: Side,
    pub root: String,
    pub sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProgramChoice {
    /// None explicitly selects data-only recovery; not an implicit deletion.
    pub program: Option<ProgramRef>,
    pub data: Side,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramDecision {
    pub id: String,
    pub program: Option<ProgramRef>,
    /// Source code is installed ONLY as external, never into bundled-plugins.
    pub destination: Option<String>,
    pub data: Side,
    pub data_facts: DataFacts,
}
fn invalid(message: &str) -> CommandError {
    CommandError::new("backup/incomplete", message)
}
fn ensure<'a>(
    facts: &'a mut BTreeMap<String, ProgramFacts>,
    id: &str,
) -> Result<&'a mut ProgramFacts, CommandError> {
    if !crate::plugins::valid_plugin_id(id) || (!facts.contains_key(id) && facts.len() >= 10000) {
        return Err(invalid("invalid or excessive plugin restore owners"));
    }
    Ok(facts.entry(id.to_owned()).or_insert_with(|| ProgramFacts {
        id: id.into(),
        builtin: crate::plugins::is_bundled_plugin(id),
        candidates: vec![],
        source_data: DataFacts::default(),
        target_data: DataFacts::default(),
    }))
}
fn data(facts: &mut ProgramFacts, side: Side) -> &mut DataFacts {
    match side {
        Side::Source => &mut facts.source_data,
        Side::Target => &mut facts.target_data,
    }
}
fn scan_data(
    conn: &Connection,
    side: Side,
    facts: &mut BTreeMap<String, ProgramFacts>,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    // Only names/schema/counts cross the review seam, never private KV/doc bodies.
    let mut stmt=conn.prepare("SELECT key FROM app_kv WHERE substr(key,1,length('read-aware-plugin.'))='read-aware-plugin.' OR substr(key,1,length('read-aware-plugin-host.schema.'))='read-aware-plugin-host.schema.' ORDER BY key")?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let key: String = row.get(0)?;
        if key.len() > 8192 {
            return Err(invalid("plugin data key exceeds restore limit"));
        }
        if let Some(rest) = key.strip_prefix("read-aware-plugin.") {
            let (id, _) = rest
                .split_once('.')
                .ok_or_else(|| invalid("invalid plugin KV owner"))?;
            data(ensure(facts, id)?, side).kv_rows += 1;
        } else if let Some(id) = key.strip_prefix("read-aware-plugin-host.schema.") {
            // Bound before loading a possibly damaged target's schema text.
            let (len, raw):(i64, Option<String>)=conn.query_row("SELECT length(CAST(value_json AS BLOB)), CASE WHEN length(CAST(value_json AS BLOB))<=16 THEN value_json ELSE NULL END FROM app_kv WHERE key=?1",[&key],|row|Ok((row.get(0)?,row.get(1)?)))?;
            if len > 16 {
                return Err(invalid("invalid plugin storage version"));
            }
            let raw = raw.ok_or_else(|| invalid("invalid plugin storage version"))?;
            let version = raw
                .parse::<i64>()
                .ok()
                .filter(|n| (1..=9_007_199_254_740_991).contains(n) && n.to_string() == raw)
                .ok_or_else(|| invalid("invalid plugin storage version"))?;
            data(ensure(facts, id)?, side).schema = Some(version);
        }
    }
    let mut stmt = conn.prepare("SELECT plugin_id FROM plugin_documents ORDER BY plugin_id")?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        data(ensure(facts, &row.get::<_, String>(0)?)?, side).documents += 1;
    }
    Ok(())
}
pub(super) fn inspect(
    plan: &FilePlan,
    tx: &Transaction<'_>,
    root: &Path,
    mut check: impl FnMut() -> Result<(), CommandError>,
) -> Result<Vec<ProgramFacts>, CommandError> {
    plan.verify_target(tx, root, &mut check)?;
    plan.verify_source(&mut check)?;
    let archive = plan.rows().events().source().archive();
    let mut facts = BTreeMap::new();
    scan_data(
        plan.rows().events().source().connection(),
        Side::Source,
        &mut facts,
        &mut check,
    )?;
    scan_data(tx, Side::Target, &mut facts, &mut check)?;
    let mut manifest_bytes = 0usize;
    for group in &plan.programs {
        for (side, tree, base) in [
            (Side::Source, group.source.as_ref(), archive.directory()),
            (Side::Target, group.target.as_ref(), root),
        ] {
            let Some(tree) = tree else { continue };
            check()?;
            let id = group.root.split_once('/').unwrap().1;
            let file = plan
                .matches
                .get(&format!("{}/manifest.json", group.root))
                .and_then(|item| match side {
                    Side::Source => item.source.as_ref(),
                    Side::Target => item.target.as_ref(),
                })
                .ok_or_else(|| invalid("missing program manifest"))?;
            manifest_bytes += file.byte_size as usize;
            if manifest_bytes > 16 * 1024 * 1024 {
                return Err(invalid("plugin review manifests exceed limit"));
            }
            let manifest = read_manifest(base, file, &mut check)?;
            let parsed: serde_json::Value = serde_json::from_str(&manifest)?;
            // Same whitespace/default spelling as the host parser. Semantics
            // and path validity still go through its single manifest validator.
            let main = parsed
                .get("main")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("main.js")
                .to_owned();
            let main_present = plan
                .matches
                .get(&format!("{}/{main}", group.root))
                .is_some_and(|item| match side {
                    Side::Source => item.source.is_some(),
                    Side::Target => item.target.is_some(),
                });
            ensure(&mut facts, id)?.candidates.push(ProgramCandidate {
                side,
                root: group.root.clone(),
                sha256: tree.sha256.clone(),
                manifest,
                main,
                main_present,
            });
        }
    }
    plan.verify_target(tx, root, &mut check)?;
    plan.verify_source(&mut check)?;
    Ok(facts.into_values().collect())
}
pub(super) fn prepare(
    plan: &FilePlan,
    tx: &Transaction<'_>,
    root: &Path,
    choices: &BTreeMap<String, ProgramChoice>,
    mut check: impl FnMut() -> Result<(), CommandError>,
) -> Result<Vec<ProgramDecision>, CommandError> {
    let facts = inspect(plan, tx, root, &mut check)?;
    if facts.len() != choices.len() || facts.iter().any(|f| !choices.contains_key(&f.id)) {
        return Err(invalid(
            "every plugin requires an explicit program and data choice",
        ));
    }
    let mut result = Vec::new();
    for fact in facts {
        check()?;
        let choice = &choices[&fact.id];
        let selected = match &choice.program {
            Some(reference) => Some(
                fact.candidates
                    .iter()
                    .find(|c| {
                        c.side == reference.side
                            && c.root == reference.root
                            && c.sha256 == reference.sha256
                    })
                    .ok_or_else(|| {
                        CommandError::new(
                            "backup/changed",
                            "selected program no longer matches its tree",
                        )
                    })?,
            ),
            None => None,
        };
        if fact.builtin
            && !selected.is_some_and(|c| {
                c.side == Side::Target && c.root == format!("bundled-plugins/{}", fact.id)
            })
        {
            return Err(invalid("current bundled plugin code must be retained"));
        }
        if selected.is_some_and(|c| !c.main_present) {
            return Err(invalid("selected plugin entry module is missing"));
        }
        result.push(ProgramDecision {
            id: fact.id.clone(),
            program: choice.program.clone(),
            destination: selected.map(|c| {
                if c.side == Side::Target {
                    c.root.clone()
                } else {
                    format!("plugins/{}", fact.id)
                }
            }),
            data: choice.data,
            data_facts: match choice.data {
                Side::Source => fact.source_data,
                Side::Target => fact.target_data,
            },
        });
    }
    // These are still unapplied obligations. The final owner must reverify the
    // same FilePlan and run host consent/migration before its atomic decision.
    Ok(result)
}
#[cfg(test)]
#[path = "backup_programs_tests.rs"]
mod tests;
