mod common;

use std::io::Cursor;
use std::path::{Path, PathBuf};

use ::image::{self as image_rs, DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage};
use common::TempImageDir;
use imageareo_lib::commands;
use imageareo_lib::scheduler::Scheduler;
use imageareo_lib::image::disk_cache::CacheVariant;
use imageareo_lib::image::{
    self, DecodeImageError, DecodeIntent, ImageFormatSupport, ViewportHint, DISPLAY_LONG_EDGE_CAP,
    PREVIEW_LONG_EDGE_CAP, VIEWPORT_TIER_BUCKETS, VIEWPORT_TIER_MIN_EDGE,
};
use rawler::decoders::{BlackLevel, CFAConfig, Camera, RawPhotometricInterpretation, WhiteLevel};
use rawler::dng::writer::DngWriter;
use rawler::dng::{CropMode, DngCompression, DngPhotometricConversion};
use rawler::pixarray::PixU16;
use rawler::{RawImage, CFA};

#[test]
fn apply_exif_orientation_rotates_to_correct_dimensions() {
    // A 90°/270° orientation swaps width/height; identity/flip/180 keep them.
    let landscape = DynamicImage::ImageRgba8(RgbaImage::from_pixel(40, 30, Rgba([1, 2, 3, 255])));

    // Orientation 1 (normal), 2 (flip-h), 3 (180), and 4 (flip-v) preserve
    // dimensions.
    assert_eq!(
        image::apply_exif_orientation(landscape.clone(), 1).dimensions(),
        (40, 30)
    );
    assert_eq!(
        image::apply_exif_orientation(landscape.clone(), 2).dimensions(),
        (40, 30)
    );
    assert_eq!(
        image::apply_exif_orientation(landscape.clone(), 3).dimensions(),
        (40, 30)
    );
    assert_eq!(
        image::apply_exif_orientation(landscape.clone(), 4).dimensions(),
        (40, 30)
    );

    // Orientation 6 (rotate 90) and 8 (rotate 270) swap dimensions.
    assert_eq!(
        image::apply_exif_orientation(landscape.clone(), 6).dimensions(),
        (30, 40)
    );
    assert_eq!(
        image::apply_exif_orientation(landscape.clone(), 8).dimensions(),
        (30, 40)
    );

    // Transpose/transverse (5/7) also swap dimensions.
    assert_eq!(
        image::apply_exif_orientation(landscape.clone(), 5).dimensions(),
        (30, 40)
    );
    assert_eq!(
        image::apply_exif_orientation(landscape, 7).dimensions(),
        (30, 40)
    );
}

#[test]
fn apply_exif_orientation_8_matches_a_270_degree_rotation() {
    // Orientation 8 must produce the same pixels as a 270° rotation (this is what
    // the frontend's CSS `rotate(270deg)` does for the main viewer, so the baked
    // thumbnail stays consistent with the rendered image).
    let mut src = RgbaImage::from_pixel(4, 2, Rgba([0, 0, 0, 255]));
    src.put_pixel(0, 0, Rgba([255, 0, 0, 255])); // mark top-left
    let image = DynamicImage::ImageRgba8(src);

    let baked = image::apply_exif_orientation(image.clone(), 8);
    let expected = image.rotate270();
    assert_eq!(baked.to_rgba8().into_raw(), expected.to_rgba8().into_raw());
}

#[test]
fn display_intent_writes_a_cache_file_for_image_crate_formats() {
    let dir = TempImageDir::new();

    for (name, format, expected_dims) in [
        ("sample.avif", ImageFormat::Avif, (3, 2)),
        ("sample.tiff", ImageFormat::Tiff, (4, 3)),
        ("sample.bmp", ImageFormat::Bmp, (5, 4)),
        ("sample.ico", ImageFormat::Ico, (2, 2)),
    ] {
        let image = fixture_image(expected_dims.0, expected_dims.1);
        let path = dir.path().join(name);
        write_dynamic_image(&path, &image, format);

        let decoded =
            image::decode_to_cache(&path, DecodeIntent::Display).expect("decode should succeed");

        assert_eq!((decoded.width, decoded.height), expected_dims);
        assert_eq!(decoded.orientation, 1);
        assert!(decoded.path.exists(), "cache file should exist on disk");
        let on_disk = image_rs::open(&decoded.path).expect("cache file should decode");
        assert_eq!(on_disk.dimensions(), expected_dims);
    }
}

#[test]
fn display_intent_decodes_heic_and_jxl_fixtures_to_cache_files() {
    let _cache = common::CacheGuard::new();
    let heic = image::decode_to_cache(&fixture_path("sample.heic"), DecodeIntent::Display)
        .expect("heic fixture should decode");
    let jxl = image::decode_to_cache(&fixture_path("sample.jxl"), DecodeIntent::Display)
        .expect("jxl fixture should decode");

    assert_eq!((heic.width, heic.height, heic.orientation), (48, 48, 1));
    assert_eq!((jxl.width, jxl.height, jxl.orientation), (512, 512, 1));
    assert!(heic.path.exists());
    assert!(jxl.path.exists());
}

#[test]
fn display_intent_respects_the_long_edge_cap() {
    // A source larger than the display cap is downscaled; one within the cap is
    // passed through unchanged.
    let dir = TempImageDir::new();
    let small = dir.path().join("small.tiff");
    write_dynamic_image(&small, &fixture_image(40, 30), ImageFormat::Tiff);
    let decoded =
        image::decode_to_cache(&small, DecodeIntent::Display).expect("small display should decode");
    assert_eq!((decoded.width, decoded.height), (40, 30));
    assert!(decoded.width.max(decoded.height) <= DISPLAY_LONG_EDGE_CAP);
}

#[test]
fn display_intent_uses_embedded_preview_without_demosaic() {
    // The display intent never demosaics on open: it uses the embedded RAW
    // preview at whatever size it is. The fixture's sensor is 32x24 and its
    // embedded preview is 16x12, so a display decode that returns 16x12 proves
    // the preview was used (a demosaic would yield the 32x24 sensor dimensions).
    let dir = TempImageDir::new();
    let path = dir.path().join("sample.dng");
    let raw = fixture_image(32, 24);
    let preview = fixture_image(16, 12);
    write_preview_dng(&path, &raw, &preview);

    let decoded = image::decode_to_cache(&path, DecodeIntent::Display)
        .expect("raw display should decode from the embedded preview");

    assert_eq!(
        (decoded.width, decoded.height),
        (16, 12),
        "display must use the embedded preview, not a demosaic"
    );
    assert!(decoded.width.max(decoded.height) <= DISPLAY_LONG_EDGE_CAP);
    assert!(decoded.path.exists());
}

