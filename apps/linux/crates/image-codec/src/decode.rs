use std::io::Cursor;

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};

use crate::{CodecError, MAX_IMAGE_PIXELS, Rgba};

const MAX_ALLOC_BYTES: u64 = 512 * 1024 * 1024;

pub(crate) fn limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_ALLOC_BYTES);
    limits
}

type Reader<'a> = ImageReader<Cursor<&'a [u8]>>;

pub(crate) fn reader(bytes: &[u8]) -> Result<(Reader<'_>, ImageFormat), CodecError> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| CodecError::Invalid)?;
    let format = reader.format().ok_or(CodecError::Unsupported)?;
    reader.limits(limits());
    Ok((reader, format))
}

pub(crate) fn check_dimensions((width, height): (u32, u32)) -> Result<(), CodecError> {
    if width == 0 || height == 0 {
        return Err(CodecError::Invalid);
    }
    if u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err(CodecError::TooLarge);
    }
    Ok(())
}

pub fn decode(bytes: &[u8]) -> Result<Rgba, CodecError> {
    let (reader, _) = reader(bytes)?;
    let mut decoder = reader.into_decoder()?;
    check_dimensions(decoder.dimensions())?;
    if decoder.total_bytes() > MAX_ALLOC_BYTES {
        return Err(CodecError::TooLarge);
    }
    let orientation = decoder.orientation()?;
    let mut image = DynamicImage::from_decoder(decoder)?;
    image.apply_orientation(orientation);
    let rgba = image.into_rgba8();
    Ok(Rgba {
        width: rgba.width(),
        height: rgba.height(),
        pixels: rgba.into_raw(),
    })
}
