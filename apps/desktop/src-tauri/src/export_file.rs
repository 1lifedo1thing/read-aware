//! Mobile convenience exports: the user picks a destination in the native
//! save dialog, then the webview hands over the bytes.
//!
//! The webview never names a writable path. `export_choose_target` opens the
//! save dialog natively and returns an opaque, single-use token for whatever
//! the user picked; `write_export_file` accepts only such a token. A
//! compromised or buggy webview can therefore write only where the user just
//! agreed to save, once, within `TARGET_LIFETIME`.
//!
//! Checked alternatives: the dialog plugin's fs-scope grant is process-wide
//! and permanent, and also covers every file the user ever OPENED (picked
//! books), so it cannot express "this save, once". Desktop exports already
//! go through `resource_save` with its own sealed-resource flow.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::error::{CommandError, CODE_EXPORT_TARGET_INVALID};
use crate::storage::blocking;

/// Long enough to serialize a large export, short enough that a stale token
/// is useless.
const TARGET_LIFETIME: Duration = Duration::from_secs(10 * 60);

/// Save destinations the user picked, by single-use token.
#[derive(Default)]
pub struct ExportTargets(Mutex<HashMap<String, (FilePath, Instant)>>);

impl ExportTargets {
    fn issue(&self, target: FilePath, now: Instant) -> Result<String, CommandError> {
        let token = uuid::Uuid::new_v4().to_string();
        let mut targets = self.0.lock()?;
        targets.retain(|_, (_, issued)| now.duration_since(*issued) < TARGET_LIFETIME);
        targets.insert(token.clone(), (target, now));
        Ok(token)
    }

    fn redeem(&self, token: &str, now: Instant) -> Result<FilePath, CommandError> {
        let issued = self.0.lock()?.remove(token);
        match issued {
            Some((target, at)) if now.duration_since(at) < TARGET_LIFETIME => Ok(target),
            _ => Err(CommandError::new(
                CODE_EXPORT_TARGET_INVALID,
                "export target was not chosen in the save dialog, was used, or expired",
            )),
        }
    }
}

/// Open the native save dialog. `None` when the user cancels.
#[tauri::command]
pub async fn export_choose_target(
    app: tauri::AppHandle,
    filename: String,
    extension: Option<String>,
) -> Result<Option<String>, CommandError> {
    let mut dialog = app.dialog().file().set_file_name(filename);
    if let Some(extension) = extension.filter(|ext| !ext.is_empty()) {
        dialog = dialog.add_filter(
            format!("{} file", extension.to_uppercase()),
            &[extension.as_str()],
        );
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dialog.save_file(move |picked| {
        // The waiter only disappears if the command itself was dropped.
        let _ = sender.send(picked);
    });
    let picked = receiver
        .await
        .map_err(|_| CommandError::internal("save dialog closed without a result"))?;
    picked
        .map(|target| app.state::<ExportTargets>().issue(target, Instant::now()))
        .transpose()
}

/// Write exported content to the target the user chose in
/// `export_choose_target`. `base64: true` marks binary content that crossed
/// the IPC encoded.
#[tauri::command]
pub async fn write_export_file(
    app: tauri::AppHandle,
    token: String,
    content: String,
    base64: Option<bool>,
) -> Result<(), CommandError> {
    blocking("write_export_file", move || {
        let target = app.state::<ExportTargets>().redeem(&token, Instant::now())?;
        let bytes: Vec<u8> = if base64.unwrap_or(false) {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD
                .decode(content.as_bytes())
                .map_err(|err| CommandError::internal(format!("invalid base64 export payload: {err}")))?
        } else {
            content.into_bytes()
        };
        write_target(&app, target, &bytes)
    })
    .await
}

fn write_target(app: &tauri::AppHandle, target: FilePath, bytes: &[u8]) -> Result<(), CommandError> {
    match target {
        // A real path: replace atomically, so a failed write keeps the old file.
        FilePath::Path(path) => replace_file(&path, bytes),
        // A document-provider URI (Android): only the provider can write it.
        FilePath::Url(url) => {
            use std::io::Write;
            use tauri_plugin_fs::{FsExt, OpenOptions};
            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);
            let mut file = app
                .fs()
                .open(FilePath::Url(url), options)
                .map_err(|err| CommandError::context("Failed to open the export target", err.to_string()))?;
            file.write_all(bytes)?;
            file.flush()?;
            Ok(())
        }
    }
}

fn replace_file(path: &std::path::Path, bytes: &[u8]) -> Result<(), CommandError> {
    use std::io::Write;
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::new(CODE_EXPORT_TARGET_INVALID, "export target has no parent"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path)
        .map_err(|err| CommandError::context("Failed to write exported file", err.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_are_single_use_expiring_and_unforgeable() {
        let targets = ExportTargets::default();
        let now = Instant::now();
        let path = FilePath::Path("/tmp/export.json".into());
        let token = targets.issue(path.clone(), now).unwrap();
        assert!(matches!(
            targets.redeem(&token, now).unwrap(),
            FilePath::Path(picked) if picked.ends_with("export.json")
        ));
        assert_eq!(targets.redeem(&token, now).unwrap_err().code, CODE_EXPORT_TARGET_INVALID);
        assert_eq!(
            targets.redeem("/tmp/export.json", now).unwrap_err().code,
            CODE_EXPORT_TARGET_INVALID
        );
        let stale = targets.issue(path, now).unwrap();
        assert_eq!(
            targets.redeem(&stale, now + TARGET_LIFETIME).unwrap_err().code,
            CODE_EXPORT_TARGET_INVALID
        );
    }

    #[test]
    fn a_path_target_is_replaced_whole() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.txt");
        std::fs::write(&path, "previous contents, longer").unwrap();
        replace_file(&path, b"new").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
