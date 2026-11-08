use std::rc::Rc;

use gtk4::gdk;

/// What an image reference shows; `frames` holds each frame with its delay in milliseconds
/// (0 for a still image).
#[derive(Debug, Clone)]
pub enum EditorImage {
    Loading,
    Unavailable,
    Ready {
        width: u32,
        height: u32,
        frames: Rc<[(gdk::Texture, u32)]>,
    },
}

/// Supplies the images that references in the text point to. A source answers at once and
/// tells the view through `MarkdownView::image_changed` when an answer changes.
pub trait ImageSource {
    fn image(&self, image_id: &str) -> EditorImage;
}
