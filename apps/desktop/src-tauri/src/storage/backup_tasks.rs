//! Shared native ownership for export snapshots and import preparation.
//! Idle results expire; physical work retains its reservation until its lease drops.
use super::{
    backup_archive::{FilePlan, PreflightedBackup},
    backup_snapshot::BackupSnapshot,
};
use crate::error::CommandError;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Phase {
    Export,
    Source,
    Plan,
}
pub(crate) enum PreparedBackup {
    Export(BackupSnapshot),
    Source(PreflightedBackup),
    Plan(FilePlan),
}
impl PreparedBackup {
    fn phase(&self) -> Phase {
        match self {
            Self::Export(_) => Phase::Export,
            Self::Source(_) => Phase::Source,
            Self::Plan(_) => Phase::Plan,
        }
    }
}
impl From<BackupSnapshot> for PreparedBackup {
    fn from(value: BackupSnapshot) -> Self {
        Self::Export(value)
    }
}

pub(crate) const IDLE_LIMIT: Duration = Duration::from_secs(10 * 60);
pub(crate) fn cancelled() -> CommandError {
    CommandError::new("backup/cancelled", "Backup task cancelled")
}
pub(crate) fn missing() -> CommandError {
    CommandError::new("backup/changed", "Backup task is no longer available")
}

struct Task {
    owner: String,
    id: String,
    cancelled: Arc<AtomicBool>,
    ready: Option<(PreparedBackup, Instant)>,
}
#[derive(Clone, Default)]
pub struct BackupTasks(Arc<Mutex<Option<Task>>>);
pub(crate) struct Lease {
    tasks: BackupTasks,
    cancelled: Arc<AtomicBool>,
    retained: bool,
}
impl Lease {
    pub(crate) fn cancellation(&self) -> Arc<AtomicBool> {
        self.cancelled.clone()
    }
    pub(crate) fn check(&self) -> Result<(), CommandError> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(cancelled())
        } else {
            Ok(())
        }
    }
    pub(crate) fn publish(
        mut self,
        snapshot: impl Into<PreparedBackup>,
    ) -> Result<(), CommandError> {
        self.check()?;
        let mut task = self.tasks.0.lock()?;
        let current = task
            .as_mut()
            .filter(|task| Arc::ptr_eq(&task.cancelled, &self.cancelled))
            .ok_or_else(missing)?;
        self.check()?;
        current.ready = Some((snapshot.into(), Instant::now()));
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
            Err(error) => log::error!("backup task release failed: {error}"),
        }
    }
}
impl BackupTasks {
    #[cfg(test)]
    pub(crate) fn is_empty(&self) -> bool {
        self.0.lock().unwrap().is_none()
    }
    pub(crate) fn begin(&self, owner: &str, id: &str) -> Result<Lease, CommandError> {
        uuid::Uuid::parse_str(id)
            .map_err(|_| CommandError::new("backup/invalid-archive", "Invalid backup task ID"))?;
        self.expire_ready(Instant::now())?;
        let mut slot = self.0.lock()?;
        if slot.is_some() {
            return Err(CommandError::new(
                "backup/busy",
                "Another backup task is active",
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
    pub(crate) fn take(
        &self,
        owner: &str,
        id: &str,
        phase: Phase,
    ) -> Result<(Lease, PreparedBackup), CommandError> {
        self.expire_ready(Instant::now())?;
        let mut slot = self.0.lock()?;
        let task = slot
            .as_mut()
            .filter(|task| task.owner == owner && task.id == id)
            .ok_or_else(missing)?;
        if task.cancelled.load(Ordering::Acquire) {
            return Err(cancelled());
        }
        if task
            .ready
            .as_ref()
            .is_some_and(|(value, _)| value.phase() != phase)
        {
            return Err(CommandError::new(
                "backup/changed",
                "Backup task is in another phase",
            ));
        }
        let (snapshot, _) = task
            .ready
            .take()
            .ok_or_else(|| CommandError::new("backup/busy", "Backup task is still running"))?;
        Ok((
            Lease {
                tasks: self.clone(),
                cancelled: task.cancelled.clone(),
                retained: false,
            },
            snapshot,
        ))
    }
    pub(crate) fn cancel(&self, owner: &str, id: Option<&str>) -> Result<(), CommandError> {
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
    pub(crate) fn expire_ready(&self, now: Instant) -> Result<(), CommandError> {
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
    /// capture, encryption, decryption and planning have a physical owner and
    /// are never timed out by age.
    pub fn start_cleanup(&self) -> std::io::Result<()> {
        let weak = Arc::downgrade(&self.0);
        std::thread::Builder::new()
            .name("backup-task-cleanup".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_secs(60));
                let Some(state) = weak.upgrade() else {
                    break;
                };
                if let Err(error) = BackupTasks(state).expire_ready(Instant::now()) {
                    log::warn!("backup cleanup failed: {error}");
                }
            })?;
        Ok(())
    }
    pub fn cancel_owner(&self, owner: &str) {
        if let Err(error) = self.cancel(owner, None) {
            log::warn!("backup owner cleanup failed: {error}");
        }
    }
}