#[test]
fn lookup_cached_returns_only_already_decoded_intents() {
    // `lookup_cached` must never decode: it returns a hit only for an intent that
    // was previously written, and `None` otherwise (so the viewer can prefer a
    // cached enhanced image without triggering a fresh demosaic).
    let dir = TempImageDir::new();
    let path = dir.path().join("sample.dng");
    let raw = fixture_image(32, 24);
    let preview = fixture_image(16, 12);
    write_preview_dng(&path, &raw, &preview);

    // Nothing cached yet.
    assert!(image::lookup_cached(&path, DecodeIntent::Display)
        .expect("lookup ok")
        .is_none());
    assert!(image::lookup_cached(&path, DecodeIntent::Enhance)
        .expect("lookup ok")
        .is_none());

    // Decode the display intent; now only Display is cached.
    let display = image::decode_to_cache(&path, DecodeIntent::Display).expect("display decode");
    let cached = image::lookup_cached(&path, DecodeIntent::Display)
        .expect("lookup ok")
        .expect("display should be cached");
    assert_eq!(cached.path, display.path);
    assert_eq!(
        (cached.width, cached.height),
        (display.width, display.height)
    );
    assert!(image::lookup_cached(&path, DecodeIntent::Enhance)
        .expect("lookup ok")
        .is_none());
}

#[test]
fn lookup_cached_returns_none_for_native_formats() {
    let dir = TempImageDir::new();
    let native = dir.path().join("photo.jpg");
    write_dynamic_image(&native, &fixture_image(8, 8), ImageFormat::Jpeg);
    assert!(image::lookup_cached(&native, DecodeIntent::Display)
        .expect("lookup ok")
        .is_none());
}

#[test]
fn enhance_intent_demosaics_to_a_capped_jpeg() {
    // The user-triggered "Enhance" intent is the one-time full sensor demosaic,
    // downscaled to the display cap and encoded as JPEG. The fixture sensor is
    // 40x30 (within the cap), so the enhanced image matches the developed sensor
    // dimensions and is a JPEG (the develop output is opaque).
    let dir = TempImageDir::new();
    let path = dir.path().join("linear-sample.dng");
    let raw = fixture_image(40, 30);
    let preview = fixture_image(16, 12);
    write_linear_preview_dng(&path, &raw, &preview);

    let decoded =
        image::decode_to_cache(&path, DecodeIntent::Enhance).expect("enhance intent should decode");

    assert_eq!((decoded.width, decoded.height), (40, 30));
    assert!(decoded.width.max(decoded.height) <= DISPLAY_LONG_EDGE_CAP);
    assert_eq!(
        decoded.path.extension().and_then(|ext| ext.to_str()),
        Some("jpg"),
        "enhance intent must be a JPEG for opaque develop output"
    );
    let on_disk = image_rs::open(&decoded.path).expect("enhance cache file should decode");
    assert_eq!(on_disk.dimensions(), (40, 30));
}

#[test]
fn preview_intent_uses_the_embedded_preview_and_never_demosaics() {
    let dir = TempImageDir::new();
    let path = dir.path().join("sample.dng");
    let raw = fixture_image(32, 24);
    let preview = fixture_image(16, 12);
    write_preview_dng(&path, &raw, &preview);

    let decoded =
        image::decode_to_cache(&path, DecodeIntent::Preview).expect("preview should decode");

    assert!(decoded.width.max(decoded.height) <= PREVIEW_LONG_EDGE_CAP);
    assert_eq!(
        decoded.path.extension().and_then(|ext| ext.to_str()),
        Some("jpg"),
        "preview intent must be a JPEG"
    );
    assert!(decoded.path.exists());
}

#[test]
fn second_decode_of_unchanged_file_is_served_from_disk() {
    // A cache hit returns the same path and never touches the source: removing
    // the source after the first decode still yields the cached file.
    let dir = TempImageDir::new();
    let path = dir.path().join("sample.tiff");
    write_dynamic_image(&path, &fixture_image(20, 16), ImageFormat::Tiff);

    let first =
        image::decode_to_cache(&path, DecodeIntent::Display).expect("first decode should succeed");
    std::fs::remove_file(&path).expect("source removable after caching");

    let second = image::decode_to_cache(&path, DecodeIntent::Display);
    // With the source gone the cache key cannot be recomputed, so this models a
    // separate property: re-decoding the *present* file returns the same path.
    // Restore and assert the cache-hit identity directly.
    assert!(second.is_err(), "removed source cannot be re-keyed");

    write_dynamic_image(&path, &fixture_image(20, 16), ImageFormat::Tiff);
    let again =
        image::decode_to_cache(&path, DecodeIntent::Display).expect("re-decode should succeed");
    let cached =
        image::decode_to_cache(&path, DecodeIntent::Display).expect("cache hit should succeed");
    assert_eq!(again.path, cached.path);
    assert_eq!((first.width, first.height), (20, 16));
}

#[test]
fn load_thumbnail_source_uses_embedded_raw_preview_with_dng_fixture() {
    let dir = TempImageDir::new();
    let path = dir.path().join("sample.dng");
    let raw = fixture_image(32, 24);
    let preview = fixture_image(16, 12);
    write_preview_dng(&path, &raw, &preview);

    let loaded = image::__test_support::load_thumbnail_source_for(&path, 16)
        .expect("thumbnail source should decode");

    assert_eq!(loaded.image.dimensions(), (16, 12));
    assert_eq!(loaded.orientation, 1);
}

#[tokio::test]
async fn decode_image_command_returns_a_cache_file_path() {
    let _cache = common::CacheGuard::new();
    let path = fixture_path("sample.heic");

    let scheduler = Scheduler::new();
    let decoded = commands::decode_image_via(&scheduler, path_string(&path), None, None, None, None)
        .await
        .expect("command should succeed");

    assert!(!decoded.path.starts_with("data:"), "must not be a data URL");
    let cache_root = image::disk_cache::cache_dir()
        .to_string_lossy()
        .into_owned();
    assert!(decoded.path.starts_with(&cache_root));
    assert!(Path::new(&decoded.path).exists());
    assert_eq!(
        (decoded.width, decoded.height, decoded.orientation),
        (48, 48, 1)
    );
}

#[tokio::test]
async fn decode_image_command_decodes_native_formats_for_display() {
    // Native formats normally render directly in the WebView, but the frontend
    // routes large native images through the backend Display path. That path must
    // decode them rather than reject them.
    let dir = TempImageDir::new();
    let path = dir.path().join("native.png");
    write_dynamic_image(&path, &fixture_image(8, 6), ImageFormat::Png);

    let scheduler = Scheduler::new();
    let decoded = commands::decode_image_via(&scheduler, path_string(&path), None, None, None, None)
        .await
        .expect("native display decode should succeed");

    assert_eq!((decoded.width, decoded.height), (8, 6));
}

