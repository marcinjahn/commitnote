use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::rc::Rc;

use commitnote_core_api::commands::{
    ImageClonePasted, ImageClonePastedParams, ImageInsert, ImageInsertParams, ImageRead,
    ImageReadParams, ImageReadResult,
};
use commitnote_core_api::events::SyncStateChanged;
use commitnote_core_runtime::RequestError;
use commitnote_image_codec::{DisplayImage, decode_for_display};
use gio::prelude::*;
use gtk4::gdk;

use super::file_input::{READ_FAILED_MESSAGE, log_read_failure, read_bounded};
use super::organise::failed;
use super::{AppModel, LOG_DOMAIN, warn};

const MAX_IMAGE_INPUT_BYTES: usize = 25 * 1024 * 1024;
const CACHE_BYTES: usize = 256 * 1024 * 1024;
const FALLBACK_MIME_TYPE: &str = "application/octet-stream";

#[derive(Debug, Clone)]
pub enum ImageInput {
    File(gio::File),
    Bytes {
        bytes: glib::Bytes,
        mime_type: String,
    },
}

/// Straight-alpha RGBA frames, each shown for its delay in milliseconds (0 for a still image).
#[derive(Debug)]
pub struct LoadedImage {
    pub width: u32,
    pub height: u32,
    pub frames: Rc<[(gdk::Texture, u32)]>,
}

impl LoadedImage {
    fn byte_size(&self) -> usize {
        (self.width as usize)
            .saturating_mul(self.height as usize)
            .saturating_mul(4)
            .saturating_mul(self.frames.len())
    }
}

#[derive(Debug, Clone)]
pub enum ImageState {
    Loading,
    Unavailable,
    Ready(Rc<LoadedImage>),
}

struct LruEntry<V> {
    value: V,
    size: usize,
    used: u64,
}

/// Evicts the least recently used entries past `bound`, but always keeps the newest one.
struct Lru<V> {
    bound: usize,
    total: usize,
    tick: u64,
    entries: HashMap<String, LruEntry<V>>,
}

impl<V: Clone> Lru<V> {
    fn new(bound: usize) -> Self {
        Self {
            bound,
            total: 0,
            tick: 0,
            entries: HashMap::new(),
        }
    }

    fn get(&mut self, key: &str) -> Option<V> {
        self.tick += 1;
        let entry = self.entries.get_mut(key)?;
        entry.used = self.tick;
        Some(entry.value.clone())
    }

    fn insert(&mut self, key: String, value: V, size: usize) {
        self.tick += 1;
        let entry = LruEntry {
            value,
            size,
            used: self.tick,
        };
        if let Some(previous) = self.entries.insert(key, entry) {
            self.total -= previous.size;
        }
        self.total += size;
        while self.total > self.bound && self.entries.len() > 1 {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.used)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            if let Some(evicted) = self.entries.remove(&oldest) {
                self.total -= evicted.size;
            }
        }
    }

    #[cfg(feature = "testing")]
    fn len(&self) -> usize {
        self.entries.len()
    }
}

/// Decoded images of the current session; replies from an older generation are ignored. An
/// unavailable image is read again once saved or refreshed data may hold it, which moves
/// `revision` on.
pub(super) struct ImageCache {
    generation: u64,
    revision: u64,
    ready: Lru<Rc<LoadedImage>>,
    unavailable: HashMap<String, u64>,
    loading: HashSet<String>,
    note_switch: u64,
}

impl Default for ImageCache {
    fn default() -> Self {
        Self {
            generation: 0,
            revision: 0,
            ready: Lru::new(CACHE_BYTES),
            unavailable: HashMap::new(),
            loading: HashSet::new(),
            note_switch: 0,
        }
    }
}

impl ImageCache {
    pub(super) fn next_generation(&self) -> Self {
        Self {
            generation: self.generation.wrapping_add(1),
            ..Self::default()
        }
    }
}

