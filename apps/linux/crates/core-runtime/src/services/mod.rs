pub mod blob_cache;
pub(crate) mod crypto;
pub mod device_settings;
pub mod http;
pub mod remembered_session;

use std::fmt;
use std::rc::Rc;
use std::sync::Arc;

use commitnote_core_api::Secret;
use commitnote_core_api::shapes::ForgeKind;
use futures_util::future::{BoxFuture, LocalBoxFuture};
use zeroize::Zeroizing;

use crate::memory::{
    GLibLogger, MemoryBlobCacheStore, MemoryDeviceSettingsStore, MemoryRememberedSessionStore,
    UnavailableHttp, UnavailableImageCodec, UnavailableStagedInputs,
};

/// Its message becomes a JavaScript error message, so it must never carry note contents,
/// names or paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceError {
    message: String,
}

impl ServiceError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for ServiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ServiceError {}

impl From<commitnote_crypto::CryptoError> for ServiceError {
    fn from(error: commitnote_crypto::CryptoError) -> Self {
        Self::new(error.message())
    }
}

pub type HttpError = ServiceError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// Lives on the core thread; any HTTP status resolves, only transport failures reject.
pub trait Http {
    fn request(
        &self,
        request: HttpRequest,
    ) -> LocalBoxFuture<'static, Result<HttpResponse, HttpError>>;
}

pub type HttpFactory = Box<dyn FnOnce() -> Rc<dyn Http> + Send>;

#[derive(Clone, PartialEq, Eq)]
pub struct RepoCoordinates {
    pub forge: ForgeKind,
    pub owner: String,
    pub repo: String,
}

#[derive(Clone)]
pub struct RememberedSessionRecord {
    pub repo_url: String,
    pub coordinates: RepoCoordinates,
    pub access_token: Secret,
    pub content_key: Zeroizing<Vec<u8>>,
    pub name_key: Zeroizing<Vec<u8>>,
    pub name_iv_key: Zeroizing<Vec<u8>>,
    pub key_check_key: Zeroizing<Vec<u8>>,
}

pub trait RememberedSessionStore: Send + Sync {
    fn save(&self, record: RememberedSessionRecord)
    -> BoxFuture<'static, Result<(), ServiceError>>;
    fn load(&self) -> BoxFuture<'static, Result<Option<RememberedSessionRecord>, ServiceError>>;
    fn clear(&self) -> BoxFuture<'static, Result<(), ServiceError>>;
}

#[derive(Clone, PartialEq)]
pub struct BlobCacheEntry {
    pub bytes: Vec<u8>,
    pub text: bool,
    pub last_used_at: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BlobCacheListing {
    pub blob_sha: String,
    pub size: u64,
    pub last_used_at: f64,
}

/// Blocking; the host calls it off the core thread, one operation at a time.
pub trait BlobCacheStore: Send + Sync {
    fn get(&self, repo_key: &str, blob_sha: &str) -> Result<Option<BlobCacheEntry>, ServiceError>;
    fn put(
        &self,
        repo_key: &str,
        blob_sha: &str,
        entry: BlobCacheEntry,
    ) -> Result<(), ServiceError>;
    fn touch(&self, repo_key: &str, blob_sha: &str, last_used_at: f64) -> Result<(), ServiceError>;
    fn delete(&self, repo_key: &str, blob_sha: &str) -> Result<(), ServiceError>;
    fn list(&self, repo_key: &str) -> Result<Vec<BlobCacheListing>, ServiceError>;
    fn list_repos(&self) -> Result<Vec<String>, ServiceError>;
    fn delete_repo(&self, repo_key: &str) -> Result<(), ServiceError>;
}

pub trait DeviceSettingsStore: Send {
    fn get_item(&mut self, key: &str) -> Option<String>;
    fn set_item(&mut self, key: &str, value: &str) -> Result<(), ServiceError>;
    fn remove_item(&mut self, key: &str) -> Result<(), ServiceError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

pub trait Logger: Send + Sync {
    fn log(&self, level: LogLevel, message: &str);
}

#[derive(Clone, PartialEq, Eq)]
pub struct StagedInput {
    pub bytes: Vec<u8>,
    /// Empty when unknown.
    pub mime_type: String,
}

pub trait StagedInputs: Send {
    /// Each id can be taken once; `None` when unknown or already taken.
    fn take(&self, id: &str) -> Result<Option<StagedInput>, ServiceError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedImage {
    pub handle: String,
    pub width: u32,
    pub height: u32,
}

/// Lives on the core thread; implementations decode and encode off it.
pub trait ImageCodec: Send {
    /// Applies the image's orientation.
    fn decode(&self, bytes: Vec<u8>)
    -> LocalBoxFuture<'static, Result<DecodedImage, ServiceError>>;
    /// `quality` is 0…1, as the web canvas encoder takes it.
    fn encode_webp(
        &self,
        handle: &str,
        width: u32,
        height: u32,
        quality: f64,
    ) -> LocalBoxFuture<'static, Result<Vec<u8>, ServiceError>>;
    fn release(&self, handle: &str);
}

pub struct HostServices {
    pub http: HttpFactory,
    pub remembered_session: Arc<dyn RememberedSessionStore>,
    pub blob_cache: Arc<dyn BlobCacheStore>,
    pub device_settings: Box<dyn DeviceSettingsStore>,
    pub logger: Arc<dyn Logger>,
    pub staged_inputs: Box<dyn StagedInputs>,
    pub image_codec: Box<dyn ImageCodec>,
}

impl Default for HostServices {
    fn default() -> Self {
        Self {
            http: Box::new(|| Rc::new(UnavailableHttp)),
            remembered_session: Arc::new(MemoryRememberedSessionStore::default()),
            blob_cache: Arc::new(MemoryBlobCacheStore::default()),
            device_settings: Box::new(MemoryDeviceSettingsStore::default()),
            logger: Arc::new(GLibLogger),
            staged_inputs: Box::new(UnavailableStagedInputs),
            image_codec: Box::new(UnavailableImageCodec),
        }
    }
}
