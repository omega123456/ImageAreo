use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use ::image::{
    codecs::jpeg::JpegEncoder, DynamicImage, ExtendedColorType, GenericImageView, ImageReader,
    RgbImage, RgbaImage,
};
use fast_image_resize as fir;
use fast_image_resize::images::Image;

use crate::cache_dirs;
use crate::image::{self, DecodeImageError};

/// Cache-key version for thumbnail pixel output. Bump whenever the produced
/// pixels change so previously-cached files are invalidated. v2 bakes EXIF
/// orientation into the pixels.
const THUMBNAIL_CACHE_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThumbnailData {
    pub path: String,
    pub width: u32,
    pub height: u32,
}

pub fn generate_thumbnail(
    path: &Path,
    logical_size: u32,
) -> Result<ThumbnailData, DecodeImageError> {
    if logical_size == 0 {
        return Err(DecodeImageError {
            code: "decode_failed",
            message: "thumbnail size must be greater than zero".to_string(),
        });
    }

    let cache_path = cache_path_for(path, logical_size)?;
    if cache_path.exists() {
        let (width, height) = read_cached_dimensions(&cache_path)?;
        return Ok(ThumbnailData {
            path: cache_path.to_string_lossy().into_owned(),
            width,
            height,
        });
    }

    let loaded = image::load_thumbnail_source(path, logical_size.saturating_mul(2))?;
    // Bake EXIF orientation into the pixels: the filmstrip renders this cached
    // JPEG directly and applies no display transform of its own.
    let oriented = image::apply_exif_orientation(loaded.image, loaded.orientation);
    let (width, height) = target_dimensions(&oriented, logical_size);
    let resized = resize_image(&oriented, width, height)?;
    let jpeg_bytes = encode_jpeg(&resized)?;
    write_cache_file(&cache_path, &jpeg_bytes)?;

    Ok(ThumbnailData {
        path: cache_path.to_string_lossy().into_owned(),
        width,
        height,
    })
}

/// Decode and downscale `path` to a small JPEG (raw pixel orientation) for
/// backdrop sampling. Unlike [`generate_thumbnail`] this does not touch the
/// on-disk cache and returns the encoded bytes directly, so the frontend can
/// load them as a same-origin data URL (a canvas drawn from an asset-protocol
/// URL taints and cannot be read).
pub fn sample_jpeg(path: &Path, logical_size: u32) -> Result<Vec<u8>, DecodeImageError> {
    if logical_size == 0 {
        return Err(DecodeImageError {
            code: "decode_failed",
            message: "sample size must be greater than zero".to_string(),
        });
    }

    let loaded = image::load_thumbnail_source(path, logical_size.saturating_mul(2))?;
    let oriented = image::apply_exif_orientation(loaded.image, loaded.orientation);
    let (width, height) = target_dimensions(&oriented, logical_size);
    let resized = resize_image(&oriented, width, height)?;
    encode_jpeg(&resized)
}

fn target_dimensions(image: &DynamicImage, logical_size: u32) -> (u32, u32) {
    let max_edge = logical_size.saturating_mul(2);
    let (source_width, source_height) = image.dimensions();

    if source_width == 0 || source_height == 0 {
        return (max_edge.max(1), max_edge.max(1));
    }

    let target_long_edge = max_edge.min(source_width.max(source_height)).max(1);

    if source_width >= source_height {
        let height = ((u64::from(source_height) * u64::from(target_long_edge))
            / u64::from(source_width))
        .max(1);
        (target_long_edge, u32::try_from(height).unwrap_or(1))
    } else {
        let width = ((u64::from(source_width) * u64::from(target_long_edge))
            / u64::from(source_height))
        .max(1);
        (u32::try_from(width).unwrap_or(1), target_long_edge)
    }
}

