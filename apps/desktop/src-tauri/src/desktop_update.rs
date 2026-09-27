//! Desktop update commands with channel support. The updater plugin's JS API
//! cannot change endpoints at runtime (they are baked into tauri.conf.json),
//! so the check runs through Rust's UpdaterBuilder instead: the webview
//! resolves WHICH release manifest to use (stable = the config default,
//! beta = the semver-largest release found via the GitHub API) and hands the
//! manifest URL here. The URL is allow-listed to our own GitHub release
//! assets, and integrity never rests on it anyway — every manifest and
//! artifact is verified against the minisign pubkey baked into the config.
//!
//! The updater plugin is a DESKTOP-ONLY dependency (Android updates through
//! its own APK path, iOS through the store), so like android_update.rs this
//! module compiles everywhere and swaps the bodies: mobile gets stubs the
//! frontend never calls.

use serde::Serialize;

use crate::error::{CommandError, CODE_UPDATE_UNAVAILABLE};
#[cfg(desktop)]
use crate::error::{
    CODE_UPDATE_INSTALL_FAILED, CODE_UPDATE_INVALID_RELEASE, CODE_UPDATE_NETWORK,
    CODE_UPDATE_NOT_READY,
};

/// The update found by the last check, parked for install. An async mutex:
/// commands await it instead of blocking a runtime thread.
#[derive(Default)]
pub struct DesktopUpdateState(
    #[cfg(desktop)] tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>,
);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableDesktopUpdate {
    current_version: String,
    version: String,
}

/// Payload of the `ra-desktop-update-progress` event stream during install.
#[cfg(desktop)]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateProgress {
    downloaded: u64,
    total: Option<u64>,
    finished: bool,
}

/// Only our own release assets: a versioned release (`vX.Y.Z[-N]`) or the
/// rolling `beta` pointer release that the Beta channel follows.
#[cfg(desktop)]
fn is_release_manifest_path(path: &str, asset: &str) -> bool {
    let Some(rest) = path.strip_prefix("/ahpxex/read-aware/releases/download/") else {
        return false;
    };
    let Some((tag, name)) = rest.split_once('/') else {
        return false;
    };
    name == asset
        && (tag == "beta"
            || tag
                .strip_prefix('v')
                .is_some_and(|v| v.starts_with(|c: char| c.is_ascii_digit())))
}

/// Only manifests that live under our own repo's release assets are accepted
/// as endpoint overrides: https://github.com/ahpxex/read-aware/releases/download/v…/latest.json
#[cfg(desktop)]
fn validate_manifest_url(raw: &str) -> Result<url::Url, CommandError> {
    let invalid = |message: String| CommandError::new(CODE_UPDATE_INVALID_RELEASE, message);
    let url =
        url::Url::parse(raw).map_err(|err| invalid(format!("Invalid manifest URL: {err}")))?;
    let path_ok = is_release_manifest_path(url.path(), "latest.json");
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !path_ok
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid(
            "Manifest URL does not match the expected GitHub release asset".into(),
        ));
    }
    Ok(url)
}

/// Transport failures are worth retrying; anything the updater rejected about
/// the release itself (manifest, platform entry, signature) is not.
#[cfg(desktop)]
fn updater_error(
    context: &str,
    fallback: &str,
    error: tauri_plugin_updater::Error,
) -> CommandError {
    use tauri_plugin_updater::Error;
    let code = match &error {
        Error::Reqwest(_) | Error::Network(_) | Error::ReleaseNotFound => CODE_UPDATE_NETWORK,
        Error::Serialization(_)
        | Error::Semver(_)
        | Error::TargetNotFound(_)
        | Error::TargetsNotFound(_)
        | Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::InvalidUpdaterFormat
        | Error::BinaryNotFoundInArchive => CODE_UPDATE_INVALID_RELEASE,
        Error::Io(io) => {
            return CommandError::context(context, std::io::Error::new(io.kind(), io.to_string()))
        }
        _ => fallback,
    };
    CommandError::new(code, format!("{context}: {error}"))
}

