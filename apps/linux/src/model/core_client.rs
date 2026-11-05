use std::cell::RefCell;
use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use commitnote_core_api::{Command, CoreEvent};
use commitnote_core_runtime::services::blob_cache::FileBlobCacheStore;
use commitnote_core_runtime::services::device_settings::FileDeviceSettingsStore;
use commitnote_core_runtime::services::http::{HttpPolicy, soup_http_factory};
use commitnote_core_runtime::services::remembered_session::{
    HostRememberedSession, open_remembered_session_store,
};
use commitnote_core_runtime::services::{HostServices, ServiceError};
use commitnote_core_runtime::{CoreRuntime, RequestError, RuntimeConfig, StartError};
#[cfg(feature = "testing")]
use serde_json::Value;

const HTTP_TIMEOUT: Duration = Duration::from_secs(60);

pub struct ClientConfig {
    pub app_id: String,
    pub version: String,
    pub bundle: String,
    pub device_model: String,
    pub cache_dir: PathBuf,
    pub config_dir: PathBuf,
    pub allow_loopback_http: bool,
}

pub struct CoreClient {
    bundle: String,
    device_model: String,
    http_policy: HttpPolicy,
    device_settings_path: PathBuf,
    remembered_session: Arc<HostRememberedSession>,
    keyring_available: bool,
    blob_cache: Arc<FileBlobCacheStore>,
    runtime: RefCell<Option<CoreRuntime>>,
}

pub fn startup_message(error: &StartError) -> String {
    match error {
        StartError::ApiVersionMismatch { expected, found } => format!(
            "This build of the app is broken: its core has API version {found}, but the app expects {expected}."
        ),
        _ => "This build of the app is broken: its core could not be loaded.".to_owned(),
    }
}

impl CoreClient {
    pub async fn open(config: ClientConfig) -> Result<Self, StartError> {
        let remembered = open_remembered_session_store(&config.app_id).await;
        let client = Self {
            bundle: config.bundle,
            device_model: config.device_model,
            http_policy: HttpPolicy {
                user_agent: format!("commitnote-linux/{}", config.version),
                allow_loopback_http: config.allow_loopback_http,
                timeout: HTTP_TIMEOUT,
            },
            device_settings_path: config.config_dir.join("device-settings.json"),
            remembered_session: remembered.store,
            keyring_available: remembered.keyring_available,
            blob_cache: Arc::new(FileBlobCacheStore::new(config.cache_dir.join("blobs"))),
            runtime: RefCell::new(None),
        };
        let runtime = client.start_runtime().await?;
        client.runtime.replace(Some(runtime));
        Ok(client)
    }

    pub fn keyring_available(&self) -> bool {
        self.keyring_available
    }

    pub async fn set_persist(&self, persist: bool) -> Result<(), ServiceError> {
        self.remembered_session.set_persist(persist).await
    }

    pub fn request<C: Command>(
        &self,
        params: C::Params,
    ) -> impl Future<Output = Result<C::Result, RequestError>> + use<C> {
        let pending = self
            .runtime
            .borrow()
            .as_ref()
            .map(|runtime| runtime.request::<C>(params));
        async move {
            match pending {
                Some(pending) => pending.await,
                None => Err(RequestError::Stopped),
            }
        }
    }

    #[cfg(feature = "testing")]
    pub fn send(
        &self,
        command: &str,
        params: Value,
    ) -> impl Future<Output = Result<Value, RequestError>> + use<> {
        let pending = self
            .runtime
            .borrow()
            .as_ref()
            .map(|runtime| runtime.send(command, params));
        async move {
            match pending {
                Some(pending) => pending.await,
                None => Err(RequestError::Stopped),
            }
        }
    }

    pub fn subscribe(&self) -> Option<async_channel::Receiver<CoreEvent>> {
        self.runtime.borrow().as_ref().map(CoreRuntime::subscribe)
    }

    /// Replaces the running core with a fresh one that shares the remembered session and blob cache.
    pub async fn restart(&self) -> Result<(), StartError> {
        let previous = self.runtime.take();
        if let Some(previous) = previous {
            let _ = gio::spawn_blocking(move || previous.stop()).await;
        }
        self.blob_cache.flush();
        let runtime = self.start_runtime().await?;
        self.runtime.replace(Some(runtime));
        Ok(())
    }

    pub fn shutdown(&self) {
        if let Some(runtime) = self.runtime.take() {
            runtime.stop();
        }
        self.blob_cache.flush();
    }

    async fn start_runtime(&self) -> Result<CoreRuntime, StartError> {
        let config = RuntimeConfig {
            bundle: self.bundle.clone(),
            device_model: self.device_model.clone(),
            services: self.services(),
        };
        gio::spawn_blocking(move || CoreRuntime::start(config))
            .await
            .unwrap_or(Err(StartError::ThreadFailed))
    }

    fn services(&self) -> HostServices {
        HostServices {
            http: soup_http_factory(self.http_policy.clone()),
            remembered_session: self.remembered_session.clone(),
            blob_cache: self.blob_cache.clone(),
            device_settings: Box::new(FileDeviceSettingsStore::new(
                self.device_settings_path.clone(),
            )),
            ..HostServices::default()
        }
    }
}
