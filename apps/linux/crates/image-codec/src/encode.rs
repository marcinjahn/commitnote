use image::imageops::{self, FilterType};
use image::{ImageBuffer, RgbaImage};

use crate::{CodecError, MAX_WEBP_DIMENSION, Rgba, webp};

type SourceImage<'a> = ImageBuffer<image::Rgba<u8>, &'a [u8]>;
type Rgba16Image = ImageBuffer<image::Rgba<u16>, Vec<u16>>;

pub fn encode_webp(
    image: &Rgba,
    width: u32,
    height: u32,
    quality: f64,
) -> Result<Vec<u8>, CodecError> {
    let valid_side = |side: u32| (1..=MAX_WEBP_DIMENSION).contains(&side);
    if !valid_side(width) || !valid_side(height) || !quality.is_finite() {
        return Err(CodecError::Invalid);
    }
    let expected_len = u64::from(image.width) * u64::from(image.height) * 4;
    if expected_len == 0 || image.pixels.len() as u64 != expected_len {
        return Err(CodecError::Invalid);
    }
    let quality = (quality.clamp(0.0, 1.0) * 100.0) as f32;
    let encoded = if (image.width, image.height) == (width, height) {
        webp::encode_rgba(&image.pixels, width, height, quality)
    } else {
        let source = SourceImage::from_raw(image.width, image.height, image.pixels.as_slice())
            .ok_or(CodecError::Invalid)?;
        webp::encode_rgba(
            resize(&source, width, height).as_raw(),
            width,
            height,
            quality,
        )
    };
    encoded.ok_or(CodecError::Encode)
}

fn resize(source: &SourceImage<'_>, width: u32, height: u32) -> RgbaImage {
    if source.pixels().all(|pixel| pixel[3] == u8::MAX) {
        return imageops::resize(source, width, height, FilterType::CatmullRom);
    }
    let resized = imageops::resize(&premultiply(source), width, height, FilterType::CatmullRom);
    unpremultiply(&resized)
}

fn premultiply(source: &SourceImage<'_>) -> Rgba16Image {
    ImageBuffer::from_fn(source.width(), source.height(), |x, y| {
        let [r, g, b, a] = source.get_pixel(x, y).0.map(u16::from);
        image::Rgba([r * a, g * a, b * a, a * 257])
    })
}

fn unpremultiply(source: &Rgba16Image) -> RgbaImage {
    ImageBuffer::from_fn(source.width(), source.height(), |x, y| {
        let [r, g, b, a] = source.get_pixel(x, y).0.map(u32::from);
        if a == 0 {
            return image::Rgba([0, 0, 0, 0]);
        }
        let channel = |value: u32| ((value * 257 + a / 2) / a).min(255) as u8;
        image::Rgba([channel(r), channel(g), channel(b), ((a + 128) / 257) as u8])
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resize_does_not_darken_transparent_edges() {
        let transparent = [0, 0, 0, 0];
        let red = [255, 0, 0, 255];
        let pixels: Vec<u8> = (0..4)
            .flat_map(|_| [transparent, transparent, transparent, red, red, red].concat())
            .collect();
        let source = SourceImage::from_raw(6, 4, pixels.as_slice()).unwrap();

        let resized = resize(&source, 3, 2);

        let edges: Vec<_> = resized
            .pixels()
            .filter(|pixel| (1..255).contains(&pixel[3]))
            .collect();
        assert!(!edges.is_empty());
        assert!(
            edges
                .iter()
                .all(|pixel| pixel[0] == 255 && pixel[1] == 0 && pixel[2] == 0)
        );
    }
}
