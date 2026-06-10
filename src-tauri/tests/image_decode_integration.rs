mod common;

use std::io::Cursor;
use std::path::{Path, PathBuf};

use ::image::{self as image_rs, DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage};
use common::TempImageDir;
use imageareo_lib::commands;
use imageareo_lib::image::{self, DecodeImageError};
use rawler::dng::writer::DngWriter;
use rawler::dng::DngCompression;

#[test]
fn decode_image_path_decodes_image_crate_formats_to_png_bytes() {
    let dir = TempImageDir::new();

    for (name, format, expected_dims) in [
        ("sample.avif", ImageFormat::Avif, (3, 2)),
        ("sample.tiff", ImageFormat::Tiff, (4, 3)),
        ("sample.bmp", ImageFormat::Bmp, (5, 4)),
        ("sample.ico", ImageFormat::Ico, (2, 2)),
    ] {
        let image = fixture_image(expected_dims.0, expected_dims.1);
        write_dynamic_image(&dir.path().join(name), &image, format);

        let decoded =
            image::decode_image_path(&dir.path().join(name)).expect("decode should succeed");
        let transport =
            image_rs::load_from_memory_with_format(&decoded.png_bytes, ImageFormat::Png)
                .expect("transport bytes should be PNG");

        assert_eq!((decoded.width, decoded.height), expected_dims);
        assert_eq!(decoded.orientation, 1);
        assert_eq!(transport.dimensions(), expected_dims);
    }
}

#[test]
fn decode_image_path_decodes_heic_and_jxl_fixtures() {
    let heic =
        image::decode_image_path(&fixture_path("sample.heic")).expect("heic fixture should decode");
    let jxl =
        image::decode_image_path(&fixture_path("sample.jxl")).expect("jxl fixture should decode");

    assert_eq!((heic.width, heic.height, heic.orientation), (48, 48, 1));
    assert_eq!((jxl.width, jxl.height, jxl.orientation), (512, 512, 1));
    assert!(!heic.png_bytes.is_empty());
    assert!(!jxl.png_bytes.is_empty());
}

#[test]
fn decode_image_path_uses_raw_preview_with_dng_fixture() {
    let dir = TempImageDir::new();
    let path = dir.path().join("sample.dng");
    write_preview_dng(&path, &fixture_image(16, 12));

    let decoded = image::decode_image_path(&path).expect("raw fixture should decode");
    let transport = image_rs::load_from_memory_with_format(&decoded.png_bytes, ImageFormat::Png)
        .expect("transport bytes should decode");

    assert_eq!((decoded.width, decoded.height), (16, 12));
    assert_eq!(transport.dimensions(), (16, 12));
    assert_eq!(decoded.orientation, 1);
}

#[tokio::test]
async fn decode_image_command_returns_a_png_data_url() {
    let path = fixture_path("sample.heic");

    let decoded = commands::decode_image(path_string(&path))
        .await
        .expect("command should succeed");

    assert!(decoded.data_url.starts_with("data:image/png;base64,"));
    assert_eq!(
        (decoded.width, decoded.height, decoded.orientation),
        (48, 48, 1)
    );
}

#[tokio::test]
async fn decode_image_command_rejects_native_formats() {
    let dir = TempImageDir::new();
    let path = dir.path().join("native.png");
    write_dynamic_image(&path, &fixture_image(1, 1), ImageFormat::Png);

    let error = commands::decode_image(path_string(&path))
        .await
        .expect_err("native decode should be rejected");

    assert_eq!(error.code, "unsupported_format");
    assert!(error.message.contains("frontend"));
}

#[tokio::test]
async fn decode_image_command_returns_structured_errors_for_corrupt_and_unsupported_files() {
    let dir = TempImageDir::new();
    let corrupt_heic = dir.write("broken.heic", b"not a heic");
    let unsupported = dir.write("broken.txt", b"plain text");

    let corrupt_error = commands::decode_image(path_string(&corrupt_heic))
        .await
        .expect_err("corrupt file should fail");
    let unsupported_error = commands::decode_image(path_string(&unsupported))
        .await
        .expect_err("unsupported file should fail");

    assert_decode_error(corrupt_error, "decode_failed");
    assert_decode_error(unsupported_error, "unsupported_format");
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

fn write_preview_dng(path: &Path, preview: &DynamicImage) {
    let mut bytes = Cursor::new(Vec::new());
    let mut writer =
        DngWriter::new(&mut bytes, [1, 6, 0, 0]).expect("dng writer should initialize");

    writer.thumbnail(preview).expect("thumbnail should write");

    let mut raw = writer.subframe_on_root(0);
    raw.rgb_image_u8(
        &preview.to_rgb8().into_raw(),
        preview.width() as usize,
        preview.height() as usize,
        DngCompression::Uncompressed,
        1,
    )
    .expect("raw image should write");
    raw.finalize().expect("raw subframe should finalize");

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

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
