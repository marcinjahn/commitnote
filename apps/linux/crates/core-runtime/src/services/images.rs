use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use commitnote_image_codec::{CodecError, Rgba};
use futures_util::FutureExt;
use futures_util::future::LocalBoxFuture;

use crate::host::blocking;
use crate::services::{DecodedImage, ImageCodec, ServiceError};

const UNKNOWN_HANDLE: &str = "Unknown image handle";

/// Clones share their decoded images; the images are freed when released or when the last clone
/// is dropped.
#[derive(Clone, Default)]
pub struct HostImageCodec {
    images: Arc<Mutex<HashMap<String, Arc<Rgba>>>>,
    next_handle: Arc<AtomicU64>,
}

impl HostImageCodec {
    pub fn live_handles(&self) -> usize {
        self.images().len()
    }

    fn images(&self) -> MutexGuard<'_, HashMap<String, Arc<Rgba>>> {
        self.images
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn service_error(error: CodecError) -> ServiceError {
    ServiceError::new(error.to_string())
}

impl ImageCodec for HostImageCodec {
    fn decode(
        &self,
        bytes: Vec<u8>,
    ) -> LocalBoxFuture<'static, Result<DecodedImage, ServiceError>> {
        let codec = self.clone();
        async move {
            let image =
                blocking(move || commitnote_image_codec::decode(&bytes).map_err(service_error))
                    .await?;
            let handle = format!(
                "img-{}",
                codec.next_handle.fetch_add(1, Ordering::Relaxed) + 1
            );
            let decoded = DecodedImage {
                handle: handle.clone(),
                width: image.width,
                height: image.height,
            };
            codec.images().insert(handle, Arc::new(image));
            Ok(decoded)
        }
        .boxed_local()
    }

    fn encode_webp(
        &self,
        handle: &str,
        width: u32,
        height: u32,
        quality: f64,
    ) -> LocalBoxFuture<'static, Result<Vec<u8>, ServiceError>> {
        let image = self.images().get(handle).cloned();
        async move {
            let image = image.ok_or_else(|| ServiceError::new(UNKNOWN_HANDLE))?;
            blocking(move || {
                commitnote_image_codec::encode_webp(&image, width, height, quality)
                    .map_err(service_error)
            })
            .await
        }
        .boxed_local()
    }

    fn release(&self, handle: &str) {
        self.images().remove(handle);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block_on<F: Future>(future: F) -> F::Output {
        glib::MainContext::new().block_on(future)
    }

    #[test]
    fn encoding_an_unknown_handle_fails() {
        let codec = HostImageCodec::default();

        let error = block_on(codec.encode_webp("img-1", 1, 1, 0.8)).unwrap_err();

        assert_eq!(error.message(), UNKNOWN_HANDLE);
    }

    #[test]
    fn a_failed_decode_keeps_no_handle_and_carries_the_generic_message() {
        let codec = HostImageCodec::default();

        let error = block_on(codec.decode(b"not an image".to_vec())).unwrap_err();

        assert_eq!(error.message(), CodecError::Unsupported.to_string());
        assert_eq!(codec.live_handles(), 0);
    }

    #[test]
    fn a_released_handle_is_gone() {
        let codec = HostImageCodec::default();
        let pixel = Arc::new(Rgba {
            width: 1,
            height: 1,
            pixels: vec![0, 0, 0, 255],
        });
        codec.images().insert("img-1".to_owned(), pixel);

        codec.release("img-1");
        codec.release("img-1");

        assert_eq!(codec.live_handles(), 0);
        assert!(block_on(codec.encode_webp("img-1", 1, 1, 0.8)).is_err());
    }
}