impl AppModel {
    pub fn connect_image_changed<F: Fn(&Self, &str) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_string_signal("image-changed", f)
    }

    #[cfg(feature = "testing")]
    pub fn testing_image_cache_len(&self) -> usize {
        let state = self.state();
        let cache = &state.image_cache;
        cache.ready.len() + cache.unavailable.len() + cache.loading.len()
    }

    /// Stages the inputs and inserts them as images, returning their references in order.
    pub async fn insert_images(&self, inputs: Vec<ImageInput>) -> Vec<String> {
        self.flush_edits().await;
        let Some(client) = self.client() else {
            return Vec::new();
        };
        let staged = client.staged_inputs();
        let mut ids = Vec::with_capacity(inputs.len());
        let mut unreadable = false;
        for input in inputs {
            match read_input(input).await {
                Ok((bytes, mime_type)) => ids.push(staged.stage(bytes, mime_type)),
                Err(error) => {
                    log_read_failure(&error);
                    unreadable = true;
                }
            }
        }
        if unreadable {
            self.show_toast(READ_FAILED_MESSAGE);
        }
        if ids.is_empty() {
            return Vec::new();
        }
        let result = self
            .request::<ImageInsert>(ImageInsertParams {
                inputs: ids.clone(),
            })
            .await;
        staged.discard(&ids);
        match result {
            Ok(result) => result.references,
            Err(error) => {
                self.report_error(&failed("could not insert images", error));
                Vec::new()
            }
        }
    }

    /// Gives pasted image references their own copies where the open note needs them.
    pub async fn clone_pasted_images(&self, current: &str, pasted: &str) -> String {
        let path = self
            .state()
            .editor_target
            .note_path()
            .map(<[String]>::to_vec);
        let params = ImageClonePastedParams {
            path,
            current: current.to_owned(),
            pasted: pasted.to_owned(),
        };
        match self.request::<ImageClonePasted>(params).await {
            Ok(result) => result.text,
            Err(error) => {
                warn("could not copy pasted images", &error);
                pasted.to_owned()
            }
        }
    }

    /// The cached image, or `Loading` while a first load runs; `image-changed` fires when it
    /// ends. An unavailable image stays so while it is read again.
    pub fn image(&self, image_id: &str) -> ImageState {
        let (generation, revision, stale) = {
            let mut state = self.state_mut();
            let cache = &mut state.image_cache;
            if let Some(image) = cache.ready.get(image_id) {
                return ImageState::Ready(image);
            }
            let found_at = cache.unavailable.get(image_id).copied();
            if found_at == Some(cache.revision) || !cache.loading.insert(image_id.to_owned()) {
                return if found_at.is_some() {
                    ImageState::Unavailable
                } else {
                    ImageState::Loading
                };
            }
            (cache.generation, cache.revision, found_at.is_some())
        };
        let read = self.request::<ImageRead>(ImageReadParams {
            image_id: image_id.to_owned(),
        });
        let model = self.downgrade();
        let image_id = image_id.to_owned();
        self.spawn(async move {
            let loaded = load(read).await;
            if let Some(model) = model.upgrade() {
                model.image_loaded(generation, revision, image_id, loaded);
            }
        });
        if stale {
            ImageState::Unavailable
        } else {
            ImageState::Loading
        }
    }

    /// Makes the next `image` call read an unavailable image again instead of answering from
    /// the earlier failure.
    pub fn retry_image(&self, image_id: &str) {
        self.state_mut().image_cache.unavailable.remove(image_id);
    }

    pub(super) fn attach_image_triggers(&self) {
        self.connect_open_note_changed(|model| {
            let mut state = model.state_mut();
            let state = &mut *state;
            if state.image_cache.note_switch != state.note_switch {
                state.image_cache.note_switch = state.note_switch;
                state.image_cache.unavailable.clear();
            }
        });
    }

    /// Tells listeners to ask again for unavailable images once a save or refresh landed.
    pub(super) fn recheck_unavailable_images(&self, previous: Option<&SyncStateChanged>) {
        let ids: Vec<String> = {
            let mut state = self.state_mut();
            let state = &mut *state;
            let landed = previous
                .zip(state.sync.as_ref())
                .is_some_and(|(previous, next)| {
                    next.unsaved_count < previous.unsaved_count
                        || (previous.refreshing && !next.refreshing)
                });
            let cache = &mut state.image_cache;
            if !landed || cache.unavailable.is_empty() {
                return;
            }
            cache.revision = cache.revision.wrapping_add(1);
            cache.unavailable.keys().cloned().collect()
        };
        for image_id in ids {
            self.emit_by_name::<()>("image-changed", &[&image_id]);
        }
    }

    pub(super) fn reset_image_cache(&self) {
        let mut state = self.state_mut();
        let next = state.image_cache.next_generation();
        state.image_cache = next;
    }

    fn image_loaded(
        &self,
        generation: u64,
        revision: u64,
        image_id: String,
        loaded: Option<LoadedImage>,
    ) {
        {
            let mut state = self.state_mut();
            let cache = &mut state.image_cache;
            if cache.generation != generation || !cache.loading.remove(&image_id) {
                return;
            }
            match loaded {
                Some(image) => {
                    cache.unavailable.remove(&image_id);
                    let size = image.byte_size();
                    cache.ready.insert(image_id.clone(), Rc::new(image), size);
                }
                None => {
                    let known = cache
                        .unavailable
                        .insert(image_id.clone(), revision)
                        .is_some();
                    if known && revision == cache.revision {
                        return;
                    }
                }
            }
        }
        self.emit_by_name::<()>("image-changed", &[&image_id]);
    }
}