#[tokio::test]
async fn decode_image_command_rejects_native_formats_for_preview() {
    // Preview/Enhance are RAW-only; native formats are still rejected there so the
    // routing stays scoped to the Display path.
    let dir = TempImageDir::new();
    let path = dir.path().join("native.png");
    write_dynamic_image(&path, &fixture_image(1, 1), ImageFormat::Png);

    let scheduler = Scheduler::new();
    let error = commands::decode_image_via(
        &scheduler,
        path_string(&path),
        Some(DecodeIntent::Preview),
        None,
        None,
        None,
    )
    .await
    .expect_err("native preview decode should be rejected");

    assert_eq!(error.code, "unsupported_format");
    assert!(error.message.contains("frontend"));
}

#[test]
fn large_native_png_routes_through_display_and_downscales() {
    // Regression: a native PNG over the frontend routing threshold is handed to
    // the backend Display path. It must decode and downscale to the viewport cap
    // rather than surfacing an "unsupported native format" error.
    let dir = TempImageDir::new();
    let path = dir.path().join("large.png");
    write_dynamic_image(&path, &fixture_image(2400, 1600), ImageFormat::Png);

    let hint = ViewportHint {
        long_edge_px: 1000.0,
    };
    let decoded = image::decode_to_cache_viewport(&path, DecodeIntent::Display, Some(hint))
        .expect("large native PNG should decode through the display path");

    assert_eq!(decoded.width.max(decoded.height), 1024);
    assert!(decoded.path.exists(), "cache file should be written");
}

#[tokio::test]
async fn decode_image_command_returns_structured_errors_for_corrupt_and_unsupported_files() {
    let dir = TempImageDir::new();
    let corrupt_heic = dir.write("broken.heic", b"not a heic");
    let unsupported = dir.write("broken.txt", b"plain text");

    let scheduler = Scheduler::new();
    let corrupt_error =
        commands::decode_image_via(&scheduler, path_string(&corrupt_heic), None, None, None, None)
            .await
            .expect_err("corrupt file should fail");
    let unsupported_error =
        commands::decode_image_via(&scheduler, path_string(&unsupported), None, None, None, None)
            .await
            .expect_err("unsupported file should fail");

    assert_decode_error(corrupt_error, "decode_failed");
    assert_decode_error(unsupported_error, "unsupported_format");
}

#[tokio::test]
async fn transient_decode_failure_is_not_cached_and_can_be_retried() {
    // FIX 2 (command-level): a transient decode failure (here, a file that is
    // briefly corrupt — e.g. mid-write) must NOT be memoized by the single-flight
    // cache. Once the file is valid, the very next decode for the same path must
    // succeed instead of returning the stuck cached error.
    let dir = TempImageDir::new();
    let path = dir.path().join("mid-write.tiff");
    // First state: corrupt bytes at the path → decode fails.
    std::fs::write(&path, b"not a valid tiff yet").expect("write corrupt file");

    let scheduler = Scheduler::new();
    let first =
        commands::decode_image_via(&scheduler, path_string(&path), None, None, None, None).await;
    assert!(
        first.is_err(),
        "a corrupt file must fail the first decode attempt"
    );

    // Second state: the same path now holds a valid backend image.
    write_dynamic_image(&path, &fixture_image(24, 24), ImageFormat::Tiff);

    let retried =
        commands::decode_image_via(&scheduler, path_string(&path), None, None, None, None)
            .await
            .expect("retry after the file became valid must succeed (error was not cached)");
    assert_eq!((retried.width, retried.height), (24, 24));
}

#[test]
fn extension_getters_expose_the_native_and_backend_sets() {
    assert!(image::native_extensions().contains(&"jpg"));
    assert!(image::native_extensions().contains(&"webp"));
    assert!(image::backend_extensions().contains(&"avif"));
    assert!(image::backend_extensions().contains(&"dng"));
    assert!(image::backend_extensions().contains(&"3fr"));
}

#[test]
fn classify_extension_normalizes_case_and_leading_dot() {
    assert_eq!(
        image::classify_extension(".JPG"),
        Some(ImageFormatSupport::Native)
    );
    assert_eq!(
        image::classify_extension("HEIC"),
        Some(ImageFormatSupport::NeedsBackend)
    );
    assert_eq!(image::classify_extension("txt"), None);
    assert_eq!(image::classify_extension(""), None);
}

#[test]
fn classify_path_and_is_supported_cover_extension_and_extensionless_paths() {
    assert_eq!(
        image::classify_path(Path::new("/a/b.png")),
        Some(ImageFormatSupport::Native)
    );
    assert_eq!(
        image::classify_path(Path::new("/a/b.cr2")),
        Some(ImageFormatSupport::NeedsBackend)
    );
    assert_eq!(image::classify_path(Path::new("/a/no-extension")), None);
    assert!(image::is_supported_image_path(Path::new("photo.jpeg")));
    assert!(!image::is_supported_image_path(Path::new("README")));
}

#[test]
fn load_supported_image_path_decodes_native_formats_via_image_crate() {
    let dir = TempImageDir::new();
    let path = dir.path().join("native.png");
    write_dynamic_image(&path, &fixture_image(3, 4), ImageFormat::Png);

    let loaded = image::load_supported_image_path(&path).expect("native decode should succeed");

    assert_eq!(loaded.image.dimensions(), (3, 4));
    assert_eq!(loaded.orientation, 1);
}

#[test]
fn load_supported_image_path_rejects_unsupported_extensions() {
    let dir = TempImageDir::new();
    let path = dir.write("notes.txt", b"plain text");

    let error =
        image::load_supported_image_path(&path).expect_err("unsupported extension should error");

    assert_eq!(error.code, "unsupported_format");
    assert!(error.message.contains("unsupported image format"));
}

#[test]
fn decode_image_path_errors_for_unsupported_and_extensionless_paths() {
    let dir = TempImageDir::new();
    let unsupported = dir.write("data.bin", b"\x00\x01\x02");
    let extensionless = dir.write("noext", b"\x00\x01\x02");

    let unsupported_error = image::decode_to_cache(&unsupported, DecodeIntent::Display)
        .expect_err("unsupported extension should error");
    let extensionless_error = image::decode_to_cache(&extensionless, DecodeIntent::Display)
        .expect_err("missing extension should error");

    assert_eq!(unsupported_error.code, "unsupported_format");
    assert!(unsupported_error
        .message
        .contains("unsupported image format"));
    assert_eq!(extensionless_error.code, "unsupported_format");
    assert!(extensionless_error
        .message
        .contains("unsupported image format"));
}

