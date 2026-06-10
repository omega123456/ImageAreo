mod common;

use std::path::{Path, PathBuf};

use ::image::{self as image_rs, GenericImageView, ImageFormat};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use common::TempImageDir;
use imageareo_lib::commands;
use imageareo_lib::thumbnail;

#[test]
fn generate_thumbnail_resizes_native_images_to_hidpi_bounds() {
    let dir = TempImageDir::new();
    let path = dir.path().join("native.png");
    common::write_dynamic_fixture(&path, 20, 10, ImageFormat::Png);

    let thumbnail = thumbnail::generate_thumbnail(&path, 12).expect("thumbnail should succeed");
    let decoded = decode_data_url_image(&thumbnail.data_url);

    assert_eq!((thumbnail.width, thumbnail.height), (24, 12));
    assert_eq!(decoded.dimensions(), (24, 12));
}

#[test]
fn generate_thumbnail_preserves_aspect_ratio_for_exotic_fixture() {
    let path = fixture_path("sample.heic");

    let thumbnail = thumbnail::generate_thumbnail(&path, 15).expect("thumbnail should succeed");
    let decoded = decode_data_url_image(&thumbnail.data_url);

    assert_eq!((thumbnail.width, thumbnail.height), (30, 30));
    assert_eq!(decoded.dimensions(), (30, 30));
}

#[tokio::test]
async fn generate_thumbnail_command_returns_png_data_url_for_jxl_fixture() {
    let thumbnail = commands::generate_thumbnail(path_string(&fixture_path("sample.jxl")), 18)
        .await
        .expect("command should succeed");
    let decoded = decode_data_url_image(&thumbnail.data_url);

    assert!(thumbnail.data_url.starts_with("data:image/png;base64,"));
    assert_eq!(decoded.dimensions(), (36, 36));
}

fn decode_data_url_image(data_url: &str) -> image_rs::DynamicImage {
    let encoded = data_url
        .strip_prefix("data:image/png;base64,")
        .expect("thumbnail should be a PNG data URL");
    let bytes = STANDARD
        .decode(encoded)
        .expect("thumbnail should decode from base64");

    image_rs::load_from_memory_with_format(&bytes, ImageFormat::Png)
        .expect("thumbnail PNG should decode")
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
