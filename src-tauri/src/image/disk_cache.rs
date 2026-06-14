//! On-disk cache for decoded backend images.
//!
//! Decoded backend/RAW images are developed once and written to an on-disk
//! cache in the OS temp directory (`imageareo-images`), then rendered by the
//! viewer as a file via `convertFileSrc`. This removes both the developed-pixel
//! retention and the memoized transport bytes of the former in-memory LRU.
//!
//! A cache entry is keyed by source identity (path + modification time +
//! size) plus a decode intent (`Preview` / `Display` / `Enhance`) plus the cap
//! that produced it, so a file changed on disk (different mtime or size) — or a
//! different intent/cap — maps to a different file. Writes are atomic
//! (temp-file + rename), mirroring the proven thumbnail-module pattern.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use ::image::ImageReader;

use crate::cache_dirs;
use crate::image::DecodeImageError;

/// The decode intent a cache file was produced for. Each intent has its own set
/// of candidate file extensions valid for lookup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CacheVariant {
    /// Cheapest, instant-paint image — always JPEG.
    Preview,
    /// Viewport-sized initial display image, capped to a bucketed
    /// viewport long edge — JPEG (opaque) or PNG (has alpha). Keyed distinctly
    /// from `Display` (which is the full 8192 on-zoom tier) by both this tag
    /// and the bucketed cap-in-key, so the two tiers never collide.
    Viewport,
    /// Default viewing image — JPEG (opaque) or PNG (has alpha).
    Display,
    /// User-triggered "Enhance" image (RAW demosaic, capped) — JPEG (opaque) or
    /// PNG (has alpha).
    Enhance,
}

impl CacheVariant {
    /// Stable discriminator folded into the cache key so the same source maps to
    /// distinct files per intent.
    fn tag(self) -> u8 {
        match self {
            CacheVariant::Preview => 0,
            CacheVariant::Display => 1,
            CacheVariant::Enhance => 2,
            CacheVariant::Viewport => 3,
        }
    }

    /// The candidate extensions a lookup must try for this variant, in priority
    /// order. Preview is always JPEG; display and enhance can each be JPEG
    /// (opaque) or PNG (alpha).
    pub fn candidate_extensions(self) -> &'static [&'static str] {
        match self {
            CacheVariant::Preview => &["jpg"],
            CacheVariant::Display => &["jpg", "png"],
            CacheVariant::Enhance => &["jpg", "png"],
            CacheVariant::Viewport => &["jpg", "png"],
        }
    }
}

/// The cache root, sibling to the thumbnail cache, inside the OS temp dir.
///
/// Honors the `IMAGEAREO_IMAGE_CACHE_DIR` override so tests can point the cache
/// at an isolated, disposable directory (the committed fixtures otherwise share
/// a stable cache key across runs, which would mask the decode paths behind a
/// warm cache).
pub fn cache_dir() -> PathBuf {
    cache_dirs::image_cache_dir()
}

/// Compute the stable filename stem (without extension) for a source file and a
/// decode intent/cap. Identical inputs yield an identical stem; a changed mtime,
/// size, variant, or cap yields a different stem.
fn cache_stem(path: &Path, variant: CacheVariant, cap: u32) -> Result<String, DecodeImageError> {
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
    path.to_string_lossy().hash(&mut hasher);
    variant.tag().hash(&mut hasher);
    cap.hash(&mut hasher);
    modified_since_epoch.as_secs().hash(&mut hasher);
    modified_since_epoch.subsec_nanos().hash(&mut hasher);
    metadata.len().hash(&mut hasher);

    Ok(format!("{:016x}", hasher.finish()))
}

/// Map a source file + intent/cap + extension to a concrete cache file path.
pub fn cache_path_for(
    path: &Path,
    variant: CacheVariant,
    cap: u32,
    extension: &str,
) -> Result<PathBuf, DecodeImageError> {
    let stem = cache_stem(path, variant, cap)?;
    Ok(cache_dir().join(format!("{stem}.{extension}")))
}

/// Look up an existing cache file for the given key across the candidate
/// extensions valid for the variant. Returns `None` when nothing was written.
pub fn lookup(
    path: &Path,
    variant: CacheVariant,
    cap: u32,
) -> Result<Option<PathBuf>, DecodeImageError> {
    let stem = cache_stem(path, variant, cap)?;
    let dir = cache_dir();
    for extension in variant.candidate_extensions() {
        let candidate = dir.join(format!("{stem}.{extension}"));
        if candidate.exists() {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

/// Atomically write encoded image bytes to the cache file for the given key and
/// extension (temp-file + rename), and return the final path. If another writer
/// produced the file first, the temp file is discarded and the existing file is
/// returned.
pub fn write(
    path: &Path,
    variant: CacheVariant,
    cap: u32,
    extension: &str,
    bytes: &[u8],
) -> Result<PathBuf, DecodeImageError> {
    let cache_path = cache_path_for(path, variant, cap, extension)?;
    write_cache_file(&cache_path, bytes)?;
    Ok(cache_path)
}

fn write_cache_file(cache_path: &Path, bytes: &[u8]) -> Result<(), DecodeImageError> {
    cache_dirs::write_atomic(cache_path, bytes, "image")
}

/// Read back the pixel dimensions of a written cache file without fully decoding
/// it.
pub fn read_cached_dimensions(cache_path: &Path) -> Result<(u32, u32), DecodeImageError> {
    ImageReader::open(cache_path)
        .map_err(|err| {
            DecodeImageError::io(format!(
                "failed to open cached image {}: {err}",
                cache_path.display()
            ))
        })?
        .with_guessed_format()
        .map_err(|err| {
            DecodeImageError::decode(format!(
                "failed to inspect cached image {}: {err}",
                cache_path.display()
            ))
        })?
        .into_dimensions()
        .map_err(|err| {
            DecodeImageError::decode(format!(
                "failed to read cached image dimensions {}: {err}",
                cache_path.display()
            ))
        })
}

#[doc(hidden)]
pub mod __test_support {
    use super::*;

    pub fn write_cache_file_for(cache_path: &Path, bytes: &[u8]) -> Result<(), DecodeImageError> {
        write_cache_file(cache_path, bytes)
    }
}
