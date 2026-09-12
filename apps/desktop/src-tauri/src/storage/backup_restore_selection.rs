use super::*;
use crate::storage::backup_restore_files::{FileChange, FileDigest, FileSource};
use rusqlite::Transaction;
use std::collections::BTreeSet;
fn incomplete(message: &str) -> CommandError {
    CommandError::new("backup/incomplete", message)
}
pub(super) fn blobs(
    plan: &FilePlan,
    choices: &BTreeMap<String, Side>,
) -> Result<BTreeSet<String>, CommandError> {
    let required: BTreeSet<_> = plan
        .matches
        .values()
        .filter(|f| {
            matches!(f.policy, FilePolicy::Blob)
                && f.source.is_some()
                && f.kind != super::super::FileMatchKind::Same
        })
        .map(|f| f.path.clone())
        .collect();
    if required.iter().ne(choices.keys()) {
        return Err(incomplete(
            "Every differing source blob needs an explicit file choice",
        ));
    }
    Ok(plan
        .matches
        .values()
        .filter(|f| {
            matches!(f.policy, FilePolicy::Blob)
                && f.source.is_some()
                && (f.kind == super::super::FileMatchKind::Same
                    || choices.get(&f.path) == Some(&Side::Source))
        })
        .map(|f| f.path.clone())
        .collect())
}
fn digest(file: &crate::storage::backup_snapshot::CapturedFile) -> FileDigest {
    FileDigest {
        bytes: file.byte_size,
        sha256: file.sha256.clone(),
    }
}
pub(super) fn files(
    plan: &FilePlan,
    _root: &Path,
    blobs: &BTreeSet<String>,
    programs: &[super::super::ProgramDecision],
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<Vec<FileChange>, CommandError> {
    let archive = plan.rows.events().source().archive();
    let mut selected = BTreeMap::new();
    for path in blobs {
        check()?;
        let incoming = plan.matches[path]
            .source
            .as_ref()
            .ok_or_else(|| incomplete("Selected blob is missing"))?;
        selected.insert(path.clone(), Some(incoming));
    }
    for program in programs {
        check()?;
        let Some(reference) = program.program.as_ref().filter(|p| p.side == Side::Source) else {
            continue;
        };
        let destination = program
            .destination
            .as_ref()
            .ok_or_else(|| incomplete("Missing selected program destination"))?;
        let prefix = format!("{}/", reference.root);
        let out_prefix = format!("{destination}/");
        let mut new_paths = BTreeSet::new();
        for file in &archive.manifest.files {
            check()?;
            if let Some(suffix) = file.path.strip_prefix(&prefix) {
                let path = format!("{out_prefix}{suffix}");
                new_paths.insert(path.clone());
                selected.insert(path, Some(file));
            }
        }
        for path in plan
            .target
            .files
            .keys()
            .filter(|p| p.starts_with(&out_prefix))
        {
            if !new_paths.contains(path) {
                selected.insert(path.clone(), None);
            }
        }
    }
    let mut changes = Vec::new();
    for (path, after) in selected {
        check()?;
        let before = plan.target.files.get(&path).map(digest);
        if before == after.map(digest) {
            continue;
        }
        changes.push(FileChange {
            path,
            before,
            after: after.map(|f| FileSource::File {
                path: archive.directory().join(&f.path),
                digest: digest(f),
            }),
        });
    }
    Ok(changes)
}
pub(super) fn validate_program_results(
    plan: &FilePlan,
    tx: &Transaction<'_>,
    root: &Path,
    programs: &[super::super::ProgramDecision],
    results: &BTreeMap<String, ProgramResult>,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<BTreeMap<String, i64>, CommandError> {
    let expected: BTreeSet<_> = programs
        .iter()
        .filter(|p| p.program.is_some())
        .map(|p| p.id.clone())
        .collect();
    if expected.iter().ne(results.keys()) {
        return Err(incomplete(
            "Every selected executable program requires its staged result",
        ));
    }
    let facts = plan.program_facts(tx, root, &mut *check)?;
    let mut versions = BTreeMap::new();
    for program in programs {
        check()?;
        let Some(reference) = &program.program else {
            continue;
        };
        let result = &results[&program.id];
        if result.program != *reference || (reference.side == Side::Source && !result.consented) {
            return Err(incomplete(
                "Selected program bytes need matching user consent and a staged result",
            ));
        }
        let candidate = facts
            .iter()
            .find(|f| f.id == program.id)
            .and_then(|f| {
                f.candidates.iter().find(|c| {
                    c.side == reference.side
                        && c.root == reference.root
                        && c.sha256 == reference.sha256
                })
            })
            .ok_or_else(|| incomplete("Program result is not bound to the selected bytes"))?;
        let manifest: serde_json::Value = serde_json::from_str(&candidate.manifest)
            .map_err(|_| incomplete("Invalid selected program manifest"))?;
        let version = manifest
            .get("schemaVersion")
            .and_then(|v| v.as_i64())
            .filter(|v| (1..=9_007_199_254_740_991).contains(v))
            .ok_or_else(|| incomplete("Invalid selected plugin schema"))?;
        let needs_migration = program
            .data_facts
            .schema
            .map_or(result.has_migration, |old| old != version);
        if needs_migration && !result.has_migration {
            return Err(incomplete("Plugin data schema changed without a migration"));
        }
        match (&result.migrated, needs_migration) {
            (Some(snapshot), true)
                if snapshot.plugin_id == program.id
                    && snapshot
                        .schema
                        .as_ref()
                        .and_then(|v| serde_json::from_str::<i64>(v).ok())
                        == Some(version) => {}
            (None, false) => {}
            _ => {
                return Err(incomplete(
                    "Staged plugin migration result is missing or mismatched",
                ))
            }
        }
        versions.insert(program.id.clone(), version);
    }
    Ok(versions)
}