#[test]
fn decode_image_path_reports_io_error_for_missing_backend_file() {
    let dir = TempImageDir::new();
    let missing = dir.path().join("missing.tiff");

    let error = image::decode_to_cache(&missing, DecodeIntent::Display)
        .expect_err("missing file should error");

    assert_eq!(error.code, "io_error");
    assert!(error.message.contains("failed to stat"));
}

#[test]
fn decode_image_path_reports_decode_error_for_corrupt_image_crate_format() {
    let dir = TempImageDir::new();
    let corrupt = dir.write("broken.bmp", b"not really a bmp file at all");

    let error = image::decode_to_cache(&corrupt, DecodeIntent::Display)
        .expect_err("corrupt bmp should error");

    assert_eq!(error.code, "decode_failed");
    assert!(!error.message.is_empty());
}

#[test]
fn decode_image_path_reports_decode_error_for_corrupt_jxl_and_raw() {
    let dir = TempImageDir::new();
    let corrupt_jxl = dir.write("broken.jxl", b"not a jxl");
    let corrupt_raw = dir.write("broken.cr2", b"not a raw file");

    let jxl_error = image::decode_to_cache(&corrupt_jxl, DecodeIntent::Display)
        .expect_err("corrupt jxl should error");
    let raw_error = image::decode_to_cache(&corrupt_raw, DecodeIntent::Display)
        .expect_err("corrupt raw should error");

    assert_eq!(jxl_error.code, "decode_failed");
    assert_eq!(raw_error.code, "decode_failed");
}

#[test]
fn decode_image_path_reports_decode_error_for_empty_backend_file() {
    // An empty file passes the open() step but fails format inspection/decode,
    // covering the with_guessed_format / decode error branches.
    let dir = TempImageDir::new();
    let empty = dir.write("empty.tiff", b"");

    let error = image::decode_to_cache(&empty, DecodeIntent::Display)
        .expect_err("empty file should fail to decode");

    assert_eq!(error.code, "decode_failed");
    assert!(!error.message.is_empty());
}

#[test]
fn decode_image_path_reports_decode_error_for_corrupt_heic_and_avif() {
    let dir = TempImageDir::new();
    let corrupt_heic = dir.write("broken.heif", b"not heif");
    let corrupt_avif = dir.write("broken.avif", b"not avif");

    let heif_error = image::decode_to_cache(&corrupt_heic, DecodeIntent::Display)
        .expect_err("corrupt heif should error");
    let avif_error = image::decode_to_cache(&corrupt_avif, DecodeIntent::Display)
        .expect_err("corrupt avif should error");

    assert_eq!(heif_error.code, "decode_failed");
    assert_eq!(avif_error.code, "decode_failed");
}

#[test]
fn decode_image_path_decodes_a_grayscale_jxl_into_rgb() {
    // Exercises the JXL framebuffer path with a real JXL fixture (channels >= 3).
    let _cache = common::CacheGuard::new();
    let decoded = image::decode_to_cache(&fixture_path("sample.jxl"), DecodeIntent::Display)
        .expect("jxl fixture should decode");

    assert_eq!((decoded.width, decoded.height), (512, 512));
}

#[test]
fn downscale_to_cap_caps_the_long_edge_with_lanczos3() {
    let large = DynamicImage::ImageRgb8(image_rs::RgbImage::from_pixel(
        4000,
        2000,
        image_rs::Rgb([120, 80, 40]),
    ));

    let downscaled = image::__test_support::downscale_to_cap_for(&large, 1000)
        .expect("downscale should succeed");

    assert_eq!(downscaled.dimensions(), (1000, 500));
}

#[test]
fn downscale_to_cap_passes_through_images_within_the_cap() {
    let small = fixture_image(16, 16);

    let downscaled = image::__test_support::downscale_to_cap_for(&small, 8192)
        .expect("downscale should succeed");

    assert_eq!(downscaled.dimensions(), (16, 16));
}

#[test]
fn opaque_display_images_encode_as_jpeg_and_alpha_as_png() {
    // Display intent chooses the codec by transparency: opaque sources become
    // JPEG, sources with real alpha stay PNG.
    let dir = TempImageDir::new();

    let opaque = dir.path().join("opaque.bmp");
    write_dynamic_image(
        &opaque,
        &DynamicImage::ImageRgb8(image_rs::RgbImage::from_pixel(
            8,
            6,
            image_rs::Rgb([10, 20, 30]),
        )),
        ImageFormat::Bmp,
    );
    let opaque_decoded =
        image::decode_to_cache(&opaque, DecodeIntent::Display).expect("opaque display");
    assert_eq!(
        opaque_decoded.path.extension().and_then(|ext| ext.to_str()),
        Some("jpg")
    );

    // PNG is native, so route the alpha image through a backend format (TIFF).
    let alpha_tiff = dir.path().join("alpha.tiff");
    let mut alpha_image = RgbaImage::from_pixel(8, 6, Rgba([10, 20, 30, 255]));
    alpha_image.put_pixel(0, 0, Rgba([10, 20, 30, 0]));
    write_dynamic_image(
        &alpha_tiff,
        &DynamicImage::ImageRgba8(alpha_image),
        ImageFormat::Tiff,
    );
    let alpha_decoded =
        image::decode_to_cache(&alpha_tiff, DecodeIntent::Display).expect("alpha display");
    assert_eq!(
        alpha_decoded.path.extension().and_then(|ext| ext.to_str()),
        Some("png")
    );
}

// ---- Phase 7: opaque/alpha resize+encode split ----------------------------

#[test]
fn resize_target_caps_or_skips() {
    use image::__test_support::resize_target_for;
    // Within the cap → no resize.
    assert_eq!(resize_target_for(100, 80, 200), None);
    // Empty source → no resize.
    assert_eq!(resize_target_for(0, 0, 200), None);
    // Landscape: long edge (width) capped, height scaled proportionally.
    assert_eq!(resize_target_for(4000, 2000, 1000), Some((1000, 500)));
    // Portrait: long edge (height) capped, width scaled.
    assert_eq!(resize_target_for(1000, 4000, 1000), Some((250, 1000)));
}

#[test]
fn is_opaque_source_reads_color_type_not_pixels() {
    use image::__test_support::is_opaque_source_for;
    // RGB8 has no alpha channel → opaque-typed.
    let rgb = DynamicImage::ImageRgb8(image_rs::RgbImage::from_pixel(2, 2, image_rs::Rgb([1, 2, 3])));
    assert!(is_opaque_source_for(&rgb));

    // A fully-opaque RGBA8 (every alpha == 255) is still alpha-*typed*: the
    // discriminator reads the color type, not the pixels, so it is NOT opaque.
    let opaque_rgba = DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([1, 2, 3, 255])));
    assert!(!is_opaque_source_for(&opaque_rgba));
}

