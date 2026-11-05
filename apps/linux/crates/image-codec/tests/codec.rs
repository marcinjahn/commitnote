use std::io::Cursor;

use commitnote_image_codec::{CodecError, Rgba, decode, decode_for_display, encode_webp};
use image::codecs::gif::{GifEncoder, Repeat};
use image::codecs::jpeg::JpegEncoder;
use image::{Delay, DynamicImage, ImageFormat, RgbImage, RgbaImage};

const RED: [u8; 3] = [220, 30, 30];
const BLUE: [u8; 3] = [30, 30, 220];

fn png(image: RgbaImage) -> Vec<u8> {
    let mut bytes = Vec::new();
    DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .unwrap();
    bytes
}

fn rgba(width: u32, height: u32, pixel: impl Fn(u32, u32) -> [u8; 4]) -> Rgba {
    let image = RgbaImage::from_fn(width, height, |x, y| image::Rgba(pixel(x, y)));
    Rgba {
        width,
        height,
        pixels: image.into_raw(),
    }
}

fn noise(seed: u32) -> impl FnMut() -> u8 {
    let mut state = seed;
    move || {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (state >> 24) as u8
    }
}

fn read_back(webp: &[u8]) -> RgbaImage {
    image::load_from_memory_with_format(webp, ImageFormat::WebP)
        .unwrap()
        .into_rgba8()
}

fn assert_webp_file(bytes: &[u8]) {
    assert_eq!(&bytes[0..4], b"RIFF");
    assert_eq!(&bytes[8..12], b"WEBP");
}

fn close_to(actual: [u8; 3], expected: [u8; 3]) -> bool {
    actual
        .iter()
        .zip(expected)
        .all(|(&a, e)| a.abs_diff(e) <= 40)
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn png_chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut chunk = (data.len() as u32).to_be_bytes().to_vec();
    chunk.extend_from_slice(kind);
    chunk.extend_from_slice(data);
    let mut covered = kind.to_vec();
    covered.extend_from_slice(data);
    chunk.extend_from_slice(&crc32(&covered).to_be_bytes());
    chunk
}

fn truncated_png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut header = width.to_be_bytes().to_vec();
    header.extend_from_slice(&height.to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]);
    bytes.extend(png_chunk(b"IHDR", &header));
    bytes.extend_from_slice(&100_000u32.to_be_bytes());
    bytes.extend_from_slice(b"IDAT\x78\x9c\x00");
    bytes
}

fn exif_orientation_segment(orientation: u16) -> Vec<u8> {
    let mut tiff = b"MM\x00\x2a\x00\x00\x00\x08".to_vec();
    tiff.extend_from_slice(&1u16.to_be_bytes());
    tiff.extend_from_slice(&0x0112u16.to_be_bytes());
    tiff.extend_from_slice(&3u16.to_be_bytes());
    tiff.extend_from_slice(&1u32.to_be_bytes());
    tiff.extend_from_slice(&orientation.to_be_bytes());
    tiff.extend_from_slice(&[0, 0]);
    tiff.extend_from_slice(&0u32.to_be_bytes());
    let mut payload = b"Exif\x00\x00".to_vec();
    payload.extend(tiff);
    let mut segment = vec![0xFF, 0xE1];
    segment.extend_from_slice(&(payload.len() as u16 + 2).to_be_bytes());
    segment.extend(payload);
    segment
}

fn gif_of_tiny_frames(width: u16, height: u16, frames: usize) -> Vec<u8> {
    let mut bytes = b"GIF89a".to_vec();
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.extend_from_slice(&[0x80, 0, 0, 0, 0, 0, 255, 255, 255]);
    for _ in 0..frames {
        bytes.extend_from_slice(&[0x21, 0xF9, 0x04, 0x00, 5, 0, 0, 0x00]);
        bytes.extend_from_slice(&[0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0x00]);
        bytes.extend_from_slice(&[0x02, 0x02, 0x44, 0x01, 0x00]);
    }
    bytes.push(0x3B);
    bytes
}

#[test]
fn decode_applies_exif_orientation() {
    let source = RgbImage::from_fn(40, 20, |x, y| {
        image::Rgb(if x < 10 && y < 10 { RED } else { BLUE })
    });
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 95)
        .encode_image(&source)
        .unwrap();
    let mut oriented = jpeg[..2].to_vec();
    oriented.extend(exif_orientation_segment(6));
    oriented.extend_from_slice(&jpeg[2..]);

    let decoded = decode(&oriented).unwrap();

    assert_eq!((decoded.width, decoded.height), (20, 40));
    let image = RgbaImage::from_raw(decoded.width, decoded.height, decoded.pixels).unwrap();
    let pixel = |x, y| {
        let [r, g, b, _] = image.get_pixel(x, y).0;
        [r, g, b]
    };
    assert!(close_to(pixel(16, 3), RED));
    assert!(close_to(pixel(3, 3), BLUE));
    assert!(close_to(pixel(16, 36), BLUE));
}

#[test]
fn decode_keeps_alpha_and_webp_output_keeps_transparency() {
    let source = png(RgbaImage::from_fn(64, 64, |x, _| {
        if x < 32 {
            image::Rgba([0, 0, 0, 0])
        } else {
            image::Rgba([RED[0], RED[1], RED[2], 255])
        }
    }));

    let decoded = decode(&source).unwrap();
    assert_eq!(decoded.pixels[3], 0);
    assert_eq!(decoded.pixels[(32 * 64 + 63) * 4 + 3], 255);

    for size in [64, 48] {
        let webp = encode_webp(&decoded, size, size, 0.85).unwrap();
        let back = read_back(&webp);
        assert_eq!(back.dimensions(), (size, size));
        assert_eq!(back.get_pixel(2, size / 2)[3], 0);
        assert_eq!(back.get_pixel(size - 3, size / 2)[3], 255);
    }
}

