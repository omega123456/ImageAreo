mod common;

use std::io::Cursor;
use std::path::{Path, PathBuf};

use ::image::{self as image_rs, GenericImageView, ImageFormat};
use common::TempImageDir;
use exif::experimental::Writer as ExifWriter;
use exif::{Field, In, Tag, Value};
use filetime::FileTime;
use imageareo_lib::commands;
use imageareo_lib::scheduler::{JobClass, Priority, Scheduler};
use imageareo_lib::thumbnail;

#[test]
fn generate_thumbnail_resizes_native_images_to_hidpi_bounds() {
    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let path = dir.path().join("native.png");
    common::write_dynamic_fixture(&path, 20, 10, ImageFormat::Png);

    let thumbnail = thumbnail::generate_thumbnail(&path, 12).expect("thumbnail should succeed");
    let decoded = decode_jpeg_file(Path::new(&thumbnail.path));

    assert_eq!((thumbnail.width, thumbnail.height), (20, 10));
    assert_eq!(decoded.dimensions(), (20, 10));
    assert_cache_path(&thumbnail.path);
}

#[test]
fn generate_thumbnail_uses_scaled_jpeg_decode_path() {
    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let path = dir.path().join("large.jpg");
    common::write_dynamic_fixture(&path, 1600, 1200, ImageFormat::Jpeg);

    let loaded = imageareo_lib::image::load_thumbnail_source(&path, 64)
        .expect("thumbnail source should load");
    let thumbnail = thumbnail::generate_thumbnail(&path, 32).expect("thumbnail should succeed");
    let decoded = decode_jpeg_file(Path::new(&thumbnail.path));

    assert!(loaded.image.width() < 1600);
    assert!(loaded.image.height() < 1200);
    assert_eq!((thumbnail.width, thumbnail.height), (64, 48));
    assert_eq!(decoded.dimensions(), (64, 48));
    assert_cache_path(&thumbnail.path);
}

#[test]
fn generate_thumbnail_preserves_aspect_ratio_for_exotic_fixture() {
    let _cache = common::CacheGuard::new();
    let path = fixture_path("sample.heic");

    let thumbnail = thumbnail::generate_thumbnail(&path, 15).expect("thumbnail should succeed");
    let decoded = decode_jpeg_file(Path::new(&thumbnail.path));

    assert_eq!((thumbnail.width, thumbnail.height), (30, 30));
    assert_eq!(decoded.dimensions(), (30, 30));
    assert_cache_path(&thumbnail.path);
}

#[tokio::test]
async fn generate_thumbnail_command_returns_cache_path_for_jxl_fixture() {
    let _cache = common::CacheGuard::new();
    let scheduler = Scheduler::new();
    let thumbnail = commands::generate_thumbnail_via(
        &scheduler,
        path_string(&fixture_path("sample.jxl")),
        18,
        None,
        None,
    )
    .await
    .expect("command should succeed");
    let decoded = decode_jpeg_file(Path::new(&thumbnail.path));

    assert_cache_path(&thumbnail.path);
    assert_eq!(decoded.dimensions(), (36, 36));
}

#[test]
fn generate_thumbnail_rejects_zero_logical_size() {
    let dir = TempImageDir::new();
    let path = dir.path().join("native.png");
    common::write_dynamic_fixture(&path, 10, 10, ImageFormat::Png);

    let error = thumbnail::generate_thumbnail(&path, 0).expect_err("zero size should be rejected");

    assert_eq!(error.code, "decode_failed");
    assert!(error.message.contains("greater than zero"));
}

#[test]
fn generate_thumbnail_scales_tall_images_by_height() {
    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let path = dir.path().join("tall.png");
    common::write_dynamic_fixture(&path, 10, 20, ImageFormat::Png);

    let thumbnail = thumbnail::generate_thumbnail(&path, 12).expect("thumbnail should succeed");
    let decoded = decode_jpeg_file(Path::new(&thumbnail.path));

    assert_eq!((thumbnail.width, thumbnail.height), (10, 20));
    assert_eq!(decoded.dimensions(), (10, 20));
}

