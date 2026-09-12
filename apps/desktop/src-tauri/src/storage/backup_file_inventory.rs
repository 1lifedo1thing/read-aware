//! Read-only inventory of managed target files. Registry absence and filesystem
//! absence are different facts; neither authorizes overwriting existing bytes.
use crate::{
    error::CommandError,
    storage::{
        self,
        backup_snapshot::{files::FileCollector, CapturedFile},
    },
};
use rusqlite::Connection;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BlobAvailability {
    Local,
    Unavailable,
    MissingLocalFile,
    RegistryMismatch,
    UnregisteredFile,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BlobBinding {
    pub key: Option<String>,
    pub availability: BlobAvailability,
}
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Inventory {
    pub files: BTreeMap<String, CapturedFile>,
    pub blobs: BTreeMap<String, BlobBinding>,
}
fn invalid(message: &str) -> CommandError {
    CommandError::new("backup/incomplete", message)
}
pub(super) fn read(
    conn: &Connection,
    root: &Path,
    bundled: &crate::plugins::BundledPrograms,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<Inventory, CommandError> {
    check()?;
    if !fs::symlink_metadata(root)?.file_type().is_dir() {
        return Err(invalid("backup target root is not an owned directory"));
    }
    let mut progress = |_| check();
    let mut collector = FileCollector::inspect(root, &mut progress).with_bundled(bundled);
    collector.blobs()?;
    collector.plugins("plugins")?;
    collector.plugins("bundled-plugins")?;
    match fs::symlink_metadata(root.join("secret.key")) {
        Ok(_) => collector.copy("secret.key", Some(32), None)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let files: BTreeMap<_, _> = collector
        .finish()
        .into_iter()
        .map(|entry| (entry.path.clone(), entry))
        .collect();
    let mut portable = BTreeSet::new();
    for name in files.keys() {
        check()?;
        storage::backup_archive::member_path(name)?;
        if !portable.insert(name.to_lowercase()) {
            return Err(invalid("case-colliding target managed paths"));
        }
    }
    let mut blobs: BTreeMap<_, _> = files
        .keys()
        .filter(|name| name.starts_with("blobs/"))
        .map(|name| {
            (
                name.clone(),
                BlobBinding {
                    key: None,
                    availability: BlobAvailability::UnregisteredFile,
                },
            )
        })
        .collect();
    let mut statement = conn.prepare("SELECT key,storage_uri,byte_size,sha256 FROM blob_objects WHERE deleted_at IS NULL ORDER BY key")?;
    let mut rows = statement.query([])?;
    let mut registered = BTreeSet::new();
    while let Some(row) = rows.next()? {
        check()?;
        let key: String = row.get(0)?;
        let uri: Option<String> = row.get(1)?;
        let size: Option<i64> = row.get(2)?;
        let digest: Option<String> = row.get(3)?;
        if key.is_empty() || key.len() > 4096 || registered.len() >= 100_000 {
            return Err(invalid("invalid or excessive target blob identities"));
        }
        let path = format!("blobs/{}", storage::blob_file_name(&key));
        storage::backup_archive::member_path(&path)?;
        if !registered.insert(path.clone())
            || uri.as_deref().is_some_and(|uri| uri != path)
            || size.is_some_and(|size| size < 0)
        {
            return Err(invalid("invalid target blob registration"));
        }
        let availability = match files.get(&path) {
            Some(file)
                if size.is_some_and(|size| size as u64 != file.byte_size)
                    || digest
                        .as_deref()
                        .is_some_and(|digest| digest != file.sha256) =>
            {
                BlobAvailability::RegistryMismatch
            }
            Some(_) if uri.is_some() => BlobAvailability::Local,
            Some(_) => BlobAvailability::UnregisteredFile,
            None if uri.is_some() => BlobAvailability::MissingLocalFile,
            None => BlobAvailability::Unavailable,
        };
        blobs.insert(
            path,
            BlobBinding {
                key: Some(key),
                availability,
            },
        );
    }
    // The key is part of the target version but is never a replacement action.
    // Corrupt existing credential stores must be repaired separately, not cloned.
    let mut statement = conn.prepare("SELECT value_json FROM app_kv WHERE substr(key,1,length('read-aware-secret:'))='read-aware-secret:'")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let _ = crate::secrets::decrypt_existing(root, &row.get::<_, String>(0)?)?;
    }
    Ok(Inventory { files, blobs })
}
