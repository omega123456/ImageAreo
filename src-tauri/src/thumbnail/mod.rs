use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use ::image::{
    codecs::jpeg::JpegEncoder, DynamicImage, ExtendedColorType, GenericImageView, ImageReader,
    RgbImage, RgbaImage,
};
use fast_image_resize as fir;

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
        return Err(DecodeImageError::decode(
            "thumbnail size must be greater than zero",
        ));
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

    let loaded = image::load_thumbnail_source_chain(path, logical_size.saturating_mul(2))?;
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
        return Err(DecodeImageError::decode(
            "sample size must be greater than zero",
        ));
    }

    // Source-keyed tone cache (#9): rapid navigation re-samples the same images
    // repeatedly (e.g. next/prev/next). The sampled JPEG depends only on the
    // source identity (path + mtime + size) and the logical size, so a hit lets
    // us skip the decode + resize + encode entirely. The key reuses the same
    // identity components as the on-disk cache stem.
    let key = sample_cache_key(path, logical_size)?;
    if let Some(bytes) = sample_tone_cache_get(&key) {
        return Ok(bytes);
    }

    let loaded = image::load_thumbnail_source_chain(path, logical_size.saturating_mul(2))?;
    let oriented = image::apply_exif_orientation(loaded.image, loaded.orientation);
    let (width, height) = target_dimensions(&oriented, logical_size);
    let resized = resize_image(&oriented, width, height)?;
    let bytes = encode_jpeg(&resized)?;

    sample_tone_cache_put(key, bytes.clone());
    Ok(bytes)
}

/// Maximum number of source-keyed sample-tone entries retained in memory. A
/// sampled JPEG is small (a few hundred bytes to a few KB at sample sizes), so a
/// few hundred entries is a trivial footprint and covers a deep navigation
/// history without unbounded growth.
const SAMPLE_TONE_CACHE_CAPACITY: usize = 256;

/// Process-wide source-keyed sample-tone cache. Maps a source-identity key to
/// the encoded sample JPEG. Bounded by [`SAMPLE_TONE_CACHE_CAPACITY`] with a
/// simple oldest-insertion eviction (the map is small and sampling is not on a
/// tight hot loop, so an exact LRU is unnecessary).
fn sample_tone_cache() -> &'static Mutex<SampleToneCache> {
    static CACHE: OnceLock<Mutex<SampleToneCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(SampleToneCache::default()))
}

#[derive(Default)]
struct SampleToneCache {
    entries: HashMap<String, Vec<u8>>,
    /// Insertion order, used for FIFO eviction when over capacity.
    order: Vec<String>,
}

fn sample_tone_cache_get(key: &str) -> Option<Vec<u8>> {
    let cache = sample_tone_cache()
        .lock()
        .expect("sample tone cache mutex should not be poisoned");
    cache.entries.get(key).cloned()
}

fn sample_tone_cache_put(key: String, bytes: Vec<u8>) {
    let mut cache = sample_tone_cache()
        .lock()
        .expect("sample tone cache mutex should not be poisoned");
    if cache.entries.contains_key(&key) {
        return;
    }
    if cache.entries.len() >= SAMPLE_TONE_CACHE_CAPACITY {
        if let Some(oldest) = (!cache.order.is_empty()).then(|| cache.order.remove(0)) {
            cache.entries.remove(&oldest);
        }
    }
    cache.order.push(key.clone());
    cache.entries.insert(key, bytes);
}