#[test]
fn generate_thumbnail_propagates_decode_errors_for_invalid_inputs() {
    let dir = TempImageDir::new();
    let unsupported = dir.write("notes.txt", b"plain text");

    let error = thumbnail::generate_thumbnail(&unsupported, 16)
        .expect_err("unsupported input should error");

    assert_eq!(error.code, "unsupported_format");
    assert!(!error.message.is_empty());
}

#[tokio::test]
async fn generate_thumbnail_command_propagates_errors() {
    let dir = TempImageDir::new();
    let unsupported = dir.write("notes.txt", b"plain text");

    let scheduler = Scheduler::new();
    let error = commands::generate_thumbnail_via(
        &scheduler,
        path_string(&unsupported),
        16,
        None,
        None,
    )
    .await
    .expect_err("unsupported input should error through the command");

    assert_eq!(error.code, "unsupported_format");
}

#[test]
fn generate_thumbnail_uses_embedded_exif_thumbnail_without_upscaling() {
    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let path = dir.path().join("embedded.jpg");
    write_jpeg_with_embedded_thumbnail(&path, 1600, 1200, 160, 120);

    let loaded = imageareo_lib::image::load_thumbnail_source(&path, 240)
        .expect("thumbnail source should load");
    let thumbnail = thumbnail::generate_thumbnail(&path, 120).expect("thumbnail should succeed");
    let decoded = decode_jpeg_file(Path::new(&thumbnail.path));

    assert_eq!(loaded.image.dimensions(), (160, 120));
    assert_eq!((thumbnail.width, thumbnail.height), (160, 120));
    assert_eq!(decoded.dimensions(), (160, 120));
}

#[test]
fn load_thumbnail_source_falls_back_when_embedded_thumb_is_too_small() {
    let dir = TempImageDir::new();
    let path = dir.path().join("embedded-small.jpg");
    write_jpeg_with_embedded_thumbnail(&path, 1600, 1200, 80, 60);

    let loaded = imageareo_lib::image::__test_support::load_thumbnail_source_for(&path, 240)
        .expect("thumbnail source should fall back to scaled decode");

    assert!(loaded.image.width() > 80);
    assert!(loaded.image.height() > 60);
    assert!(loaded.image.width() < 1600);
    assert!(loaded.image.height() < 1200);
}

#[test]
fn generate_thumbnail_reuses_existing_cache_file() {
    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let path = dir.path().join("cache.jpg");
    common::write_dynamic_fixture(&path, 1600, 1200, ImageFormat::Jpeg);

    let first = thumbnail::generate_thumbnail(&path, 32).expect("first thumbnail should succeed");
    let first_modified = std::fs::metadata(&first.path)
        .expect("cache file should exist")
        .modified()
        .expect("cache file should expose modified time");

    std::thread::sleep(std::time::Duration::from_millis(20));

    let second = thumbnail::generate_thumbnail(&path, 32).expect("second thumbnail should succeed");
    let second_modified = std::fs::metadata(&second.path)
        .expect("cache file should exist")
        .modified()
        .expect("cache file should expose modified time");

    assert_eq!(first.path, second.path);
    assert_eq!(first_modified, second_modified);
    assert_eq!((second.width, second.height), (64, 48));
}

#[test]
fn sample_jpeg_downscales_to_jpeg_bytes() {
    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let path = dir.path().join("sample.jpg");
    common::write_dynamic_fixture(&path, 1600, 1200, ImageFormat::Jpeg);

    let bytes = thumbnail::sample_jpeg(&path, 48).expect("sample should succeed");
    let decoded = image_rs::load_from_memory_with_format(&bytes, ImageFormat::Jpeg)
        .expect("sample bytes should decode as JPEG");

    // Long edge capped at logical_size * 2 (= 96), aspect preserved.
    assert_eq!(decoded.dimensions(), (96, 72));
}

#[test]
fn sample_jpeg_uses_embedded_exif_thumbnail_without_upscaling() {
    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let path = dir.path().join("sample-embedded.jpg");
    write_jpeg_with_embedded_thumbnail(&path, 1600, 1200, 120, 90);

    let bytes = thumbnail::sample_jpeg(&path, 80).expect("sample should succeed");
    let decoded = image_rs::load_from_memory_with_format(&bytes, ImageFormat::Jpeg)
        .expect("sample bytes should decode as JPEG");

    assert_eq!(decoded.dimensions(), (120, 90));
}