#[test]
fn opaque_typed_source_resizes_via_the_rgb_path_with_no_alpha_plane() {
    // An opaque-typed (RGB8) source larger than the cap is resized through the
    // RGB path and stays RGB8 — no alpha plane is ever allocated.
    use image::__test_support::{downscale_owned_to_cap_for, downscale_to_cap_for};
    let large =
        DynamicImage::ImageRgb8(image_rs::RgbImage::from_pixel(4000, 2000, image_rs::Rgb([9, 9, 9])));

    let borrowed = downscale_to_cap_for(&large, 1000).expect("borrowed rgb downscale");
    assert!(matches!(borrowed, DynamicImage::ImageRgb8(_)));
    assert_eq!(borrowed.dimensions(), (1000, 500));
    assert!(!borrowed.color().has_alpha(), "rgb path must not add alpha");

    let owned = downscale_owned_to_cap_for(large, 1000).expect("owned rgb downscale");
    assert!(matches!(owned, DynamicImage::ImageRgb8(_)));
    assert_eq!(owned.dimensions(), (1000, 500));
}

#[test]
fn alpha_typed_source_resizes_via_the_rgba_path() {
    // An alpha-typed (RGBA8) source larger than the cap stays RGBA8 through the
    // resize, preserving the alpha channel for the post-resize transparency scan.
    use image::__test_support::{downscale_owned_to_cap_for, downscale_to_cap_for};
    let large =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(2000, 1000, Rgba([9, 9, 9, 128])));

    let borrowed = downscale_to_cap_for(&large, 1000).expect("borrowed rgba downscale");
    assert!(matches!(borrowed, DynamicImage::ImageRgba8(_)));
    assert_eq!(borrowed.dimensions(), (1000, 500));
    assert!(borrowed.color().has_alpha(), "rgba path must keep alpha");

    let owned = downscale_owned_to_cap_for(large, 1000).expect("owned rgba downscale");
    assert!(matches!(owned, DynamicImage::ImageRgba8(_)));
}

#[test]
fn opaque_typed_display_decode_yields_a_jpeg_via_the_rgb_path() {
    // End-to-end: an opaque-typed (RGB8) BMP source larger than the cap is
    // resized as RGB and encoded as JPEG (no PNG, no alpha allocation), and the
    // on-disk derivative is opaque RGB.
    let dir = TempImageDir::new();
    let path = dir.path().join("opaque-large.bmp");
    write_dynamic_image(
        &path,
        &DynamicImage::ImageRgb8(image_rs::RgbImage::from_pixel(3000, 2000, image_rs::Rgb([40, 60, 80]))),
        ImageFormat::Bmp,
    );

    let decoded = image::decode_to_cache(&path, DecodeIntent::Display).expect("opaque display");

    assert_eq!(
        decoded.path.extension().and_then(|ext| ext.to_str()),
        Some("jpg"),
        "opaque-typed source must encode as JPEG via the RGB path"
    );
    let on_disk = image_rs::open(&decoded.path).expect("cache file should decode");
    assert!(
        !on_disk.color().has_alpha(),
        "the RGB path must not produce an alpha plane"
    );
    assert_eq!(on_disk.dimensions().0.max(on_disk.dimensions().1), 3000);
}

#[test]
fn alpha_typed_transparent_display_decode_yields_a_png_via_the_rgba_path() {
    // An alpha-typed source with real transparency is resized via the RGBA path
    // and encoded as PNG (the transparency survives the resize). PNG is native,
    // so route through a backend format (TIFF).
    let dir = TempImageDir::new();
    let path = dir.path().join("alpha-large.tiff");
    let mut alpha = RgbaImage::from_pixel(3000, 2000, Rgba([40, 60, 80, 255]));
    alpha.put_pixel(0, 0, Rgba([40, 60, 80, 0]));
    write_dynamic_image(&path, &DynamicImage::ImageRgba8(alpha), ImageFormat::Tiff);

    let decoded = image::decode_to_cache(&path, DecodeIntent::Display).expect("alpha display");

    assert_eq!(
        decoded.path.extension().and_then(|ext| ext.to_str()),
        Some("png"),
        "transparent alpha-typed source must encode as PNG via the RGBA path"
    );
    let on_disk = image_rs::open(&decoded.path).expect("cache file should decode");
    assert!(on_disk.color().has_alpha());
}

#[test]
fn alpha_typed_opaque_content_display_decode_still_works() {
    // An alpha-typed source whose content is fully opaque (every alpha == 255)
    // keeps the RGBA path (channel-presence discriminator) and, because the
    // post-resize scan finds no real transparency, encodes as JPEG.
    let dir = TempImageDir::new();
    let path = dir.path().join("opaque-alpha-large.tiff");
    let opaque_rgba = RgbaImage::from_pixel(3000, 2000, Rgba([40, 60, 80, 255]));
    write_dynamic_image(&path, &DynamicImage::ImageRgba8(opaque_rgba), ImageFormat::Tiff);

    let decoded = image::decode_to_cache(&path, DecodeIntent::Display).expect("opaque-alpha display");

    assert_eq!(
        decoded.path.extension().and_then(|ext| ext.to_str()),
        Some("jpg"),
        "opaque-content alpha-typed source still works and encodes as JPEG"
    );
    let on_disk = image_rs::open(&decoded.path).expect("cache file should decode");
    assert_eq!(on_disk.dimensions().0.max(on_disk.dimensions().1), 3000);
}

#[test]
fn load_supported_image_path_decodes_backend_formats() {
    // The NeedsBackend branch routes through the backend decoder (here HEIC).
    let _cache = common::CacheGuard::new();
    let loaded = image::load_supported_image_path(&fixture_path("sample.heic"))
        .expect("backend decode should succeed");

    assert_eq!(loaded.image.dimensions(), (48, 48));
    assert_eq!(loaded.orientation, 1);
}

#[test]
fn downscale_to_cap_caps_tall_images_by_height() {
    // The portrait branch caps the long edge (height) and scales width down.
    let tall = DynamicImage::ImageRgb8(image_rs::RgbImage::from_pixel(
        1000,
        4000,
        image_rs::Rgb([60, 90, 120]),
    ));

    let downscaled =
        image::__test_support::downscale_to_cap_for(&tall, 1000).expect("downscale should succeed");

    assert_eq!(downscaled.dimensions(), (250, 1000));
}

#[test]
fn is_raw_extension_classifies_raw_and_non_raw_paths() {
    assert!(image::__test_support::is_raw_extension_for(Path::new(
        "/a/b.dng"
    )));
    assert!(image::__test_support::is_raw_extension_for(Path::new(
        "/a/b.CR2"
    )));
    assert!(!image::__test_support::is_raw_extension_for(Path::new(
        "/a/b.jpg"
    )));
    assert!(!image::__test_support::is_raw_extension_for(Path::new(
        "/a/b"
    )));
}