#[test]
fn encode_webp_produces_the_requested_size() {
    let large = rgba(3000, 2000, |x, y| [(x / 12) as u8, (y / 8) as u8, 128, 255]);
    let resized = encode_webp(&large, 2560, 1707, 0.85).unwrap();
    assert_webp_file(&resized);
    assert_eq!(read_back(&resized).dimensions(), (2560, 1707));

    let small = rgba(300, 200, |x, y| [x as u8, y as u8, 64, 255]);
    let same = encode_webp(&small, 300, 200, 0.7).unwrap();
    assert_webp_file(&same);
    assert_eq!(read_back(&same).dimensions(), (300, 200));
}

#[test]
fn lower_quality_gives_a_smaller_file() {
    let mut next = noise(7);
    let pixels = (0..256 * 256).flat_map(|_| [next(), next(), next(), 255]);
    let image = Rgba {
        width: 256,
        height: 256,
        pixels: pixels.collect(),
    };

    let high = encode_webp(&image, 256, 256, 0.9).unwrap();
    let low = encode_webp(&image, 256, 256, 0.3).unwrap();

    assert!(low.len() < high.len());
}

#[test]
fn decode_rejects_too_many_pixels_from_the_header() {
    let bytes = truncated_png(10_000, 6_000);

    assert_eq!(decode(&bytes).unwrap_err(), CodecError::TooLarge);
    assert_eq!(
        decode_for_display(&bytes).unwrap_err(),
        CodecError::TooLarge
    );
}

#[test]
fn decode_rejects_unsupported_input() {
    let mut heic = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic".to_vec();
    heic.extend_from_slice(&[0; 64]);
    let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>"#;
    let mut next = noise(42);
    let random: Vec<u8> = (0..4096).map(|_| next()).collect();

    for bytes in [&heic[..], &svg[..], &random[..], &[][..]] {
        assert_eq!(decode(bytes).unwrap_err(), CodecError::Unsupported);
        assert_eq!(
            decode_for_display(bytes).unwrap_err(),
            CodecError::Unsupported
        );
    }
}

#[test]
fn encode_webp_rejects_invalid_arguments() {
    let image = rgba(4, 4, |_, _| [1, 2, 3, 255]);

    for (width, height, quality) in [
        (0, 4, 0.5),
        (4, 0, 0.5),
        (16_384, 4, 0.5),
        (4, 16_384, 0.5),
        (4, 4, f64::NAN),
        (4, 4, f64::INFINITY),
    ] {
        assert_eq!(
            encode_webp(&image, width, height, quality).unwrap_err(),
            CodecError::Invalid
        );
    }
    let short = Rgba {
        pixels: vec![0; 10],
        ..image.clone()
    };
    assert_eq!(
        encode_webp(&short, 4, 4, 0.5).unwrap_err(),
        CodecError::Invalid
    );

    assert_webp_file(&encode_webp(&image, 4, 4, 1.5).unwrap());
    assert_webp_file(&encode_webp(&image, 4, 4, -1.0).unwrap());
}

#[test]
fn decode_for_display_returns_gif_frames_with_delays() {
    let mut gif = Vec::new();
    {
        let mut encoder = GifEncoder::new(&mut gif);
        encoder.set_repeat(Repeat::Infinite).unwrap();
        let frames = [
            ([255, 0, 0, 255], 0),
            ([0, 255, 0, 255], 50),
            ([0, 0, 255, 255], 200),
        ]
        .map(|(color, delay)| {
            image::Frame::from_parts(
                RgbaImage::from_pixel(6, 4, image::Rgba(color)),
                0,
                0,
                Delay::from_numer_denom_ms(delay, 1),
            )
        });
        encoder.encode_frames(frames).unwrap();
    }

    let display = decode_for_display(&gif).unwrap();

    assert_eq!((display.width, display.height), (6, 4));
    let delays: Vec<u32> = display.frames.iter().map(|frame| frame.delay_ms).collect();
    assert_eq!(delays, [100, 50, 200]);
    let first_pixels: Vec<&[u8]> = display
        .frames
        .iter()
        .map(|frame| &frame.rgba[..4])
        .collect();
    assert_eq!(
        first_pixels,
        [&[255, 0, 0, 255][..], &[0, 255, 0, 255], &[0, 0, 255, 255]]
    );
    assert!(
        display
            .frames
            .iter()
            .all(|frame| frame.rgba.len() == 6 * 4 * 4)
    );
}

#[test]
fn decode_for_display_keeps_only_the_first_frame_of_a_huge_animation() {
    let gif = gif_of_tiny_frames(2048, 2048, 5);

    let display = decode_for_display(&gif).unwrap();

    assert_eq!((display.width, display.height), (2048, 2048));
    assert_eq!(display.frames.len(), 1);
}

#[test]
fn decode_for_display_returns_one_frame_for_a_still_webp() {
    let image = rgba(30, 20, |x, y| [x as u8 * 8, y as u8 * 12, 90, 255]);
    let webp = encode_webp(&image, 30, 20, 0.8).unwrap();

    let display = decode_for_display(&webp).unwrap();

    assert_eq!((display.width, display.height), (30, 20));
    assert_eq!(display.frames.len(), 1);
    assert_eq!(display.frames[0].rgba.len(), 30 * 20 * 4);
}