#[test]
fn sample_jpeg_rejects_zero_size() {
    let dir = TempImageDir::new();
    let path = dir.path().join("sample.png");
    common::write_dynamic_fixture(&path, 10, 10, ImageFormat::Png);

    let error = thumbnail::sample_jpeg(&path, 0).expect_err("zero size should be rejected");
    assert_eq!(error.code, "decode_failed");
}

#[tokio::test]
async fn sample_image_command_returns_jpeg_data_url() {
    let dir = TempImageDir::new();
    let path = dir.path().join("sample.png");
    common::write_dynamic_fixture(&path, 40, 20, ImageFormat::Png);

    let scheduler = Scheduler::new();
    let data_url =
        commands::sample_image_via(&scheduler, path_string(&path), 32, None, None)
            .await
            .expect("command should succeed");

    assert!(data_url.starts_with("data:image/jpeg;base64,"));
}

#[tokio::test]
async fn sample_image_command_propagates_errors() {
    let dir = TempImageDir::new();
    let unsupported = dir.path().join("note.txt");
    std::fs::write(&unsupported, b"not an image").expect("fixture write should succeed");

    let scheduler = Scheduler::new();
    let error =
        commands::sample_image_via(&scheduler, path_string(&unsupported), 32, None, None)
            .await
            .expect_err("unsupported input should error");
    assert_eq!(error.code, "unsupported_format");
}

#[test]
fn target_dimensions_cap_at_double_logical_size_and_handle_orientation() {
    use thumbnail::__test_support::target_dimensions_for;
    let landscape = image_rs::DynamicImage::ImageRgba8(image_rs::RgbaImage::new(400, 200));
    // logical_size 50 → max edge 100; landscape caps width.
    assert_eq!(target_dimensions_for(&landscape, 50), (100, 50));

    let portrait = image_rs::DynamicImage::ImageRgba8(image_rs::RgbaImage::new(200, 400));
    assert_eq!(target_dimensions_for(&portrait, 50), (50, 100));

    // Sources smaller than the cap are never upscaled.
    let tiny = image_rs::DynamicImage::ImageRgba8(image_rs::RgbaImage::new(8, 6));
    assert_eq!(target_dimensions_for(&tiny, 50), (8, 6));
}

#[test]
fn resize_and_encode_seams_round_trip_through_a_decodable_jpeg() {
    use thumbnail::__test_support::{encode_jpeg_for, resize_image_for};
    let source = image_rs::DynamicImage::ImageRgba8(image_rs::RgbaImage::from_pixel(
        40,
        30,
        image_rs::Rgba([12, 34, 56, 255]),
    ));

    let resized = resize_image_for(&source, 20, 15).expect("resize should succeed");
    assert_eq!(resized.dimensions(), (20, 15));
    // Alpha-typed (RGBA8) source → resized through the RGBA path.
    assert!(resized.color().has_alpha());

    let bytes = encode_jpeg_for(&resized).expect("encode should succeed");
    let decoded = image_rs::load_from_memory_with_format(&bytes, ImageFormat::Jpeg)
        .expect("encoded thumbnail should decode");
    assert_eq!(decoded.dimensions(), (20, 15));
}

#[test]
fn cache_file_seams_write_idempotently_and_read_dimensions() {
    use thumbnail::__test_support::{
        cache_path_for, read_cached_dimensions_for, write_cache_file_for,
    };
    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let source = dir.path().join("seam.png");
    common::write_dynamic_fixture(&source, 8, 8, ImageFormat::Png);

    let cache_path = cache_path_for(&source, 24).expect("cache path should compute");

    let jpeg = {
        let img = image_rs::DynamicImage::ImageRgb8(image_rs::RgbImage::from_pixel(
            10,
            6,
            image_rs::Rgb([1, 2, 3]),
        ));
        let mut buf = Cursor::new(Vec::new());
        img.write_to(&mut buf, ImageFormat::Jpeg)
            .expect("jpeg should encode");
        buf.into_inner()
    };

    write_cache_file_for(&cache_path, &jpeg).expect("first write should succeed");
    // A second write for an existing cache file is a no-op that discards the temp.
    write_cache_file_for(&cache_path, &jpeg).expect("second write should succeed");

    let (width, height) = read_cached_dimensions_for(&cache_path).expect("dimensions should read");
    assert_eq!((width, height), (10, 6));
}

