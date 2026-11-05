use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, DirBuilder, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use super::{BlobCacheEntry, BlobCacheListing, BlobCacheStore, ServiceError};

const INDEX_NAME: &str = "index.json";
const STORAGE_FAILED: &str = "Blob cache storage failed";
const INVALID_BLOB_ID: &str = "Invalid blob id";

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) fn create_private_dir(path: &Path) -> io::Result<()> {
    DirBuilder::new().recursive(true).mode(0o700).create(path)
}

pub(crate) fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let directory = path
        .parent()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    create_private_dir(directory)?;
    let temp = directory.join(format!(
        ".tmp-{}-{}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let written = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temp, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    written
}

fn storage_error(_: io::Error) -> ServiceError {
    ServiceError::new(STORAGE_FAILED)
}

fn remove_path(path: &Path) -> io::Result<()> {
    let removed = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(error) => Err(error),
    };
    match removed {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

fn validate_blob_id(blob_sha: &str) -> Result<(), ServiceError> {
    let valid = matches!(blob_sha.len(), 40 | 64)
        && blob_sha
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if valid {
        Ok(())
    } else {
        Err(ServiceError::new(INVALID_BLOB_ID))
    }
}

fn repo_directory_name(repo_key: &str) -> Result<String, ServiceError> {
    let digest = commitnote_crypto::digest("SHA-256", repo_key.as_bytes())?;
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
    size: u64,
    last_used_at: f64,
    text: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoIndex {
    repo_key: String,
    blobs: BTreeMap<String, IndexEntry>,
}

fn read_index(directory: &Path) -> Option<RepoIndex> {
    let data = fs::read(directory.join(INDEX_NAME)).ok()?;
    serde_json::from_slice(&data).ok()
}

#[derive(Default)]
struct State {
    indexes: HashMap<String, RepoIndex>,
    dirty: HashSet<String>,
}

pub struct FileBlobCacheStore {
    root: PathBuf,
    state: Mutex<State>,
}

impl FileBlobCacheStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            state: Mutex::default(),
        }
    }

    pub fn flush(&self) {
        let mut state = self.lock();
        let State { indexes, dirty } = &mut *state;
        dirty.retain(|repo_key| {
            indexes
                .get(repo_key)
                .is_some_and(|index| self.save_index(index).is_err())
        });
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn repo_directory(&self, repo_key: &str) -> Result<PathBuf, ServiceError> {
        Ok(self.root.join(repo_directory_name(repo_key)?))
    }

    fn blob_path(&self, repo_key: &str, blob_sha: &str) -> Result<PathBuf, ServiceError> {
        Ok(self.repo_directory(repo_key)?.join(blob_sha))
    }

    /// An index that cannot be read, or belongs to another key, invalidates its directory.
    fn load<'a>(
        &self,
        state: &'a mut State,
        repo_key: &str,
    ) -> Result<Option<&'a mut RepoIndex>, ServiceError> {
        if !state.indexes.contains_key(repo_key) {
            let directory = self.repo_directory(repo_key)?;
            match read_index(&directory) {
                Some(index) if index.repo_key == repo_key => {
                    state.indexes.insert(repo_key.to_owned(), index);
                }
                _ => {
                    remove_path(&directory).map_err(storage_error)?;
                    return Ok(None);
                }
            }
        }
        Ok(state.indexes.get_mut(repo_key))
    }

    fn save_index(&self, index: &RepoIndex) -> Result<(), ServiceError> {
        let path = self.repo_directory(&index.repo_key)?.join(INDEX_NAME);
        let data = serde_json::to_vec(index).map_err(|_| ServiceError::new(STORAGE_FAILED))?;
        write_atomically(&path, &data).map_err(storage_error)
    }
}

