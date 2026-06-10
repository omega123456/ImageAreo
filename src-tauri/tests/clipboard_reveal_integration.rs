mod common;

use std::path::{Path, PathBuf};

use ::image::{self as image_rs, ImageFormat};
use common::TempImageDir;
use imageareo_lib::commands::{
    prepare_clipboard_image, reveal_in_file_manager, validate_reveal_path,
};

#[test]
fn prepare_clipboard_image_converts_native_png_to_rgba_without_baking_rotation() {
    let dir = TempImageDir::new();
    let path = dir.path().join("sample.png");
    common::write_dynamic_fixture(&path, 4, 3, ImageFormat::Png);

    let prepared = prepare_clipboard_image(&path).expect("clipboard prep should succeed");

    assert_eq!((prepared.width, prepared.height), (4, 3));
    assert_eq!(prepared.orientation, 1);
    assert_eq!(prepared.rgba_bytes.len(), 4 * 3 * 4);

    let rgba = image_rs::RgbaImage::from_raw(prepared.width, prepared.height, prepared.rgba_bytes)
        .expect("prepared bytes should be valid RGBA");
    assert_eq!(rgba.dimensions(), (4, 3));
}

#[test]
fn prepare_clipboard_image_converts_exotic_fixture_to_rgba() {
    let prepared =
        prepare_clipboard_image(&fixture_path("sample.heic")).expect("heic prep should succeed");

    assert_eq!(
        (prepared.width, prepared.height, prepared.orientation),
        (48, 48, 1)
    );
    assert_eq!(prepared.rgba_bytes.len(), 48 * 48 * 4);
}

#[test]
fn prepare_clipboard_image_returns_structured_errors_for_invalid_inputs() {
    let dir = TempImageDir::new();
    let missing = dir.path().join("missing.heic");
    let unsupported = dir.write("notes.txt", b"plain text");

    let missing_error = prepare_clipboard_image(&missing).expect_err("missing file should fail");
    let unsupported_error =
        prepare_clipboard_image(&unsupported).expect_err("unsupported file should fail");

    assert_eq!(missing_error.code, "io_error");
    assert!(!missing_error.message.is_empty());
    assert_eq!(unsupported_error.code, "unsupported_format");
    assert!(!unsupported_error.message.is_empty());
}

#[test]
fn validate_reveal_path_rejects_empty_and_missing_paths() {
    let empty = validate_reveal_path(Path::new("")).expect_err("empty path should fail");
    let missing = validate_reveal_path(Path::new("/definitely/missing/image.png"))
        .expect_err("missing path should fail");

    assert_eq!(empty.code, "invalid_path");
    assert!(empty.message.contains("must not be empty"));
    assert_eq!(missing.code, "invalid_path");
    assert!(missing.message.contains("failed to resolve"));
}

#[test]
fn validate_reveal_path_canonicalizes_existing_file_and_directory() {
    let dir = TempImageDir::new();
    let file = dir.path().join("image.png");
    common::write_dynamic_fixture(&file, 2, 2, ImageFormat::Png);

    let revealed_file = validate_reveal_path(&file).expect("file should validate");
    let revealed_dir = validate_reveal_path(dir.path()).expect("dir should validate");

    assert!(revealed_file.is_absolute());
    assert!(revealed_dir.is_absolute());
    assert_eq!(
        revealed_file.file_name().and_then(|name| name.to_str()),
        Some("image.png")
    );
}

#[tokio::test]
async fn reveal_in_file_manager_returns_clean_errors_for_bad_paths() {
    let error = reveal_in_file_manager(String::new())
        .await
        .expect_err("empty path should fail before OS reveal");

    assert_eq!(error.code, "invalid_path");
    assert!(error.message.contains("must not be empty"));
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}
