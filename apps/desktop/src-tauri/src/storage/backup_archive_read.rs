use super::*;

pub(crate) fn read_archive(
    source: impl Read,
    password: SecretString,
    staging_root: &crate::storage::backup_staging::BackupStaging,
    mut check: impl FnMut() -> Result<(), CommandError>,
) -> Result<AuthenticatedBackup, CommandError> {
    password_policy(&password)?;
    check()?;
    let limit = Rc::new(Cell::new(64 * 1024));
    let bounded = BoundedReader {
        input: source,
        limit: limit.clone(),
        read: 0,
    };
    let decryptor = age::Decryptor::new(bounded).map_err(decrypt_error)?;
    if !decryptor.is_scrypt() {
        return Err(invalid("backup must use a passphrase recipient"));
    }
    limit.set(MAX_ARCHIVE);
    let mut identity = age::scrypt::Identity::new(password);
    identity.set_max_work_factor(WORK_FACTOR);
    let decrypted = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(decrypt_error)?;
    check()?;
    extract(decrypted, staging_root, &mut check)
}

/// Only called with authenticated-chunk age output in production. Even then no
/// extracted member is exposed and no SQLite file opened until authenticated EOF.
pub(super) fn extract(
    decrypted: impl Read,
    staging_root: &crate::storage::backup_staging::BackupStaging,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<AuthenticatedBackup, CommandError> {
    let directory = crate::storage::backup_staging::BackupDirectory::new(staging_root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
    }
    let mut archive = tar::Archive::new(decrypted);
    let mut manifest: Option<BackupManifest> = None;
    let mut remaining = BTreeMap::new();
    let mut seen = BTreeSet::new();
    let mut long_path: Option<String> = None;
    let mut count = 0usize;
    let mut buffer = vec![0; CHUNK];
    // Raw mode prevents the tar crate from allocating unbounded long-name/PAX
    // metadata or silently interpreting sparse files and links for us.
    for item in archive.entries().map_err(input_error)?.raw(true) {
        check()?;
        count += 1;
        if count > MAX_FILES * 2 + 1 {
            return Err(invalid("too many tar headers"));
        }
        let mut item = item.map_err(input_error)?;
        let size = item.size();
        let kind = item.header().entry_type();
        if kind.is_gnu_longname() {
            if manifest.is_none()
                || long_path.is_some()
                || size == 0
                || size > (MAX_PATH + 1) as u64
            {
                return Err(invalid("invalid long-name metadata"));
            }
            let mut name = Vec::new();
            item.read_to_end(&mut name).map_err(input_error)?;
            if name.len() as u64 != size || name.pop() != Some(0) || name.contains(&0) {
                return Err(invalid("invalid long-name encoding"));
            }
            let name = String::from_utf8(name).map_err(|_| invalid("non-UTF8 archive path"))?;
            member_path(&name)?;
            long_path = Some(name);
            continue;
        }
        if !kind.is_file() {
            return Err(invalid("backup may contain only regular files"));
        }
        let path = match long_path.take() {
            Some(path) => path,
            None => std::str::from_utf8(&item.path_bytes())
                .map_err(|_| invalid("non-UTF8 archive path"))?
                .to_owned(),
        };
        if manifest.is_none() {
            if path != "manifest.json" || size > MAX_MANIFEST {
                return Err(invalid("backup manifest must be first and bounded"));
            }
            let mut bytes = Vec::new();
            item.read_to_end(&mut bytes).map_err(input_error)?;
            if bytes.len() as u64 != size {
                return Err(invalid("truncated backup manifest"));
            }
            let parsed: BackupManifest =
                serde_json::from_slice(&bytes).map_err(|_| invalid("invalid backup manifest"))?;
            remaining = manifest_members(&parsed)?;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(directory.path().join("manifest.json"))?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            manifest = Some(parsed);
            continue;
        }
        member_path(&path)?;
        if !seen.insert(path.clone()) {
            return Err(invalid("duplicate tar member"));
        }
        let expected = remaining
            .remove(&path)
            .ok_or_else(|| invalid("tar member is not declared by manifest"))?;
        if size != expected.byte_size {
            return Err(invalid("tar member size differs from manifest"));
        }
        let destination = directory.path().join(&path);
        fs::create_dir_all(
            destination
                .parent()
                .ok_or_else(|| invalid("invalid member parent"))?,
        )?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)?;
        let mut hash = Sha256::new();
        let mut length = 0u64;
        loop {
            check()?;
            let read = item.read(&mut buffer).map_err(input_error)?;
            if read == 0 {
                break;
            }
            length += read as u64;
            if length > size {
                return Err(invalid("oversized tar member"));
            }
            hash.update(&buffer[..read]);
            file.write_all(&buffer[..read])?;
        }
        if length != size || format!("{:x}", hash.finalize()) != expected.sha256 {
            return Err(invalid("tar member failed digest verification"));
        }
        file.sync_all()?;
    }
    if manifest.is_none() || !remaining.is_empty() || long_path.is_some() {
        return Err(invalid("backup is missing declared members"));
    }
    // tar stops at its first zero header, before age's final authentication tag.
    // Drain through EOF, allowing only bounded tar padding. Never expose a prefix
    // of a truncated archive, or ignore a concatenated archive after tar EOF.
    let mut decrypted = archive.into_inner();
    let mut padding = 0usize;
    loop {
        check()?;
        let read = decrypted.read(&mut buffer).map_err(input_error)?;
        if read == 0 {
            break;
        }
        padding += read;
        if padding > 4096 || buffer[..read].iter().any(|byte| *byte != 0) {
            return Err(invalid("unexpected trailing archive data"));
        }
    }
    if padding < 512 {
        return Err(invalid("tar end markers are missing"));
    }
    Ok(AuthenticatedBackup {
        directory,
        manifest: manifest.unwrap(),
    })
}
