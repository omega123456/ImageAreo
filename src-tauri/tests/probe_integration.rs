//! Dimension-probe + 256 MP pixel-budget guard behaviour (Phase 1).
//!
//! Covers: a header declaring > 256 MP causes `decode_to_cache` to reject before
//! any decode; `probe` returns correct dimensions for native + backend formats
//! and flags animated GIF/WebP; corrupt/truncated payloads return a structured
//! error (no panic); and the over-ceiling probe round-trips through `ProbedImage`.

mod common;

use std::path::Path;

use ::image::codecs::gif::{GifEncoder, Repeat};
use ::image::{DynamicImage, Frame, ImageFormat, Rgba, RgbaImage};
use common::TempImageDir;
use imageareo_lib::commands::ProbedImage;
use imageareo_lib::image::{self, probe, DecodeIntent, MAX_PIXELS};

fn fixture_image(width: u32, height: u32) -> DynamicImage {
    DynamicImage::ImageRgba8(RgbaImage::from_fn(width, height, |x, y| {
        Rgba([
            ((x + 1) * 17) as u8,
            ((y + 1) * 29) as u8,
            ((x + y + 1) * 13) as u8,
            u8::MAX,
        ])
    }))
}

/// Build a minimal BMP file whose header *declares* the given dimensions without
/// allocating any pixel data. `imagesize` reads width at offset 0x12 and height
/// at 0x16 (little-endian u32), so this lets us forge an over-ceiling header
/// cheaply (a real 20000x20000 BMP would be ~1.6 GB).
fn write_fake_bmp(path: &Path, width: u32, height: u32) {
    let mut header = vec![0u8; 0x1A];
    header[0] = b'B';
    header[1] = b'M';
    header[0x12..0x16].copy_from_slice(&width.to_le_bytes());
    header[0x16..0x1A].copy_from_slice(&height.to_le_bytes());
    std::fs::write(path, header).expect("fake bmp header should write");
}

fn write_animated_gif(path: &Path, frame_count: usize) {
    let mut buffer = Vec::new();
    {
        let mut encoder = GifEncoder::new(&mut buffer);
        encoder
            .set_repeat(Repeat::Infinite)
            .expect("repeat should set");
        for index in 0..frame_count {
            let shade = (index * 60) as u8;
            let image = RgbaImage::from_pixel(8, 8, Rgba([shade, shade, shade, u8::MAX]));
            encoder
                .encode_frame(Frame::new(image))
                .expect("frame should encode");
        }
    }
    std::fs::write(path, buffer).expect("animated gif should write");
}

#[test]
fn over_ceiling_header_rejects_decode_before_any_decode() {
    let dir = TempImageDir::new();
    // 20000 x 20000 = 400 MP, well over the 256 MP ceiling.
    let path = dir.path().join("huge.bmp");
    write_fake_bmp(&path, 20_000, 20_000);

    let err = image::decode_to_cache(&path, DecodeIntent::Display)
        .expect_err("over-ceiling image must be rejected");

    assert_eq!(err.code, "image_too_large");
    // No cache file is written for a rejected image (no decode performed).
    assert!(
        image::lookup_cached(&path, DecodeIntent::Display)
            .expect("lookup ok")
            .is_none(),
        "no decode should have occurred, so nothing is cached"
    );
}

#[test]
fn probe_flags_over_ceiling_and_round_trips_through_command_type() {
    let dir = TempImageDir::new();
    let path = dir.path().join("huge.bmp");
    write_fake_bmp(&path, 20_000, 20_000);

    let result = probe::probe(&path).expect("header probe should succeed");
    assert_eq!((result.width, result.height), (20_000, 20_000));
    assert_eq!(result.pixels, 400_000_000);
    assert!(result.exceeds_limit);
    assert!(!result.animated);

    let command: ProbedImage = result.into();
    assert!(command.exceeds_limit);
    assert_eq!(command.pixels, 400_000_000);
}

#[test]
fn probe_at_exactly_the_ceiling_is_not_over_limit() {
    let dir = TempImageDir::new();
    // 16384 x 16384 = 268,435,456 = MAX_PIXELS exactly (boundary: not over).
    let path = dir.path().join("ceiling.bmp");
    write_fake_bmp(&path, 16_384, 16_384);

    let result = probe::probe(&path).expect("probe should succeed");
    assert_eq!(result.pixels, MAX_PIXELS);
    assert!(!result.exceeds_limit, "exactly at the ceiling is allowed");
}

#[test]
fn probe_reports_correct_dimensions_for_native_and_backend_formats() {
    let dir = TempImageDir::new();

    // Native (PNG) + backend (TIFF) raster formats both read via the hybrid path.
    let png = dir.path().join("native.png");
    fixture_image(48, 32)
        .save_with_format(&png, ImageFormat::Png)
        .expect("png should write");
    let tiff = dir.path().join("backend.tiff");
    fixture_image(64, 40)
        .save_with_format(&tiff, ImageFormat::Tiff)
        .expect("tiff should write");

    let png_probe = probe::probe(&png).expect("png probe");
    assert_eq!((png_probe.width, png_probe.height), (48, 32));
    assert!(!png_probe.exceeds_limit);

    let tiff_probe = probe::probe(&tiff).expect("tiff probe");
    assert_eq!((tiff_probe.width, tiff_probe.height), (64, 40));
}

