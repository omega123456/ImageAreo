pub mod associations_runtime;
pub mod clipboard;
pub mod clipboard_runtime;
pub mod reveal;
pub mod reveal_runtime;

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::folder::{self, ImageEntry, SortOrder};
use crate::image::{self, DecodeImageError};
use crate::thumbnail;
pub use associations_runtime::{query_file_associations, set_default_associations};
pub use clipboard::{prepare_clipboard_image, ClipboardImageData};
pub use clipboard_runtime::copy_image_to_clipboard;
pub use reveal::validate_reveal_path;
pub use reveal_runtime::reveal_in_file_manager;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedImage {
    /// Absolute path to the on-disk cache file; the frontend wraps it with
    /// `convertFileSrc`. No pixel bytes cross the IPC boundary.
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub orientation: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    pub path: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn scan_folder(
    path: String,
    sort_order: Option<SortOrder>,
) -> Result<Vec<ImageEntry>, String> {
    folder::scan_folder(std::path::Path::new(&path), sort_order.unwrap_or_default())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn decode_image(
    path: String,
    quality: Option<image::DecodeIntent>,
) -> Result<DecodedImage, DecodeImageError> {
    let path = std::path::PathBuf::from(path);
    let intent = quality.unwrap_or(image::DecodeIntent::Display);
    let decoded =
        tauri::async_runtime::spawn_blocking(move || image::decode_to_cache(&path, intent))
            .await
            .map_err(|err| DecodeImageError {
                code: "decode_failed",
                message: format!("decode task failed: {err}"),
            })??;

    Ok(DecodedImage {
        path: decoded.path.to_string_lossy().into_owned(),
        width: decoded.width,
        height: decoded.height,
        orientation: decoded.orientation,
    })
}

/// Return an already-cached decode result for `path`/`quality` without ever
/// decoding. The viewer uses this on reopen to prefer a previously-enhanced
/// image, without triggering a fresh (heavy) demosaic when none is cached.
/// Resolves to `null` when no cache file exists.
#[tauri::command(rename_all = "camelCase")]
pub async fn peek_decoded_image(
    path: String,
    quality: image::DecodeIntent,
) -> Result<Option<DecodedImage>, DecodeImageError> {
    let path = std::path::PathBuf::from(path);
    let cached = tauri::async_runtime::spawn_blocking(move || image::lookup_cached(&path, quality))
        .await
        .map_err(|err| DecodeImageError {
            code: "decode_failed",
            message: format!("cache lookup task failed: {err}"),
        })??;

    Ok(cached.map(|decoded| DecodedImage {
        path: decoded.path.to_string_lossy().into_owned(),
        width: decoded.width,
        height: decoded.height,
        orientation: decoded.orientation,
    }))
}

/// Return a small downscaled JPEG of `path` as a base64 data URL, used by the
/// frontend to sample the image brightness behind the floating toolbar. A data
/// URL is same-origin, so the sampling canvas is readable (asset-protocol URLs
/// taint the canvas and cannot be sampled).
#[tauri::command(rename_all = "camelCase")]
pub async fn sample_image(path: String, size: u32) -> Result<String, DecodeImageError> {
    let path = std::path::PathBuf::from(path);
    let bytes = tauri::async_runtime::spawn_blocking(move || thumbnail::sample_jpeg(&path, size))
        .await
        .map_err(|err| DecodeImageError {
            code: "decode_failed",
            message: format!("sample task failed: {err}"),
        })??;

    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn generate_thumbnail(path: String, size: u32) -> Result<Thumbnail, DecodeImageError> {
    let path = std::path::PathBuf::from(path);
    let thumbnail =
        tauri::async_runtime::spawn_blocking(move || thumbnail::generate_thumbnail(&path, size))
            .await
            .map_err(|err| DecodeImageError {
                code: "decode_failed",
                message: format!("thumbnail task failed: {err}"),
            })??;

    Ok(Thumbnail {
        path: thumbnail.path,
    })
}