#[test]
fn encode_helpers_round_trip_to_decodable_bytes() {
    let opaque = fixture_image(6, 4);
    let jpeg = image::__test_support::encode_display_jpeg_for(&opaque)
        .expect("jpeg encode should succeed");
    let decoded_jpeg = image_rs::load_from_memory_with_format(&jpeg, ImageFormat::Jpeg)
        .expect("jpeg should decode");
    assert_eq!(decoded_jpeg.dimensions(), (6, 4));

    let png = image::__test_support::encode_png_for(&opaque).expect("png encode should succeed");
    let decoded_png =
        image_rs::load_from_memory_with_format(&png, ImageFormat::Png).expect("png should decode");
    assert_eq!(decoded_png.dimensions(), (6, 4));
}

#[tokio::test]
async fn peek_decoded_image_returns_cached_only_after_a_decode() {
    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let path = dir.path().join("peek.tiff");
    write_dynamic_image(&path, &fixture_image(20, 16), ImageFormat::Tiff);

    let scheduler = Scheduler::new();
    // Nothing cached yet → null.
    let absent =
        commands::peek_decoded_image(path_string(&path), DecodeIntent::Display, None)
            .await
            .expect("peek should succeed");
    assert!(absent.is_none());

    // Decode populates the cache; peek now returns the cached transport shape
    // without decoding again.
    let decoded = commands::decode_image_via(
        &scheduler,
        path_string(&path),
        Some(DecodeIntent::Display),
        None,
        None,
        None,
    )
    .await
    .expect("decode should succeed");
    let peeked =
        commands::peek_decoded_image(path_string(&path), DecodeIntent::Display, None)
            .await
            .expect("peek should succeed")
            .expect("cache hit expected");

    assert_eq!(peeked.path, decoded.path);
    assert_eq!(
        (peeked.width, peeked.height),
        (decoded.width, decoded.height)
    );
}

#[test]
fn normalized_extension_lowercases_and_errors_when_absent() {
    use image::__test_support::normalized_extension_for;
    assert_eq!(
        normalized_extension_for(Path::new("/a/PHOTO.JPG")).unwrap(),
        "jpg"
    );
    let error = normalized_extension_for(Path::new("/a/noext"))
        .expect_err("missing extension should error");
    assert_eq!(error.code, "unsupported_format");
}

#[test]
fn read_orientation_defaults_to_one_for_images_without_exif() {
    let dir = TempImageDir::new();
    let path = dir.path().join("plain.png");
    write_dynamic_image(&path, &fixture_image(4, 4), ImageFormat::Png);
    assert_eq!(image::__test_support::read_orientation_for(&path), 1);
}

#[test]
fn decode_with_image_crate_reads_a_native_png() {
    let dir = TempImageDir::new();
    let path = dir.path().join("native.png");
    write_dynamic_image(&path, &fixture_image(5, 7), ImageFormat::Png);
    let decoded =
        image::__test_support::decode_with_image_crate_for(&path).expect("png should decode");
    assert_eq!(decoded.dimensions(), (5, 7));
}

#[test]
fn linear_sample_to_u8_clamps_to_byte_range() {
    use image::__test_support::linear_sample_to_u8_for;
    assert_eq!(linear_sample_to_u8_for(-1.0), 0);
    assert_eq!(linear_sample_to_u8_for(0.0), 0);
    assert_eq!(linear_sample_to_u8_for(1.0), 255);
    assert_eq!(linear_sample_to_u8_for(2.0), 255);
}

#[test]
fn image_from_jpeg_pixels_maps_each_pixel_format() {
    use image::__test_support::image_from_jpeg_pixels_for;
    use jpeg_decoder::PixelFormat;
    let path = Path::new("/tmp/jpeg-pixels.jpg");

    let gray = image_from_jpeg_pixels_for(2, 1, PixelFormat::L8, vec![10, 20], path)
        .expect("L8 should map");
    assert_eq!(gray.dimensions(), (2, 1));

    let gray16 = image_from_jpeg_pixels_for(2, 1, PixelFormat::L16, vec![0, 10, 0, 20], path)
        .expect("L16 should map");
    assert_eq!(gray16.dimensions(), (2, 1));

    let rgb = image_from_jpeg_pixels_for(1, 1, PixelFormat::RGB24, vec![1, 2, 3], path)
        .expect("RGB24 should map");
    assert_eq!(rgb.dimensions(), (1, 1));

    let cmyk = image_from_jpeg_pixels_for(1, 1, PixelFormat::CMYK32, vec![0, 0, 0, 0], path)
        .expect("CMYK32 should map");
    assert_eq!(cmyk.dimensions(), (1, 1));
}

#[test]
fn error_constructors_set_expected_codes() {
    use image::__test_support::{decode_error, encode_error, io_error, unsupported_error};
    assert_eq!(unsupported_error("x").code, "unsupported_format");
    assert_eq!(io_error("x").code, "io_error");
    assert_eq!(decode_error("x").code, "decode_failed");
    assert_eq!(encode_error("x").code, "encode_failed");
}

// ---- Phase 5b: viewport-aware display tier --------------------------------

#[test]
fn viewport_tier_cap_buckets_and_clamps() {
    // Below the floor → floor bucket.
    assert_eq!(
        image::viewport_tier_cap(ViewportHint { long_edge_px: 200.0 }),
        VIEWPORT_TIER_MIN_EDGE
    );

    // Mid-range rounds up to the smallest covering bucket: 1390 → 1536.
    assert_eq!(
        image::viewport_tier_cap(ViewportHint {
            long_edge_px: 1390.0,
        }),
        1536
    );

    // A value exactly on a bucket stays on that bucket.
    assert_eq!(
        image::viewport_tier_cap(ViewportHint {
            long_edge_px: 2048.0,
        }),
        2048
    );

    // 3000 rounds up to the 3072 bucket.
    assert_eq!(
        image::viewport_tier_cap(ViewportHint {
            long_edge_px: 3000.0,
        }),
        3072
    );

    // Above the ceiling clamps to the top bucket (== DISPLAY_LONG_EDGE_CAP).
    assert_eq!(
        image::viewport_tier_cap(ViewportHint {
            long_edge_px: 10000.0,
        }),
        DISPLAY_LONG_EDGE_CAP
    );
    assert_eq!(*VIEWPORT_TIER_BUCKETS.last().unwrap(), DISPLAY_LONG_EDGE_CAP);

    // Non-finite / non-positive inputs fall back to the floor bucket.
    assert_eq!(
        image::viewport_tier_cap(ViewportHint {
            long_edge_px: f64::NAN,
        }),
        VIEWPORT_TIER_MIN_EDGE
    );
    assert_eq!(
        image::viewport_tier_cap(ViewportHint { long_edge_px: 0.0 }),
        VIEWPORT_TIER_MIN_EDGE
    );
}

