//! `read_image_metadata` behaviour (info-card Phase 1).
//!
//! Covers: a JPEG carrying EXIF (camera fields + orientation populated, File/Image
//! facts correct); an image with no camera EXIF (camera = None, File/Image still
//! correct); best-effort color type / bit depth header-side; and a missing/invalid
//! path returning a structured error rather than panicking. No pixel decode occurs
//! (metadata reuses the header-only probe path).

mod common;

use std::path::Path;

use ::image::{ColorType, DynamicImage, ImageFormat, Rgba, RgbaImage};
use common::TempImageDir;
use imageareo_lib::commands::ImageMetadata;
use imageareo_lib::image::{self, gather_image_metadata, DecodeImageError};

fn fixture_image(width: u32, height: u32) -> DynamicImage {
    DynamicImage::ImageRgba8(RgbaImage::from_fn(width, height, |x, y| {
        Rgba([
            ((x + 1) * 17) as u8,
            ((y + 1) * 29) as u8,
            ((x + y + 1) * 13) as u8,
            u8::MAX,
        ])
    }))
}

// ---------------------------------------------------------------------------
// Minimal little-endian TIFF/EXIF builder, spliced into a JPEG APP1 segment.
// Builds IFD0 (Make/Model/Orientation + an Exif sub-IFD pointer) and an Exif IFD
// (LensModel/ISO/FNumber/ExposureTime/FocalLength/DateTimeOriginal). Just enough
// for kamadak-exif to round-trip the camera fields the command extracts.
// ---------------------------------------------------------------------------

const TYPE_ASCII: u16 = 2;
const TYPE_SHORT: u16 = 3;
const TYPE_RATIONAL: u16 = 5;

enum FieldValue {
    Ascii(String),
    Short(u16),
    Rational(u32, u32),
}

struct Entry {
    tag: u16,
    value: FieldValue,
}

fn ascii_bytes(text: &str) -> Vec<u8> {
    let mut bytes = text.as_bytes().to_vec();
    bytes.push(0);
    bytes
}

/// Serialize one IFD. `external_start` is the absolute file offset (from TIFF
/// header start) where this IFD's overflow data region begins. Returns
/// (ifd_bytes, external_bytes). `next_ifd_offset` is written as the IFD's
/// "next IFD" pointer.
fn build_ifd(entries: &[Entry], external_start: usize, next_ifd_offset: u32) -> (Vec<u8>, Vec<u8>) {
    let count = entries.len() as u16;
    let mut ifd = Vec::new();
    let mut external = Vec::new();
    ifd.extend_from_slice(&count.to_le_bytes());

    for entry in entries {
        ifd.extend_from_slice(&entry.tag.to_le_bytes());
        match &entry.value {
            FieldValue::Ascii(text) => {
                let data = ascii_bytes(text);
                ifd.extend_from_slice(&TYPE_ASCII.to_le_bytes());
                ifd.extend_from_slice(&(data.len() as u32).to_le_bytes());
                if data.len() <= 4 {
                    let mut inline = [0u8; 4];
                    inline[..data.len()].copy_from_slice(&data);
                    ifd.extend_from_slice(&inline);
                } else {
                    let offset = (external_start + external.len()) as u32;
                    ifd.extend_from_slice(&offset.to_le_bytes());
                    external.extend_from_slice(&data);
                }
            }
            FieldValue::Short(value) => {
                ifd.extend_from_slice(&TYPE_SHORT.to_le_bytes());
                ifd.extend_from_slice(&1u32.to_le_bytes());
                let mut inline = [0u8; 4];
                inline[..2].copy_from_slice(&value.to_le_bytes());
                ifd.extend_from_slice(&inline);
            }
            FieldValue::Rational(num, denom) => {
                ifd.extend_from_slice(&TYPE_RATIONAL.to_le_bytes());
                ifd.extend_from_slice(&1u32.to_le_bytes());
                let offset = (external_start + external.len()) as u32;
                ifd.extend_from_slice(&offset.to_le_bytes());
                external.extend_from_slice(&num.to_le_bytes());
                external.extend_from_slice(&denom.to_le_bytes());
            }
        }
    }
    ifd.extend_from_slice(&next_ifd_offset.to_le_bytes());
    (ifd, external)
}

