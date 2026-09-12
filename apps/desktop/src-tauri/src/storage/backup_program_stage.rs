//! A selected program's code and data for the host's isolated restore Worker.
//! The existing candidate protocol serves code; the FilePlan owns its lifetime.
use super::{programs::Side, FilePlan, ProgramChoice};
use crate::{
    error::CommandError,
    storage::{
        self,
        backup_restore_files::{copy_checked, FileDigest},
    },
};
use rusqlite::{params, Connection, Transaction};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
#[derive(Debug)]
pub(super) struct OwnedStage {
    token: String,
    id: String,
    path: PathBuf,
    connection: Connection,
}
impl Drop for OwnedStage {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!("Restore program stage cleanup failed: {error}");
            }
        }
    }
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProgramStageRequest {
    pub id: String,
    pub choices: BTreeMap<String, ProgramChoice>,
    pub consented: bool,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramStageReceipt {
    pub token: String,
    pub storage: BTreeMap<String, String>,
}
impl FilePlan {
    pub(crate) fn stage_program(
        &self,
        tx: &Transaction<'_>,
        root: &Path,
        request: ProgramStageRequest,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<ProgramStageReceipt, CommandError> {
        self.verify_target(tx, root, &mut check)?;
        self.verify_source(&mut check)?;
        let programs = self.prepare_programs(tx, root, &request.choices, &mut check)?;
        let selected = programs
            .iter()
            .find(|p| p.id == request.id)
            .ok_or_else(|| {
                CommandError::new("backup/incomplete", "Unknown staged restore plugin")
            })?;
        let reference = selected.program.as_ref().ok_or_else(|| {
            CommandError::new(
                "backup/incomplete",
                "Data-only selection has no executable stage",
            )
        })?;
        if reference.side == Side::Source && !request.consented {
            return Err(CommandError::new(
                "backup/incomplete",
                "Source program requires user consent before loading",
            ));
        }
        let token = uuid::Uuid::new_v4().to_string();
        let stages = root.join("plugins/.candidates");
        // Never follow an unexpected link in the executable staging namespace.
        for parent in [root.join("plugins"), stages.clone()] {
            fs::create_dir_all(&parent)?;
            if !fs::symlink_metadata(parent)?.file_type().is_dir() {
                return Err(CommandError::new(
                    "backup/changed",
                    "Plugin staging directory is not owned",
                ));
            }
        }
        let directory = stages.join(&token);
        let connection = Connection::open_in_memory()?;
        fs::create_dir(&directory)?;
        let mut owned = OwnedStage {
            token: token.clone(),
            id: request.id.clone(),
            path: directory.clone(),
            connection,
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        }
        let prefix = format!("{}/", reference.root);
        let archive = self.rows.events().source().archive();
        let files: Vec<_> = if reference.side == Side::Source {
            archive
                .manifest
                .files
                .iter()
                .filter(|f| f.path.starts_with(&prefix))
                .collect()
        } else {
            self.target
                .files
                .values()
                .filter(|f| f.path.starts_with(&prefix))
                .collect()
        };
        for file in files {
            check()?;
            let destination = directory.join(file.path.strip_prefix(&prefix).unwrap());
            fs::create_dir_all(destination.parent().unwrap())?;
            let source = if reference.side == Side::Source {
                archive.directory().join(&file.path)
            } else {
                storage::backup_snapshot::files::source_path(root, Some(&self.bundled), &file.path)?
            };
            copy_checked(
                &source,
                &destination,
                &FileDigest {
                    bytes: file.byte_size,
                    sha256: file.sha256.clone(),
                },
                &mut check,
            )?;
        }
        let data = if selected.data == Side::Source {
            self.rows.events().source().connection()
        } else {
            &self.rows.events.target_snapshot
        };
        let mut snapshot = storage::plugin_data_snapshot_conn(data, &selected.id)?;
        snapshot.kv.remove("schedule-state");
        snapshot.kv.remove("schedule-runs");
        let cancelled = self.rows.events().source().cancellation();
        owned.connection.progress_handler(
            1000,
            Some(move || cancelled.load(std::sync::atomic::Ordering::Acquire)),
        );
        storage::register_sql_functions(&owned.connection)?;
        storage::run_migrations(&mut owned.connection)?;
        let storage = snapshot.kv.clone();
        storage::plugin_data_restore_inner(&mut owned.connection, &request.id, snapshot)?;
        check()?;
        let mut stages = self.staged_programs.borrow_mut();
        stages.retain(|stage| stage.id != request.id);
        stages.push(owned);
        Ok(ProgramStageReceipt { token, storage })
    }
}

#[derive(serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum ProgramStageQuery {
    Get {
        key: String,
    },
    Set {
        key: String,
        json: String,
    },
    Remove {
        key: String,
    },
    DocsGet {
        collection: String,
        id: String,
    },
    DocsPut {
        collection: String,
        id: String,
        json: String,
        book_id: Option<String>,
        anchor: Option<String>,
    },
    DocsDelete {
        collection: String,
        id: String,
    },
    DocsList {
        collection: String,
        book_id: Option<String>,
        limit: Option<i64>,
        oldest_first: Option<bool>,
    },
    DocsPage {
        collection: String,
        query: storage::PluginDocumentPageQuery,
    },
    DocsApply {
        changes: Vec<storage::PluginDocumentMutation>,
    },
    Snapshot {
        schema_version: u64,
    },
}
impl OwnedStage {
    fn query(&mut self, query: ProgramStageQuery) -> Result<serde_json::Value, CommandError> {
        use ProgramStageQuery::*;
        let conn = &mut self.connection;
        let owner = &self.id;
        let prefix = format!("read-aware-plugin.{owner}.");
        let result = match query {
            Get { key } => {
                serde_json::to_value(storage::get_kv_inner(conn, &format!("{prefix}{key}"))?)?
            }
            Set { key, json } => {
                serde_json::from_str::<serde_json::Value>(&json)
                    .map_err(|e| CommandError::new("plugin/invalid-argument", e.to_string()))?;
                conn.execute("INSERT INTO app_kv(key,value_json,updated_at) VALUES (?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", params![format!("{prefix}{key}"),json])?;
                serde_json::Value::Null
            }
            Remove { key } => {
                conn.execute(
                    "DELETE FROM app_kv WHERE key=?1",
                    [format!("{prefix}{key}")],
                )?;
                serde_json::Value::Null
            }
            DocsGet { collection, id } => serde_json::to_value(
                storage::plugin_docs::plugin_docs_get_inner(conn, owner, &collection, &id)?,
            )?,
            DocsPut {
                collection,
                id,
                json,
                book_id,
                anchor,
            } => {
                storage::plugin_docs::plugin_docs_put_inner(
                    conn,
                    owner,
                    &collection,
                    &id,
                    &json,
                    book_id,
                    anchor,
                )?;
                serde_json::Value::Null
            }
            DocsDelete { collection, id } => {
                storage::plugin_docs::plugin_docs_delete_inner(conn, owner, &collection, &id)?;
                serde_json::Value::Null
            }
            DocsList {
                collection,
                book_id,
                limit,
                oldest_first,
            } => serde_json::to_value(storage::plugin_docs::plugin_docs_list_inner(
                conn,
                owner,
                &collection,
                book_id,
                limit,
                oldest_first,
            )?)?,
            DocsPage { collection, query } => serde_json::to_value(
                storage::plugin_docs_page_inner(conn, owner, &collection, query)?,
            )?,
            DocsApply { changes } => {
                serde_json::to_value(storage::plugin_docs_apply_inner(conn, owner, changes)?)?
            }
            Snapshot { schema_version } => {
                if schema_version == 0 || schema_version > 9_007_199_254_740_991 {
                    return Err(CommandError::new(
                        "backup/incomplete",
                        "Invalid migrated schema version",
                    ));
                }
                let mut snapshot = storage::plugin_data_snapshot_conn(conn, owner)?;
                snapshot.schema = Some(schema_version.to_string());
                serde_json::to_value(snapshot)?
            }
        };
        Ok(result)
    }
}
impl FilePlan {
    pub(crate) fn stage_storage(
        &self,
        token: &str,
        query: ProgramStageQuery,
        mut check: impl FnMut() -> Result<(), CommandError>,
    ) -> Result<serde_json::Value, CommandError> {
        check()?;
        let mut stages = self.staged_programs.borrow_mut();
        let stage = stages
            .iter_mut()
            .find(|stage| stage.token == token)
            .ok_or_else(|| {
                CommandError::new("backup/incomplete", "Unknown restore program stage")
            })?;
        let result = stage.query(query);
        check()?;
        result
    }
}

#[cfg(test)]
#[path = "backup_program_stage_tests.rs"]
mod tests;
