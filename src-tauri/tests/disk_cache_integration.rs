mod common;

use std::path::Path;

use ::image::{GenericImageView, ImageFormat};
use common::TempImageDir;
use filetime::FileTime;
use imageareo_lib::image::disk_cache::{self, CacheVariant};

fn cleanup(path: &Path) {
    let _ = std::fs::remove_file(path);
}

#[test]
fn cache_path_is_stable_for_identical_inputs() {
    let dir = TempImageDir::new();
    let source = dir.path().join("a.png");
    common::write_dynamic_fixture(&source, 8, 8, ImageFormat::Png);

    let first = disk_cache::cache_path_for(&source, CacheVariant::Display, 8192, "jpg")
        .expect("path should compute");
    let second = disk_cache::cache_path_for(&source, CacheVariant::Display, 8192, "jpg")
        .expect("path should compute");

    assert_eq!(first, second);
    assert!(first.starts_with(disk_cache::cache_dir()));
    assert_eq!(first.extension().and_then(|e| e.to_str()), Some("jpg"));
}

#[test]
fn cache_path_differs_per_variant_and_cap() {
    let dir = TempImageDir::new();
    let source = dir.path().join("b.png");
    common::write_dynamic_fixture(&source, 8, 8, ImageFormat::Png);

    let display = disk_cache::cache_path_for(&source, CacheVariant::Display, 8192, "jpg").unwrap();
    let preview = disk_cache::cache_path_for(&source, CacheVariant::Preview, 8192, "jpg").unwrap();
    let other_cap =
        disk_cache::cache_path_for(&source, CacheVariant::Display, 2560, "jpg").unwrap();

    assert_ne!(display.file_stem(), preview.file_stem());
    assert_ne!(display.file_stem(), other_cap.file_stem());
}

#[test]
fn cache_path_changes_when_mtime_or_size_changes() {
    let dir = TempImageDir::new();
    let source = dir.path().join("c.png");
    common::write_dynamic_fixture(&source, 8, 8, ImageFormat::Png);

    let before = disk_cache::cache_path_for(&source, CacheVariant::Display, 8192, "jpg").unwrap();

    // Rewrite with different content/size; mtime advances and size differs.
    std::thread::sleep(std::time::Duration::from_millis(10));
    common::write_dynamic_fixture(&source, 16, 12, ImageFormat::Png);

    let after = disk_cache::cache_path_for(&source, CacheVariant::Display, 8192, "jpg").unwrap();

    assert_ne!(before, after);
}

#[test]
fn atomic_write_produces_readable_file_with_correct_dimensions() {
    let dir = TempImageDir::new();
    let source = dir.path().join("d.png");
    common::write_dynamic_fixture(&source, 8, 8, ImageFormat::Png);

    let payload = dir.path().join("payload.png");
    common::write_dynamic_fixture(&payload, 30, 20, ImageFormat::Png);
    let bytes = std::fs::read(&payload).expect("payload should read");

    let written = disk_cache::write(&source, CacheVariant::Display, 8192, "png", &bytes)
        .expect("write should succeed");

    assert!(written.exists());
    let (width, height) =
        disk_cache::read_cached_dimensions(&written).expect("dimensions should read");
    assert_eq!((width, height), (30, 20));

    // Sanity: the file is a real decodable image.
    let decoded = ::image::open(&written).expect("cache file should decode");
    assert_eq!(decoded.dimensions(), (30, 20));

    cleanup(&written);
}

#[test]
fn lookup_finds_written_file_and_absent_for_unwritten_key() {
    let dir = TempImageDir::new();
    let source = dir.path().join("e.png");
    common::write_dynamic_fixture(&source, 8, 8, ImageFormat::Png);

    // Never written yet.
    let absent =
        disk_cache::lookup(&source, CacheVariant::Display, 8192).expect("lookup should succeed");
    assert!(absent.is_none());

    let payload = std::fs::read(&source).unwrap();
    let written = disk_cache::write(&source, CacheVariant::Display, 8192, "jpg", &payload)
        .expect("write should succeed");

    let found =
        disk_cache::lookup(&source, CacheVariant::Display, 8192).expect("lookup should succeed");
    assert_eq!(found.as_deref(), Some(written.as_path()));

    cleanup(&written);
}

#[test]
fn lookup_tries_png_extension_for_display_variant() {
    let dir = TempImageDir::new();
    let source = dir.path().join("f.png");
    common::write_dynamic_fixture(&source, 8, 8, ImageFormat::Png);

    let payload = std::fs::read(&source).unwrap();
    // Written as PNG; display lookup must still find it across its candidates.
    let written = disk_cache::write(&source, CacheVariant::Display, 8192, "png", &payload)
        .expect("write should succeed");

    let found =
        disk_cache::lookup(&source, CacheVariant::Display, 8192).expect("lookup should succeed");
    assert_eq!(found.as_deref(), Some(written.as_path()));

    cleanup(&written);
}