/// Build a TIFF/EXIF block with IFD0 + an Exif sub-IFD. Tag 0x8769 in IFD0 points
/// at the Exif IFD.
fn build_exif_tiff() -> Vec<u8> {
    // TIFF header: "II", magic 42, offset to IFD0 (8).
    let header_len = 8usize;

    // Exif IFD entries.
    let exif_entries = vec![
        Entry { tag: 0xA434, value: FieldValue::Ascii("RF24-105mm F4".to_string()) }, // LensModel
        Entry { tag: 0x8827, value: FieldValue::Short(400) },                          // PhotographicSensitivity (ISO)
        Entry { tag: 0x829D, value: FieldValue::Rational(4, 1) },                       // FNumber f/4
        Entry { tag: 0x829A, value: FieldValue::Rational(1, 250) },                     // ExposureTime 1/250
        Entry { tag: 0x920A, value: FieldValue::Rational(50, 1) },                      // FocalLength 50mm
        Entry { tag: 0x9003, value: FieldValue::Ascii("2026:06:10 14:32:00".to_string()) }, // DateTimeOriginal
    ];

    // We must lay out: [header][IFD0][IFD0 external][Exif IFD][Exif external].
    // IFD0 has 4 entries (Make, Model, Orientation, ExifIFDPointer). Compute sizes.
    let ifd0_count = 4usize;
    let ifd0_size = 2 + ifd0_count * 12 + 4;
    // Probe IFD0 external size by building with a placeholder external_start, then
    // recompute offsets. Simpler: compute external bytes lengths directly.
    let make = ascii_bytes("Canon"); // <=4? "Canon\0" = 6 > 4 -> external
    let model = ascii_bytes("Canon EOS R6"); // external
    let ifd0_external_len = make.len() + model.len();

    let ifd0_external_start = header_len + ifd0_size;
    let exif_ifd_start = ifd0_external_start + ifd0_external_len;
    let exif_ifd_size = 2 + exif_entries.len() * 12 + 4;
    let exif_external_start = exif_ifd_start + exif_ifd_size;

    let ifd0_entries = vec![
        Entry { tag: 0x010F, value: FieldValue::Ascii("Canon".to_string()) },       // Make
        Entry { tag: 0x0110, value: FieldValue::Ascii("Canon EOS R6".to_string()) }, // Model
        Entry { tag: 0x0112, value: FieldValue::Short(1) },                          // Orientation
        Entry { tag: 0x8769, value: FieldValue::Short(0) },                          // placeholder, fixed below
    ];

    let (mut ifd0, ifd0_external) = build_ifd(&ifd0_entries, ifd0_external_start, 0);
    // Overwrite the ExifIFDPointer (last entry) to a LONG pointing at exif_ifd_start.
    // Last entry's value field is at: 2 + 3*12 + 8 (tag+type+count) within ifd0.
    let ptr_value_pos = 2 + 3 * 12 + 8;
    // Rewrite type to LONG (4) and count 1, value = exif_ifd_start.
    ifd0[2 + 3 * 12 + 2..2 + 3 * 12 + 4].copy_from_slice(&4u16.to_le_bytes());
    ifd0[2 + 3 * 12 + 4..2 + 3 * 12 + 8].copy_from_slice(&1u32.to_le_bytes());
    ifd0[ptr_value_pos..ptr_value_pos + 4]
        .copy_from_slice(&(exif_ifd_start as u32).to_le_bytes());

    let (exif_ifd, exif_external) = build_ifd(&exif_entries, exif_external_start, 0);

    let mut tiff = Vec::new();
    tiff.extend_from_slice(b"II");
    tiff.extend_from_slice(&42u16.to_le_bytes());
    tiff.extend_from_slice(&8u32.to_le_bytes());
    tiff.extend_from_slice(&ifd0);
    tiff.extend_from_slice(&ifd0_external);
    tiff.extend_from_slice(&exif_ifd);
    tiff.extend_from_slice(&exif_external);
    tiff
}

