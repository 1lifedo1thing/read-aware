//! Streaming copy and integrity checks for host-owned backup staging.
use super::{CaptureProgress, CapturedFile, CODE_CHANGED, CODE_INCOMPLETE};
use crate::error::CommandError;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
const MAX_FILES: usize = 100_000;
const MAX_BYTES: u64 = 512 * 1024 * 1024 * 1024;
const CHUNK: usize = 1024 * 1024;

fn owned_path(root: &Path, relative: &str) -> Result<PathBuf, CommandError> {
    let path = Path::new(relative);
    if relative.is_empty()
        || relative.contains('\\')
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(CommandError::new(
            CODE_INCOMPLETE,
            "invalid backup member path",
        ));
    }
    let mut absolute = root.to_path_buf();
    for part in path.components() {
        absolute.push(part.as_os_str());
        if fs::symlink_metadata(&absolute)?.file_type().is_symlink() {
            return Err(CommandError::new(
                CODE_INCOMPLETE,
                "symlinks cannot be captured as owned backup files",
            ));
        }
    }
    Ok(absolute)
}

pub(in crate::storage) fn verify_file(
    root: &Path,
    entry: &CapturedFile,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    let path = owned_path(root, &entry.path)?;
    if !fs::symlink_metadata(&path)?.file_type().is_file() {
        return Err(CommandError::new(
            CODE_CHANGED,
            "backup member is not a regular file",
        ));
    }
    let mut file = fs::File::open(path)?;
    if !file.metadata()?.is_file() || file.metadata()?.len() != entry.byte_size {
        return Err(CommandError::new(
            CODE_CHANGED,
            "backup member size changed",
        ));
    }
    let mut buffer = vec![0; CHUNK];
    let mut hash = Sha256::new();
    let mut length = 0u64;
    loop {
        check()?;
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        length += read as u64;
        if length > entry.byte_size {
            return Err(CommandError::new(
                CODE_CHANGED,
                "backup member grew during verification",
            ));
        }
        hash.update(&buffer[..read]);
    }
    if length != entry.byte_size || format!("{:x}", hash.finalize()) != entry.sha256 {
        return Err(CommandError::new(
            CODE_CHANGED,
            "backup member content changed",
        ));
    }
    Ok(())
}

