use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use futures_util::FutureExt;
use futures_util::future::BoxFuture;
use gio::prelude::CancellableExt;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::{
    ITEM_KIND, RememberedSessionRecord, RememberedSessionStore, ServiceError, UNLOCK_TIMEOUT,
    bounded, decode_record, encode_record, keyring_error,
};

/// The host keyring behind the shim may ask the user to unlock it.
const SHIM_TIMEOUT: Duration = UNLOCK_TIMEOUT;

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum Operation {
    Put,
    Search,
    Delete,
}

#[derive(Serialize)]
struct Attributes<'a> {
    application: &'a str,
    kind: &'static str,
}

#[derive(Serialize)]
struct ShimRequest<'a> {
    operation: Operation,
    attributes: Attributes<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<&'a str>,
}

#[derive(Deserialize)]
struct ShimResponse {
    entries: Vec<ShimEntry>,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
struct ShimEntry {
    value: String,
}

/// Stops the shim once its caller gives up on it, on a timeout or when the call is dropped.
struct CancelOnDrop(gio::Cancellable);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

fn run_shim(
    shim: &Path,
    payload: Zeroizing<Vec<u8>>,
    cancellable: &gio::Cancellable,
) -> Result<ShimResponse, ServiceError> {
    let process = gio::Subprocess::newv(
        &[shim.as_os_str()],
        gio::SubprocessFlags::STDIN_PIPE
            | gio::SubprocessFlags::STDOUT_PIPE
            | gio::SubprocessFlags::STDERR_SILENCE,
    )
    .map_err(keyring_error)?;
    let stdin = glib::Bytes::from_owned(payload);
    let stdout = match process.communicate(Some(&stdin), Some(cancellable)) {
        Ok((stdout, _)) => stdout,
        Err(error) => {
            process.force_exit();
            return Err(keyring_error(error));
        }
    };
    if !process.is_successful() {
        return Err(keyring_error(()));
    }
    let stdout = stdout.ok_or_else(|| keyring_error(()))?;
    serde_json::from_slice(&stdout).map_err(keyring_error)
}

struct CpakInner {
    shim: PathBuf,
    app_id: String,
}

impl CpakInner {
    async fn run(
        &self,
        operation: Operation,
        value: Option<&str>,
    ) -> Result<ShimResponse, ServiceError> {
        let request = ShimRequest {
            operation,
            attributes: Attributes {
                application: &self.app_id,
                kind: ITEM_KIND,
            },
            value,
        };
        let mut payload = Zeroizing::new(Vec::new());
        serde_json::to_writer(&mut *payload, &request).map_err(keyring_error)?;
        let shim = self.shim.clone();
        let cancel = CancelOnDrop(gio::Cancellable::new());
        let cancellable = cancel.0.clone();
        let call = gio::spawn_blocking(move || run_shim(&shim, payload, &cancellable));
        bounded(SHIM_TIMEOUT, call).await?
    }

    async fn save(&self, record: &RememberedSessionRecord) -> Result<(), ServiceError> {
        let encoded = encode_record(record).ok_or_else(|| keyring_error(()))?;
        let text = std::str::from_utf8(&encoded).map_err(keyring_error)?;
        self.run(Operation::Put, Some(text)).await?;
        Ok(())
    }

    async fn load(&self) -> Result<Option<RememberedSessionRecord>, ServiceError> {
        let response = self.run(Operation::Search, None).await?;
        Ok(response
            .entries
            .first()
            .and_then(|entry| decode_record(entry.value.as_bytes())))
    }

    async fn clear(&self) -> Result<(), ServiceError> {
        self.run(Operation::Delete, None).await?;
        Ok(())
    }
}

/// Keeps the record in the host keyring through cpak's secrets shim, which scopes every item to
/// the package and speaks JSON over stdin and stdout.
#[derive(Clone)]
pub struct CpakRememberedSessionStore {
    inner: Arc<CpakInner>,
}

impl CpakRememberedSessionStore {
    pub async fn open(shim: &Path, app_id: &str) -> Result<Self, ServiceError> {
        let inner = CpakInner {
            shim: shim.to_owned(),
            app_id: app_id.to_owned(),
        };
        inner.run(Operation::Search, None).await?;
        Ok(Self {
            inner: Arc::new(inner),
        })
    }
}

impl RememberedSessionStore for CpakRememberedSessionStore {
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
