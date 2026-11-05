use std::io::Cursor;

use image::codecs::gif::GifDecoder;
use image::codecs::webp::WebPDecoder;
use image::{AnimationDecoder, ImageDecoder, ImageFormat};

use crate::decode::{check_dimensions, limits, reader};
use crate::{CodecError, decode};

const MAX_ANIMATION_BYTES: u64 = 64 * 1024 * 1024;
const MIN_FRAME_DELAY_MS: u32 = 10;
const DEFAULT_FRAME_DELAY_MS: u32 = 100;

#[derive(Clone, PartialEq, Eq)]
pub struct DisplayImage {
    pub width: u32,
    pub height: u32,
    pub frames: Vec<Frame>,
}

/// Straight RGBA8 pixels covering the whole image, shown for `delay_ms` (0 for a still image).
#[derive(Clone, PartialEq, Eq)]
pub struct Frame {
    pub rgba: Vec<u8>,
    pub delay_ms: u32,
}

impl std::fmt::Debug for DisplayImage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DisplayImage")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("frames", &self.frames)
            .finish()
    }
}

impl std::fmt::Debug for Frame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Frame")
            .field("delay_ms", &self.delay_ms)
            .finish_non_exhaustive()
    }
}

pub fn decode_for_display(bytes: &[u8]) -> Result<DisplayImage, CodecError> {
    let (_, format) = reader(bytes)?;
    match format {
        ImageFormat::Gif => {
            let mut decoder = GifDecoder::new(Cursor::new(bytes))?;
            decoder.set_limits(limits())?;
            animation(decoder.dimensions(), decoder)
        }
        ImageFormat::WebP => {
            let mut decoder = WebPDecoder::new(Cursor::new(bytes))?;
            decoder.set_limits(limits())?;
            if decoder.has_animation() {
                animation(decoder.dimensions(), decoder)
            } else {
                still(bytes)
            }
        }
        _ => still(bytes),
    }
}

fn still(bytes: &[u8]) -> Result<DisplayImage, CodecError> {
    let image = decode(bytes)?;
    Ok(DisplayImage {
        width: image.width,
        height: image.height,
        frames: vec![Frame {
            rgba: image.pixels,
            delay_ms: 0,
        }],
    })
}

fn animation<'a>(
    (width, height): (u32, u32),
    decoder: impl AnimationDecoder<'a>,
) -> Result<DisplayImage, CodecError> {
    check_dimensions((width, height))?;
    let frame_bytes = u64::from(width) * u64::from(height) * 4;
    let mut frames = Vec::new();
    for frame in decoder.into_frames() {
        let frame = match frame {
            Ok(frame) => frame,
            Err(error) if frames.is_empty() => return Err(error.into()),
            Err(_) => break,
        };
        let (numerator, denominator) = frame.delay().numer_denom_ms();
        let delay_ms = numerator.checked_div(denominator).unwrap_or(0);
        let buffer = frame.into_buffer();
        if (buffer.width(), buffer.height()) != (width, height) {
            return Err(CodecError::Invalid);
        }
        if !frames.is_empty() && frame_bytes * (frames.len() as u64 + 1) > MAX_ANIMATION_BYTES {
            frames.truncate(1);
            break;
        }
        frames.push(Frame {
            rgba: buffer.into_raw(),
            delay_ms: if delay_ms <= MIN_FRAME_DELAY_MS {
                DEFAULT_FRAME_DELAY_MS
            } else {
                delay_ms
            },
        });
    }
    if frames.is_empty() {
        return Err(CodecError::Invalid);
    }
    Ok(DisplayImage {
        width,
        height,
        frames,
    })
}
