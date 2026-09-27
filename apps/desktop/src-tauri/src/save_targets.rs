//! Save destinations the user picked in a native save dialog.
//!
//! The webview never names a writable path. A native command opens the save
//! dialog and records whatever the user picked as a grant; every command that
//! writes a user-visible file accepts only such a grant. A compromised or
//! buggy webview can therefore write only where the user just agreed to save,
//! once. Grants come in two lifetimes:
//!
//! - token grants: an opaque, single-use token valid for `TARGET_LIFETIME`,
//!   for one-shot writes (`write_export_file`, `resource_save`);
//! - session grants: bound to one window's native task (the full backup
//!   export), valid until that task writes, is cancelled, or its window is
//!   destroyed. Preparing and capturing a large library can outlast any fixed
//!   lifetime, and the grant is useless outside that task.
//!
//! Checked alternatives: the dialog plugin's fs-scope grant is process-wide
//! and permanent, and also covers every file the user ever OPENED (picked
//! books), so it cannot express "this save, once".

use std::collections::HashMap;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::error::{CommandError, CODE_EXPORT_TARGET_INVALID};

/// Long enough to serialize a large export, short enough that a stale token
/// is useless.
pub(crate) const TARGET_LIFETIME: Duration = Duration::from_secs(10 * 60);

fn invalid_target() -> CommandError {
    CommandError::new(
        CODE_EXPORT_TARGET_INVALID,
        "save target was not chosen in the save dialog, was used, or expired",
    )
}

#[derive(Default)]
struct Grants {
    tokens: HashMap<String, (FilePath, Instant)>,
    /// One pending session grant per window: a newer choice replaces it.
    sessions: HashMap<String, (String, FilePath)>,
}

/// Save destinations the user picked, by single-use token or task session.
#[derive(Default)]
pub struct SaveTargets(Mutex<Grants>);

impl SaveTargets {
    pub(crate) fn issue(&self, target: FilePath, now: Instant) -> Result<String, CommandError> {
        let token = uuid::Uuid::new_v4().to_string();
        let mut grants = self.0.lock()?;
        grants
            .tokens
            .retain(|_, (_, issued)| now.duration_since(*issued) < TARGET_LIFETIME);
        grants.tokens.insert(token.clone(), (target, now));
        Ok(token)
    }

    pub(crate) fn redeem(&self, token: &str, now: Instant) -> Result<FilePath, CommandError> {
        let issued = self.0.lock()?.tokens.remove(token);
        match issued {
            Some((target, at)) if now.duration_since(at) < TARGET_LIFETIME => Ok(target),
            _ => Err(invalid_target()),
        }
    }

    pub(crate) fn bind_session(
        &self,
        owner: &str,
        session: &str,
        target: FilePath,
    ) -> Result<(), CommandError> {
        self.0
            .lock()?
            .sessions
            .insert(owner.to_owned(), (session.to_owned(), target));
        Ok(())
    }

    /// Consumes the owner's grant for `session`; a grant for another session
    /// of the same owner stays in place.
    pub(crate) fn redeem_session(
        &self,
        owner: &str,
        session: &str,
    ) -> Result<FilePath, CommandError> {
        let mut grants = self.0.lock()?;
        match grants.sessions.get(owner) {
            Some((bound, _)) if bound == session => grants
                .sessions
                .remove(owner)
                .map(|(_, target)| target)
                .ok_or_else(invalid_target),
            _ => Err(invalid_target()),
        }
    }

    pub(crate) fn release_session(&self, owner: &str, session: &str) -> Result<(), CommandError> {
        let mut grants = self.0.lock()?;
        if grants
            .sessions
            .get(owner)
            .is_some_and(|(bound, _)| bound == session)
        {
            grants.sessions.remove(owner);
        }
        Ok(())
    }

    pub fn release_owner(&self, owner: &str) {
        match self.0.lock() {
            Ok(mut grants) => {
                grants.sessions.remove(owner);
            }
            Err(error) => log::warn!("save target owner cleanup failed: {error}"),
        }
    }
}