/// Wrap a TIFF/EXIF block in a JPEG APP1 segment and splice it into a real JPEG
/// (right after SOI), producing a valid JPEG carrying EXIF.
fn write_jpeg_with_exif(path: &Path, width: u32, height: u32) {
    let mut base = Vec::new();
    fixture_image(width, height)
        .to_rgb8()
        .write_to(&mut std::io::Cursor::new(&mut base), ImageFormat::Jpeg)
        .expect("base jpeg should encode");

    let tiff = build_exif_tiff();
    let mut app1_payload = Vec::new();
    app1_payload.extend_from_slice(b"Exif\0\0");
    app1_payload.extend_from_slice(&tiff);
    let segment_len = (app1_payload.len() + 2) as u16;

    let mut out = Vec::new();
    out.extend_from_slice(&base[0..2]); // SOI
    out.extend_from_slice(&[0xFF, 0xE1]); // APP1
    out.extend_from_slice(&segment_len.to_be_bytes());
    out.extend_from_slice(&app1_payload);
    out.extend_from_slice(&base[2..]); // rest of JPEG
    std::fs::write(path, out).expect("jpeg with exif should write");
}

/// Build a TIFF/EXIF block carrying only an IFD0 Orientation tag (no camera
/// fields, no Exif sub-IFD). Exercises the "EXIF container present, orientation
/// read, camera = None" path in `gather_image_metadata`.
fn build_orientation_only_tiff(orientation: u16) -> Vec<u8> {
    let ifd0_entries = vec![Entry {
        tag: 0x0112,
        value: FieldValue::Short(orientation),
    }];
    let header_len = 8usize;
    let ifd0_size = 2 + ifd0_entries.len() * 12 + 4;
    let ifd0_external_start = header_len + ifd0_size;
    let (ifd0, ifd0_external) = build_ifd(&ifd0_entries, ifd0_external_start, 0);

    let mut tiff = Vec::new();
    tiff.extend_from_slice(b"II");
    tiff.extend_from_slice(&42u16.to_le_bytes());
    tiff.extend_from_slice(&8u32.to_le_bytes());
    tiff.extend_from_slice(&ifd0);
    tiff.extend_from_slice(&ifd0_external);
    tiff
}

/// Build a TIFF/EXIF block with IFD0 → an Exif sub-IFD carrying only
/// `PixelXDimension`/`PixelYDimension`. Used to exercise the RAW dimension
/// correction: a RAW's probe reads its tiny embedded-thumbnail IFD, so the real
/// main-image size has to come from these EXIF tags.
fn build_pixel_dimensions_tiff(pixel_x: u16, pixel_y: u16) -> Vec<u8> {
    let header_len = 8usize;

    let exif_entries = vec![
        Entry { tag: 0xA002, value: FieldValue::Short(pixel_x) }, // PixelXDimension
        Entry { tag: 0xA003, value: FieldValue::Short(pixel_y) }, // PixelYDimension
    ];

    // IFD0 holds a single entry: the Exif sub-IFD pointer (0x8769). Both Exif
    // entries are inline SHORTs, so neither IFD carries external overflow data.
    let ifd0_count = 1usize;
    let ifd0_size = 2 + ifd0_count * 12 + 4;
    let exif_ifd_start = header_len + ifd0_size;
    let exif_ifd_size = 2 + exif_entries.len() * 12 + 4;
    let exif_external_start = exif_ifd_start + exif_ifd_size;

    let ifd0_entries = vec![Entry { tag: 0x8769, value: FieldValue::Short(0) }]; // placeholder
    let (mut ifd0, ifd0_external) = build_ifd(&ifd0_entries, exif_ifd_start, 0);
    // Rewrite the sole entry (ExifIFDPointer) to a LONG pointing at exif_ifd_start.
    let ptr_value_pos = 2 + 8;
    ifd0[2 + 2..2 + 4].copy_from_slice(&4u16.to_le_bytes()); // type LONG
    ifd0[2 + 4..2 + 8].copy_from_slice(&1u32.to_le_bytes()); // count 1
    ifd0[ptr_value_pos..ptr_value_pos + 4].copy_from_slice(&(exif_ifd_start as u32).to_le_bytes());

    let (exif_ifd, exif_external) = build_ifd(&exif_entries, exif_external_start, 0);

    let mut tiff = Vec::new();
    tiff.extend_from_slice(b"II");
    tiff.extend_from_slice(&42u16.to_le_bytes());
    tiff.extend_from_slice(&8u32.to_le_bytes());
    tiff.extend_from_slice(&ifd0);
    tiff.extend_from_slice(&ifd0_external);
    tiff.extend_from_slice(&exif_ifd);
    tiff.extend_from_slice(&exif_external);
    tiff
}

