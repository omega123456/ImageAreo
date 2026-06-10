mod common;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use ::image::{self as image_rs, DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage};
use common::TempImageDir;
use imageareo_lib::commands::clipboard::ClipboardCommandError;
use imageareo_lib::commands::reveal::RevealCommandError;
use imageareo_lib::commands::{self};
use imageareo_lib::image::{self, ImageFormatSupport};
use imageareo_lib::menu::{self, ids, MenuAction, MENU_EVENT};
use imageareo_lib::startup::{parse_launch_path, LaunchPathBuffer};
use imageareo_lib::thumbnail;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Listener;

fn write_image(path: &Path, width: u32, height: u32, format: ImageFormat) {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
        width,
        height,
        Rgba([32, 64, 128, 255]),
    ));
    image
        .save_with_format(path, format)
        .expect("fixture image should save");
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

#[test]
fn startup_parse_launch_path_and_buffer_flow_work() {
    assert_eq!(
        parse_launch_path(["imageareo.exe", "--debug", "", "/photos/a.jpg"]).as_deref(),
        Some("/photos/a.jpg")
    );
    assert_eq!(parse_launch_path(["imageareo"]), None);

    let buffer = LaunchPathBuffer::new();
    assert!(!buffer.offer("/photos/first.jpg".into()));
    assert!(!buffer.offer("/photos/second.jpg".into()));
    assert_eq!(buffer.mark_ready().as_deref(), Some("/photos/second.jpg"));
    assert_eq!(buffer.mark_ready(), None);
    assert!(buffer.offer("/photos/warm.jpg".into()));
}

#[test]
fn menu_actions_map_ids_and_emit_known_events_only() {
    assert_eq!(MenuAction::from_id(ids::OPEN), MenuAction::OpenDialog);
    assert_eq!(
        MenuAction::from_id(ids::OPEN_FOLDER),
        MenuAction::OpenFolderDialog
    );
    assert_eq!(MenuAction::from_id("predefined.quit"), MenuAction::Unknown);
    assert_eq!(MenuAction::from_id("predefined.quit").frontend_key(), None);

    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("mock app should build");
    let received = Arc::new(Mutex::new(Vec::<String>::new()));
    let captured = Arc::clone(&received);

    let handler_id = app.listen(MENU_EVENT, move |event| {
        let payload = serde_json::from_str::<String>(event.payload())
            .expect("payload should decode from json");
        captured
            .lock()
            .expect("event log should unlock")
            .push(payload);
    });

    menu::route_menu_event(app.handle(), ids::FIT);
    menu::route_menu_event(app.handle(), "predefined.quit");
    app.unlisten(handler_id);

    assert_eq!(
        received.lock().expect("event log should unlock").as_slice(),
        [ids::FIT]
    );
}

#[tokio::test]
async fn commands_return_expected_transport_shapes() {
    let dir = TempImageDir::new();
    let later = dir.path().join("image-02.png");
    let earlier = dir.path().join("image-01.png");
    write_image(&later, 2, 2, ImageFormat::Png);
    write_image(&earlier, 2, 2, ImageFormat::Png);

    let entries = commands::scan_folder(dir.path().to_string_lossy().into_owned(), None)
        .await
        .expect("scan should succeed");
    let names: Vec<_> = entries.into_iter().map(|entry| entry.name).collect();
    assert_eq!(names, vec!["image-01.png", "image-02.png"]);

    let decoded =
        commands::decode_image(fixture_path("sample.heic").to_string_lossy().into_owned())
            .await
            .expect("decode command should succeed");
    assert!(decoded.data_url.starts_with("data:image/png;base64,"));
    assert_eq!(
        (decoded.width, decoded.height, decoded.orientation),
        (48, 48, 1)
    );

    let thumbnail = commands::generate_thumbnail(
        fixture_path("sample.jxl").to_string_lossy().into_owned(),
        12,
    )
    .await
    .expect("thumbnail command should succeed");
    let cache_root = std::env::temp_dir()
        .join("imageareo-thumbnails")
        .to_string_lossy()
        .into_owned();
    assert!(thumbnail.path.starts_with(&cache_root));
}

#[test]
fn image_public_logic_handles_classification_and_missing_backend_paths() {
    assert_eq!(
        image::classify_extension(".JPG"),
        Some(ImageFormatSupport::Native)
    );
    assert_eq!(
        image::classify_extension("HEIC"),
        Some(ImageFormatSupport::NeedsBackend)
    );
    assert!(image::native_extensions().contains(&"jpg"));
    assert!(image::backend_extensions().contains(&"jxl"));

    let dir = TempImageDir::new();
    let png = dir.path().join("plain.png");
    write_image(&png, 4, 3, ImageFormat::Png);

    let loaded = image::load_supported_image_path(&png).expect("native image should decode");
    assert_eq!(loaded.image.dimensions(), (4, 3));
    assert_eq!(loaded.orientation, 1);

    let jpeg = dir.path().join("large.jpg");
    write_image(&jpeg, 1600, 1200, ImageFormat::Jpeg);
    let thumbnail_source =
        image::load_thumbnail_source(&jpeg, 64).expect("thumbnail source should decode");
    assert!(thumbnail_source.image.width() < 1600);
    assert!(thumbnail_source.image.height() < 1200);
    assert_eq!(thumbnail_source.orientation, 1);

    let missing_heic = dir.path().join("missing.heic");
    let missing_jxl = dir.path().join("missing.jxl");
    let missing_raw = dir.path().join("missing.cr2");
    assert_eq!(
        image::decode_image_path(&missing_heic)
            .expect_err("missing heic should fail")
            .code,
        "io_error"
    );
    assert_eq!(
        image::decode_image_path(&missing_jxl)
            .expect_err("missing jxl should fail")
            .code,
        "decode_failed"
    );
    assert_eq!(
        image::decode_image_path(&missing_raw)
            .expect_err("missing raw should fail")
            .code,
        "decode_failed"
    );
}

#[test]
fn thumbnail_public_logic_handles_missing_files() {
    let dir = TempImageDir::new();
    let missing = dir.path().join("missing.png");

    let error = thumbnail::generate_thumbnail(&missing, 12).expect_err("missing file should fail");
    assert_eq!(error.code, "io_error");
}

#[test]
fn command_error_structs_keep_expected_codes() {
    let clipboard = ClipboardCommandError {
        code: "clipboard_failed",
        message: "write failed".to_string(),
    };
    let reveal_invalid = RevealCommandError {
        code: "invalid_path",
        message: "bad path".to_string(),
    };
    let reveal_runtime = RevealCommandError {
        code: "reveal_failed",
        message: "os reveal failed".to_string(),
    };

    assert_eq!(clipboard.code, "clipboard_failed");
    assert_eq!(reveal_invalid.code, "invalid_path");
    assert_eq!(reveal_runtime.code, "reveal_failed");
}

#[test]
fn encoded_png_transport_from_public_decoder_is_decodable() {
    let decoded =
        image::decode_image_path(&fixture_path("sample.heic")).expect("heic fixture should decode");
    let transport = image_rs::load_from_memory_with_format(&decoded.png_bytes, ImageFormat::Png)
        .expect("transport should decode as png");

    assert_eq!(transport.dimensions(), (48, 48));
}
