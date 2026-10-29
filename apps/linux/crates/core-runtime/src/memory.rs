use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, MutexGuard};

use futures_util::FutureExt;
use futures_util::future::{BoxFuture, LocalBoxFuture};

use crate::services::{
    BlobCacheEntry, BlobCacheListing, BlobCacheStore, DecodedImage, DeviceSettingsStore, Http,
    HttpError, HttpRequest, HttpResponse, ImageCodec, LogLevel, Logger, RememberedSessionRecord,
    RememberedSessionStore, ServiceError, StagedInput, StagedInputs,
};

pub const LOG_DOMAIN: &str = "commitnote-core";

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct GLibLogger;

impl Logger for GLibLogger {
    fn log(&self, level: LogLevel, message: &str) {
        let level = match level {
            LogLevel::Debug => glib::LogLevel::Debug,
            LogLevel::Info => glib::LogLevel::Info,
            LogLevel::Warn => glib::LogLevel::Warning,
            LogLevel::Error => glib::LogLevel::Critical,
        };
        glib::log_structured_array(
            level,
            &[
                glib::LogField::new(glib::gstr!("PRIORITY"), level.priority().as_bytes()),
                glib::LogField::new(glib::gstr!("GLIB_DOMAIN"), LOG_DOMAIN.as_bytes()),
                glib::LogField::new(glib::gstr!("MESSAGE"), message.as_bytes()),
            ],
        );
    }
}

pub struct UnavailableHttp;

impl Http for UnavailableHttp {
    fn request(
        &self,
        _request: HttpRequest,
    ) -> LocalBoxFuture<'static, Result<HttpResponse, HttpError>> {
        async { Err(ServiceError::new("Network request failed")) }.boxed_local()
    }
}

#[derive(Default)]
pub struct MemoryRememberedSessionStore {
    record: Mutex<Option<RememberedSessionRecord>>,
}

impl RememberedSessionStore for MemoryRememberedSessionStore {
    fn save(
        &self,
        record: RememberedSessionRecord,
    ) -> BoxFuture<'static, Result<(), ServiceError>> {
        *lock(&self.record) = Some(record);
        async { Ok(()) }.boxed()
    }

    fn load(&self) -> BoxFuture<'static, Result<Option<RememberedSessionRecord>, ServiceError>> {
        let record = lock(&self.record).clone();
        async { Ok(record) }.boxed()
    }

    fn clear(&self) -> BoxFuture<'static, Result<(), ServiceError>> {
        *lock(&self.record) = None;
        async { Ok(()) }.boxed()
    }
}

#[derive(Default)]
pub struct MemoryBlobCacheStore {
    repos: Mutex<BTreeMap<String, BTreeMap<String, BlobCacheEntry>>>,
}

impl BlobCacheStore for MemoryBlobCacheStore {
    fn get(&self, repo_key: &str, blob_sha: &str) -> Result<Option<BlobCacheEntry>, ServiceError> {
        Ok(lock(&self.repos)
            .get(repo_key)
            .and_then(|blobs| blobs.get(blob_sha))
            .cloned())
    }

    fn put(
        &self,
        repo_key: &str,
        blob_sha: &str,
        entry: BlobCacheEntry,
    ) -> Result<(), ServiceError> {
        lock(&self.repos)
            .entry(repo_key.to_owned())
            .or_default()
            .insert(blob_sha.to_owned(), entry);
        Ok(())
    }

    fn touch(&self, repo_key: &str, blob_sha: &str, last_used_at: f64) -> Result<(), ServiceError> {
        if let Some(entry) = lock(&self.repos)
            .get_mut(repo_key)
            .and_then(|blobs| blobs.get_mut(blob_sha))
        {
            entry.last_used_at = last_used_at;
        }
        Ok(())
    }

    fn delete(&self, repo_key: &str, blob_sha: &str) -> Result<(), ServiceError> {
        let mut repos = lock(&self.repos);
        if let Some(blobs) = repos.get_mut(repo_key) {
            blobs.remove(blob_sha);
            if blobs.is_empty() {
                repos.remove(repo_key);
            }
        }
        Ok(())
    }

    fn list(&self, repo_key: &str) -> Result<Vec<BlobCacheListing>, ServiceError> {
        Ok(lock(&self.repos)
            .get(repo_key)
            .map(|blobs| {
                blobs
                    .iter()
                    .map(|(blob_sha, entry)| BlobCacheListing {
                        blob_sha: blob_sha.clone(),
                        size: entry.bytes.len() as u64,
                        last_used_at: entry.last_used_at,
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    fn list_repos(&self) -> Result<Vec<String>, ServiceError> {
        Ok(lock(&self.repos).keys().cloned().collect())
    }

    fn delete_repo(&self, repo_key: &str) -> Result<(), ServiceError> {
        lock(&self.repos).remove(repo_key);
        Ok(())
    }
}

#[derive(Default)]
pub struct MemoryDeviceSettingsStore {
    items: HashMap<String, String>,
}

impl DeviceSettingsStore for MemoryDeviceSettingsStore {
    fn get_item(&mut self, key: &str) -> Option<String> {
        self.items.get(key).cloned()
    }

    fn set_item(&mut self, key: &str, value: &str) -> Result<(), ServiceError> {
        self.items.insert(key.to_owned(), value.to_owned());
        Ok(())
    }

    fn remove_item(&mut self, key: &str) -> Result<(), ServiceError> {
        self.items.remove(key);
        Ok(())
    }
}

pub struct UnavailableStagedInputs;

impl StagedInputs for UnavailableStagedInputs {
    fn take(&self, _id: &str) -> Result<Option<StagedInput>, ServiceError> {
        Err(ServiceError::new("Staged inputs are not available"))
    }
}

const IMAGE_PROCESSING_UNAVAILABLE: &str = "Image processing is not available";

pub struct UnavailableImageCodec;

impl ImageCodec for UnavailableImageCodec {
    fn decode(
        &self,
        _bytes: Vec<u8>,
    ) -> LocalBoxFuture<'static, Result<DecodedImage, ServiceError>> {
        async { Err(ServiceError::new(IMAGE_PROCESSING_UNAVAILABLE)) }.boxed_local()
    }

    fn encode_webp(
        &self,
        _handle: &str,
        _width: u32,
        _height: u32,
        _quality: f64,
    ) -> LocalBoxFuture<'static, Result<Vec<u8>, ServiceError>> {
        async { Err(ServiceError::new(IMAGE_PROCESSING_UNAVAILABLE)) }.boxed_local()
    }

    fn release(&self, _handle: &str) {}
}
