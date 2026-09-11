//! Coordinates immutable plugin file backups with SQLite's durable update
//! journal. Recovery runs before frontend KV hydration or roaming overlays.
use crate::{error::CommandError, plugins, storage};
use rusqlite::Connection;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

fn update_dir(root: &Path, id: &str) -> Result<PathBuf, CommandError> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(CommandError::new(
            "plugin/invalid-argument",
            "invalid plugin update identity",
        ));
    }
    Ok(root.join(".updates").join(id))
}
fn file_error(message: String) -> CommandError {
    CommandError::new("plugin/recovery-required", message)
}

#[cfg(test)]
pub(crate) fn begin_at(
    conn: &mut Connection,
    root: &Path,
    plugin_id: &str,
    candidate_token: Option<String>,
) -> Result<storage::PluginUpdateJournal, CommandError> {
    begin_with_id_at(
        conn,
        root,
        plugin_id,
        candidate_token,
        &uuid::Uuid::new_v4().to_string(),
    )
}

fn begin_with_id_at(
    conn: &mut Connection,
    root: &Path,
    plugin_id: &str,
    candidate_token: Option<String>,
    id: &str,
) -> Result<storage::PluginUpdateJournal, CommandError> {
    let backup = update_dir(root, id)?;
    if let Some(existing) = storage::read_plugin_update(conn, id)? {
        if existing.plugin_id == plugin_id && existing.candidate_token == candidate_token {
            return Ok(existing);
        }
        return Err(CommandError::new(
            "plugin/invalid-argument",
            "plugin update identity belongs to another candidate",
        ));
    }
    if storage::list_plugin_updates(conn)?
        .iter()
        .any(|row| row.plugin_id == plugin_id)
    {
        return Err(CommandError::new(
            "plugin/recovery-required",
            "plugin update already pending",
        ));
    }
    // Validate the owner even for an activation which never touches files.
    storage::plugin_data_snapshot_inner(conn, plugin_id)?;
    let had_previous = if let Some(token) = &candidate_token {
        let (_, candidate) = plugins::candidate_at(root, token).map_err(file_error)?;
        if candidate.id != plugin_id {
            return Err(CommandError::new(
                "plugin/invalid-argument",
                "candidate belongs to another plugin",
            ));
        }
        fs::create_dir_all(&backup)?;
        let active = root.join(plugin_id);
        let had_previous = active.exists();
        if had_previous {
            plugins::copy_dir(&active, &backup.join("previous")).map_err(file_error)?;
        }
        Some(had_previous)
    } else {
        None
    };
    match storage::begin_plugin_update(conn, &id, plugin_id, candidate_token, had_previous) {
        Ok(journal) => Ok(journal),
        Err(error) => {
            if backup.exists() {
                if let Err(cleanup) = fs::remove_dir_all(&backup) {
                    log::warn!("plugin baseline cleanup failed: {cleanup}");
                }
            }
            Err(error)
        }
    }
}

fn restore_files(root: &Path, journal: &storage::PluginUpdateJournal) -> Result<(), CommandError> {
    let Some(had_previous) = journal.had_previous else {
        return Ok(());
    };
    let directory = update_dir(root, &journal.update_id)?;
    let active = root.join(&journal.plugin_id);
    if !had_previous {
        if active.exists() {
            fs::remove_dir_all(active)?;
        }
        return Ok(());
    }
    let previous = directory.join("previous");
    if !previous.join("manifest.json").is_file() {
        return Err(file_error("retained plugin baseline is missing".into()));
    }
    let restoring = directory.join("restoring");
    if restoring.exists() {
        fs::remove_dir_all(&restoring)?;
    }
    plugins::copy_dir(&previous, &restoring).map_err(file_error)?;
    let replaced = directory.join("replaced");
    if replaced.exists() {
        fs::remove_dir_all(&replaced)?;
    }
    if active.exists() {
        fs::rename(&active, &replaced)?;
    }
    fs::rename(&restoring, &active)?;
    // Never consume 'previous': a crash or SQLite failure can repeat this step.
    Ok(())
}
fn cleanup_files(root: &Path, journal: &storage::PluginUpdateJournal) -> Result<(), CommandError> {
    let directory = update_dir(root, &journal.update_id)?;
    if directory.exists() {
        fs::remove_dir_all(directory)?;
    }
    Ok(())
}

