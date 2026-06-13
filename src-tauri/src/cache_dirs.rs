use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::image::DecodeImageError;

pub const IMAGE_CACHE_DIR_ENV: &str = "IMAGEAREO_IMAGE_CACHE_DIR";
pub const THUMBNAIL_CACHE_DIR_ENV: &str = "IMAGEAREO_THUMBNAIL_CACHE_DIR";

const IMAGE_CACHE_DIR_NAME: &str = "imageareo-images";
const THUMBNAIL_CACHE_DIR_NAME: &str = "imageareo-thumbnails";

fn resolve(env_var: &str, default_dir_name: &str) -> PathBuf {
    match std::env::var_os(env_var) {
        Some(dir) => PathBuf::from(dir),
        None => std::env::temp_dir().join(default_dir_name),
    }
}

pub fn image_cache_dir() -> PathBuf {
    resolve(IMAGE_CACHE_DIR_ENV, IMAGE_CACHE_DIR_NAME)
}

pub fn thumbnail_cache_dir() -> PathBuf {
    resolve(THUMBNAIL_CACHE_DIR_ENV, THUMBNAIL_CACHE_DIR_NAME)
}

/// Atomically write `bytes` to `cache_path` via a timestamped temp file in the
/// same directory followed by a rename. `default_stem` names the temp file when
/// the cache path has no usable file stem. If a concurrent writer produced the
/// final file first (the post-rename `exists()` double-check), the temp file is
/// discarded and the write is treated as a success.
pub(crate) fn write_atomic(
    cache_path: &Path,
    bytes: &[u8],
    default_stem: &str,
) -> Result<(), DecodeImageError> {
    let dir = cache_path.parent().ok_or_else(|| {
        DecodeImageError::io(format!(
            "cache file had no parent directory: {}",
            cache_path.display()
        ))
    })?;

    fs::create_dir_all(dir).map_err(|err| {
        DecodeImageError::io(format!(
            "failed to create cache directory {}: {err}",
            dir.display()
        ))
    })?;

    let temp_suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_stem = cache_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(default_stem);
    let temp_path = dir.join(format!(".{temp_stem}.{temp_suffix}.tmp"));

    fs::write(&temp_path, bytes).map_err(|err| {
        DecodeImageError::io(format!(
            "failed to write temp cache file {}: {err}",
            temp_path.display()
        ))
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
            Err(DecodeImageError::io(format!(
                "failed to promote temp cache file {} to {}: {err}",
                temp_path.display(),
                cache_path.display()
            )))
        }
    }
}