impl BlobCacheStore for FileBlobCacheStore {
    fn get(&self, repo_key: &str, blob_sha: &str) -> Result<Option<BlobCacheEntry>, ServiceError> {
        validate_blob_id(blob_sha)?;
        let mut state = self.lock();
        let Some(index) = self.load(&mut state, repo_key)? else {
            return Ok(None);
        };
        let Some(entry) = index.blobs.get(blob_sha).cloned() else {
            return Ok(None);
        };
        match fs::read(self.blob_path(repo_key, blob_sha)?) {
            Ok(bytes) => Ok(Some(BlobCacheEntry {
                bytes,
                text: entry.text,
                last_used_at: entry.last_used_at,
            })),
            Err(_) => {
                if let Some(index) = state.indexes.get_mut(repo_key) {
                    index.blobs.remove(blob_sha);
                }
                state.dirty.insert(repo_key.to_owned());
                Ok(None)
            }
        }
    }

    fn put(
        &self,
        repo_key: &str,
        blob_sha: &str,
        entry: BlobCacheEntry,
    ) -> Result<(), ServiceError> {
        validate_blob_id(blob_sha)?;
        let mut state = self.lock();
        if self.load(&mut state, repo_key)?.is_none() {
            state.indexes.insert(
                repo_key.to_owned(),
                RepoIndex {
                    repo_key: repo_key.to_owned(),
                    blobs: BTreeMap::new(),
                },
            );
        }
        write_atomically(&self.blob_path(repo_key, blob_sha)?, &entry.bytes)
            .map_err(storage_error)?;
        let State { indexes, dirty } = &mut *state;
        let index = indexes
            .get_mut(repo_key)
            .ok_or_else(|| ServiceError::new(STORAGE_FAILED))?;
        index.blobs.insert(
            blob_sha.to_owned(),
            IndexEntry {
                size: entry.bytes.len() as u64,
                last_used_at: entry.last_used_at,
                text: entry.text,
            },
        );
        if let Err(error) = self.save_index(index) {
            dirty.insert(repo_key.to_owned());
            return Err(error);
        }
        dirty.remove(repo_key);
        Ok(())
    }

    fn touch(&self, repo_key: &str, blob_sha: &str, last_used_at: f64) -> Result<(), ServiceError> {
        validate_blob_id(blob_sha)?;
        let mut state = self.lock();
        let Some(index) = self.load(&mut state, repo_key)? else {
            return Ok(());
        };
        if let Some(entry) = index.blobs.get_mut(blob_sha) {
            entry.last_used_at = last_used_at;
            state.dirty.insert(repo_key.to_owned());
        }
        Ok(())
    }

    fn delete(&self, repo_key: &str, blob_sha: &str) -> Result<(), ServiceError> {
        validate_blob_id(blob_sha)?;
        let mut state = self.lock();
        if self.load(&mut state, repo_key)?.is_none() {
            return Ok(());
        }
        remove_path(&self.blob_path(repo_key, blob_sha)?).map_err(storage_error)?;
        let State { indexes, dirty } = &mut *state;
        if let Some(index) = indexes.get_mut(repo_key)
            && index.blobs.remove(blob_sha).is_some()
        {
            self.save_index(index)?;
            dirty.remove(repo_key);
        }
        Ok(())
    }

    fn list(&self, repo_key: &str) -> Result<Vec<BlobCacheListing>, ServiceError> {
        let mut state = self.lock();
        Ok(self
            .load(&mut state, repo_key)?
            .map(|index| {
                index
                    .blobs
                    .iter()
                    .map(|(blob_sha, entry)| BlobCacheListing {
                        blob_sha: blob_sha.clone(),
                        size: entry.size,
                        last_used_at: entry.last_used_at,
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    fn list_repos(&self) -> Result<Vec<String>, ServiceError> {
        let _state = self.lock();
        let Ok(entries) = fs::read_dir(&self.root) else {
            return Ok(Vec::new());
        };
        let mut keys = Vec::new();
        for entry in entries {
            let path = entry.map_err(storage_error)?.path();
            match read_index(&path) {
                Some(index) => keys.push(index.repo_key),
                None => remove_path(&path).map_err(storage_error)?,
            }
        }
        keys.sort();
        Ok(keys)
    }

    fn delete_repo(&self, repo_key: &str) -> Result<(), ServiceError> {
        let mut state = self.lock();
        state.indexes.remove(repo_key);
        state.dirty.remove(repo_key);
        remove_path(&self.repo_directory(repo_key)?).map_err(storage_error)
    }
}

impl Drop for FileBlobCacheStore {
    fn drop(&mut self) {
        self.flush();
    }
}
