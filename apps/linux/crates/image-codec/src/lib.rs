#![deny(unsafe_code)]

mod decode;
mod display;
mod encode;
mod error;
#[allow(unsafe_code)]
mod webp;

pub use decode::decode;
pub use display::{DisplayImage, Frame, decode_for_display};
pub use encode::encode_webp;
pub use error::CodecError;

pub const MAX_IMAGE_PIXELS: u64 = 50_000_000;
pub const MAX_WEBP_DIMENSION: u32 = 16_383;

/// Straight (non-premultiplied) RGBA8 pixels, row by row without padding.
#[derive(Clone, PartialEq, Eq)]
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

impl std::fmt::Debug for Rgba {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Rgba")
            .field("width", &self.width)
            .field("height", &self.height)
            .finish_non_exhaustive()
    }
}