#[test]
fn variant_candidate_extensions_match_intent() {
    assert_eq!(CacheVariant::Preview.candidate_extensions(), &["jpg"]);
    assert_eq!(
        CacheVariant::Display.candidate_extensions(),
        &["jpg", "png"]
    );
    assert_eq!(
        CacheVariant::Enhance.candidate_extensions(),
        &["jpg", "png"]
    );
}

#[test]
fn write_returns_existing_file_on_repeated_write() {
    // A second write for the same key short-circuits once the cache file already
    // exists: the temp file is discarded and the existing path is returned.
    let dir = TempImageDir::new();
    let source = dir.path().join("g.png");
    common::write_dynamic_fixture(&source, 8, 8, ImageFormat::Png);
    let payload = std::fs::read(&source).unwrap();

    let first = disk_cache::write(&source, CacheVariant::Display, 8192, "png", &payload)
        .expect("first write should succeed");
    let second = disk_cache::write(&source, CacheVariant::Display, 8192, "png", &payload)
        .expect("second write should succeed");

    assert_eq!(first, second);
    // No leftover temp files in the cache dir.
    let temp_files: Vec<_> = std::fs::read_dir(disk_cache::cache_dir())
        .expect("cache dir should be readable")
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(temp_files.is_empty(), "temp files should be cleaned up");

    cleanup(&first);
}

#[test]
fn read_cached_dimensions_errors_for_missing_file() {
    let dir = TempImageDir::new();
    let missing = dir.path().join("does-not-exist.jpg");

    let error =
        disk_cache::read_cached_dimensions(&missing).expect_err("missing cache file should error");

    assert_eq!(error.code, "io_error");
    assert!(error.message.contains("failed to open cached image"));
}

#[test]
fn read_cached_dimensions_errors_for_non_image_file() {
    let dir = TempImageDir::new();
    let not_an_image = dir.write("garbage.jpg", b"this is not image data at all");

    let error =
        disk_cache::read_cached_dimensions(&not_an_image).expect_err("non-image file should error");

    assert_eq!(error.code, "decode_failed");
    assert!(!error.message.is_empty());
}

#[test]
fn cache_key_operations_error_for_missing_source_files() {
    let dir = TempImageDir::new();
    let missing = dir.path().join("missing.png");

    let cache_path = disk_cache::cache_path_for(&missing, CacheVariant::Display, 8192, "jpg")
        .expect_err("missing source should fail cache path generation");
    assert_eq!(cache_path.code, "io_error");

    let lookup = disk_cache::lookup(&missing, CacheVariant::Display, 8192)
        .expect_err("missing source should fail cache lookup key generation");
    assert_eq!(lookup.code, "io_error");
}

#[test]
fn cache_path_errors_for_pre_unix_epoch_mtime() {
    let dir = TempImageDir::new();
    let source = dir.path().join("pre-epoch.png");
    common::write_dynamic_fixture(&source, 8, 8, ImageFormat::Png);
    filetime::set_file_mtime(&source, FileTime::from_unix_time(-1, 0))
        .expect("mtime should be set before the unix epoch");

    let error = disk_cache::cache_path_for(&source, CacheVariant::Display, 8192, "png")
        .expect_err("pre-epoch mtimes should be rejected");
    assert_eq!(error.code, "io_error");
    assert!(error.message.contains("before unix epoch"));
}

#[test]
fn write_cache_file_seam_reports_parent_errors() {
    use disk_cache::__test_support::write_cache_file_for;

    let dir = TempImageDir::new();
    let payload = b"not-an-image";

    let no_parent =
        write_cache_file_for(Path::new(""), payload).expect_err("path without parent should fail");
    assert_eq!(no_parent.code, "io_error");

    let blocked_parent = dir.path().join("not-a-dir");
    std::fs::write(&blocked_parent, b"file").expect("blocking file should write");
    let blocked = write_cache_file_for(&blocked_parent.join("cache.png"), payload)
        .expect_err("file parent should fail create_dir_all");
    assert_eq!(blocked.code, "io_error");
}

#[cfg(unix)]
#[test]
fn write_cache_file_seam_reports_temp_write_failures() {
    use disk_cache::__test_support::write_cache_file_for;
    use std::os::unix::fs::PermissionsExt;

    let dir = TempImageDir::new();
    let readonly = dir.path().join("readonly");
    std::fs::create_dir(&readonly).expect("readonly cache dir should create");
    let mut perms = std::fs::metadata(&readonly)
        .expect("readonly dir metadata should read")
        .permissions();
    perms.set_mode(0o555);
    std::fs::set_permissions(&readonly, perms).expect("readonly perms should apply");

    let cache_path = readonly.join("cache.png");
    let error = write_cache_file_for(&cache_path, b"not-an-image")
        .expect_err("temp write should fail in readonly directory");
    assert_eq!(error.code, "io_error");

    let mut cleanup_perms = std::fs::metadata(&readonly)
        .expect("readonly dir metadata should read")
        .permissions();
    cleanup_perms.set_mode(0o755);
    std::fs::set_permissions(&readonly, cleanup_perms).expect("cleanup perms should apply");
}