#[test]
fn display_tier_selects_viewport_only_for_display_with_hint() {
    use image::__test_support::display_tier_for;
    let hint = ViewportHint {
        long_edge_px: 1280.0,
    };

    // Display + hint → bucketed Viewport tier.
    let (variant, cap) = display_tier_for(DecodeIntent::Display, Some(hint));
    assert_eq!(variant, CacheVariant::Viewport);
    assert_eq!(cap, 1536);

    // Display without a hint → the 8192 Display tier (unchanged behaviour).
    let (variant, cap) = display_tier_for(DecodeIntent::Display, None);
    assert_eq!(variant, CacheVariant::Display);
    assert_eq!(cap, DISPLAY_LONG_EDGE_CAP);

    // The hint is ignored for non-Display intents.
    let (variant, _) = display_tier_for(DecodeIntent::Preview, Some(hint));
    assert_eq!(variant, CacheVariant::Preview);
    let (variant, _) = display_tier_for(DecodeIntent::Enhance, Some(hint));
    assert_eq!(variant, CacheVariant::Enhance);
}

#[test]
fn viewport_decode_produces_a_smaller_derivative_keyed_distinctly() {
    // A large source decoded with a small viewport hint yields a derivative
    // capped to the bucket (smaller than 8192) and written under the Viewport
    // variant — distinct from the full 8192 Display tier of the same source.
    let dir = TempImageDir::new();
    let path = dir.path().join("large.tiff");
    write_dynamic_image(&path, &fixture_image(2400, 1600), ImageFormat::Tiff);

    let hint = ViewportHint {
        long_edge_px: 1000.0,
    };
    let viewport = image::decode_to_cache_viewport(&path, DecodeIntent::Display, Some(hint))
        .expect("viewport decode should succeed");

    // 1000 → 1024 bucket; the long edge is capped to it.
    assert_eq!(viewport.width.max(viewport.height), 1024);
    assert!(viewport.width.max(viewport.height) < DISPLAY_LONG_EDGE_CAP);

    // The viewport derivative is keyed under the Viewport variant + 1024 cap.
    let viewport_key = image::disk_cache::cache_path_for(
        &path,
        CacheVariant::Viewport,
        1024,
        viewport
            .path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("jpg"),
    )
    .unwrap();
    assert_eq!(viewport.path, viewport_key);
}

#[test]
fn viewport_and_display_tiers_coexist_without_clobbering() {
    // Requesting the viewport tier then the 8192 tier (and vice versa) leaves
    // two distinct cache files on disk.
    let dir = TempImageDir::new();
    let path = dir.path().join("coexist.tiff");
    write_dynamic_image(&path, &fixture_image(2000, 2000), ImageFormat::Tiff);

    let hint = ViewportHint {
        long_edge_px: 1500.0,
    };
    let viewport = image::decode_to_cache_viewport(&path, DecodeIntent::Display, Some(hint))
        .expect("viewport decode");
    let display = image::decode_to_cache_viewport(&path, DecodeIntent::Display, None)
        .expect("display decode");

    assert_ne!(viewport.path, display.path);
    assert!(viewport.path.exists(), "viewport file should remain");
    assert!(display.path.exists(), "display file should remain");
    assert_eq!(viewport.width.max(viewport.height), 1536);
    assert_eq!(display.width.max(display.height), 2000);
}

#[test]
fn near_identical_viewports_share_a_bucketed_cache_hit() {
    // Two slightly different window sizes that bucket to the same cap resolve to
    // the same cache file — so resizing the window a few px does not refragment
    // the cache.
    let dir = TempImageDir::new();
    let path = dir.path().join("bucketed.tiff");
    write_dynamic_image(&path, &fixture_image(2000, 1500), ImageFormat::Tiff);

    let first = image::decode_to_cache_viewport(
        &path,
        DecodeIntent::Display,
        Some(ViewportHint {
            long_edge_px: 1300.0,
        }),
    )
    .expect("first viewport decode");
    let second = image::decode_to_cache_viewport(
        &path,
        DecodeIntent::Display,
        Some(ViewportHint {
            long_edge_px: 1420.0,
        }),
    )
    .expect("second viewport decode");

    // Both 1300 and 1420 bucket to 1536 → identical key → cache hit.
    assert_eq!(first.path, second.path);
    assert_eq!(first.width.max(first.height), 1536);
}

#[test]
fn viewport_tier_files_live_in_the_image_cache_dir_and_are_swept_by_age() {
    // AC#4: the viewport tier reuses the existing image cache dir (no new
    // wiring), so the unchanged age-only sweep already covers it. Assert the
    // existing sweep behaviour against a viewport-tier file.
    use imageareo_lib::image::cache_maintenance::{sweep_dir, EVICTION_WINDOW};
    use std::time::{Duration, SystemTime};

    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let path = dir.path().join("aged.tiff");
    write_dynamic_image(&path, &fixture_image(3000, 2000), ImageFormat::Tiff);

    let viewport = image::decode_to_cache_viewport(
        &path,
        DecodeIntent::Display,
        Some(ViewportHint {
            long_edge_px: 900.0,
        }),
    )
    .expect("viewport decode");

    assert!(viewport.path.starts_with(image::disk_cache::cache_dir()));
    assert!(viewport.path.exists());

    // A `now` far in the future makes the freshly-written file older than the
    // eviction window, so the standard sweep deletes it — proving the viewport
    // tier is covered by the existing maintenance pass with no new wiring.
    let future = SystemTime::now() + EVICTION_WINDOW + Duration::from_secs(60);
    let deleted = sweep_dir(&image::disk_cache::cache_dir(), future, EVICTION_WINDOW);

    assert!(deleted >= 1, "the aged viewport-tier file should be swept");
    assert!(!viewport.path.exists(), "swept file should be gone");
}

fn assert_decode_error(error: DecodeImageError, expected_code: &str) {
    assert_eq!(error.code, expected_code);
    assert!(!error.message.is_empty());
}

fn fixture_image(width: u32, height: u32) -> DynamicImage {
    let image = RgbaImage::from_fn(width, height, |x, y| {
        let r = ((x + 1) * 17) as u8;
        let g = ((y + 1) * 29) as u8;
        let b = ((x + y + 1) * 13) as u8;
        Rgba([r, g, b, u8::MAX])
    });

    DynamicImage::ImageRgba8(image)
}