fn resize_image(
    image: &DynamicImage,
    width: u32,
    height: u32,
) -> Result<RgbaImage, DecodeImageError> {
    let source = image.to_rgba8();
    let source_image = Image::from_vec_u8(
        source.width(),
        source.height(),
        source.into_raw(),
        fir::PixelType::U8x4,
    )
    .map_err(|err| DecodeImageError {
        code: "decode_failed",
        message: format!("failed to prepare thumbnail source buffer: {err}"),
    })?;

    let mut destination_image = Image::new(width, height, fir::PixelType::U8x4);
    let mut resizer = fir::Resizer::new();

    resizer
        .resize(
            &source_image,
            &mut destination_image,
            &fir::ResizeOptions::new()
                .resize_alg(fir::ResizeAlg::Convolution(fir::FilterType::Bilinear)),
        )
        .map_err(|err| DecodeImageError {
            code: "decode_failed",
            message: format!("failed to resize thumbnail: {err}"),
        })?;

    RgbaImage::from_vec(width, height, destination_image.into_vec()).ok_or_else(|| {
        DecodeImageError {
            code: "decode_failed",
            message: "resizer returned an invalid RGBA thumbnail buffer".to_string(),
        }
    })
}

fn encode_jpeg(image: &RgbaImage) -> Result<Vec<u8>, DecodeImageError> {
    let rgb = flatten_to_rgb(image);
    let mut cursor = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut cursor, 80);
    encoder
        .encode(
            rgb.as_raw(),
            image.width(),
            image.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(|err| DecodeImageError {
            code: "encode_failed",
            message: format!("failed to encode thumbnail JPEG: {err}"),
        })?;

    Ok(cursor.into_inner())
}

fn flatten_to_rgb(image: &RgbaImage) -> RgbImage {
    const BACKGROUND: u16 = 128;

    let mut pixels = Vec::with_capacity((image.width() as usize) * (image.height() as usize) * 3);

    for pixel in image.pixels() {
        let [red, green, blue, alpha] = pixel.0;
        let alpha = u16::from(alpha);
        let inverse_alpha = 255_u16.saturating_sub(alpha);

        let flattened_red = ((u16::from(red) * alpha) + (BACKGROUND * inverse_alpha) + 127) / 255;
        let flattened_green =
            ((u16::from(green) * alpha) + (BACKGROUND * inverse_alpha) + 127) / 255;
        let flattened_blue = ((u16::from(blue) * alpha) + (BACKGROUND * inverse_alpha) + 127) / 255;

        pixels.push(flattened_red as u8);
        pixels.push(flattened_green as u8);
        pixels.push(flattened_blue as u8);
    }

    RgbImage::from_vec(image.width(), image.height(), pixels)
        .expect("flattened RGB thumbnail buffer should match image dimensions")
}

fn cache_path_for(path: &Path, logical_size: u32) -> Result<std::path::PathBuf, DecodeImageError> {
    let metadata = fs::metadata(path).map_err(|err| DecodeImageError {
        code: "io_error",
        message: format!("failed to stat {}: {err}", path.display()),
    })?;
    let modified = metadata.modified().map_err(|err| DecodeImageError {
        code: "io_error",
        message: format!("failed to read modified time for {}: {err}", path.display()),
    })?;
    let modified_since_epoch =
        modified
            .duration_since(UNIX_EPOCH)
            .map_err(|err| DecodeImageError {
                code: "io_error",
                message: format!(
                    "modified time for {} was before unix epoch: {err}",
                    path.display()
                ),
            })?;

    let mut hasher = DefaultHasher::new();
    // Bump when the thumbnail pixel output changes so stale cache files are
    // invalidated. v2: EXIF orientation is now baked into thumbnail pixels.
    THUMBNAIL_CACHE_VERSION.hash(&mut hasher);
    path.to_string_lossy().hash(&mut hasher);
    logical_size.hash(&mut hasher);
    modified_since_epoch.as_secs().hash(&mut hasher);
    modified_since_epoch.subsec_nanos().hash(&mut hasher);
    let file_name = format!("{:016x}.jpg", hasher.finish());

    Ok(cache_dir().join(file_name))
}