#[test]
fn probe_detects_animated_gif() {
    let dir = TempImageDir::new();
    let animated = dir.path().join("animated.gif");
    write_animated_gif(&animated, 3);
    let still = dir.path().join("still.gif");
    write_animated_gif(&still, 1);

    assert!(
        probe::probe(&animated).expect("animated gif probe").animated,
        "a multi-frame GIF must be flagged animated"
    );
    assert!(
        !probe::probe(&still).expect("still gif probe").animated,
        "a single-frame GIF is not animated"
    );
}

#[test]
fn probe_detects_animated_webp_chunk() {
    // Synthetic RIFF/WEBP container carrying a VP8X + ANIM chunk. Encoding a real
    // animated WebP is not supported by the `image` crate, so we exercise the
    // chunk scanner directly with a hand-built container.
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&0u32.to_le_bytes()); // file size (ignored by scanner)
    bytes.extend_from_slice(b"WEBP");
    // VP8X chunk (10 bytes payload).
    bytes.extend_from_slice(b"VP8X");
    bytes.extend_from_slice(&10u32.to_le_bytes());
    bytes.extend_from_slice(&[0u8; 10]);
    // ANIM chunk (6 bytes payload).
    bytes.extend_from_slice(b"ANIM");
    bytes.extend_from_slice(&6u32.to_le_bytes());
    bytes.extend_from_slice(&[0u8; 6]);

    assert!(probe::__test_support::has_webp_anim_chunk_for(&bytes));

    // A static WEBP container (single VP8 chunk) is not animated.
    let mut still = Vec::new();
    still.extend_from_slice(b"RIFF");
    still.extend_from_slice(&0u32.to_le_bytes());
    still.extend_from_slice(b"WEBP");
    still.extend_from_slice(b"VP8 ");
    still.extend_from_slice(&4u32.to_le_bytes());
    still.extend_from_slice(&[0u8; 4]);
    assert!(!probe::__test_support::has_webp_anim_chunk_for(&still));

    // Non-RIFF / short buffers are not animated (no panic).
    assert!(!probe::__test_support::has_webp_anim_chunk_for(b"not riff"));
    assert!(!probe::__test_support::has_webp_anim_chunk_for(&[]));
}

fn animated_webp_container() -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(b"WEBP");
    bytes.extend_from_slice(b"VP8X");
    bytes.extend_from_slice(&10u32.to_le_bytes());
    bytes.extend_from_slice(&[0u8; 10]);
    bytes.extend_from_slice(b"ANIM");
    bytes.extend_from_slice(&6u32.to_le_bytes());
    bytes.extend_from_slice(&[0u8; 6]);
    bytes
}

#[test]
fn probe_detects_animated_webp_file() {
    // Exercise the real file-reading path (`webp_is_animated` → `detect_animation`
    // → `probe`) against a `.webp` file, not just the in-memory chunk scanner.
    let dir = TempImageDir::new();
    let webp = dir.path().join("animated.webp");
    std::fs::write(&webp, animated_webp_container()).expect("animated webp should write");

    assert!(
        probe::__test_support::detect_animation_for(&webp),
        "an ANIM-chunk WebP file must be flagged animated"
    );
}

#[test]
fn detect_animation_returns_false_for_non_animatable_formats() {
    let dir = TempImageDir::new();
    let png = dir.path().join("static.png");
    fixture_image(10, 10)
        .save_with_format(&png, ImageFormat::Png)
        .expect("png should write");
    // PNG is never treated as animated by the probe.
    assert!(!probe::__test_support::detect_animation_for(&png));
}

#[test]
fn corrupt_payload_returns_structured_error_not_panic() {
    let dir = TempImageDir::new();

    // Garbage bytes with an image extension but no recognizable magic: neither
    // `imagesize` (no format match) nor `image::image_dimensions` can read a
    // header, so probe returns a structured error rather than panicking.
    let corrupt = dir.path().join("corrupt.png");
    std::fs::write(&corrupt, b"this is not an image file at all").expect("write corrupt");
    let err = probe::probe(&corrupt).expect_err("corrupt header must error");
    assert_eq!(err.code, "decode_failed");

    // A backend-format decode of a corrupt file still returns a structured error
    // (the probe preflight does not mask the decoder's own error).
    let corrupt_tiff = dir.path().join("corrupt.tiff");
    std::fs::write(&corrupt_tiff, b"II*\x00garbage").expect("write corrupt tiff");
    let decode_err = image::decode_to_cache(&corrupt_tiff, DecodeIntent::Display)
        .expect_err("corrupt tiff must error");
    assert!(
        !decode_err.code.is_empty(),
        "decode failure must be structured, got {decode_err:?}"
    );
}

#[test]
fn missing_file_returns_structured_error() {
    let path = Path::new("/nonexistent/imageareo/probe/missing.png");
    let err = probe::probe(path).expect_err("missing file must error");
    assert_eq!(err.code, "decode_failed");
}