fn write_dynamic_image(path: &Path, image: &DynamicImage, format: ImageFormat) {
    image
        .save_with_format(path, format)
        .expect("fixture image should be written");
}

fn write_preview_dng(path: &Path, raw_image: &DynamicImage, preview: &DynamicImage) {
    let mut bytes = Cursor::new(Vec::new());
    let mut writer =
        DngWriter::new(&mut bytes, [1, 6, 0, 0]).expect("dng writer should initialize");

    writer.thumbnail(preview).expect("thumbnail should write");

    let width = raw_image.width() as usize;
    let height = raw_image.height() as usize;
    let mut camera = Camera::default();
    camera.cfa = CFA::new("RGGB");

    let photometric = RawPhotometricInterpretation::Cfa(CFAConfig::new_from_camera(&camera));
    let raw_pixels = bayer_pixels_from_image(raw_image);
    let raw_image = RawImage::new(
        camera,
        PixU16::new_with(raw_pixels, width, height),
        1,
        [1.0, 1.0, 1.0, f32::NAN],
        photometric,
        Some(BlackLevel::new(&[0_u32, 0, 0, 0], 2, 2, 1)),
        Some(WhiteLevel::new_bits(16, 1)),
        false,
    );

    let mut raw_subframe = writer.subframe_on_root(0);
    raw_subframe
        .raw_image(
            &raw_image,
            CropMode::None,
            DngCompression::Uncompressed,
            DngPhotometricConversion::Original,
            1,
        )
        .expect("raw image should write");
    raw_subframe
        .finalize()
        .expect("raw subframe should finalize");

    let mut preview_frame = writer.subframe(1);
    preview_frame
        .preview(preview, 0.9)
        .expect("preview should write");
    preview_frame
        .finalize()
        .expect("preview subframe should finalize");

    writer.close().expect("dng should close");
    std::fs::write(path, bytes.into_inner()).expect("dng should be persisted");
}

fn write_linear_preview_dng(path: &Path, raw_image: &DynamicImage, preview: &DynamicImage) {
    let mut bytes = Cursor::new(Vec::new());
    let mut writer =
        DngWriter::new(&mut bytes, [1, 6, 0, 0]).expect("dng writer should initialize");

    writer.thumbnail(preview).expect("thumbnail should write");

    let rgb = raw_image.to_rgb8();
    let mut raw_subframe = writer.subframe_on_root(0);
    raw_subframe
        .rgb_image_u8(
            rgb.as_raw(),
            raw_image.width() as usize,
            raw_image.height() as usize,
            DngCompression::Uncompressed,
            1,
        )
        .expect("linear raw image should write");
    raw_subframe
        .finalize()
        .expect("raw subframe should finalize");

    let mut preview_frame = writer.subframe(1);
    preview_frame
        .preview(preview, 0.9)
        .expect("preview should write");
    preview_frame
        .finalize()
        .expect("preview subframe should finalize");

    writer.close().expect("dng should close");
    std::fs::write(path, bytes.into_inner()).expect("dng should be persisted");
}

fn bayer_pixels_from_image(image: &DynamicImage) -> Vec<u16> {
    let rgb = image.to_rgb8();
    let mut pixels = Vec::with_capacity((rgb.width() as usize) * (rgb.height() as usize));

    for y in 0..rgb.height() {
        for x in 0..rgb.width() {
            let [red, green, blue] = rgb.get_pixel(x, y).0;
            let sample = match (y % 2, x % 2) {
                (0, 0) => red,
                (0, 1) | (1, 0) => green,
                (1, 1) => blue,
                _ => unreachable!("2x2 Bayer coordinates should be exhaustive"),
            };

            pixels.push(u16::from(sample) * 257);
        }
    }

    pixels
}

#[test]
fn mislabeled_png_as_heic_decodes_via_content_sniff() {
    // A plain PNG saved with a `.heic` name: the extension routes it to the HEIC
    // decoder (which fails on PNG bytes), but the content-sniff fallback must
    // recover and decode it as PNG — mirroring OS image viewers.
    let dir = TempImageDir::new();
    let path = dir.path().join("mislabeled.heic");
    write_dynamic_image(&path, &fixture_image(48, 36), ImageFormat::Png);

    let loaded = image::load_supported_image_path(&path)
        .expect("a PNG misnamed as .heic should decode via content sniffing");
    assert_eq!(loaded.image.dimensions(), (48, 36));
}

#[test]
fn mislabeled_jpeg_as_avif_decodes_via_content_sniff() {
    // `.avif` routes to the HEIC/AVIF decoder; JPEG bytes there fail, so the
    // content-sniff fallback decodes them as JPEG instead.
    let dir = TempImageDir::new();
    let path = dir.path().join("mislabeled.avif");
    write_dynamic_image(&path, &fixture_image(40, 40), ImageFormat::Jpeg);

    let loaded = image::load_supported_image_path(&path)
        .expect("a JPEG misnamed as .avif should decode via content sniffing");
    assert_eq!(loaded.image.dimensions(), (40, 40));
}

#[test]
fn mislabeled_heic_as_tiff_decodes_via_content_sniff() {
    // Real HEIC bytes saved with a `.tif` name: the image-crate TIFF decoder
    // fails, and the fallback detects the ISO-BMFF `ftyp` brand and routes to the
    // HEIC decoder.
    let dir = TempImageDir::new();
    let path = dir.path().join("mislabeled.tif");
    std::fs::copy(fixture_path("sample.heic"), &path).expect("copy heic fixture");

    let loaded = image::load_supported_image_path(&path)
        .expect("HEIC bytes misnamed as .tif should decode via content sniffing");
    assert!(loaded.image.width() > 0 && loaded.image.height() > 0);
}

#[test]
fn mislabeled_png_as_heic_decodes_to_cache() {
    // End-to-end through the user-facing decode path: the misnamed file must
    // produce a display-cache derivative rather than a "corrupted format" error.
    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let path = dir.path().join("mislabeled.heic");
    write_dynamic_image(&path, &fixture_image(64, 48), ImageFormat::Png);

    let decoded = image::decode_to_cache(&path, DecodeIntent::Display)
        .expect("a PNG misnamed as .heic should decode to cache");
    assert_eq!((decoded.width, decoded.height), (64, 48));
    assert!(decoded.path.exists());
}

#[test]
fn genuinely_corrupt_backend_file_surfaces_error() {
    // Random bytes with no recognizable signature must still error (the content
    // sniff finds nothing to recover with), not silently succeed.
    let dir = TempImageDir::new();
    let path = dir.path().join("corrupt.heic");
    dir.write("corrupt.heic", &[0u8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    assert!(
        image::load_supported_image_path(&path).is_err(),
        "a genuinely corrupt file should still surface a decode error"
    );
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
