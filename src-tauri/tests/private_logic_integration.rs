use std::path::Path;

use ::image::{self as image_rs, DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage};
use jpeg_decoder::PixelFormat as JpegPixelFormat;
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
    let gif = dir.path().join("plain.gif");
    let webp = dir.path().join("plain.webp");
    let bmp = dir.path().join("plain.bmp");
    let ico = dir.path().join("plain.ico");
    let tiff = dir.path().join("plain.tiff");
    let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(4, 3, Rgba([10, 20, 30, 255])));
    let icon_image =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(16, 16, Rgba([10, 20, 30, 255])));
    image
        .save_with_format(&png, ImageFormat::Png)
        .expect("fixture image should save");
    image
        .save_with_format(&gif, ImageFormat::Gif)
        .expect("fixture image should save");
    image
        .save_with_format(&webp, ImageFormat::WebP)
        .expect("fixture image should save");
    image
        .save_with_format(&bmp, ImageFormat::Bmp)
        .expect("fixture image should save");
    icon_image
        .save_with_format(&ico, ImageFormat::Ico)
        .expect("fixture image should save");
    image
        .save_with_format(&tiff, ImageFormat::Tiff)
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

    assert_eq!(
        image_private::read_orientation_for(&dir.path().join("missing.jpg")),
        1
    );
    assert_eq!(image_private::read_orientation_for(&png), 1);

    let decoded_native =
        image_private::decode_with_image_crate_for(&png).expect("native decode should succeed");
    assert_eq!(decoded_native.dimensions(), (4, 3));
    assert_eq!(
        image_private::decode_with_image_crate_for(&gif)
            .expect("gif decode should succeed")
            .dimensions(),
        (4, 3)
    );
    assert_eq!(
        image_private::decode_with_image_crate_for(&webp)
            .expect("webp decode should succeed")
            .dimensions(),
        (4, 3)
    );
    assert_eq!(
        image_private::decode_with_image_crate_for(&bmp)
            .expect("bmp decode should succeed")
            .dimensions(),
        (4, 3)
    );
    assert_eq!(
        image_private::decode_with_image_crate_for(&ico)
            .expect("ico decode should succeed")
            .dimensions(),
        (16, 16)
    );
    assert_eq!(
        image_private::decode_with_image_crate_for(&tiff)
            .expect("tiff decode should succeed")
            .dimensions(),
        (4, 3)
    );

    let unsupported = image_private::decode_with_image_crate_for(Path::new("/tmp/image.txt"))
        .expect_err("unsupported extension should fail");
    assert_eq!(unsupported.code, "unsupported_format");

    let grayscale = image_private::image_from_jpeg_pixels_for(
        1,
        1,
        JpegPixelFormat::L8,
        vec![77],
        Path::new("/tmp/l8.jpg"),
    )
    .expect("grayscale pixels should convert");
    assert_eq!(grayscale.dimensions(), (1, 1));
    let grayscale_invalid = image_private::image_from_jpeg_pixels_for(
        2,
        1,
        JpegPixelFormat::L8,
        vec![1],
        Path::new("/tmp/l8-invalid.jpg"),
    )
    .expect_err("short grayscale buffer should fail");
    assert_eq!(grayscale_invalid.code, "decode_failed");

    let grayscale16 = image_private::image_from_jpeg_pixels_for(
        1,
        1,
        JpegPixelFormat::L16,
        vec![255, 0],
        Path::new("/tmp/l16.jpg"),
    )
    .expect("16-bit grayscale pixels should convert");
    assert_eq!(grayscale16.dimensions(), (1, 1));
    let grayscale16_invalid = image_private::image_from_jpeg_pixels_for(
        2,
        1,
        JpegPixelFormat::L16,
        vec![255, 0],
        Path::new("/tmp/l16-invalid.jpg"),
    )
    .expect_err("short 16-bit grayscale buffer should fail");
    assert_eq!(grayscale16_invalid.code, "decode_failed");

    let rgb = image_private::image_from_jpeg_pixels_for(
        1,
        1,
        JpegPixelFormat::RGB24,
        vec![12, 34, 56],
        Path::new("/tmp/rgb.jpg"),
    )
    .expect("rgb pixels should convert");
    assert_eq!(rgb.dimensions(), (1, 1));
    let rgb_invalid = image_private::image_from_jpeg_pixels_for(
        2,
        1,
        JpegPixelFormat::RGB24,
        vec![12, 34, 56],
        Path::new("/tmp/rgb-invalid.jpg"),
    )
    .expect_err("short rgb buffer should fail");
    assert_eq!(rgb_invalid.code, "decode_failed");

    let cmyk = image_private::image_from_jpeg_pixels_for(
        1,
        1,
        JpegPixelFormat::CMYK32,
        vec![0, 0, 0, 0],
        Path::new("/tmp/cmyk.jpg"),
    )
    .expect("cmyk pixels should convert");
    assert_eq!(cmyk.dimensions(), (1, 1));
    let cmyk_invalid = image_private::image_from_jpeg_pixels_for(
        2,
        1,
        JpegPixelFormat::CMYK32,
        vec![0, 0, 0, 0],
        Path::new("/tmp/cmyk-invalid.jpg"),
    )
    .expect_err("short cmyk buffer should fail");
    assert_eq!(cmyk_invalid.code, "decode_failed");

    let empty_jpeg = dir.path().join("empty.jpg");
    std::fs::write(&empty_jpeg, []).expect("empty jpeg fixture should write");
    let inspect_error = image_private::decode_with_image_crate_for(&empty_jpeg)
        .expect_err("empty jpeg should fail inspection or decode");
    assert_eq!(inspect_error.code, "decode_failed");

    assert_eq!(
        image_private::unsupported_error("bad extension").code,
        "unsupported_format"
    );
    assert_eq!(image_private::io_error("disk failed").code, "io_error");
    assert_eq!(
        image_private::decode_error("decode failed").code,
        "decode_failed"
    );
    assert_eq!(
        image_private::encode_error("encode failed").code,
        "encode_failed"
    );
}