pub(in crate::storage) struct FileCollector<'a, F> {
    source: &'a Path,
    destination: &'a Path,
    progress: &'a mut F,
    copied_bytes: u64,
    copy_files: bool,
    files: BTreeMap<String, CapturedFile>,
    visited_entries: usize,
}
impl<'a, F: FnMut(CaptureProgress) -> Result<(), CommandError>> FileCollector<'a, F> {
    pub fn new(source: &'a Path, destination: &'a Path, progress: &'a mut F) -> Self {
        Self {
            source,
            destination,
            progress,
            copied_bytes: 0,
            copy_files: true,
            files: BTreeMap::new(),
            visited_entries: 0,
        }
    }
    /// Inspect the same owned files without creating a second copy. Restore
    /// planning must account for actual target bytes, including orphan blobs.
    pub fn inspect(source: &'a Path, progress: &'a mut F) -> Self {
        let mut collector = Self::new(source, source, progress);
        collector.copy_files = false;
        collector
    }
    pub fn blobs(&mut self) -> Result<(), CommandError> {
        let path = self.source.join("blobs");
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
            Ok(_) => {}
        }
        owned_path(self.source, "blobs")?;
        for entry in self.children(&path)? {
            (self.progress)(CaptureProgress::Files {
                copied_bytes: self.copied_bytes,
            })?;
            if !entry.file_type()?.is_file() {
                return Err(CommandError::new(
                    CODE_INCOMPLETE,
                    "non-regular managed blob",
                ));
            }
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| CommandError::new(CODE_INCOMPLETE, "non-UTF8 managed blob"))?;
            self.copy(&format!("blobs/{name}"), None, None)?;
        }
        Ok(())
    }
    fn children(&mut self, path: &Path) -> Result<Vec<fs::DirEntry>, CommandError> {
        let available = MAX_FILES.saturating_sub(self.visited_entries);
        let mut entries = fs::read_dir(path)?
            .take(available + 1)
            .collect::<Result<Vec<_>, _>>()?;
        self.visited_entries += entries.len();
        if self.visited_entries > MAX_FILES {
            return Err(CommandError::new(
                CODE_INCOMPLETE,
                "too many plugin tree entries",
            ));
        }
        entries.sort_by_key(|entry| entry.file_name());
        Ok(entries)
    }
    fn transfer(
        &mut self,
        relative: &str,
        created: bool,
        size: Option<u64>,
        digest: Option<&str>,
    ) -> Result<(), CommandError> {
        if self.files.len() >= MAX_FILES || self.files.contains_key(relative) {
            return Err(CommandError::new(
                CODE_INCOMPLETE,
                "too many or duplicate backup members",
            ));
        }
        let path = owned_path(
            if created {
                self.destination
            } else {
                self.source
            },
            relative,
        )
        .map_err(|error| {
            CommandError::context_coded(CODE_INCOMPLETE, "backup source unavailable", error)
        })?;
        if !fs::symlink_metadata(&path)?.file_type().is_file() {
            return Err(CommandError::new(
                CODE_INCOMPLETE,
                "backup source is not a regular file",
            ));
        }
        let mut input = fs::File::open(&path)?;
        let metadata = input.metadata()?;
        if !metadata.is_file() || size.is_some_and(|size| size != metadata.len()) {
            return Err(CommandError::new(
                CODE_CHANGED,
                "backup source size differs from registry",
            ));
        }
        if metadata.len() > MAX_BYTES.saturating_sub(self.copied_bytes) {
            return Err(CommandError::new(
                CODE_INCOMPLETE,
                "backup exceeds the native 512 GiB capture limit",
            ));
        }
        let mut output = if created || !self.copy_files {
            None
        } else {
            let destination = self.destination.join(relative);
            fs::create_dir_all(destination.parent().unwrap())?;
            Some(
                fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(destination)?,
            )
        };
        let mut hash = Sha256::new();
        let mut length = 0u64;
        let mut buffer = vec![0; CHUNK];
        loop {
            (self.progress)(CaptureProgress::Files {
                copied_bytes: self.copied_bytes,
            })?;
            let read = input.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            self.copied_bytes = self
                .copied_bytes
                .checked_add(read as u64)
                .filter(|value| *value <= MAX_BYTES)
                .ok_or_else(|| {
                    CommandError::new(
                        CODE_INCOMPLETE,
                        "backup exceeds the native 512 GiB capture limit",
                    )
                })?;
            length += read as u64;
            hash.update(&buffer[..read]);
            if let Some(output) = &mut output {
                output.write_all(&buffer[..read])?;
            }
        }
        let sha256 = format!("{:x}", hash.finalize());
        if length != metadata.len() || digest.is_some_and(|expected| expected != sha256) {
            return Err(CommandError::new(
                CODE_CHANGED,
                "backup source changed or failed content verification",
            ));
        }
        if let Some(output) = output {
            output.sync_all()?;
        }
        self.files.insert(
            relative.into(),
            CapturedFile {
                path: relative.into(),
                byte_size: length,
                sha256,
            },
        );
        Ok(())
    }
    pub fn record_created(&mut self, relative: &str) -> Result<(), CommandError> {
        self.transfer(relative, true, None, None)
    }
    pub fn copy(
        &mut self,
        relative: &str,
        size: Option<u64>,
        digest: Option<&str>,
    ) -> Result<(), CommandError> {
        self.transfer(relative, false, size, digest)
    }
    pub fn plugins(&mut self, folder: &str) -> Result<(), CommandError> {
        let path = self.source.join(folder);
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
            Ok(_) => {}
        }
        owned_path(self.source, folder)?;
        let roots = self.children(&path)?;
        for entry in roots {
            (self.progress)(CaptureProgress::Files {
                copied_bytes: self.copied_bytes,
            })?;
            let id = entry
                .file_name()
                .into_string()
                .map_err(|_| CommandError::new(CODE_INCOMPLETE, "non-UTF8 plugin directory"))?;
            if id.starts_with('.') {
                continue;
            } // staging/rollback/version stamp, never active programs
            if !crate::plugins::valid_plugin_id(&id) || !entry.file_type()?.is_dir() {
                return Err(CommandError::new(
                    CODE_INCOMPLETE,
                    "invalid installed plugin directory",
                ));
            }
            let relative = format!("{folder}/{id}");
            let manifest_path = owned_path(self.source, &format!("{relative}/manifest.json"))?;
            let metadata = fs::symlink_metadata(&manifest_path)?;
            if !metadata.file_type().is_file() || metadata.len() > CHUNK as u64 {
                return Err(CommandError::new(
                    CODE_INCOMPLETE,
                    "installed plugin manifest is too large",
                ));
            }
            let mut bytes = Vec::new();
            fs::File::open(manifest_path)?
                .take(CHUNK as u64 + 1)
                .read_to_end(&mut bytes)?;
            if bytes.len() > CHUNK {
                return Err(CommandError::new(
                    CODE_CHANGED,
                    "plugin manifest grew during capture",
                ));
            }
            let manifest: serde_json::Value = serde_json::from_slice(&bytes)?;
            if manifest.get("id").and_then(serde_json::Value::as_str) != Some(&id) {
                return Err(CommandError::new(
                    CODE_INCOMPLETE,
                    "installed plugin identity mismatch",
                ));
            }
            self.tree(&relative, 0)?;
        }
        Ok(())
    }
    fn tree(&mut self, relative: &str, depth: usize) -> Result<(), CommandError> {
        if depth > 32 {
            return Err(CommandError::new(
                CODE_INCOMPLETE,
                "plugin tree exceeds backup depth limit",
            ));
        }
        let path = owned_path(self.source, relative)?;
        let children = self.children(&path)?;
        for entry in children {
            (self.progress)(CaptureProgress::Files {
                copied_bytes: self.copied_bytes,
            })?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| CommandError::new(CODE_INCOMPLETE, "non-UTF8 plugin file"))?;
            let child = format!("{relative}/{name}");
            let kind = entry.file_type()?;
            if kind.is_dir() {
                self.tree(&child, depth + 1)?;
            } else if kind.is_file() {
                self.copy(&child, None, None)?;
            } else {
                return Err(CommandError::new(
                    CODE_INCOMPLETE,
                    "non-regular plugin file",
                ));
            }
        }
        Ok(())
    }
    pub fn finish(self) -> Vec<CapturedFile> {
        self.files.into_values().collect()
    }
}
