use std::fs;
use std::io::{BufReader, Cursor};
use std::path::Path;

use exif::{Exif, In, Reader as ExifReader, Tag};
use heic::{DecoderConfig, PixelLayout};
use image::{DynamicImage, GrayImage, ImageBuffer, ImageFormat, ImageReader, RgbImage, RgbaImage};
use jpeg_decoder::{Decoder as JpegDecoder, PixelFormat as JpegPixelFormat};
use serde::Serialize;

const NATIVE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp"];
const BACKEND_EXTENSIONS: &[&str] = &[
    "avif", "tif", "tiff", "bmp", "ico", "heic", "heif", "jxl", "raw", "cr2", "cr3", "nef", "nrw",
    "arw", "sr2", "srf", "dng", "raf", "rw2", "orf", "pef", "srw", "kdc", "erf", "3fr",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormatSupport {
    Native,
    NeedsBackend,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedImageData {
    pub png_bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub orientation: u16,
}

#[derive(Debug, Clone)]
pub struct LoadedImageData {
    pub image: DynamicImage,
    pub orientation: u16,
}

#[derive(Debug)]
struct ExifMetadata {
    orientation: u16,
    embedded_thumbnail: Option<DynamicImage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodeImageError {
    pub code: &'static str,
    pub message: String,
}

impl DecodeImageError {
    fn unsupported(message: impl Into<String>) -> Self {
        Self {
            code: "unsupported_format",
            message: message.into(),
        }
    }

    fn io(message: impl Into<String>) -> Self {
        Self {
            code: "io_error",
            message: message.into(),
        }
    }

    fn decode(message: impl Into<String>) -> Self {
        Self {
            code: "decode_failed",
            message: message.into(),
        }
    }

    fn encode(message: impl Into<String>) -> Self {
        Self {
            code: "encode_failed",
            message: message.into(),
        }
    }
}

pub fn native_extensions() -> &'static [&'static str] {
    NATIVE_EXTENSIONS
}

pub fn backend_extensions() -> &'static [&'static str] {
    BACKEND_EXTENSIONS
}

pub fn classify_extension(ext: &str) -> Option<ImageFormatSupport> {
    let normalized = ext.trim_start_matches('.').to_ascii_lowercase();

    if NATIVE_EXTENSIONS.contains(&normalized.as_str()) {
        Some(ImageFormatSupport::Native)
    } else if BACKEND_EXTENSIONS.contains(&normalized.as_str()) {
        Some(ImageFormatSupport::NeedsBackend)
    } else {
        None
    }
}

pub fn classify_path(path: &Path) -> Option<ImageFormatSupport> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .and_then(classify_extension)
}

pub fn is_supported_image_path(path: &Path) -> bool {
    classify_path(path).is_some()
}

pub fn decode_image_path(path: &Path) -> Result<DecodedImageData, DecodeImageError> {
    let loaded = load_backend_image_path(path)?;
    let png_bytes = encode_png(&loaded.image)?;

    Ok(DecodedImageData {
        png_bytes,
        width: loaded.image.width(),
        height: loaded.image.height(),
        orientation: loaded.orientation,
    })
}

pub fn load_supported_image_path(path: &Path) -> Result<LoadedImageData, DecodeImageError> {
    match classify_path(path) {
        Some(ImageFormatSupport::Native) => decode_native_image(path),
        Some(ImageFormatSupport::NeedsBackend) => load_backend_image_path(path),
        None => Err(DecodeImageError::unsupported(format!(
            "unsupported image format: {}",
            path.display()
        ))),
    }
}

pub fn load_thumbnail_source(
    path: &Path,
    max_edge: u32,
) -> Result<LoadedImageData, DecodeImageError> {
    let exif_metadata = read_exif_metadata(path, max_edge / 2);
    if let Some(image) = exif_metadata.embedded_thumbnail {
        return Ok(LoadedImageData {
            image,
            orientation: exif_metadata.orientation,
        });
    }

    match classify_path(path) {
        Some(ImageFormatSupport::Native) => decode_native_thumbnail_image_with_orientation(
            path,
            max_edge,
            exif_metadata.orientation,
        ),
        Some(ImageFormatSupport::NeedsBackend) => {
            load_backend_image_path_with_orientation(path, exif_metadata.orientation)
        }
        None => Err(DecodeImageError::unsupported(format!(
            "unsupported image format: {}",
            path.display()
        ))),
    }
}

fn load_backend_image_path(path: &Path) -> Result<LoadedImageData, DecodeImageError> {
    let orientation = read_orientation(path);
    load_backend_image_path_with_orientation(path, orientation)
}

