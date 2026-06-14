mod common;

use std::path::Path;

use ::image::ImageFormat;
use common::TempImageDir;
use imageareo_lib::commands::{
    reveal_in_file_manager, validate_clipboard_file_path, validate_reveal_path,
};

#[test]
fn validate_clipboard_file_path_canonicalizes_existing_supported_files() {
    let dir = TempImageDir::new();
    let native = dir.path().join("sample.png");
    common::write_dynamic_fixture(&native, 4, 3, ImageFormat::Png);
    let backend = dir.write("sample.heic", b"original file bytes");

    let native_path = validate_clipboard_file_path(&native).expect("native image should validate");
    let backend_path =
        validate_clipboard_file_path(&backend).expect("backend image should validate");

    assert!(native_path.is_absolute());
    assert!(backend_path.is_absolute());
    assert_eq!(
        native_path.file_name().and_then(|name| name.to_str()),
        Some("sample.png")
    );
    assert_eq!(
        backend_path.file_name().and_then(|name| name.to_str()),
        Some("sample.heic")
    );
}

#[test]
fn validate_clipboard_file_path_returns_structured_errors_for_invalid_inputs() {
    let dir = TempImageDir::new();
    let missing = dir.path().join("missing.heic");
    let unsupported = dir.write("notes.txt", b"plain text");
    let directory = dir.path().join("folder.heic");
    std::fs::create_dir(&directory).expect("fixture directory should be created");

    let missing_error =
        validate_clipboard_file_path(&missing).expect_err("missing file should fail");
    let unsupported_error =
        validate_clipboard_file_path(&unsupported).expect_err("unsupported file should fail");
    let directory_error =
        validate_clipboard_file_path(&directory).expect_err("directory should fail");

    assert_eq!(missing_error.code, "io_error");
    assert!(!missing_error.message.is_empty());
    assert_eq!(unsupported_error.code, "unsupported_format");
    assert!(!unsupported_error.message.is_empty());
    assert_eq!(directory_error.code, "io_error");
    assert!(directory_error.message.contains("not a file"));
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
    // Drives the command up to (and failing at) path validation so the
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
