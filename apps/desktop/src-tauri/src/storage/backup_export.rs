//! Host-owned export task. Only an opaque ID and progress cross IPC; the
//! plaintext snapshot stays native between capture and encrypted publication.
use super::{backup_archive, backup_snapshot, backup_staging::BackupStaging, DataDir, Db};
use crate::error::CommandError;
use age::secrecy::SecretString;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

const IDLE_LIMIT: Duration = Duration::from_secs(10 * 60);
fn cancelled() -> CommandError {
    CommandError::new("backup/cancelled", "Backup export task cancelled")
}
fn missing() -> CommandError {
    CommandError::new(
        "backup/changed",
        "Backup export task is no longer available",
    )
}

struct Task {
    owner: String,
    id: String,
    cancelled: Arc<AtomicBool>,
    ready: Option<(backup_snapshot::BackupSnapshot, Instant)>,
}
#[derive(Clone, Default)]
pub struct ExportTasks(Arc<Mutex<Option<Task>>>);
struct Lease {
    tasks: ExportTasks,
    cancelled: Arc<AtomicBool>,
    retained: bool,
}
impl Lease {
    fn check(&self) -> Result<(), CommandError> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(cancelled())
        } else {
            Ok(())
        }
    }
    fn publish(mut self, snapshot: backup_snapshot::BackupSnapshot) -> Result<(), CommandError> {
        self.check()?;
        let mut task = self.tasks.0.lock()?;
        let current = task
            .as_mut()
            .filter(|task| Arc::ptr_eq(&task.cancelled, &self.cancelled))
            .ok_or_else(missing)?;
        self.check()?;
        current.ready = Some((snapshot, Instant::now()));
        self.retained = true;
        Ok(())
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if self.retained {
            return;
        }
        match self.tasks.0.lock() {
            Ok(mut slot) => {
                if slot
                    .as_ref()
                    .is_some_and(|task| Arc::ptr_eq(&task.cancelled, &self.cancelled))
                {
                    slot.take();
                }
            }
            Err(error) => log::error!("backup export task release failed: {error}"),
        }
    }
}
impl ExportTasks {
    fn begin(&self, owner: &str, id: &str) -> Result<Lease, CommandError> {
        uuid::Uuid::parse_str(id)
            .map_err(|_| CommandError::new("backup/invalid-archive", "Invalid export task ID"))?;
        self.expire_ready(Instant::now())?;
        let mut slot = self.0.lock()?;
        if slot.is_some() {
            return Err(CommandError::new(
                "backup/busy",
                "Another export task is active",
            ));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        *slot = Some(Task {
            owner: owner.to_owned(),
            id: id.to_owned(),
            cancelled: cancelled.clone(),
            ready: None,
        });
        Ok(Lease {
            tasks: self.clone(),
            cancelled,
            retained: false,
        })
    }
    fn take(
        &self,
        owner: &str,
        id: &str,
    ) -> Result<(Lease, backup_snapshot::BackupSnapshot), CommandError> {
        self.expire_ready(Instant::now())?;
        let mut slot = self.0.lock()?;
        let task = slot
            .as_mut()
            .filter(|task| task.owner == owner && task.id == id)
            .ok_or_else(missing)?;
        if task.cancelled.load(Ordering::Acquire) {
            return Err(cancelled());
        }
        let (snapshot, _) = task
            .ready
            .take()
            .ok_or_else(|| CommandError::new("backup/busy", "Export task is still running"))?;
        Ok((
            Lease {
                tasks: self.clone(),
                cancelled: task.cancelled.clone(),
                retained: false,
            },
            snapshot,
        ))
    }
    fn cancel(&self, owner: &str, id: Option<&str>) -> Result<(), CommandError> {
        let removed = {
            let mut slot = self.0.lock()?;
            let Some(task) = slot
                .as_mut()
                .filter(|task| task.owner == owner && id.is_none_or(|id| task.id == id))
            else {
                return Ok(());
            };
            task.cancelled.store(true, Ordering::Release);
            // Running work keeps its reservation until its physical receipt.
            if task.ready.is_some() {
                slot.take()
            } else {
                None
            }
        };
        drop(removed); // File cleanup never holds the task mutex.
        Ok(())
    }
    fn expire_ready(&self, now: Instant) -> Result<(), CommandError> {
        let removed = {
            let mut slot = self.0.lock()?;
            if slot
                .as_ref()
                .and_then(|task| task.ready.as_ref())
                .is_some_and(|(_, at)| now.saturating_duration_since(*at) >= IDLE_LIMIT)
            {
                slot.take()
            } else {
                None
            }
        };
        drop(removed);
        Ok(())
    }
    /// Reclaims an abandoned ready task even after a webview reload. Active
    /// capture/encryption has a physical owner and is never timed out by age.
    pub fn start_cleanup(&self) -> std::io::Result<()> {
        let weak = Arc::downgrade(&self.0);
        std::thread::Builder::new()
            .name("backup-export-cleanup".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_secs(60));
                let Some(state) = weak.upgrade() else {
                    break;
                };
                if let Err(error) = ExportTasks(state).expire_ready(Instant::now()) {
                    log::warn!("backup export cleanup failed: {error}");
                }
            })?;
        Ok(())
    }
    pub fn cancel_owner(&self, owner: &str) {
        if let Err(error) = self.cancel(owner, None) {
            log::warn!("backup export owner cleanup failed: {error}");
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExportProgress {
    Preparing,
    Database {
        remaining_pages: i32,
        total_pages: i32,
    },
    Files {
        copied_bytes: u64,
    },
    VerifyingPrograms,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureReceipt {
    task_id: String,
    format: u32,
}

fn missing_sources(
    conn: &rusqlite::Connection,
    data_dir: &Path,
) -> Result<Vec<String>, CommandError> {
    let mut statement = conn.prepare("SELECT key,storage_uri FROM blob_objects WHERE deleted_at IS NULL ORDER BY key LIMIT 100001")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    })?;
    let mut missing = Vec::new();
    for (index, row) in rows.enumerate() {
        if index >= 100_000 {
            return Err(CommandError::new(
                "backup/incomplete",
                "Backup blob catalog exceeds its bound",
            ));
        }
        let (key, uri) = row?;
        let expected = format!("blobs/{}", super::blob_file_name(&key));
        if let Some(uri) = uri {
            if uri != expected {
                return Err(CommandError::new(
                    "backup/incomplete",
                    "Invalid registered blob location",
                ));
            }
        } else {
            missing.push(key);
            continue;
        }
        match std::fs::symlink_metadata(data_dir.join(expected)) {
            Ok(metadata) if metadata.file_type().is_file() => {}
            Ok(_) => {
                return Err(CommandError::new(
                    "backup/incomplete",
                    "Registered blob is not a regular file",
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => missing.push(key),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(missing)
}
/// Source preparation may download these through the current sync scope before
/// the final write fence. Capture independently rechecks the complete catalog.
#[tauri::command]
pub async fn backup_export_sources(app: tauri::AppHandle) -> Result<Vec<String>, CommandError> {
    super::blocking("backup_export_sources", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        missing_sources(&conn, &app.state::<DataDir>().0)
    })
    .await
}

#[tauri::command]
pub async fn backup_export_capture(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    progress: tauri::ipc::Channel<ExportProgress>,
) -> Result<CaptureReceipt, CommandError> {
    let tasks = app.state::<ExportTasks>().inner().clone();
    // Reserve before blocking work starts. The host retries cancellation on
    // progress/receipt if its first IPC arrived before this command was polled.
    let lease = tasks.begin(window.label(), &task_id)?;
    super::blocking("backup_export_capture", move || {
        let bundled = crate::plugins::backup_programs(&app)?;
        let db = app.state::<Db>();
        let mut conn = db.0.lock()?;
        let snapshot = backup_snapshot::capture(
            &mut conn,
            &app.state::<DataDir>().0,
            &app.state::<BackupStaging>(),
            &bundled,
            |update| {
                lease.check()?;
                let update = match update {
                    backup_snapshot::CaptureProgress::Preparing => ExportProgress::Preparing,
                    backup_snapshot::CaptureProgress::Database {
                        remaining_pages,
                        total_pages,
                    } => ExportProgress::Database {
                        remaining_pages,
                        total_pages,
                    },
                    backup_snapshot::CaptureProgress::Files { copied_bytes } => {
                        ExportProgress::Files { copied_bytes }
                    }
                    backup_snapshot::CaptureProgress::VerifyingPrograms => {
                        ExportProgress::VerifyingPrograms
                    }
                };
                progress.send(update).map_err(|_| cancelled())
            },
        )?;
        drop(conn);
        lease.publish(snapshot)?;
        Ok(CaptureReceipt {
            task_id,
            format: backup_snapshot::FORMAT,
        })
    })
    .await
}

fn write(
    tasks: &ExportTasks,
    owner: &str,
    id: &str,
    password: SecretString,
    destination: &Path,
    data_dir: &Path,
) -> Result<(), CommandError> {
    let (lease, snapshot) = tasks.take(owner, id)?;
    let result = (|| {
        lease.check()?;
        if !destination.is_absolute() {
            return Err(CommandError::new(
                "backup/invalid-archive",
                "Backup destination must be absolute",
            ));
        }
        let parent = destination.parent().ok_or_else(missing)?.canonicalize()?;
        if parent.starts_with(data_dir.canonicalize()?) {
            return Err(CommandError::new(
                "backup/invalid-archive",
                "Backup destination overlaps managed application data",
            ));
        }
        backup_archive::write_archive(&snapshot, password, destination, || lease.check())
    })();
    drop(snapshot); // Retain admission until private files are actually released.
    drop(lease);
    result
}
#[tauri::command]
pub async fn backup_export_write(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
    password: String,
    destination: String,
) -> Result<(), CommandError> {
    let tasks = app.state::<ExportTasks>().inner().clone();
    let owner = window.label().to_owned();
    let password = SecretString::from(password);
    super::blocking("backup_export_write", move || {
        write(
            &tasks,
            &owner,
            &task_id,
            password,
            Path::new(&destination),
            &app.state::<DataDir>().0,
        )
    })
    .await
}
#[tauri::command]
pub async fn backup_export_cancel(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    task_id: String,
) -> Result<(), CommandError> {
    let tasks = app.state::<ExportTasks>().inner().clone();
    let owner = window.label().to_owned();
    super::blocking("backup_export_cancel", move || {
        tasks.cancel(&owner, Some(&task_id))
    })
    .await
}

#[cfg(test)]
#[path = "backup_export_tests.rs"]
mod tests;