fn cache_dir() -> std::path::PathBuf {
    cache_dirs::thumbnail_cache_dir()
}

/// The thumbnail cache directory, exposed so cache maintenance can sweep it
/// alongside the decoded-image cache. Does not create the directory.
pub fn thumbnail_cache_dir() -> std::path::PathBuf {
    cache_dir()
}

fn write_cache_file(cache_path: &Path, jpeg_bytes: &[u8]) -> Result<(), DecodeImageError> {
    let cache_dir = cache_path.parent().ok_or_else(|| DecodeImageError {
        code: "io_error",
        message: format!(
            "cache file had no parent directory: {}",
            cache_path.display()
        ),
    })?;

    fs::create_dir_all(cache_dir).map_err(|err| DecodeImageError {
        code: "io_error",
        message: format!(
            "failed to create cache directory {}: {err}",
            cache_dir.display()
        ),
    })?;

    let temp_suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_stem = cache_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("thumb");
    let temp_path = cache_dir.join(format!(".{}.{}.tmp", temp_stem, temp_suffix,));

    fs::write(&temp_path, jpeg_bytes).map_err(|err| DecodeImageError {
        code: "io_error",
        message: format!(
            "failed to write temp thumbnail {}: {err}",
            temp_path.display()
        ),
    })?;

    if cache_path.exists() {
        let _ = fs::remove_file(&temp_path);
        return Ok(());
    }

    match fs::rename(&temp_path, cache_path) {
        Ok(()) => Ok(()),
        Err(err) => {
            if cache_path.exists() {
                let _ = fs::remove_file(&temp_path);
                return Ok(());
            }

            let _ = fs::remove_file(&temp_path);
            Err(DecodeImageError {
                code: "io_error",
                message: format!(
                    "failed to promote temp thumbnail {} to {}: {err}",
                    temp_path.display(),
                    cache_path.display()
                ),
            })
        }
    }
}

fn read_cached_dimensions(cache_path: &Path) -> Result<(u32, u32), DecodeImageError> {
    ImageReader::open(cache_path)
        .map_err(|err| DecodeImageError {
            code: "io_error",
            message: format!(
                "failed to open cached thumbnail {}: {err}",
                cache_path.display()
            ),
        })?
        .with_guessed_format()
        .map_err(|err| DecodeImageError {
            code: "decode_failed",
            message: format!(
                "failed to inspect cached thumbnail {}: {err}",
                cache_path.display()
            ),
        })?
        .into_dimensions()
        .map_err(|err| DecodeImageError {
            code: "decode_failed",
            message: format!(
                "failed to read cached thumbnail dimensions {}: {err}",
                cache_path.display()
            ),
        })
}

#[doc(hidden)]
pub mod __test_support {
    use super::*;

    pub fn target_dimensions_for(image: &DynamicImage, logical_size: u32) -> (u32, u32) {
        target_dimensions(image, logical_size)
    }

    pub fn resize_image_for(
        image: &DynamicImage,
        width: u32,
        height: u32,
    ) -> Result<RgbaImage, DecodeImageError> {
        resize_image(image, width, height)
    }

    pub fn encode_jpeg_for(image: &RgbaImage) -> Result<Vec<u8>, DecodeImageError> {
        encode_jpeg(image)
    }

    pub fn cache_path_for(
        path: &Path,
        logical_size: u32,
    ) -> Result<std::path::PathBuf, DecodeImageError> {
        super::cache_path_for(path, logical_size)
    }

    pub fn write_cache_file_for(
        cache_path: &Path,
        jpeg_bytes: &[u8],
    ) -> Result<(), DecodeImageError> {
        super::write_cache_file(cache_path, jpeg_bytes)
    }

    pub fn read_cached_dimensions_for(cache_path: &Path) -> Result<(u32, u32), DecodeImageError> {
        super::read_cached_dimensions(cache_path)
    }
}