#[test]
fn thumbnail_private_helpers_are_covered_from_integration_tests() {
    let zero = DynamicImage::ImageRgba8(RgbaImage::new(0, 0));
    assert_eq!(
        thumbnail_private::target_dimensions_for(&zero, 12),
        (24, 24)
    );

    let small_landscape =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(20, 10, Rgba([0, 0, 0, 255])));
    let small_portrait =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(10, 20, Rgba([0, 0, 0, 255])));
    let large_landscape =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(40, 20, Rgba([0, 0, 0, 255])));
    assert_eq!(
        thumbnail_private::target_dimensions_for(&small_landscape, 12),
        (20, 10)
    );
    assert_eq!(
        thumbnail_private::target_dimensions_for(&small_portrait, 12),
        (10, 20)
    );
    assert_eq!(
        thumbnail_private::target_dimensions_for(&large_landscape, 12),
        (24, 12)
    );

    let resized =
        thumbnail_private::resize_image_for(&large_landscape, 6, 3).expect("resize should succeed");
    assert_eq!(resized.dimensions(), (6, 3));

    let encoded =
        thumbnail_private::encode_jpeg_for(&RgbaImage::from_pixel(3, 2, Rgba([255, 0, 0, 255])))
            .expect("encode should succeed");
    let decoded = image_rs::load_from_memory_with_format(&encoded, ImageFormat::Jpeg)
        .expect("encoded bytes should decode");
    assert_eq!(decoded.dimensions(), (3, 2));

    let dir = tempfile::tempdir().expect("tempdir should create");
    let jpeg = dir.path().join("cache-source.jpg");
    DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 6, Rgba([12, 34, 56, 255])))
        .save_with_format(&jpeg, ImageFormat::Jpeg)
        .expect("fixture image should save");
    let cache_path = thumbnail_private::cache_path_for(&jpeg, 12).expect("cache path should build");
    assert_eq!(
        cache_path.extension().and_then(|ext| ext.to_str()),
        Some("jpg")
    );
    let missing_cache_path = thumbnail_private::cache_path_for(Path::new("/tmp/no-such-thumb.jpg"), 12)
        .expect_err("missing source should fail");
    assert_eq!(missing_cache_path.code, "io_error");

    let cache_bytes = thumbnail_private::encode_jpeg_for(&RgbaImage::from_pixel(
        4,
        3,
        Rgba([12, 34, 56, 255]),
    ))
    .expect("encode should succeed");
    thumbnail_private::write_cache_file_for(&cache_path, &cache_bytes)
        .expect("cache write should succeed");
    thumbnail_private::write_cache_file_for(&cache_path, &cache_bytes)
        .expect("rewriting existing cache should succeed");
    let cached_dimensions = thumbnail_private::read_cached_dimensions_for(&cache_path)
        .expect("cached dimensions should decode");
    assert_eq!(cached_dimensions, (4, 3));

    let no_parent_error =
        thumbnail_private::write_cache_file_for(Path::new(""), &cache_bytes)
            .expect_err("cache path without parent should fail");
    assert_eq!(no_parent_error.code, "io_error");

    let blocked_parent = dir.path().join("not-a-dir");
    std::fs::write(&blocked_parent, b"file").expect("blocking file should write");
    let blocked_parent_error = thumbnail_private::write_cache_file_for(
        &blocked_parent.join("thumb.jpg"),
        &cache_bytes,
    )
    .expect_err("existing file parent should fail create_dir_all");
    assert_eq!(blocked_parent_error.code, "io_error");

    let invalid_cached = dir.path().join("invalid-cache.jpg");
    std::fs::write(&invalid_cached, b"not a jpeg").expect("invalid cache fixture should write");
    let invalid_cached_error = thumbnail_private::read_cached_dimensions_for(&invalid_cached)
        .expect_err("invalid cached file should fail");
    assert_eq!(invalid_cached_error.code, "decode_failed");
    let empty_cached = dir.path().join("empty-cache.jpg");
    std::fs::write(&empty_cached, []).expect("empty cache fixture should write");
    let empty_cached_error = thumbnail_private::read_cached_dimensions_for(&empty_cached)
        .expect_err("empty cached file should fail inspection");
    assert_eq!(empty_cached_error.code, "decode_failed");
    let missing_cached_error =
        thumbnail_private::read_cached_dimensions_for(&dir.path().join("missing-cache.jpg"))
            .expect_err("missing cached file should fail");
    assert_eq!(missing_cached_error.code, "io_error");
}