/// Compute the source-identity key for the sample-tone cache: the same
/// (path, mtime, size, logical_size) components the on-disk cache stem uses, so
/// a touched/edited file (changed mtime/size) yields a fresh key and a stale
/// sample is never served.
fn sample_cache_key(path: &Path, logical_size: u32) -> Result<String, DecodeImageError> {
    let metadata = fs::metadata(path)
        .map_err(|err| DecodeImageError::io(format!("failed to stat {}: {err}", path.display())))?;
    let modified = metadata.modified().map_err(|err| {
        DecodeImageError::io(format!(
            "failed to read modified time for {}: {err}",
            path.display()
        ))
    })?;
    let modified_since_epoch = modified.duration_since(UNIX_EPOCH).map_err(|err| {
        DecodeImageError::io(format!(
            "modified time for {} was before unix epoch: {err}",
            path.display()
        ))
    })?;

    let mut hasher = DefaultHasher::new();
    THUMBNAIL_CACHE_VERSION.hash(&mut hasher);
    path.to_string_lossy().hash(&mut hasher);
    logical_size.hash(&mut hasher);
    modified_since_epoch.as_secs().hash(&mut hasher);
    modified_since_epoch.subsec_nanos().hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    Ok(format!("sample:{:016x}", hasher.finish()))
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

/// Resize `image` to `width`×`height`. Opaque-typed sources resize through the
/// alpha-free RGB path (3 bytes/px, no alpha plane allocated); alpha-typed
/// sources resize through the RGBA path. This mirrors the Phase 7 opaque/alpha
/// split in `image/mod.rs` so an opaque photo no longer pays the RGBA round-trip
/// just to produce a thumbnail. The returned `DynamicImage` is `ImageRgb8` or
/// `ImageRgba8` accordingly.
fn resize_image(
    image: &DynamicImage,
    width: u32,
    height: u32,
) -> Result<DynamicImage, DecodeImageError> {
    if image.color().has_alpha() {
        resize_rgba(image.to_rgba8(), width, height).map(DynamicImage::ImageRgba8)
    } else {
        resize_rgb(image.to_rgb8(), width, height).map(DynamicImage::ImageRgb8)
    }
}

fn resize_rgb(source: RgbImage, width: u32, height: u32) -> Result<RgbImage, DecodeImageError> {
    let (src_w, src_h) = (source.width(), source.height());
    let raw = image::fir_resize(
        source.into_raw(),
        src_w,
        src_h,
        width,
        height,
        fir::PixelType::U8x3,
        fir::FilterType::Bilinear,
    )?;

    RgbImage::from_vec(width, height, raw).ok_or_else(|| {
        DecodeImageError::decode("resizer returned an invalid RGB thumbnail buffer")
    })
}

fn resize_rgba(source: RgbaImage, width: u32, height: u32) -> Result<RgbaImage, DecodeImageError> {
    let (src_w, src_h) = (source.width(), source.height());
    let raw = image::fir_resize(
        source.into_raw(),
        src_w,
        src_h,
        width,
        height,
        fir::PixelType::U8x4,
        fir::FilterType::Bilinear,
    )?;

    RgbaImage::from_vec(width, height, raw).ok_or_else(|| {
        DecodeImageError::decode("resizer returned an invalid RGBA thumbnail buffer")
    })
}

/// Encode a resized thumbnail as JPEG. An RGB8 image encodes directly (no alpha
/// plane); an RGBA8 image is first flattened over a neutral background. Other
/// color types are coerced through `to_rgb8` for safety.
fn encode_jpeg(image: &DynamicImage) -> Result<Vec<u8>, DecodeImageError> {
    let rgb = match image {
        DynamicImage::ImageRgb8(rgb) => rgb.clone(),
        DynamicImage::ImageRgba8(rgba) => flatten_to_rgb(rgba),
        other => other.to_rgb8(),
    };

    let mut cursor = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut cursor, 80);
    encoder
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(|err| {
            DecodeImageError::encode(format!("failed to encode thumbnail JPEG: {err}"))
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
    metadata.len().hash(&mut hasher);
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
    cache_dirs::write_atomic(cache_path, jpeg_bytes, "thumb")
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
    ) -> Result<DynamicImage, DecodeImageError> {
        resize_image(image, width, height)
    }

    pub fn encode_jpeg_for(image: &DynamicImage) -> Result<Vec<u8>, DecodeImageError> {
        encode_jpeg(image)
    }

    pub fn sample_cache_key_for(
        path: &Path,
        logical_size: u32,
    ) -> Result<String, DecodeImageError> {
        super::sample_cache_key(path, logical_size)
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