/// `endpoint: None` checks the config default (the newest STABLE release —
/// GitHub's `releases/latest` never includes pre-releases). A found update is
/// parked in state for `desktop_update_install`.
#[cfg(desktop)]
#[tauri::command]
pub async fn desktop_update_check(
    app: tauri::AppHandle,
    endpoint: Option<String>,
) -> Result<Option<AvailableDesktopUpdate>, CommandError> {
    use tauri::Manager;
    use tauri_plugin_updater::UpdaterExt;

    if !crate::app_environment::can_update(&app.config().identifier) {
        return Ok(None);
    }

    let mut builder = app.updater_builder();
    if let Some(raw) = endpoint {
        let url = validate_manifest_url(&raw)?;
        builder = builder.endpoints(vec![url]).map_err(|err| {
            updater_error(
                "Could not set the update endpoint",
                CODE_UPDATE_INVALID_RELEASE,
                err,
            )
        })?;
    }
    let updater = builder.build().map_err(|err| {
        updater_error(
            "Could not start the update check",
            CODE_UPDATE_UNAVAILABLE,
            err,
        )
    })?;
    let update = updater
        .check()
        .await
        .map_err(|err| updater_error("Update check failed", CODE_UPDATE_NETWORK, err))?;

    let state: tauri::State<'_, DesktopUpdateState> = app.state();
    let info = update.as_ref().map(|u| AvailableDesktopUpdate {
        current_version: u.current_version.clone(),
        version: u.version.clone(),
    });
    *state.0.lock().await = update;
    Ok(info)
}

/// Downloads and installs the parked update, streaming progress to the
/// webview as `ra-desktop-update-progress` events. The caller relaunches.
#[cfg(desktop)]
#[tauri::command]
pub async fn desktop_update_install(app: tauri::AppHandle) -> Result<(), CommandError> {
    use tauri::{Emitter, Manager};

    if !crate::app_environment::can_update(&app.config().identifier) {
        return Err(CommandError::new(
            CODE_UPDATE_UNAVAILABLE,
            "Software updates are unavailable for development installations.",
        ));
    }

    let update = {
        let state: tauri::State<'_, DesktopUpdateState> = app.state();
        let taken = state.0.lock().await.take();
        taken.ok_or_else(|| {
            CommandError::new(
                CODE_UPDATE_NOT_READY,
                "No software update is ready to install.",
            )
        })?
    };

    let progress_app = app.clone();
    let finish_app = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                // Progress is advisory; a closed webview must not fail the install.
                let _ = progress_app.emit(
                    "ra-desktop-update-progress",
                    DesktopUpdateProgress {
                        downloaded,
                        total,
                        finished: false,
                    },
                );
            },
            move || {
                let _ = finish_app.emit(
                    "ra-desktop-update-progress",
                    DesktopUpdateProgress {
                        downloaded: 0,
                        total: None,
                        finished: true,
                    },
                );
            },
        )
        .await
        .map_err(|err| updater_error("Update install failed", CODE_UPDATE_INSTALL_FAILED, err))
}

// ── Mobile stubs: registered but never called (Android has android_update). ──

#[cfg(not(desktop))]
#[tauri::command]
pub async fn desktop_update_check(
    _endpoint: Option<String>,
) -> Result<Option<AvailableDesktopUpdate>, CommandError> {
    Ok(None)
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn desktop_update_install() -> Result<(), CommandError> {
    Err(CommandError::new(
        CODE_UPDATE_UNAVAILABLE,
        "Desktop updates are not available on this platform.",
    ))
}

#[cfg(all(test, desktop))]
mod tests {
    use super::is_release_manifest_path;

    #[test]
    fn accepts_versioned_and_beta_manifests_only() {
        assert!(is_release_manifest_path(
            "/ahpxex/read-aware/releases/download/v0.6.1-3/latest.json",
            "latest.json"
        ));
        assert!(is_release_manifest_path(
            "/ahpxex/read-aware/releases/download/beta/latest.json",
            "latest.json"
        ));
        assert!(!is_release_manifest_path(
            "/ahpxex/read-aware/releases/download/beta/latest-android.json",
            "latest.json"
        ));
        assert!(!is_release_manifest_path(
            "/ahpxex/read-aware/releases/download/nightly/latest.json",
            "latest.json"
        ));
        assert!(!is_release_manifest_path(
            "/ahpxex/read-aware/releases/download/beta/../v1/latest.json",
            "latest.json"
        ));
        assert!(!is_release_manifest_path(
            "/someone/else/releases/download/beta/latest.json",
            "latest.json"
        ));
    }
}
