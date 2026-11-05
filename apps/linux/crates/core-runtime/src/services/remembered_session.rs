use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use commitnote_core_api::Secret;
use commitnote_core_api::shapes::ForgeKind;
use futures_util::FutureExt;
use futures_util::future::BoxFuture;
use oo7::dbus::{Collection, Service};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::{
    LogLevel, Logger, RememberedSessionRecord, RememberedSessionStore, RepoCoordinates,
    ServiceError,
};
use crate::memory::GLibLogger;

const KEYRING_UNAVAILABLE: &str = "Keyring unavailable";
const ITEM_LABEL: &str = "commitnote remembered session";
const ITEM_KIND: &str = "remembered-session";

fn keyring_error<E>(_: E) -> ServiceError {
    ServiceError::new(KEYRING_UNAVAILABLE)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionOut<'a> {
    repo_url: &'a str,
    coordinates: CoordinatesOut<'a>,
    access_token: &'a str,
    keys: KeysOut<'a>,
}

#[derive(Serialize)]
struct CoordinatesOut<'a> {
    forge: ForgeKind,
    owner: &'a str,
    repo: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeysOut<'a> {
    content_key: &'a str,
    name_key: &'a str,
    name_iv_key: &'a str,
    key_check_key: &'a str,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
struct SessionIn {
    repo_url: String,
    coordinates: CoordinatesIn,
    access_token: String,
    keys: KeysIn,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
struct CoordinatesIn {
    #[zeroize(skip)]
    forge: ForgeKind,
    owner: String,
    repo: String,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
struct KeysIn {
    content_key: String,
    name_key: String,
    name_iv_key: String,
    key_check_key: String,
}

fn encode_record(record: &RememberedSessionRecord) -> Option<Zeroizing<Vec<u8>>> {
    let encode = |key: &[u8]| Zeroizing::new(STANDARD.encode(key));
    let content_key = encode(&record.content_key);
    let name_key = encode(&record.name_key);
    let name_iv_key = encode(&record.name_iv_key);
    let key_check_key = encode(&record.key_check_key);
    let out = SessionOut {
        repo_url: &record.repo_url,
        coordinates: CoordinatesOut {
            forge: record.coordinates.forge,
            owner: &record.coordinates.owner,
            repo: &record.coordinates.repo,
        },
        access_token: record.access_token.expose(),
        keys: KeysOut {
            content_key: &content_key,
            name_key: &name_key,
            name_iv_key: &name_iv_key,
            key_check_key: &key_check_key,
        },
    };
    let capacity = 512
        + record.repo_url.len()
        + record.coordinates.owner.len()
        + record.coordinates.repo.len()
        + record.access_token.expose().len();
    let mut buffer = Zeroizing::new(Vec::with_capacity(capacity));
    serde_json::to_writer(&mut *buffer, &out).ok()?;
    Some(buffer)
}

fn decode_record(bytes: &[u8]) -> Option<RememberedSessionRecord> {
    let mut stored: SessionIn = serde_json::from_slice(bytes).ok()?;
    let decode = |text: &str| STANDARD.decode(text).ok().map(Zeroizing::new);
    let content_key = decode(&stored.keys.content_key)?;
    let name_key = decode(&stored.keys.name_key)?;
    let name_iv_key = decode(&stored.keys.name_iv_key)?;
    let key_check_key = decode(&stored.keys.key_check_key)?;
    Some(RememberedSessionRecord {
        repo_url: std::mem::take(&mut stored.repo_url),
        coordinates: RepoCoordinates {
            forge: stored.coordinates.forge,
            owner: std::mem::take(&mut stored.coordinates.owner),
            repo: std::mem::take(&mut stored.coordinates.repo),
        },
        access_token: Secret::new(std::mem::take(&mut stored.access_token)),
        content_key,
        name_key,
        name_iv_key,
        key_check_key,
    })
}

struct KeyringInner {
    collection: Collection,
    app_id: String,
}

impl KeyringInner {
    fn attributes(&self) -> [(&'static str, &str); 2] {
        [("application", self.app_id.as_str()), ("kind", ITEM_KIND)]
    }

    async fn unlocked(&self) -> Result<(), ServiceError> {
        if self.collection.is_locked().await.map_err(keyring_error)? {
            self.collection.unlock(None).await.map_err(keyring_error)?;
            if self.collection.is_locked().await.map_err(keyring_error)? {
                return Err(keyring_error(()));
            }
        }
        Ok(())
    }

    async fn save(&self, record: &RememberedSessionRecord) -> Result<(), ServiceError> {
        let encoded = encode_record(record).ok_or_else(|| keyring_error(()))?;
        let text = std::str::from_utf8(&encoded).map_err(keyring_error)?;
        self.unlocked().await?;
        self.collection
            .create_item(
                ITEM_LABEL,
                &self.attributes(),
                oo7::Secret::text(text),
                true,
                None,
            )
            .await
            .map_err(keyring_error)?;
        Ok(())
    }

    async fn load(&self) -> Result<Option<RememberedSessionRecord>, ServiceError> {
        self.unlocked().await?;
        let items = self
            .collection
            .search_items(&self.attributes())
            .await
            .map_err(keyring_error)?;
        let Some(item) = items.first() else {
            return Ok(None);
        };
        let secret = item.secret().await.map_err(keyring_error)?;
        Ok(decode_record(secret.as_bytes()))
    }

    async fn clear(&self) -> Result<(), ServiceError> {
        self.unlocked().await?;
        let items = self
            .collection
            .search_items(&self.attributes())
            .await
            .map_err(keyring_error)?;
        for item in items {
            item.delete(None).await.map_err(keyring_error)?;
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct KeyringRememberedSessionStore {
    inner: Arc<KeyringInner>,
}

impl KeyringRememberedSessionStore {
    pub async fn open(app_id: &str) -> Result<Self, ServiceError> {
        let service = Service::new().await.map_err(keyring_error)?;
        let collection = service.default_collection().await.map_err(keyring_error)?;
        let inner = KeyringInner {
            collection,
            app_id: app_id.to_owned(),
        };
        inner.unlocked().await?;
        Ok(Self {
            inner: Arc::new(inner),
        })
    }
}

impl RememberedSessionStore for KeyringRememberedSessionStore {
    fn save(
        &self,
        record: RememberedSessionRecord,
    ) -> BoxFuture<'static, Result<(), ServiceError>> {
        let inner = self.inner.clone();
        async move { inner.save(&record).await }.boxed()
    }

    fn load(&self) -> BoxFuture<'static, Result<Option<RememberedSessionRecord>, ServiceError>> {
        let inner = self.inner.clone();
        async move { inner.load().await }.boxed()
    }

    fn clear(&self) -> BoxFuture<'static, Result<(), ServiceError>> {
        let inner = self.inner.clone();
        async move { inner.clear().await }.boxed()
    }
}

pub struct HostRememberedSession {
    keyring: Option<KeyringRememberedSessionStore>,
    persist: Arc<AtomicBool>,
    memory: Arc<Mutex<Option<RememberedSessionRecord>>>,
}

impl HostRememberedSession {
    pub fn memory_only() -> Self {
        Self::new(None)
    }