#[test]
fn cache_path_seam_rejects_pre_unix_epoch_mtime() {
    use thumbnail::__test_support::cache_path_for;

    let dir = TempImageDir::new();
    let source = dir.path().join("pre-epoch.png");
    common::write_dynamic_fixture(&source, 8, 8, ImageFormat::Png);
    filetime::set_file_mtime(&source, FileTime::from_unix_time(-1, 0))
        .expect("mtime should be set before the unix epoch");

    let error = cache_path_for(&source, 24).expect_err("pre-epoch mtimes should be rejected");
    assert_eq!(error.code, "io_error");
    assert!(error.message.contains("before unix epoch"));
}

#[test]
fn read_cached_dimensions_seam_errors_for_missing_and_non_image_files() {
    use thumbnail::__test_support::read_cached_dimensions_for;
    let dir = TempImageDir::new();

    let missing = dir.path().join("absent.jpg");
    let missing_err = read_cached_dimensions_for(&missing).expect_err("missing file should error");
    assert_eq!(missing_err.code, "io_error");

    let garbage = dir.path().join("garbage.jpg");
    std::fs::write(&garbage, b"definitely not a jpeg").expect("fixture write should succeed");
    let garbage_err =
        read_cached_dimensions_for(&garbage).expect_err("non-image file should error");
    assert_eq!(garbage_err.code, "decode_failed");
}

#[cfg(unix)]
#[test]
fn cache_file_seam_reports_temp_write_failures() {
    use std::os::unix::fs::PermissionsExt;
    use thumbnail::__test_support::write_cache_file_for;

    let dir = TempImageDir::new();
    let readonly = dir.path().join("readonly");
    std::fs::create_dir(&readonly).expect("readonly cache dir should create");
    let mut perms = std::fs::metadata(&readonly)
        .expect("readonly dir metadata should read")
        .permissions();
    perms.set_mode(0o555);
    std::fs::set_permissions(&readonly, perms).expect("readonly perms should apply");

    let cache_path = readonly.join("cache.jpg");
    let error = write_cache_file_for(&cache_path, b"not-a-jpeg")
        .expect_err("temp write should fail in readonly directory");
    assert_eq!(error.code, "io_error");

    let mut cleanup_perms = std::fs::metadata(&readonly)
        .expect("readonly dir metadata should read")
        .permissions();
    cleanup_perms.set_mode(0o755);
    std::fs::set_permissions(&readonly, cleanup_perms).expect("cleanup perms should apply");
}

#[test]
fn resize_image_uses_rgb_path_for_opaque_typed_source() {
    use thumbnail::__test_support::{encode_jpeg_for, resize_image_for};
    // An opaque-typed (RGB8) source must resize through the alpha-free RGB path
    // (Phase 7 split reused) — no RGBA round-trip, no alpha plane.
    let source = image_rs::DynamicImage::ImageRgb8(image_rs::RgbImage::from_pixel(
        40,
        30,
        image_rs::Rgb([200, 100, 50]),
    ));

    let resized = resize_image_for(&source, 20, 15).expect("resize should succeed");
    assert_eq!(resized.dimensions(), (20, 15));
    assert!(
        !resized.color().has_alpha(),
        "opaque source must resize to an RGB (no-alpha) buffer"
    );

    let bytes = encode_jpeg_for(&resized).expect("encode should succeed");
    let decoded = image_rs::load_from_memory_with_format(&bytes, ImageFormat::Jpeg)
        .expect("encoded thumbnail should decode");
    assert_eq!(decoded.dimensions(), (20, 15));
}