fn load_backend_image_path_with_orientation(
    path: &Path,
    orientation: u16,
) -> Result<LoadedImageData, DecodeImageError> {
    match classify_path(path) {
        Some(ImageFormatSupport::Native) => {
            return Err(DecodeImageError::unsupported(format!(
                "native format decode is handled by the frontend: {}",
                path.display()
            )));
        }
        Some(ImageFormatSupport::NeedsBackend) => {}
        None => {
            return Err(DecodeImageError::unsupported(format!(
                "unsupported image format: {}",
                path.display()
            )));
        }
    }

    let image = match normalized_extension(path)?.as_str() {
        "avif" => decode_heic(path)?,
        "tif" | "tiff" | "bmp" | "ico" => decode_with_image_crate(path)?,
        "heic" | "heif" => decode_heic(path)?,
        "jxl" => decode_jxl(path)?,
        "raw" | "cr2" | "cr3" | "nef" | "nrw" | "arw" | "sr2" | "srf" | "dng" | "raf" | "rw2"
        | "orf" | "pef" | "srw" | "kdc" | "erf" | "3fr" => decode_raw(path)?,
        _ => {
            return Err(DecodeImageError::unsupported(format!(
                "unsupported backend image format: {}",
                path.display()
            )));
        }
    };

    Ok(LoadedImageData { image, orientation })
}

fn normalized_extension(path: &Path) -> Result<String, DecodeImageError> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .ok_or_else(|| {
            DecodeImageError::unsupported(format!("missing file extension: {}", path.display()))
        })
}

fn decode_with_image_crate(path: &Path) -> Result<DynamicImage, DecodeImageError> {
    let format = match normalized_extension(path)?.as_str() {
        "jpg" | "jpeg" => ImageFormat::Jpeg,
        "png" => ImageFormat::Png,
        "gif" => ImageFormat::Gif,
        "webp" => ImageFormat::WebP,
        "avif" => ImageFormat::Avif,
        "tif" | "tiff" => ImageFormat::Tiff,
        "bmp" => ImageFormat::Bmp,
        "ico" => ImageFormat::Ico,
        ext => {
            return Err(DecodeImageError::unsupported(format!(
                "unsupported image crate decode format: {ext}"
            )));
        }
    };

    let mut reader = ImageReader::open(path)
        .map_err(|err| DecodeImageError::io(format!("failed to open {}: {err}", path.display())))?
        .with_guessed_format()
        .map_err(|err| {
            DecodeImageError::decode(format!("failed to inspect {}: {err}", path.display()))
        })?;
    reader.set_format(format);

    reader.decode().map_err(|err| {
        DecodeImageError::decode(format!("failed to decode {}: {err}", path.display()))
    })
}

fn decode_native_image(path: &Path) -> Result<LoadedImageData, DecodeImageError> {
    let image = decode_with_image_crate(path)?;

    Ok(LoadedImageData {
        image,
        orientation: read_orientation(path),
    })
}

fn decode_native_thumbnail_image_with_orientation(
    path: &Path,
    max_edge: u32,
    orientation: u16,
) -> Result<LoadedImageData, DecodeImageError> {
    let image = match normalized_extension(path)?.as_str() {
        "jpg" | "jpeg" => decode_jpeg_thumbnail_image(path, max_edge)?,
        _ => decode_with_image_crate(path)?,
    };

    Ok(LoadedImageData { image, orientation })
}

fn decode_jpeg_thumbnail_image(
    path: &Path,
    max_edge: u32,
) -> Result<DynamicImage, DecodeImageError> {
    let file = std::fs::File::open(path)
        .map_err(|err| DecodeImageError::io(format!("failed to open {}: {err}", path.display())))?;
    let mut decoder = JpegDecoder::new(BufReader::new(file));
    let requested_edge = max_edge.clamp(1, u32::from(u16::MAX)) as u16;

    decoder
        .scale(requested_edge, requested_edge)
        .map_err(|err| {
            DecodeImageError::decode(format!(
                "failed to configure scaled JPEG decode for {}: {err}",
                path.display()
            ))
        })?;

    let pixels = decoder.decode().map_err(|err| {
        DecodeImageError::decode(format!(
            "failed to decode scaled JPEG {}: {err}",
            path.display()
        ))
    })?;
    let info = decoder.info().ok_or_else(|| {
        DecodeImageError::decode(format!(
            "scaled JPEG decoder did not report metadata for {}",
            path.display()
        ))
    })?;

    image_from_jpeg_pixels(
        u32::from(info.width),
        u32::from(info.height),
        info.pixel_format,
        pixels,
        path,
    )
}