/// Build a bare TIFF (the DNG container shape) whose IFD0 carries the small
/// embedded-thumbnail dimensions plus a SubIFDs pointer, and a SubIFD carrying the
/// full sensor dimensions. Exercises the TIFF SubIFD walk that recovers a RAW's
/// real size (IFD0 is the thumbnail; the full image lives in a SubIFD).
fn build_tiff_with_subifd(thumb: (u16, u16), full: (u16, u16)) -> Vec<u8> {
    let header_len = 8usize;
    let ifd0_count = 3usize;
    let ifd0_size = 2 + ifd0_count * 12 + 4;
    let subifd_offset = header_len + ifd0_size;

    let ifd0_entries = vec![
        Entry { tag: 0x0100, value: FieldValue::Short(thumb.0) }, // ImageWidth
        Entry { tag: 0x0101, value: FieldValue::Short(thumb.1) }, // ImageLength
        Entry { tag: 0x014A, value: FieldValue::Short(subifd_offset as u16) }, // SubIFDs pointer
    ];
    let (ifd0, ifd0_external) = build_ifd(&ifd0_entries, subifd_offset, 0);
    assert!(ifd0_external.is_empty(), "fixture IFD0 must be inline-only");

    let subifd_entries = vec![
        Entry { tag: 0x0100, value: FieldValue::Short(full.0) },
        Entry { tag: 0x0101, value: FieldValue::Short(full.1) },
    ];
    let subifd_size = 2 + subifd_entries.len() * 12 + 4;
    let (subifd, subifd_external) = build_ifd(&subifd_entries, subifd_offset + subifd_size, 0);

    let mut tiff = Vec::new();
    tiff.extend_from_slice(b"II");
    tiff.extend_from_slice(&42u16.to_le_bytes());
    tiff.extend_from_slice(&8u32.to_le_bytes());
    tiff.extend_from_slice(&ifd0);
    tiff.extend_from_slice(&ifd0_external);
    tiff.extend_from_slice(&subifd);
    tiff.extend_from_slice(&subifd_external);
    tiff
}

fn write_jpeg_with_tiff(path: &Path, width: u32, height: u32, tiff: &[u8]) {
    let mut base = Vec::new();
    fixture_image(width, height)
        .to_rgb8()
        .write_to(&mut std::io::Cursor::new(&mut base), ImageFormat::Jpeg)
        .expect("base jpeg should encode");

    let mut app1_payload = Vec::new();
    app1_payload.extend_from_slice(b"Exif\0\0");
    app1_payload.extend_from_slice(tiff);
    let segment_len = (app1_payload.len() + 2) as u16;

    let mut out = Vec::new();
    out.extend_from_slice(&base[0..2]); // SOI
    out.extend_from_slice(&[0xFF, 0xE1]); // APP1
    out.extend_from_slice(&segment_len.to_be_bytes());
    out.extend_from_slice(&app1_payload);
    out.extend_from_slice(&base[2..]); // rest of JPEG
    std::fs::write(path, out).expect("jpeg with exif should write");
}