async fn read_input(input: ImageInput) -> Result<(Vec<u8>, String), glib::Error> {
    match input {
        ImageInput::Bytes { bytes, mime_type } => {
            let end = bytes.len().min(MAX_IMAGE_INPUT_BYTES + 1);
            Ok((bytes[..end].to_vec(), mime_type))
        }
        ImageInput::File(file) => {
            let data = read_bounded(&file, MAX_IMAGE_INPUT_BYTES).await?;
            let (content_type, _) = gio::content_type_guess(file.basename(), &data[..]);
            let mime_type = gio::content_type_get_mime_type(&content_type)
                .map_or_else(|| FALLBACK_MIME_TYPE.to_owned(), String::from);
            Ok((data, mime_type))
        }
    }
}

async fn load(
    read: impl Future<Output = Result<ImageReadResult, RequestError>>,
) -> Option<LoadedImage> {
    let image = match read.await {
        Ok(result) => result.image?,
        Err(error) => {
            warn("could not read an image", &error);
            return None;
        }
    };
    let decoded =
        gio::spawn_blocking(move || decode_for_display(&glib::base64_decode(&image.base64))).await;
    match decoded {
        Ok(Ok(display)) => textures(display),
        Ok(Err(error)) => {
            glib::g_warning!(LOG_DOMAIN, "could not decode an image: {error}");
            None
        }
        Err(_) => {
            glib::g_warning!(LOG_DOMAIN, "the image decoder failed");
            None
        }
    }
}