fn image_from_jpeg_pixels(
    width: u32,
    height: u32,
    pixel_format: JpegPixelFormat,
    pixels: Vec<u8>,
    path: &Path,
) -> Result<DynamicImage, DecodeImageError> {
    match pixel_format {
        JpegPixelFormat::L8 => GrayImage::from_vec(width, height, pixels)
            .map(DynamicImage::ImageLuma8)
            .ok_or_else(|| {
                DecodeImageError::decode(format!(
                    "scaled JPEG decoder returned invalid grayscale pixels for {}",
                    path.display()
                ))
            }),
        JpegPixelFormat::L16 => {
            let luma8 = pixels
                .chunks_exact(2)
                .map(|chunk| chunk[0])
                .collect::<Vec<_>>();

            GrayImage::from_vec(width, height, luma8)
                .map(DynamicImage::ImageLuma8)
                .ok_or_else(|| {
                    DecodeImageError::decode(format!(
                        "scaled JPEG decoder returned invalid 16-bit grayscale pixels for {}",
                        path.display()
                    ))
                })
        }
        JpegPixelFormat::RGB24 => RgbImage::from_vec(width, height, pixels)
            .map(DynamicImage::ImageRgb8)
            .ok_or_else(|| {
                DecodeImageError::decode(format!(
                    "scaled JPEG decoder returned invalid RGB pixels for {}",
                    path.display()
                ))
            }),
        JpegPixelFormat::CMYK32 => {
            let mut rgb_pixels = Vec::with_capacity((width as usize) * (height as usize) * 3);

            for chunk in pixels.chunks_exact(4) {
                let cyan = u16::from(chunk[0]);
                let magenta = u16::from(chunk[1]);
                let yellow = u16::from(chunk[2]);
                let key = u16::from(chunk[3]);

                let red = (((255 - cyan) * (255 - key)) + 127) / 255;
                let green = (((255 - magenta) * (255 - key)) + 127) / 255;
                let blue = (((255 - yellow) * (255 - key)) + 127) / 255;

                rgb_pixels.push(red as u8);
                rgb_pixels.push(green as u8);
                rgb_pixels.push(blue as u8);
            }

            RgbImage::from_vec(width, height, rgb_pixels)
                .map(DynamicImage::ImageRgb8)
                .ok_or_else(|| {
                    DecodeImageError::decode(format!(
                        "scaled JPEG decoder returned invalid CMYK pixels for {}",
                        path.display()
                    ))
                })
        }
    }
}

fn decode_heic(path: &Path) -> Result<DynamicImage, DecodeImageError> {
    let bytes = fs::read(path)
        .map_err(|err| DecodeImageError::io(format!("failed to read {}: {err}", path.display())))?;
    let output = DecoderConfig::new()
        .decode(&bytes, PixelLayout::Rgba8)
        .map_err(|err| {
            DecodeImageError::decode(format!("failed to decode {}: {err}", path.display()))
        })?;

    let image = RgbaImage::from_vec(output.width, output.height, output.data).ok_or_else(|| {
        DecodeImageError::decode(format!(
            "decoder returned invalid RGBA buffer for {}",
            path.display()
        ))
    })?;

    Ok(DynamicImage::ImageRgba8(image))
}

fn decode_raw(path: &Path) -> Result<DynamicImage, DecodeImageError> {
    rawler::analyze::extract_preview_pixels(path, &rawler::decoders::RawDecodeParams::default())
        .map_err(|err| {
            DecodeImageError::decode(format!("failed to decode RAW {}: {err}", path.display()))
        })
}

fn decode_jxl(path: &Path) -> Result<DynamicImage, DecodeImageError> {
    let image = jxl_oxide::JxlImage::builder().open(path).map_err(|err| {
        DecodeImageError::decode(format!("failed to open {}: {err}", path.display()))
    })?;
    let render = image.render_frame(0).map_err(|err| {
        DecodeImageError::decode(format!("failed to render {}: {err}", path.display()))
    })?;
    let buffer = render.image_all_channels();
    let rgba = framebuffer_to_rgba(buffer)?;

    Ok(DynamicImage::ImageRgba8(rgba))
}

fn framebuffer_to_rgba(buffer: jxl_oxide::FrameBuffer) -> Result<RgbaImage, DecodeImageError> {
    let width = u32::try_from(buffer.width())
        .map_err(|_| DecodeImageError::decode("JPEG XL width overflowed u32"))?;
    let height = u32::try_from(buffer.height())
        .map_err(|_| DecodeImageError::decode("JPEG XL height overflowed u32"))?;

    let channels = buffer.channels();
    if channels < 3 {
        return Err(DecodeImageError::decode(format!(
            "JPEG XL image had unsupported channel count: {channels}"
        )));
    }

    let floats = buffer.buf();
    let mut rgba = Vec::with_capacity((width as usize) * (height as usize) * 4);

    for pixel in floats.chunks(channels) {
        let r = linear_sample_to_u8(pixel[0]);
        let g = linear_sample_to_u8(pixel[1]);
        let b = linear_sample_to_u8(pixel[2]);
        let a = if channels >= 4 {
            linear_sample_to_u8(pixel[3])
        } else {
            u8::MAX
        };

        rgba.extend_from_slice(&[r, g, b, a]);
    }

    ImageBuffer::from_vec(width, height, rgba)
        .ok_or_else(|| DecodeImageError::decode("failed to build JPEG XL RGBA image"))
}