    pub fn with_keyring(keyring: KeyringRememberedSessionStore) -> Self {
        Self::new(Some(keyring))
    }

    fn new(keyring: Option<KeyringRememberedSessionStore>) -> Self {
        Self {
            keyring,
            persist: Arc::new(AtomicBool::new(true)),
            memory: Arc::default(),
        }
    }

    /// Switching to `false` removes the keyring item before the returned future completes.
    pub async fn set_persist(&self, persist: bool) -> Result<(), ServiceError> {
        self.persist.store(persist, Ordering::SeqCst);
        match &self.keyring {
            Some(keyring) if !persist => keyring.clear().await,
            _ => Ok(()),
        }
    }
}

impl RememberedSessionStore for HostRememberedSession {
    fn save(
        &self,
        record: RememberedSessionRecord,
    ) -> BoxFuture<'static, Result<(), ServiceError>> {
        let keyring = self.keyring.clone();
        let persist = self.persist.clone();
        let memory = self.memory.clone();
        async move {
            *lock(&memory) = Some(record.clone());
            match keyring {
                Some(keyring) if persist.load(Ordering::SeqCst) => keyring.save(record).await,
                Some(keyring) => keyring.clear().await,
                None => Ok(()),
            }
        }
        .boxed()
    }

    fn load(&self) -> BoxFuture<'static, Result<Option<RememberedSessionRecord>, ServiceError>> {
        let keyring = self.keyring.clone();
        let persist = self.persist.clone();
        let memory = self.memory.clone();
        async move {
            match keyring {
                Some(keyring) if persist.load(Ordering::SeqCst) => keyring.load().await,
                _ => Ok(lock(&memory).clone()),
            }
        }
        .boxed()
    }

    fn clear(&self) -> BoxFuture<'static, Result<(), ServiceError>> {
        let keyring = self.keyring.clone();
        let memory = self.memory.clone();
        async move {
            *lock(&memory) = None;
            match keyring {
                Some(keyring) => keyring.clear().await,
                None => Ok(()),
            }
        }
        .boxed()
    }
}

pub struct RememberedSession {
    pub store: Arc<HostRememberedSession>,
    pub keyring_available: bool,
}

pub async fn open_remembered_session_store(app_id: &str) -> RememberedSession {
    match KeyringRememberedSessionStore::open(app_id).await {
        Ok(keyring) => RememberedSession {
            store: Arc::new(HostRememberedSession::with_keyring(keyring)),
            keyring_available: true,
        },
        Err(_) => {
            GLibLogger.log(
                LogLevel::Warn,
                "Secret Service is unavailable; the session is kept in memory only",
            );
            RememberedSession {
                store: Arc::new(HostRememberedSession::memory_only()),
                keyring_available: false,
            }
        }
    }
}