#[test]
fn metadata_reads_orientation_but_no_camera_when_camera_fields_absent() {
    let dir = TempImageDir::new();
    let path = dir.path().join("oriented.jpg");
    // EXIF container present with Orientation=6 but no camera fields.
    write_jpeg_with_tiff(&path, 200, 120, &build_orientation_only_tiff(6));

    let meta = gather_image_metadata(&path).expect("metadata should read");
    assert_eq!(meta.orientation, 6);
    assert!(meta.camera.is_none());
}

#[test]
fn metadata_reads_file_and_image_facts_for_a_plain_png() {
    let dir = TempImageDir::new();
    let path = dir.path().join("plain.png");
    fixture_image(64, 48)
        .save_with_format(&path, ImageFormat::Png)
        .expect("png should save");

    let meta = gather_image_metadata(&path).expect("metadata should read");
    assert_eq!(meta.file_name, "plain.png");
    assert_eq!(meta.file_path, path.to_string_lossy());
    assert_eq!(meta.format, "PNG");
    assert_eq!(meta.width, 64);
    assert_eq!(meta.height, 48);
    assert_eq!(meta.pixels, 64 * 48);
    assert_eq!(meta.orientation, 1);
    assert!(meta.file_size_bytes > 0);
    // RGBA PNG, 8 bits per channel.
    assert_eq!(meta.color_type.as_deref(), Some("RGBA"));
    assert_eq!(meta.bit_depth, Some(8));
    // No camera EXIF.
    assert!(meta.camera.is_none());
}

#[test]
fn metadata_populates_camera_fields_for_a_jpeg_with_exif() {
    let dir = TempImageDir::new();
    let path = dir.path().join("shot.jpg");
    write_jpeg_with_exif(&path, 4032, 3024);

    let meta = gather_image_metadata(&path).expect("metadata should read");
    assert_eq!(meta.format, "JPEG");
    assert_eq!((meta.width, meta.height), (4032, 3024));
    assert_eq!(meta.orientation, 1);
    assert_eq!(meta.color_type.as_deref(), Some("RGB"));
    assert_eq!(meta.bit_depth, Some(8));

    let camera = meta.camera.expect("camera EXIF should be present");
    assert_eq!(camera.make.as_deref(), Some("Canon"));
    assert_eq!(camera.model.as_deref(), Some("Canon EOS R6"));
    assert_eq!(camera.lens.as_deref(), Some("RF24-105mm F4"));
    assert_eq!(camera.iso, Some(400));
    assert_eq!(camera.aperture, Some(4.0));
    assert_eq!(camera.shutter_speed.as_deref(), Some("1/250"));
    assert_eq!(camera.focal_length, Some(50.0));
    // kamadak-exif's display_value normalizes the EXIF date separators to dashes.
    assert_eq!(camera.date_taken.as_deref(), Some("2026-06-10 14:32:00"));
}

