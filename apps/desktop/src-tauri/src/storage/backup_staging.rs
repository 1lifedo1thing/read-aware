//! Disposable full-backup preparation, protected by OS-backed SQLite leases.
//! This is NEVER the home of a committed restore journal or its recovery files.
use crate::error::CommandError;
use rusqlite::{Connection, OpenFlags};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tempfile::TempDir;
const CONTROL: &str = ".control";
const LEASE: &str = ".lease.sqlite";
const APPLICATION_ID: i64 = 0x5241424b;
const PREFIX: &str = "stage-";

#[derive(Debug, Clone)]
pub(crate) struct BackupStaging {
    root: PathBuf,
}
#[derive(Debug, Default)]
pub(crate) struct CleanupReport {
    pub removed: usize,
    pub active: usize,
    pub skipped: usize,
    pub failed: usize,
}
#[derive(Debug)]
pub(crate) struct BackupDirectory {
    directory: Option<TempDir>,
    lease: Option<Connection>,
    owner: BackupStaging,
}
fn incomplete(message: &str) -> CommandError {
    CommandError::new("backup/incomplete", message)
}
fn private_directory(path: &Path) -> Result<(), CommandError> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)?;
    if !fs::symlink_metadata(path)?.file_type().is_dir() {
        return Err(incomplete("backup staging root is not an owned directory"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
fn regular(path: &Path) -> Result<(), CommandError> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(incomplete("backup lease is not an owned regular file"));
    }
    Ok(())
}
fn busy(error: &rusqlite::Error) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
    )
}
impl BackupStaging {
    pub(crate) fn for_app(data_dir: &Path) -> Self {
        Self {
            root: data_dir.join("backup-staging-v1"),
        }
    }
    #[cfg(test)]
    pub(crate) fn fixture(root: &Path) -> Self {
        Self {
            root: root.to_owned(),
        }
    }
    fn registry(&self) -> Result<Connection, CommandError> {
        private_directory(&self.root)?;
        let control = self.root.join(CONTROL);
        private_directory(&control)?;
        let path = control.join("registry.sqlite");
        match fs::symlink_metadata(&path) {
            Ok(_) => regular(&path)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(Duration::ZERO)?;
        // No user data, tables or statements from an archive are executed here.
        conn.execute_batch("BEGIN EXCLUSIVE")?;
        Ok(conn)
    }
    pub(crate) fn cleanup(&self) -> Result<CleanupReport, CommandError> {
        match fs::symlink_metadata(&self.root) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(CleanupReport::default())
            }
            Err(e) => return Err(e.into()),
            Ok(_) => {}
        }
        let _registry = self.registry()?;
        let mut report = CleanupReport::default();
        for (index, entry) in fs::read_dir(&self.root)?.enumerate() {
            if index >= 10000 {
                return Err(incomplete("backup staging directory limit exceeded"));
            }
            let entry = entry?;
            let name = entry.file_name();
            if name == CONTROL {
                continue;
            }
            let recognized = name
                .to_str()
                .and_then(|name| name.strip_prefix(PREFIX))
                .is_some_and(|suffix| {
                    suffix.len() == 16 && suffix.bytes().all(|b| b.is_ascii_alphanumeric())
                });
            if !recognized || !entry.file_type()?.is_dir() {
                report.skipped += 1;
                continue;
            }
            let path = entry.path();
            match self.clean_one(&path) {
                Ok(Cleaned::Removed) => report.removed += 1,
                Ok(Cleaned::Active) => report.active += 1,
                Ok(Cleaned::Unknown) => report.skipped += 1,
                Err(error) => {
                    report.failed += 1;
                    log::warn!("private backup staging cleanup deferred: {error}");
                }
            }
        }
        Ok(report)
    }
    /// Registry lock spans lease inspection, lease release and directory removal.
    fn clean_one(&self, path: &Path) -> Result<Cleaned, CommandError> {
        let lease_path = path.join(LEASE);
        match fs::symlink_metadata(&lease_path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // A crash before creating a lease can leave an EMPTY directory.
                // Missing metadata with any payload is never guessed safe.
                if fs::read_dir(path)?.next().is_none() {
                    fs::remove_dir(path)?;
                    return Ok(Cleaned::Removed);
                }
                return Ok(Cleaned::Unknown);
            }
            Err(e) => return Err(e.into()),
            Ok(meta) if !meta.file_type().is_file() => return Ok(Cleaned::Unknown),
            Ok(_) => {}
        }
        let conn = Connection::open_with_flags(&lease_path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        conn.busy_timeout(Duration::ZERO)?;
        match conn.execute_batch("BEGIN EXCLUSIVE") {
            Err(error) if busy(&error) => return Ok(Cleaned::Active),
            Err(error) => return Err(error.into()),
            Ok(()) => {}
        }
        let app: i64 = conn.query_row("PRAGMA application_id", [], |row| row.get(0))?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if app != APPLICATION_ID || version != 1 {
            return Ok(Cleaned::Unknown);
        }
        erase(path, Some(conn), || Ok(()))?;
        Ok(Cleaned::Removed)
    }
}
/// Keep the durable ownership marker until EVERY payload entry is gone. A
/// crash/failure halfway through cleanup must remain recognizable next launch.
fn erase(
    path: &Path,
    lease: Option<Connection>,
    mut after_remove: impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_name() == LEASE {
            continue;
        }
        if entry.file_type()?.is_dir() {
            fs::remove_dir_all(entry.path())?;
        } else {
            fs::remove_file(entry.path())?;
        } // Unlink links; never follow them.
        after_remove()?;
    }
    // Windows needs every lease handle closed before unlinking the marker.
    drop(lease);
    fs::remove_file(path.join(LEASE))?;
    fs::remove_dir(path)?;
    Ok(())
}
enum Cleaned {
    Removed,
    Active,
    Unknown,
}
impl BackupDirectory {
    pub(crate) fn new(staging: &BackupStaging) -> Result<Self, CommandError> {
        let owner = staging.clone();
        let root = &owner.root;
        let _registry = owner.registry()?;
        let directory = tempfile::Builder::new()
            .prefix(PREFIX)
            .rand_bytes(16)
            .tempdir_in(root)?;
        private_directory(directory.path())?;
        let lease = Connection::open(directory.path().join(LEASE))?;
        lease.busy_timeout(Duration::ZERO)?;
        lease.execute_batch(&format!("PRAGMA journal_mode=DELETE; PRAGMA application_id={APPLICATION_ID}; PRAGMA user_version=1; BEGIN EXCLUSIVE;"))?;
        // Only now may the caller write plaintext, after both directory creation
        // and its lease are visible under the registry's serialization boundary.
        Ok(Self {
            directory: Some(directory),
            lease: Some(lease),
            owner,
        })
    }
    pub(crate) fn path(&self) -> &Path {
        self.directory
            .as_ref()
            .expect("owned backup directory")
            .path()
    }
    #[cfg(test)]
    pub(crate) fn new_fixture(root: &Path) -> Result<Self, CommandError> {
        Self::new(&BackupStaging::fixture(root))
    }
    #[cfg(test)]
    pub(crate) fn fixture(directory: TempDir) -> Self {
        let owner = BackupStaging::fixture(directory.path());
        Self {
            directory: Some(directory),
            lease: None,
            owner,
        }
    }
}
impl Drop for BackupDirectory {
    fn drop(&mut self) {
        let Some(directory) = self.directory.take() else {
            return;
        };
        if self.lease.is_none() {
            // Only unleased, synthetic fixtures use this branch.
            if let Err(error) = directory.close() {
                log::warn!("backup fixture cleanup failed: {error}");
            }
            return;
        }
        match self.owner.registry() {
            Ok(_registry) => {
                let path = directory.keep();
                if let Err(error) = erase(&path, self.lease.take(), || Ok(())) {
                    log::warn!("private backup directory cleanup deferred: {error}");
                }
            }
            Err(error) => {
                // Retain the directory for the next cleanup; never unlink the
                // lease during another cleaner's registry transaction.
                let _ = directory.keep();
                drop(self.lease.take());
                log::warn!("private backup directory cleanup deferred: {error}");
            }
        }
    }
}

#[cfg(test)]
pub(crate) fn fixture_entries(
    root: &Path,
) -> std::io::Result<impl Iterator<Item = std::io::Result<fs::DirEntry>>> {
    Ok(fs::read_dir(root)?.filter(|entry| {
        entry
            .as_ref()
            .map_or(true, |entry| entry.file_name() != CONTROL)
    }))
}
#[cfg(test)]
#[path = "backup_staging_tests.rs"]
mod tests;
