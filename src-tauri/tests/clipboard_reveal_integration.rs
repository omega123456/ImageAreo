mod common;

use std::io::Cursor;
use std::path::{Path, PathBuf};

use ::image::{self as image_rs, DynamicImage, ImageFormat, Rgba, RgbaImage};
use common::TempImageDir;
use imageareo_lib::commands::{
    prepare_clipboard_image, reveal_in_file_manager, validate_reveal_path,
};
use rawler::dng::writer::DngWriter;
use rawler::dng::DngCompression;

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
fn prepare_clipboard_image_downscales_oversized_images() {
    // A full RAW is tens of megapixels; expanded to RGBA the OS clipboard
    // cannot accept it. Oversized images are downscaled (longest edge capped)
    // so the copy stays within a writable bound.
    let dir = TempImageDir::new();
    let path = dir.path().join("huge.tiff");
    common::write_dynamic_fixture(&path, 9000, 30, ImageFormat::Tiff);

    let prepared = prepare_clipboard_image(&path).expect("oversized prep should succeed");

    assert!(
        prepared.width <= 4096,
        "longest edge should be capped, got {}x{}",
        prepared.width,
        prepared.height
    );
    assert_eq!(
        prepared.rgba_bytes.len() as u32,
        prepared.width * prepared.height * 4
    );
    assert_eq!(prepared.orientation, 1);
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
fn prepare_clipboard_image_sources_from_the_display_cache_without_demosaic() {
    // The clipboard reuses the on-disk display cache, which for RAW is the
    // embedded preview (no demosaic on open). So a copy reflects the embedded
    // preview dimensions (16x12), not the full sensor develop (40x30).
    let dir = TempImageDir::new();
    let path = dir.path().join("sample.dng");
    let raw = fixture_image(40, 30);
    let preview = fixture_image(16, 12);
    write_linear_preview_dng(&path, &raw, &preview);

    let prepared = prepare_clipboard_image(&path).expect("dng prep should succeed");

    assert_eq!(
        (prepared.width, prepared.height, prepared.orientation),
        (16, 12, 1)
    );
    assert_eq!(prepared.rgba_bytes.len(), 16 * 12 * 4);
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

#[test]
fn validate_reveal_path_rejects_paths_that_are_neither_file_nor_directory() {
    // A unix domain socket exists on disk but is neither a regular file nor a
    // directory, exercising the final rejection branch of validate_reveal_path.
    #[cfg(unix)]
    {
        use std::os::unix::net::UnixListener;

        let dir = TempImageDir::new();
        let socket_path = dir.path().join("reveal.sock");

        // Binding can be blocked by sandboxes; only assert the branch when the OS
        // actually let us create the special file.
        if UnixListener::bind(&socket_path).is_ok() {
            let error = validate_reveal_path(&socket_path)
                .expect_err("non file/dir path should be rejected");

            assert_eq!(error.code, "invalid_path");
            assert!(error.message.contains("not a file or directory"));
        }
    }
}

#[tokio::test]
async fn reveal_in_file_manager_rejects_missing_path_before_os_reveal() {
    let error = reveal_in_file_manager("/definitely/missing/file.png".to_string())
        .await
        .expect_err("missing path should fail validation before any OS reveal");

    assert_eq!(error.code, "invalid_path");
    assert!(error.message.contains("failed to resolve"));
}

#[tokio::test]
async fn copy_image_to_clipboard_command_rejects_unsupported_inputs_before_os_write() {
    // Drives the command up to (and failing at) clipboard preparation so the
    // input-validation/error path is covered without performing an OS clipboard
    // write (the OS write step is on the coverage-exclusion list).
    use tauri::test::{mock_builder, mock_context, noop_assets};

    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("mock app should build");

    let dir = TempImageDir::new();
    let unsupported = dir.write("notes.txt", b"plain text");

    let error = imageareo_lib::commands::copy_image_to_clipboard(
        app.handle().clone(),
        unsupported.to_string_lossy().into_owned(),
    )
    .await
    .expect_err("unsupported input should fail before the OS clipboard write");

    assert_eq!(error.code, "unsupported_format");
    assert!(!error.message.is_empty());
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
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
