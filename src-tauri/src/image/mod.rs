use std::fs;
use std::io::{BufReader, Cursor};
use std::path::Path;

use exif::{In, Reader as ExifReader, Tag};
use heic::{DecoderConfig, PixelLayout};
use image::{DynamicImage, ImageBuffer, ImageFormat, ImageReader, RgbaImage};
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

fn load_backend_image_path(path: &Path) -> Result<LoadedImageData, DecodeImageError> {
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

    let orientation = read_orientation(path);
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

fn read_orientation(path: &Path) -> u16 {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return 1,
    };
    let mut reader = BufReader::new(file);
    let exif = match ExifReader::new().read_from_container(&mut reader) {
        Ok(exif) => exif,
        Err(_) => return 1,
    };

    exif.get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|field| field.value.get_uint(0))
        .and_then(|value| u16::try_from(value).ok())
        .filter(|value| (1..=8).contains(value))
        .unwrap_or(1)
}
