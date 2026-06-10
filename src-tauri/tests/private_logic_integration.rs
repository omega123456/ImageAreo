use std::path::Path;

use ::image::{self as image_rs, DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage};
use imageareo_lib::commands::clipboard::__test_support as clipboard_private;
use imageareo_lib::commands::reveal::__test_support as reveal_private;
use imageareo_lib::image::__test_support as image_private;
use imageareo_lib::thumbnail::__test_support as thumbnail_private;

#[test]
fn command_private_error_helpers_keep_expected_codes() {
    let clipboard = clipboard_private::clipboard_error("write failed");
    assert_eq!(clipboard.code, "clipboard_failed");
    assert_eq!(clipboard.message, "write failed");

    let invalid = reveal_private::invalid_path_error("bad path");
    assert_eq!(invalid.code, "invalid_path");
    assert_eq!(invalid.message, "bad path");

    let reveal = reveal_private::reveal_error("os reveal failed");
    assert_eq!(reveal.code, "reveal_failed");
    assert_eq!(reveal.message, "os reveal failed");
}

#[test]
fn image_private_helpers_are_covered_from_integration_tests() {
    let dir = tempfile::tempdir().expect("tempdir should create");
    let png = dir.path().join("plain.png");
    let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(4, 3, Rgba([10, 20, 30, 255])));
    image
        .save_with_format(&png, ImageFormat::Png)
        .expect("fixture image should save");

    assert_eq!(
        image_private::normalized_extension_for(Path::new("/tmp/photo.WEBP")).as_deref(),
        Ok("webp")
    );
    let missing_ext = image_private::normalized_extension_for(Path::new("/tmp/noext"))
        .expect_err("missing extension should fail");
    assert_eq!(missing_ext.code, "unsupported_format");

    assert_eq!(image_private::linear_sample_to_u8_for(-0.5), 0);
    assert_eq!(image_private::linear_sample_to_u8_for(0.5), 128);
    assert_eq!(image_private::linear_sample_to_u8_for(1.5), 255);

    let encoded = image_private::encode_png_for(&image).expect("png encode should succeed");
    let decoded = image_rs::load_from_memory_with_format(&encoded, ImageFormat::Png)
        .expect("encoded bytes should decode as png");
    assert_eq!(decoded.dimensions(), (4, 3));

    assert_eq!(image_private::read_orientation_for(&dir.path().join("missing.jpg")), 1);
    assert_eq!(image_private::read_orientation_for(&png), 1);

    let decoded_native = image_private::decode_with_image_crate_for(&png)
        .expect("native decode should succeed");
    assert_eq!(decoded_native.dimensions(), (4, 3));

    let unsupported = image_private::decode_with_image_crate_for(Path::new("/tmp/image.txt"))
        .expect_err("unsupported extension should fail");
    assert_eq!(unsupported.code, "unsupported_format");

    assert_eq!(image_private::unsupported_error("bad extension").code, "unsupported_format");
    assert_eq!(image_private::io_error("disk failed").code, "io_error");
    assert_eq!(image_private::decode_error("decode failed").code, "decode_failed");
    assert_eq!(image_private::encode_error("encode failed").code, "encode_failed");
}

#[test]
fn thumbnail_private_helpers_are_covered_from_integration_tests() {
    let zero = DynamicImage::ImageRgba8(RgbaImage::new(0, 0));
    assert_eq!(thumbnail_private::target_dimensions_for(&zero, 12), (24, 24));

    let landscape =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(20, 10, Rgba([0, 0, 0, 255])));
    let portrait =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(10, 20, Rgba([0, 0, 0, 255])));
    assert_eq!(thumbnail_private::target_dimensions_for(&landscape, 12), (24, 12));
    assert_eq!(thumbnail_private::target_dimensions_for(&portrait, 12), (12, 24));

    let resized = thumbnail_private::resize_image_for(&landscape, 6, 3)
        .expect("resize should succeed");
    assert_eq!(resized.dimensions(), (6, 3));

    let encoded = thumbnail_private::encode_png_for(&RgbaImage::from_pixel(
        3,
        2,
        Rgba([255, 0, 0, 255]),
    ))
    .expect("encode should succeed");
    let decoded = image_rs::load_from_memory_with_format(&encoded, ImageFormat::Png)
        .expect("encoded bytes should decode");
    assert_eq!(decoded.dimensions(), (3, 2));
}