#[test]
fn metadata_survives_a_malformed_subifd_count() {
    // A TIFF whose SubIFDs entry declares a near-u32::MAX offset count. The walk
    // must clamp the allocation and bail gracefully (not panic / OOM), keeping the
    // IFD0 dimensions.
    let mut tiff: Vec<u8> = Vec::new();
    tiff.extend_from_slice(b"II");
    tiff.extend_from_slice(&42u16.to_le_bytes());
    tiff.extend_from_slice(&8u32.to_le_bytes()); // IFD0 at offset 8

    // IFD0: 3 entries + next pointer.
    tiff.extend_from_slice(&3u16.to_le_bytes());
    // ImageWidth = 100 (SHORT).
    tiff.extend_from_slice(&0x0100u16.to_le_bytes());
    tiff.extend_from_slice(&3u16.to_le_bytes());
    tiff.extend_from_slice(&1u32.to_le_bytes());
    tiff.extend_from_slice(&100u32.to_le_bytes());
    // ImageLength = 80 (SHORT).
    tiff.extend_from_slice(&0x0101u16.to_le_bytes());
    tiff.extend_from_slice(&3u16.to_le_bytes());
    tiff.extend_from_slice(&1u32.to_le_bytes());
    tiff.extend_from_slice(&80u32.to_le_bytes());
    // SubIFDs (0x014A), LONG, bogus huge count, pointer = 8.
    tiff.extend_from_slice(&0x014Au16.to_le_bytes());
    tiff.extend_from_slice(&4u16.to_le_bytes());
    tiff.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
    tiff.extend_from_slice(&8u32.to_le_bytes());
    // Next IFD = 0.
    tiff.extend_from_slice(&0u32.to_le_bytes());

    let dir = TempImageDir::new();
    let path = dir.path().join("malformed.dng");
    std::fs::write(&path, &tiff).expect("malformed dng should write");

    let meta = gather_image_metadata(&path).expect("metadata should read without panicking");
    assert_eq!((meta.width, meta.height), (100, 80));
}

#[test]
fn metadata_reads_full_dimensions_from_tiff_subifd_for_raw() {
    let dir = TempImageDir::new();
    let path = dir.path().join("DSC06780.dng");
    // IFD0 = 256×171 embedded thumbnail; the full 8672×5784 sensor image lives in
    // a SubIFD, exactly as a real DNG lays it out.
    std::fs::write(&path, build_tiff_with_subifd((256, 171), (8672, 5784)))
        .expect("dng fixture should write");

    let meta = gather_image_metadata(&path).expect("metadata should read");
    assert_eq!(meta.format, "DNG");
    assert_eq!((meta.width, meta.height), (8672, 5784));
    assert_eq!(meta.pixels, 8672 * 5784);
}

#[test]
fn metadata_prefers_exif_pixel_dimensions_for_raw() {
    let dir = TempImageDir::new();
    let path = dir.path().join("DSC06780.dng");
    // The JPEG content stands in for a RAW's tiny embedded thumbnail IFD (256×171),
    // while EXIF carries the real 8640×5760 main-image dimensions.
    write_jpeg_with_tiff(&path, 256, 171, &build_pixel_dimensions_tiff(8640, 5760));

    let meta = gather_image_metadata(&path).expect("metadata should read");
    assert_eq!(meta.format, "DNG");
    assert_eq!((meta.width, meta.height), (8640, 5760));
    assert_eq!(meta.pixels, 8640 * 5760);
}

#[test]
fn metadata_ignores_exif_pixel_dimensions_for_non_raw() {
    let dir = TempImageDir::new();
    let path = dir.path().join("photo.jpg");
    write_jpeg_with_tiff(&path, 256, 171, &build_pixel_dimensions_tiff(8640, 5760));

    let meta = gather_image_metadata(&path).expect("metadata should read");
    // A non-RAW format trusts the probe (real pixels), never the EXIF tags.
    assert_eq!((meta.width, meta.height), (256, 171));
}

#[test]
fn metadata_falls_back_to_probe_for_raw_without_exif_dimensions() {
    let dir = TempImageDir::new();
    let path = dir.path().join("nodims.dng");
    // RAW extension but no PixelX/YDimension tags → keep the probe dimensions.
    write_jpeg_with_tiff(&path, 200, 120, &build_orientation_only_tiff(1));

    let meta = gather_image_metadata(&path).expect("metadata should read");
    assert_eq!((meta.width, meta.height), (200, 120));
}

