mod common;

use std::io::Cursor;
use std::path::{Path, PathBuf};

use ::image::{self as image_rs, GenericImageView, ImageFormat};
use common::TempImageDir;
use exif::experimental::Writer as ExifWriter;
use exif::{Field, In, Tag, Value};
use imageareo_lib::commands;
use imageareo_lib::thumbnail;

#[test]
fn generate_thumbnail_resizes_native_images_to_hidpi_bounds() {
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
    let path = fixture_path("sample.heic");

    let thumbnail = thumbnail::generate_thumbnail(&path, 15).expect("thumbnail should succeed");
    let decoded = decode_jpeg_file(Path::new(&thumbnail.path));

    assert_eq!((thumbnail.width, thumbnail.height), (30, 30));
    assert_eq!(decoded.dimensions(), (30, 30));
    assert_cache_path(&thumbnail.path);
}

#[tokio::test]
async fn generate_thumbnail_command_returns_cache_path_for_jxl_fixture() {
    let thumbnail = commands::generate_thumbnail(path_string(&fixture_path("sample.jxl")), 18)
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

    let error = commands::generate_thumbnail(path_string(&unsupported), 16)
        .await
        .expect_err("unsupported input should error through the command");

    assert_eq!(error.code, "unsupported_format");
}

#[test]
fn generate_thumbnail_uses_embedded_exif_thumbnail_without_upscaling() {
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

fn decode_jpeg_file(path: &Path) -> image_rs::DynamicImage {
    image_rs::open(path).expect("thumbnail JPEG should decode")
}

fn assert_cache_path(path: &str) {
    let cache_root = std::env::temp_dir()
        .join("imageareo-thumbnails")
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