pub(crate) fn rollback_at(
    conn: &mut Connection,
    root: &Path,
    update_id: &str,
) -> Result<(), CommandError> {
    let journal = storage::read_plugin_update(conn, update_id)?
        .ok_or_else(|| file_error("plugin recovery record is missing".into()))?;
    if journal.phase != "prepared" {
        return Err(file_error(
            "accepted plugin update cannot be rolled back".into(),
        ));
    }
    restore_files(root, &journal)?;
    storage::rollback_plugin_update(conn, update_id)?;
    // Recovery is complete even if the now-orphaned backup cannot be removed.
    if let Err(error) = cleanup_files(root, &journal) {
        log::warn!("plugin recovered but backup cleanup failed: {error}");
    }
    Ok(())
}
pub(crate) fn finish_at(
    conn: &Connection,
    root: &Path,
    update_id: &str,
) -> Result<(), CommandError> {
    let Some(journal) = storage::read_plugin_update(conn, update_id)? else {
        return Ok(());
    };
    if journal.phase != "accepted" {
        return Err(file_error(
            "unaccepted plugin update cannot be finalized".into(),
        ));
    }
    cleanup_files(root, &journal)?;
    storage::finish_plugin_update(conn, update_id)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRecoveryFailure {
    pub plugin_id: String,
    pub code: String,
}

pub(crate) fn recover_at(
    conn: &mut Connection,
    root: &Path,
) -> Result<Vec<PluginRecoveryFailure>, CommandError> {
    let mut failed = Vec::new();
    for journal in storage::list_plugin_updates(conn)? {
        let result = if journal.phase == "accepted" {
            finish_at(conn, root, &journal.update_id)
        } else {
            rollback_at(conn, root, &journal.update_id)
        };
        if let Err(error) = result {
            if journal.phase == "accepted" {
                log::warn!(
                    "accepted plugin {} backup cleanup deferred: {error}",
                    journal.plugin_id
                );
                continue;
            }
            log::error!("plugin {} recovery failed: {error}", journal.plugin_id);
            failed.push(PluginRecoveryFailure {
                plugin_id: journal.plugin_id,
                code: "plugin/recovery-required".into(),
            });
        }
    }
    // A process can die after copying an immutable backup but before inserting
    // its DB record. Only startup runs this sweep; no live begin can race it.
    let retained: std::collections::BTreeSet<_> = storage::list_plugin_updates(conn)?
        .into_iter()
        .map(|row| row.update_id)
        .collect();
    let directories = root.join(".updates");
    if directories.exists() {
        let entries = match fs::read_dir(directories) {
            Ok(entries) => entries,
            Err(error) => {
                log::warn!("orphan plugin backup scan deferred: {error}");
                return Ok(failed);
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    log::warn!("orphan plugin backup entry scan deferred: {error}");
                    continue;
                }
            };
            let name = entry.file_name().to_string_lossy().to_string();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) => {
                    log::warn!("orphan plugin backup type scan deferred: {error}");
                    continue;
                }
            };
            if file_type.is_dir()
                && uuid::Uuid::parse_str(&name).is_ok()
                && !retained.contains(&name)
            {
                if let Err(error) = fs::remove_dir_all(entry.path()) {
                    log::warn!("orphan plugin backup cleanup deferred: {error}");
                }
            }
        }
    }
    Ok(failed)
}

#[tauri::command]
pub async fn plugins_update_begin(
    app: tauri::AppHandle,
    plugin_id: String,
    candidate_token: Option<String>,
    update_id: String,
) -> Result<storage::PluginUpdateJournal, CommandError> {
    storage::blocking("plugins_update_begin", move || {
        let root = plugins::plugins_dir(&app).map_err(file_error)?;
        let db = app.state::<storage::Db>();
        let mut conn = db.0.lock()?;
        begin_with_id_at(&mut conn, &root, &plugin_id, candidate_token, &update_id)
    })
    .await
}
#[tauri::command]
pub async fn plugins_update_get(
    app: tauri::AppHandle,
    update_id: String,
) -> Result<Option<storage::PluginUpdateJournal>, CommandError> {
    storage::blocking("plugins_update_get", move || {
        let db = app.state::<storage::Db>();
        let conn = db.0.lock()?;
        storage::read_plugin_update(&conn, &update_id)
    })
    .await
}
#[tauri::command]
pub async fn plugins_update_accept(
    app: tauri::AppHandle,
    update_id: String,
    expected_kv: BTreeMap<String, String>,
    expected_schema: Option<String>,
    events: Vec<storage::EventRow>,
) -> Result<storage::PluginUpdateJournal, CommandError> {
    storage::blocking("plugins_update_accept", move || {
        let db = app.state::<storage::Db>();
        let mut conn = db.0.lock()?;
        storage::accept_plugin_update(&mut conn, &update_id, expected_kv, expected_schema, &events)
    })
    .await
}
#[tauri::command]
pub async fn plugins_update_rollback(
    app: tauri::AppHandle,
    update_id: String,
) -> Result<(), CommandError> {
    storage::blocking("plugins_update_rollback", move || {
        let root = plugins::plugins_dir(&app).map_err(file_error)?;
        let db = app.state::<storage::Db>();
        let mut conn = db.0.lock()?;
        rollback_at(&mut conn, &root, &update_id)
    })
    .await
}
#[tauri::command]
pub async fn plugins_update_finish(
    app: tauri::AppHandle,
    update_id: String,
) -> Result<(), CommandError> {
    storage::blocking("plugins_update_finish", move || {
        let root = plugins::plugins_dir(&app).map_err(file_error)?;
        let db = app.state::<storage::Db>();
        let conn = db.0.lock()?;
        finish_at(&conn, &root, &update_id)
    })
    .await
}
/// Read-only boot result. Recovery itself must never be triggered by a webview
/// reload while old native calls may still be finishing in this process.
#[tauri::command]
pub async fn plugins_recovery_status(
    app: tauri::AppHandle,
) -> Result<Vec<PluginRecoveryFailure>, CommandError> {
    storage::blocking("plugins_recovery_status", move || {
        let db = app.state::<storage::Db>();
        let conn = db.0.lock()?;
        // Also detects a webview reload interrupted later in this process.
        Ok(storage::list_plugin_updates(&conn)?
            .into_iter()
            .filter(|journal| journal.phase == "prepared")
            .map(|journal| PluginRecoveryFailure {
                plugin_id: journal.plugin_id,
                code: "plugin/recovery-required".into(),
            })
            .collect())
    })
    .await
}

#[cfg(test)]
#[path = "plugin_updates_tests.rs"]
mod tests;