#[test]
fn metadata_command_struct_maps_from_parts() {
    let dir = TempImageDir::new();
    let path = dir.path().join("shot.jpg");
    write_jpeg_with_exif(&path, 100, 80);

    let parts = gather_image_metadata(&path).expect("metadata should read");
    let dto = ImageMetadata::from(parts);
    let json = serde_json::to_value(&dto).expect("serialize");
    // camelCase serialization shape the frontend types must match.
    assert_eq!(json["fileName"], "shot.jpg");
    assert_eq!(json["fileSizeBytes"].is_u64(), true);
    assert_eq!(json["colorType"], "RGB");
    assert_eq!(json["bitDepth"], 8);
    assert_eq!(json["camera"]["make"], "Canon");
    assert_eq!(json["camera"]["shutterSpeed"], "1/250");
    assert_eq!(json["camera"]["focalLength"], 50.0);
}

#[test]
fn metadata_errors_for_a_missing_path() {
    let dir = TempImageDir::new();
    let path = dir.path().join("does-not-exist.jpg");
    let err: DecodeImageError = gather_image_metadata(&path).unwrap_err();
    assert_eq!(err.code, "io_error");
    assert!(!err.message.is_empty());
}

#[test]
fn metadata_errors_for_a_directory() {
    let dir = TempImageDir::new();
    let err = gather_image_metadata(dir.path()).unwrap_err();
    assert_eq!(err.code, "io_error");
}

#[test]
fn metadata_errors_for_a_corrupt_header() {
    let dir = TempImageDir::new();
    let path = dir.write("garbage.jpg", b"not a real image at all");
    let err = gather_image_metadata(&path).unwrap_err();
    // Probe rejects the unreadable header with a structured decode error.
    assert_eq!(err.code, "decode_failed");
}

#[test]
fn color_helpers_label_each_color_type() {
    assert_eq!(image::__test_support::color_type_label_for(ColorType::L8), "Grayscale");
    assert_eq!(
        image::__test_support::color_type_label_for(ColorType::La8),
        "Grayscale + Alpha"
    );
    assert_eq!(image::__test_support::color_type_label_for(ColorType::Rgb8), "RGB");
    assert_eq!(image::__test_support::color_type_label_for(ColorType::Rgba8), "RGBA");
    assert_eq!(image::__test_support::color_type_label_for(ColorType::Rgb16), "RGB");

    assert_eq!(image::__test_support::bits_per_channel_for(ColorType::Rgb8), 8);
    assert_eq!(image::__test_support::bits_per_channel_for(ColorType::Rgb16), 16);
    assert_eq!(image::__test_support::bits_per_channel_for(ColorType::L16), 16);
}

#[test]
fn format_label_maps_extensions_and_falls_back() {
    let dir = TempImageDir::new();
    assert_eq!(image::__test_support::format_label_for(Path::new("a.HEIC")), "HEIC");
    assert_eq!(image::__test_support::format_label_for(Path::new("a.jxl")), "JPEG XL");
    assert_eq!(image::__test_support::format_label_for(Path::new("a.cr2")), "CR2");
    assert_eq!(image::__test_support::format_label_for(Path::new("noext")), "Unknown");
    let _ = dir; // keep import symmetry
}

#[test]
fn rational_label_formats_fractions_and_whole_seconds() {
    assert_eq!(image::__test_support::rational_label_for(1, 250), "1/250");
    assert_eq!(image::__test_support::rational_label_for(2, 1), "2");
    assert_eq!(image::__test_support::rational_label_for(1, 1), "1");
    assert_eq!(image::__test_support::rational_label_for(10, 300), "10/300");
    assert_eq!(image::__test_support::rational_label_for(5, 0), "0");
}

#[test]
fn header_color_returns_none_for_unreadable_format() {
    let dir = TempImageDir::new();
    let path = dir.write("not-image.bin", b"\x00\x01\x02\x03");
    let (color, depth) = image::__test_support::read_header_color_for(&path);
    assert!(color.is_none());
    assert!(depth.is_none());
}
