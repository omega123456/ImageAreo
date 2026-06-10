pub mod clipboard;
pub mod clipboard_runtime;
pub mod reveal;
pub mod reveal_runtime;

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::folder::{self, ImageEntry, SortOrder};
use crate::image::{self, DecodeImageError};
use crate::thumbnail;
pub use clipboard::{prepare_clipboard_image, ClipboardImageData};
pub use clipboard_runtime::copy_image_to_clipboard;
pub use reveal::validate_reveal_path;
pub use reveal_runtime::reveal_in_file_manager;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedImage {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub orientation: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    pub data_url: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn scan_folder(
    path: String,
    sort_order: Option<SortOrder>,
) -> Result<Vec<ImageEntry>, String> {
    folder::scan_folder(std::path::Path::new(&path), sort_order.unwrap_or_default())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn decode_image(path: String) -> Result<DecodedImage, DecodeImageError> {
    let decoded = image::decode_image_path(std::path::Path::new(&path))?;

    Ok(DecodedImage {
        data_url: format!(
            "data:image/png;base64,{}",
            STANDARD.encode(decoded.png_bytes)
        ),
        width: decoded.width,
        height: decoded.height,
        orientation: decoded.orientation,
    })
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
        data_url: thumbnail.data_url,
    })
}