/// Open the native save dialog. `None` when the user cancels.
pub(crate) async fn choose(
    app: &tauri::AppHandle,
    filename: String,
    filter: Option<(String, String)>,
) -> Result<Option<FilePath>, CommandError> {
    let mut dialog = app.dialog().file().set_file_name(filename);
    if let Some((name, extension)) = filter {
        dialog = dialog.add_filter(name, &[extension.as_str()]);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dialog.save_file(move |picked| {
        // The waiter only disappears if the command itself was dropped.
        let _ = sender.send(picked);
    });
    receiver
        .await
        .map_err(|_| CommandError::internal("save dialog closed without a result"))
}

/// Streams content into a staged file. The file is synced afterwards.
pub(crate) type Produce<'a> = Box<dyn FnOnce(&mut File) -> Result<(), CommandError> + 'a>;

/// Publishes produced content to a granted target.
pub(crate) trait SaveIo {
    fn publish(&self, target: FilePath, produce: Produce<'_>) -> Result<(), CommandError>;
}

impl SaveIo for tauri::AppHandle {
    fn publish(&self, target: FilePath, produce: Produce<'_>) -> Result<(), CommandError> {
        match target {
            FilePath::Path(path) => replace_path(&path, produce),
            // A document-provider URI (Android): only the provider can write
            // it, and it cannot be replaced atomically. Stage first so a failed
            // or cancelled producer never truncates the chosen document.
            FilePath::Url(url) => {
                use tauri_plugin_fs::{FsExt, OpenOptions};
                let staging = self.path().app_cache_dir()?.join("save-staging");
                std::fs::create_dir_all(&staging)?;
                let mut staged = tempfile::NamedTempFile::new_in(&staging)?;
                produce(staged.as_file_mut())?;
                staged.as_file_mut().seek(SeekFrom::Start(0))?;
                let mut options = OpenOptions::new();
                options.write(true).create(true).truncate(true);
                let mut file = self.fs().open(FilePath::Url(url), options).map_err(|err| {
                    CommandError::context("Failed to open the save target", err.to_string())
                })?;
                std::io::copy(staged.as_file_mut(), &mut file)?;
                file.flush()?;
                Ok(())
            }
        }
    }
}

/// Plain filesystem paths only; document-provider targets need the app.
#[cfg(test)]
pub(crate) struct LocalFiles;

#[cfg(test)]
impl SaveIo for LocalFiles {
    fn publish(&self, target: FilePath, produce: Produce<'_>) -> Result<(), CommandError> {
        match target {
            FilePath::Path(path) => replace_path(&path, produce),
            FilePath::Url(_) => Err(CommandError::internal("provider targets need the app")),
        }
    }
}

/// Replace `path` atomically (sibling temp file + rename), so a failed or
/// cancelled producer keeps the previous file.
pub(crate) fn replace_path(path: &Path, produce: Produce<'_>) -> Result<(), CommandError> {
    let parent = path.parent().ok_or_else(|| {
        CommandError::new(CODE_EXPORT_TARGET_INVALID, "save target has no parent")
    })?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    produce(temp.as_file_mut())?;
    temp.as_file_mut().flush()?;
    temp.as_file().sync_all()?;
    temp.persist(path)
        .map_err(|err| CommandError::context("Failed to write the saved file", err.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(name: &str) -> FilePath {
        FilePath::Path(std::env::temp_dir().join(name))
    }

    #[test]
    fn tokens_are_single_use_expiring_and_unforgeable() {
        let targets = SaveTargets::default();
        let now = Instant::now();
        let token = targets.issue(target("export.json"), now).unwrap();
        assert!(matches!(
            targets.redeem(&token, now).unwrap(),
            FilePath::Path(picked) if picked.ends_with("export.json")
        ));
        assert_eq!(
            targets.redeem(&token, now).unwrap_err().code,
            CODE_EXPORT_TARGET_INVALID
        );
        let forged = std::env::temp_dir().join("export.json");
        assert_eq!(
            targets
                .redeem(forged.to_str().unwrap(), now)
                .unwrap_err()
                .code,
            CODE_EXPORT_TARGET_INVALID
        );
        let stale = targets.issue(target("export.json"), now).unwrap();
        assert_eq!(
            targets
                .redeem(&stale, now + TARGET_LIFETIME)
                .unwrap_err()
                .code,
            CODE_EXPORT_TARGET_INVALID
        );
    }

    #[test]
    fn session_grants_belong_to_one_owner_task_and_are_consumed_once() {
        let targets = SaveTargets::default();
        targets
            .bind_session("main", "task-a", target("a.age"))
            .unwrap();
        assert_eq!(
            targets.redeem_session("other", "task-a").unwrap_err().code,
            CODE_EXPORT_TARGET_INVALID
        );
        assert_eq!(
            targets.redeem_session("main", "task-b").unwrap_err().code,
            CODE_EXPORT_TARGET_INVALID
        );
        // A token is not a session and a session is not a token.
        assert_eq!(
            targets.redeem("task-a", Instant::now()).unwrap_err().code,
            CODE_EXPORT_TARGET_INVALID
        );
        assert!(matches!(
            targets.redeem_session("main", "task-a").unwrap(),
            FilePath::Path(picked) if picked.ends_with("a.age")
        ));
        assert_eq!(
            targets.redeem_session("main", "task-a").unwrap_err().code,
            CODE_EXPORT_TARGET_INVALID
        );

        targets
            .bind_session("main", "task-a", target("a.age"))
            .unwrap();
        targets
            .bind_session("main", "task-b", target("b.age"))
            .unwrap();
        assert!(
            targets.redeem_session("main", "task-a").is_err(),
            "a newer choice replaces the grant"
        );
        targets.release_session("main", "task-a").unwrap();
        assert!(
            targets.redeem_session("main", "task-b").is_ok(),
            "another task's release keeps it"
        );

        targets
            .bind_session("main", "task-c", target("c.age"))
            .unwrap();
        targets.release_session("main", "task-c").unwrap();
        assert!(targets.redeem_session("main", "task-c").is_err());
        targets
            .bind_session("main", "task-d", target("d.age"))
            .unwrap();
        targets.release_owner("main");
        assert!(targets.redeem_session("main", "task-d").is_err());
    }

    #[test]
    fn a_path_target_is_replaced_whole_or_not_at_all() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.txt");
        std::fs::write(&path, "previous contents, longer").unwrap();
        replace_path(&path, Box::new(|file| Ok(file.write_all(b"new")?))).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        let failed = replace_path(
            &path,
            Box::new(|file| {
                file.write_all(b"partial")?;
                Err(CommandError::internal("producer failed"))
            }),
        );
        assert!(failed.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