#[test]
fn resize_image_uses_rgba_path_for_alpha_typed_source() {
    use thumbnail::__test_support::{encode_jpeg_for, resize_image_for};
    // An alpha-typed source (RGBA8, with real transparency) must resize through
    // the RGBA path (alpha plane retained), then flatten on JPEG encode.
    let source = image_rs::DynamicImage::ImageRgba8(image_rs::RgbaImage::from_pixel(
        40,
        30,
        image_rs::Rgba([12, 34, 56, 64]),
    ));

    let resized = resize_image_for(&source, 20, 15).expect("resize should succeed");
    assert_eq!(resized.dimensions(), (20, 15));
    assert!(
        resized.color().has_alpha(),
        "alpha-typed source must resize through the RGBA path"
    );

    let bytes = encode_jpeg_for(&resized).expect("encode should succeed");
    let decoded = image_rs::load_from_memory_with_format(&bytes, ImageFormat::Jpeg)
        .expect("encoded thumbnail should decode");
    assert_eq!(decoded.dimensions(), (20, 15));
}

#[test]
fn encode_jpeg_coerces_non_rgb_color_types() {
    use thumbnail::__test_support::encode_jpeg_for;
    // A luma (grayscale) image is neither Rgb8 nor Rgba8; encode must coerce it
    // through `to_rgb8` rather than panic.
    let luma = image_rs::DynamicImage::ImageLuma8(image_rs::GrayImage::from_pixel(
        6,
        4,
        image_rs::Luma([128]),
    ));
    let bytes = encode_jpeg_for(&luma).expect("luma encode should succeed");
    let decoded = image_rs::load_from_memory_with_format(&bytes, ImageFormat::Jpeg)
        .expect("encoded bytes should decode");
    assert_eq!(decoded.dimensions(), (6, 4));
}

#[test]
fn sample_cache_key_is_stable_and_size_sensitive() {
    use thumbnail::__test_support::sample_cache_key_for;
    let dir = TempImageDir::new();
    let path = dir.path().join("key.png");
    common::write_dynamic_fixture(&path, 10, 10, ImageFormat::Png);

    let a = sample_cache_key_for(&path, 48).expect("key should compute");
    let b = sample_cache_key_for(&path, 48).expect("key should compute");
    let c = sample_cache_key_for(&path, 96).expect("key should compute");

    assert_eq!(a, b, "identical inputs yield a stable key");
    assert_ne!(a, c, "a different logical size yields a different key");
    assert!(a.starts_with("sample:"));

    let missing = sample_cache_key_for(&dir.path().join("absent.png"), 48)
        .expect_err("a missing source must error");
    assert_eq!(missing.code, "io_error");
}

#[test]
fn thumbnail_source_chain_reuses_existing_display_derivative() {
    let _cache = common::CacheGuard::new();
    // A large non-JPEG (HEIC) with an existing display derivative must source its
    // thumbnail from that small derivative rather than re-decoding the original.
    let path = fixture_path("sample.heic");

    // No derivative yet: the chain decodes the source. The HEIC fixture has no
    // embedded EXIF thumbnail, so this exercises the backend decode source.
    let cold = imageareo_lib::image::__test_support::load_thumbnail_source_chain_for(&path, 64)
        .expect("cold chain should decode the source");
    assert_ne!(
        cold.image.dimensions(),
        (0, 0),
        "cold decode should yield a real image"
    );

    // Create a display derivative for the source (what the viewer would do on
    // open). This is a *real* cache write, not a force-create by the thumbnail
    // path.
    let derivative = imageareo_lib::image::decode_to_cache(
        &path,
        imageareo_lib::image::DecodeIntent::Display,
    )
    .expect("display derivative should be produced");

    // Now the chain must reuse the derivative: it reports identity orientation
    // (the derivative already baked orientation in) and its dimensions match the
    // on-disk derivative, proving the small cached file was the source.
    let warm = imageareo_lib::image::__test_support::load_thumbnail_source_chain_for(&path, 64)
        .expect("warm chain should reuse the display derivative");
    assert_eq!(
        warm.orientation, 1,
        "a reused display derivative is already upright (identity orientation)"
    );
    assert_eq!(
        warm.image.dimensions(),
        (derivative.width, derivative.height),
        "warm chain must source from the display derivative"
    );
}

