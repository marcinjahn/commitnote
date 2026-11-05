mod common;

use std::io::Cursor;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use commitnote_core_api::fake::{
    FakeEncodedImage, FakeImageProfile, FakeProcessImage, FakeProcessImageParams,
    FakeProcessedImage,
};
use commitnote_core_runtime::{CoreRuntime, HostImageCodec, HostServices};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageFormat, RgbImage, RgbaImage};

use common::{block_on, start_fake};

const KIB: usize = 1024;

struct Fixture {
    runtime: CoreRuntime,
    codec: HostImageCodec,
}

impl Fixture {
    fn start() -> Self {
        let codec = HostImageCodec::default();
        let runtime = start_fake(HostServices {
            image_codec: Box::new(codec.clone()),
            ..HostServices::default()
        });
        Self { runtime, codec }
    }

    fn process(
        &self,
        bytes: &[u8],
        mime_type: &str,
        profile: FakeImageProfile,
    ) -> FakeProcessedImage {
        let result = block_on(
            self.runtime
                .request::<FakeProcessImage>(FakeProcessImageParams {
                    base64: STANDARD.encode(bytes),
                    mime_type: mime_type.to_owned(),
                    profile,
                }),
        )
        .expect("fake.processImage");
        assert_eq!(
            self.codec.live_handles(),
            0,
            "every decoded image is released"
        );
        result.result
    }

    fn encode(
        &self,
        bytes: &[u8],
        mime_type: &str,
        profile: FakeImageProfile,
    ) -> (FakeEncodedImage, Vec<u8>) {
        match self.process(bytes, mime_type, profile) {
            FakeProcessedImage::Encoded(image) => {
                assert_eq!(image.mime_type, "image/webp");
                let webp = STANDARD.decode(&image.base64).expect("base64 output");
                (image, webp)
            }
            FakeProcessedImage::Rejected { rejection } => panic!("rejected: {rejection}"),
        }
    }
}

fn png(image: RgbaImage) -> Vec<u8> {
    let mut bytes = Vec::new();
    DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .unwrap();
    bytes
}

fn read_webp(bytes: &[u8]) -> RgbaImage {
    image::load_from_memory_with_format(bytes, ImageFormat::WebP)
        .expect("a decodable WebP")
        .into_rgba8()
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

#[test]
fn a_large_png_is_scaled_down_for_each_profile() {
    let fixture = Fixture::start();
    let source = png(RgbaImage::from_fn(3000, 1500, |x, y| {
        image::Rgba([(x / 12) as u8, (y / 6) as u8, 128, 255])
    }));

    let (note, note_webp) = fixture.encode(&source, "image/png", FakeImageProfile::Note);
    let (share, share_webp) = fixture.encode(&source, "image/png", FakeImageProfile::Share);

    assert_eq!((note.width, note.height), (2560, 1280));
    assert!(note_webp.len() < 2 * KIB * KIB, "{} bytes", note_webp.len());
    assert_eq!(read_webp(&note_webp).dimensions(), (2560, 1280));
    assert_eq!((share.width, share.height), (1600, 800));
    assert!(share_webp.len() < 600 * KIB, "{} bytes", share_webp.len());
    assert_eq!(read_webp(&share_webp).dimensions(), (1600, 800));
}

#[test]
fn transparency_survives_the_round_trip() {
    let fixture = Fixture::start();
    let source = png(RgbaImage::from_fn(64, 64, |x, _| {
        image::Rgba(if x < 32 {
            [0, 0, 0, 0]
        } else {
            [200, 40, 40, 255]
        })
    }));

    let (image, webp) = fixture.encode(&source, "image/png", FakeImageProfile::Note);

    assert_eq!((image.width, image.height), (64, 64));
    let decoded = read_webp(&webp);
    assert_eq!(decoded.get_pixel(4, 32)[3], 0);
    assert_eq!(decoded.get_pixel(60, 32)[3], 255);
}

#[test]
fn exif_orientation_is_applied() {
    let fixture = Fixture::start();
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 90)
        .encode_image(&RgbImage::from_pixel(40, 20, image::Rgb([30, 30, 220])))
        .unwrap();
    let mut oriented = jpeg[..2].to_vec();
    oriented.extend(exif_orientation_segment(6));
    oriented.extend_from_slice(&jpeg[2..]);

    let (image, webp) = fixture.encode(&oriented, "image/jpeg", FakeImageProfile::Note);

    assert_eq!((image.width, image.height), (20, 40));
    assert_eq!(read_webp(&webp).dimensions(), (20, 40));
}

#[test]
fn heic_is_rejected_as_unsupported() {
    let fixture = Fixture::start();
    let mut heic = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic".to_vec();
    heic.extend_from_slice(&[0; 64]);

    let processed = fixture.process(&heic, "image/heic", FakeImageProfile::Note);

    assert_eq!(
        processed,
        FakeProcessedImage::Rejected {
            rejection: "unsupported".to_owned()
        }
    );
}