fn textures(image: DisplayImage) -> Option<LoadedImage> {
    let width = i32::try_from(image.width).ok()?;
    let height = i32::try_from(image.height).ok()?;
    let stride = usize::try_from(image.width).ok()?.checked_mul(4)?;
    let length = stride.checked_mul(usize::try_from(image.height).ok()?)?;
    let frames = image
        .frames
        .into_iter()
        .map(|frame| {
            (frame.rgba.len() == length).then(|| {
                let bytes = glib::Bytes::from_owned(frame.rgba);
                let texture = gdk::MemoryTexture::new(
                    width,
                    height,
                    gdk::MemoryFormat::R8g8b8a8,
                    &bytes,
                    stride,
                );
                (texture.upcast::<gdk::Texture>(), frame.delay_ms)
            })
        })
        .collect::<Option<Rc<[_]>>>()?;
    if frames.is_empty() {
        return None;
    }
    Some(LoadedImage {
        width: image.width,
        height: image.height,
        frames,
    })
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    use commitnote_markdown::ImageReference;
    use gtk4::prelude::*;

    use super::super::tests::{Session, fake_bundle, open_and_read, run};
    use super::super::{LogOutResult, Route};
    use super::*;

    const COUNT_LIMIT_NOTICE: &str = "You can add up to 10 images at a time.";
    const UNKNOWN_IMAGE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";

    static NEXT_FILE: AtomicU32 = AtomicU32::new(0);

    struct TempFile(PathBuf);

    impl TempFile {
        fn new(extension: &str, bytes: &[u8]) -> Self {
            let path = Self::path(extension);
            std::fs::write(&path, bytes).expect("the temporary file is written");
            Self(path)
        }

        fn path(extension: &str) -> PathBuf {
            let id = NEXT_FILE.fetch_add(1, Ordering::SeqCst);
            std::env::temp_dir().join(format!(
                "commitnote-image-test-{}-{id}.{extension}",
                std::process::id()
            ))
        }

        fn input(&self) -> ImageInput {
            ImageInput::File(gio::File::for_path(&self.0))
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn path(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    fn png(width: i32, height: i32) -> glib::Bytes {
        let stride = width as usize * 4;
        let pixels = glib::Bytes::from_owned(vec![200_u8; stride * height as usize]);
        gdk::MemoryTexture::new(width, height, gdk::MemoryFormat::R8g8b8a8, &pixels, stride)
            .save_to_png_bytes()
    }

    fn png_input(width: i32, height: i32) -> ImageInput {
        ImageInput::Bytes {
            bytes: png(width, height),
            mime_type: "image/png".to_owned(),
        }
    }

    fn reference_target(reference: &str) -> (String, Option<u32>, Option<u32>) {
        let url = reference
            .strip_prefix("![](")
            .and_then(|rest| rest.strip_suffix(')'))
            .expect("an image reference");
        let target = ImageReference::parse(url).expect("a valid image reference");
        (target.image_id, target.width, target.height)
    }

    fn first_image_id(text: &str) -> String {
        let start = text.find("image:").expect("the text references an image") + "image:".len();
        text[start..start + 26].to_owned()
    }

    fn first_reference(text: &str) -> &str {
        let url = text.find("image:").expect("the note references an image");
        let start = text[..url].rfind("![").expect("the reference starts");
        let end = url + text[url..].find(')').expect("the reference ends") + 1;
        &text[start..end]
    }

    fn record<T: Clone + 'static>(connect: impl FnOnce(Box<dyn Fn(T)>)) -> Rc<RefCell<Vec<T>>> {
        let seen = Rc::new(RefCell::new(Vec::new()));
        let sink = seen.clone();
        connect(Box::new(move |value| sink.borrow_mut().push(value)));
        seen
    }

    fn assert_ready(model: &AppModel, image_id: &str, width: u32, height: u32) {
        let ImageState::Ready(image) = model.image(image_id) else {
            panic!("expected a ready image");
        };
        assert_eq!((image.width, image.height), (width, height));
        assert!(!image.frames.is_empty());
        for (texture, _) in image.frames.iter() {
            assert_eq!(
                (texture.width(), texture.height()),
                (width as i32, height as i32)
            );
        }
    }

    #[test]
    fn inserts_images_loads_them_once_saved_and_rejects_bad_inputs() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;
            let changed = record(|push| {
                model.connect_image_changed(move |_, id| push(id.to_owned()));
            });
            let notices = record(|push| {
                model.connect_notice(move |_, notice| push(notice.message.clone()));
            });
            let toasts = record(|push| {
                model.connect_toast(move |_, message| push(message.to_owned()));
            });
            let welcome = path(&["Welcome"]);
            let text = open_and_read(&session, &welcome).await;
            let file = TempFile::new("png", &png(40, 30));

            let references = model
                .insert_images(vec![file.input(), png_input(20, 10)])
                .await;

            let targets: Vec<_> = references.iter().map(|r| reference_target(r)).collect();
            assert_eq!(targets.len(), 2);
            assert_eq!((targets[0].1, targets[0].2), (Some(40), Some(30)));
            assert_eq!((targets[1].1, targets[1].2), (Some(20), Some(10)));
            model
                .testing_send(
                    "fake.saveNote",
                    serde_json::json!({
                        "path": welcome,
                        "text": format!("{text}\n{}\n", references.join("\n")),
                    }),
                )
                .await
                .expect("the note saves");
            for (id, _, _) in &targets {
                assert!(matches!(model.image(id), ImageState::Loading));
            }
            session
                .wait_until("both images to load", |_| {
                    targets
                        .iter()
                        .all(|(id, _, _)| changed.borrow().contains(id))
                })
                .await;
            assert_ready(model, &targets[0].0, 40, 30);
            assert_ready(model, &targets[1].0, 20, 10);

            let too_many = (0..11).map(|_| png_input(10, 10)).collect();
            assert_eq!(model.insert_images(too_many).await, Vec::<String>::new());
            assert!(model.client().expect("a client").staged_inputs().is_empty());
            session
                .wait_until("the count notice", |_| {
                    notices
                        .borrow()
                        .iter()
                        .any(|message| message == COUNT_LIMIT_NOTICE)
                })
                .await;

            let before = notices.borrow().len();
            let text_file = TempFile::new("txt", b"just some text");
            assert!(
                model
                    .insert_images(vec![text_file.input()])
                    .await
                    .is_empty()
            );
            session
                .wait_until("the rejection notice", |_| notices.borrow().len() > before)
                .await;

            let missing = ImageInput::File(gio::File::for_path(TempFile::path("png")));
            assert!(model.insert_images(vec![missing]).await.is_empty());
            assert_eq!(*toasts.borrow(), [READ_FAILED_MESSAGE]);
        });
    }

    #[test]
    fn loads_sample_images_clones_pasted_ones_and_forgets_them_on_log_out() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;
            let whiteboard = path(&["Journal", "2026", "Whiteboard"]);
            let whiteboard_text = open_and_read(&session, &whiteboard).await;
            let reference = first_reference(&whiteboard_text);
            let image_id = first_image_id(reference);

            assert!(matches!(model.image(&image_id), ImageState::Loading));
            assert!(matches!(model.image(UNKNOWN_IMAGE), ImageState::Loading));
            session
                .wait_until("both loads to end", |model| {
                    !matches!(model.image(&image_id), ImageState::Loading)
                        && !matches!(model.image(UNKNOWN_IMAGE), ImageState::Loading)
                })
                .await;
            let ImageState::Ready(image) = model.image(&image_id) else {
                panic!("expected the sample image to load");
            };
            assert!(image.width > 0 && image.height > 0);
            assert!(matches!(
                model.image(UNKNOWN_IMAGE),
                ImageState::Unavailable
            ));

            let welcome = path(&["Welcome"]);
            let welcome_text = open_and_read(&session, &welcome).await;
            assert!(matches!(model.image(UNKNOWN_IMAGE), ImageState::Loading));
            let pasted = format!("See {reference} here");
            let cloned = model.clone_pasted_images(&welcome_text, &pasted).await;
            let clone = first_image_id(&cloned);
            assert_ne!(clone, image_id);
            assert_eq!(cloned, pasted.replace(&image_id, &clone));

            assert!(model.testing_image_cache_len() > 0);
            assert!(matches!(model.log_out().await, Ok(LogOutResult::LoggedOut)));
            session
                .wait_until("the token page", |model| model.route() == Route::Token)
                .await;
            assert_eq!(model.testing_image_cache_len(), 0);
        });
    }

    #[test]
    fn reads_inserted_images_before_saving_and_rechecks_unavailable_ones_after() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;
            let welcome = path(&["Welcome"]);
            let text = open_and_read(&session, &welcome).await;
            assert!(matches!(model.image(UNKNOWN_IMAGE), ImageState::Loading));
            session
                .wait_until("the unknown image to fail", |model| {
                    matches!(model.image(UNKNOWN_IMAGE), ImageState::Unavailable)
                })
                .await;

            let references = model.insert_images(vec![png_input(12, 8)]).await;
            let (inserted, _, _) = reference_target(&references[0]);
            assert!(matches!(model.image(&inserted), ImageState::Loading));
            session
                .wait_until("the unsaved image to load", |model| {
                    matches!(model.image(&inserted), ImageState::Ready(_))
                })
                .await;

            let changed = record(|push| {
                model.connect_image_changed(move |_, id| push(id.to_owned()));
            });
            model.edit(format!("{text}\n{}\n", references[0]));
            model.save_now().await;
            session
                .wait_until("a recheck of the unknown image", |_| {
                    changed.borrow().iter().any(|id| id == UNKNOWN_IMAGE)
                })
                .await;
            assert!(matches!(
                model.image(UNKNOWN_IMAGE),
                ImageState::Unavailable
            ));
            assert_ready(model, &inserted, 12, 8);
        });
    }

    #[test]
    fn the_cache_keeps_recent_images_within_its_bound() {
        let mut lru = Lru::new(100);
        lru.insert("a".to_owned(), 'a', 40);
        lru.insert("b".to_owned(), 'b', 40);
        assert_eq!(lru.get("a"), Some('a'));

        lru.insert("c".to_owned(), 'c', 40);

        assert_eq!(lru.get("b"), None);
        assert_eq!((lru.get("a"), lru.get("c")), (Some('a'), Some('c')));
        assert_eq!(lru.total, 80);

        lru.insert("big".to_owned(), 'x', 500);

        assert_eq!(lru.len(), 1);
        assert_eq!(lru.get("big"), Some('x'));

        lru.insert("d".to_owned(), 'd', 10);

        assert_eq!(lru.get("big"), None);
        assert_eq!(lru.get("d"), Some('d'));
        assert_eq!(lru.total, 10);
    }
}