#[test]
fn thumbnail_source_chain_guards_full_decode_against_max_pixels() {
    let _cache = common::CacheGuard::new();
    // A backend image declaring more than MAX_PIXELS, with no embedded thumbnail
    // and no existing display derivative, must be refused before any full decode.
    let dir = TempImageDir::new();
    let path = dir.path().join("huge.tiff");
    write_oversize_tiff(&path);

    let error = imageareo_lib::image::__test_support::load_thumbnail_source_chain_for(&path, 64)
        .expect_err("an over-ceiling source must be refused");
    assert_eq!(error.code, "image_too_large");
}

#[test]
fn sample_jpeg_reuses_cached_tone_for_repeated_sampling() {
    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let path = dir.path().join("tone.png");
    common::write_dynamic_fixture(&path, 200, 150, ImageFormat::Png);

    let first = thumbnail::sample_jpeg(&path, 48).expect("first sample should succeed");

    // Corrupt the source bytes in place *without* changing its length or mtime,
    // so the source-identity key is unchanged but a re-decode would now fail. A
    // second sample that still succeeds therefore proves the cached tone was
    // reused (no re-decode of the source).
    let original = std::fs::read(&path).expect("source should read");
    let mtime = FileTime::from_last_modification_time(
        &std::fs::metadata(&path).expect("source metadata should read"),
    );
    let garbage = vec![0u8; original.len()];
    std::fs::write(&path, &garbage).expect("source should be overwritten");
    filetime::set_file_mtime(&path, mtime).expect("mtime should be restored");

    let second = thumbnail::sample_jpeg(&path, 48).expect("second sample should hit the tone cache");
    assert_eq!(first, second, "repeated sampling must reuse the cached tone");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_identical_thumbnail_requests_execute_once() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    let _cache = common::CacheGuard::new();
    let dir = TempImageDir::new();
    let path = dir.path().join("concurrent.jpg");
    common::write_dynamic_fixture(&path, 800, 600, ImageFormat::Jpeg);

    let scheduler = Scheduler::new();
    let executions = Arc::new(AtomicUsize::new(0));
    // Mirror the exact JobClass + key shape that `generate_thumbnail_via` uses so
    // this exercises the production single-flight path. N concurrent leaders for
    // the same key must coalesce: the instrumented work runs exactly once.
    let key = format!("thumbnail:{}:{}", 32, path.to_string_lossy());

    let mut handles = Vec::new();
    for _ in 0..8 {
        let scheduler = scheduler.clone();
        let executions = Arc::clone(&executions);
        let key = key.clone();
        let thumb_path = path.clone();
        handles.push(tokio::spawn(async move {
            scheduler
                .run(
                    JobClass::ThumbSample,
                    Priority::VisibleThumbnail,
                    key,
                    move || async move {
                        executions.fetch_add(1, Ordering::SeqCst);
                        tokio::task::spawn_blocking(move || {
                            thumbnail::generate_thumbnail(&thumb_path, 32)
                        })
                        .await
                        .expect("blocking thumbnail task should join")
                    },
                )
                .await
        }));
    }

    let mut results = Vec::new();
    for handle in handles {
        let result = handle
            .await
            .expect("task should join")
            .expect("scheduled job should succeed and not be superseded");
        results.push((*result).clone());
    }

    assert_eq!(
        executions.load(Ordering::SeqCst),
        1,
        "identical concurrent thumbnail requests must execute the underlying work exactly once"
    );
    let first_path = &results[0].path;
    for result in &results {
        assert_eq!(&result.path, first_path, "all callers receive the same result");
    }
    assert_cache_path(first_path);
}