fn linear_sample_to_u8(sample: f32) -> u8 {
    (sample.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn encode_png(image: &DynamicImage) -> Result<Vec<u8>, DecodeImageError> {
    let mut cursor = Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|err| {
            DecodeImageError::encode(format!("failed to encode PNG transport bytes: {err}"))
        })?;

    Ok(cursor.into_inner())
}

fn read_exif_metadata(path: &Path, min_thumbnail_long_edge: u32) -> ExifMetadata {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => {
            return ExifMetadata {
                orientation: 1,
                embedded_thumbnail: None,
            };
        }
    };
    let mut reader = BufReader::new(file);
    let exif = match ExifReader::new().read_from_container(&mut reader) {
        Ok(exif) => exif,
        Err(_) => {
            return ExifMetadata {
                orientation: 1,
                embedded_thumbnail: None,
            };
        }
    };

    ExifMetadata {
        orientation: orientation_from_exif(&exif),
        embedded_thumbnail: embedded_thumbnail_image(&exif, min_thumbnail_long_edge),
    }
}

fn orientation_from_exif(exif: &Exif) -> u16 {
    exif.get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|field| field.value.get_uint(0))
        .and_then(|value| u16::try_from(value).ok())
        .filter(|value| (1..=8).contains(value))
        .unwrap_or(1)
}

fn embedded_thumbnail_image(exif: &Exif, min_long_edge: u32) -> Option<DynamicImage> {
    let offset = exif
        .get_field(Tag::JPEGInterchangeFormat, In::THUMBNAIL)
        .and_then(|field| field.value.get_uint(0))
        .and_then(|value| usize::try_from(value).ok())?;
    let length = exif
        .get_field(Tag::JPEGInterchangeFormatLength, In::THUMBNAIL)
        .and_then(|field| field.value.get_uint(0))
        .and_then(|value| usize::try_from(value).ok())?;
    let end = offset.checked_add(length)?;
    let jpeg = exif.buf().get(offset..end)?;
    let image = image::load_from_memory_with_format(jpeg, ImageFormat::Jpeg).ok()?;

    if image.width().max(image.height()) < min_long_edge {
        return None;
    }

    Some(image)
}

fn read_orientation(path: &Path) -> u16 {
    read_exif_metadata(path, 0).orientation
}

#[doc(hidden)]
pub mod __test_support {
    use super::*;
    use jpeg_decoder::PixelFormat as JpegPixelFormat;

    pub fn normalized_extension_for(path: &Path) -> Result<String, DecodeImageError> {
        normalized_extension(path)
    }

    pub fn linear_sample_to_u8_for(sample: f32) -> u8 {
        linear_sample_to_u8(sample)
    }

    pub fn encode_png_for(image: &DynamicImage) -> Result<Vec<u8>, DecodeImageError> {
        encode_png(image)
    }

    pub fn read_orientation_for(path: &Path) -> u16 {
        read_orientation(path)
    }

    pub fn decode_with_image_crate_for(path: &Path) -> Result<DynamicImage, DecodeImageError> {
        decode_with_image_crate(path)
    }

    pub fn load_thumbnail_source_for(
        path: &Path,
        max_edge: u32,
    ) -> Result<LoadedImageData, DecodeImageError> {
        load_thumbnail_source(path, max_edge)
    }

    pub fn unsupported_error(message: &str) -> DecodeImageError {
        DecodeImageError::unsupported(message)
    }

    pub fn io_error(message: &str) -> DecodeImageError {
        DecodeImageError::io(message)
    }

    pub fn decode_error(message: &str) -> DecodeImageError {
        DecodeImageError::decode(message)
    }

    pub fn encode_error(message: &str) -> DecodeImageError {
        DecodeImageError::encode(message)
    }

    pub fn image_from_jpeg_pixels_for(
        width: u32,
        height: u32,
        pixel_format: JpegPixelFormat,
        pixels: Vec<u8>,
        path: &Path,
    ) -> Result<DynamicImage, DecodeImageError> {
        image_from_jpeg_pixels(width, height, pixel_format, pixels, path)
    }
}