fn write_oversize_tiff(path: &Path) {
    // A minimal TIFF header that *declares* dimensions exceeding MAX_PIXELS via
    // the ImageWidth/ImageLength tags, so the dimension probe rejects it before
    // any pixel buffer is allocated. 20000 x 20000 = 400 MP > 256 MP ceiling.
    // Little-endian TIFF, 4 IFD entries: ImageWidth, ImageLength, BitsPerSample,
    // PhotometricInterpretation.
    let mut buf: Vec<u8> = Vec::new();
    buf.extend_from_slice(b"II"); // little-endian
    buf.extend_from_slice(&42u16.to_le_bytes()); // magic
    buf.extend_from_slice(&8u32.to_le_bytes()); // offset to first IFD
    buf.extend_from_slice(&4u16.to_le_bytes()); // entry count

    let entry = |buf: &mut Vec<u8>, tag: u16, field_type: u16, value: u32| {
        buf.extend_from_slice(&tag.to_le_bytes());
        buf.extend_from_slice(&field_type.to_le_bytes());
        buf.extend_from_slice(&1u32.to_le_bytes()); // count
        buf.extend_from_slice(&value.to_le_bytes()); // value/offset
    };

    entry(&mut buf, 0x0100, 4, 20000); // ImageWidth (LONG)
    entry(&mut buf, 0x0101, 4, 20000); // ImageLength (LONG)
    entry(&mut buf, 0x0102, 3, 8); // BitsPerSample (SHORT)
    entry(&mut buf, 0x0106, 3, 1); // PhotometricInterpretation (SHORT)
    buf.extend_from_slice(&0u32.to_le_bytes()); // next IFD offset (none)

    std::fs::write(path, &buf).expect("oversize tiff fixture should be written");
}

fn decode_jpeg_file(path: &Path) -> image_rs::DynamicImage {
    image_rs::open(path).expect("thumbnail JPEG should decode")
}

fn assert_cache_path(path: &str) {
    let cache_root = thumbnail::thumbnail_cache_dir()
        .to_string_lossy()
        .into_owned();
    assert!(path.starts_with(&cache_root));
    assert!(
        Path::new(path).exists(),
        "thumbnail cache file should exist"
    );
}

fn write_jpeg_with_embedded_thumbnail(
    path: &Path,
    width: u32,
    height: u32,
    thumb_width: u32,
    thumb_height: u32,
) {
    let primary = encode_dynamic_fixture(width, height, ImageFormat::Jpeg);
    let thumbnail = encode_dynamic_fixture(thumb_width, thumb_height, ImageFormat::Jpeg);
    let exif = build_exif_thumbnail_block(&thumbnail);
    let mut embedded = Vec::with_capacity(primary.len() + exif.len() + 16);

    embedded.extend_from_slice(&primary[..2]);
    embedded.push(0xFF);
    embedded.push(0xE1);
    let app1_length = u16::try_from(8 + exif.len()).expect("exif app1 block should fit in u16");
    embedded.extend_from_slice(&app1_length.to_be_bytes());
    embedded.extend_from_slice(b"Exif\0\0");
    embedded.extend_from_slice(&exif);
    embedded.extend_from_slice(&primary[2..]);

    std::fs::write(path, embedded).expect("fixture jpeg should be written");
}

fn encode_dynamic_fixture(width: u32, height: u32, format: ImageFormat) -> Vec<u8> {
    let mut buffer = Cursor::new(Vec::new());
    let image =
        image_rs::DynamicImage::ImageRgba8(image_rs::RgbaImage::from_fn(width, height, |x, y| {
            let r = ((x + 1) * 17) as u8;
            let g = ((y + 1) * 29) as u8;
            let b = ((x + y + 1) * 13) as u8;
            image_rs::Rgba([r, g, b, u8::MAX])
        }));
    image
        .write_to(&mut buffer, format)
        .expect("fixture image should encode");

    buffer.into_inner()
}

fn build_exif_thumbnail_block(jpeg_thumbnail: &[u8]) -> Vec<u8> {
    let mut writer = ExifWriter::new();
    let mut buffer = Cursor::new(Vec::new());
    let image_desc = Field {
        tag: Tag::ImageDescription,
        ifd_num: In::PRIMARY,
        value: Value::Ascii(vec![b"embedded".to_vec()]),
    };
    writer.push_field(&image_desc);
    writer.set_jpeg(jpeg_thumbnail, In::THUMBNAIL);
    writer
        .write(&mut buffer, false)
        .expect("exif data should encode");

    buffer.into_inner()
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
