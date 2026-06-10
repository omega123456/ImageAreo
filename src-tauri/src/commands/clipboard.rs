use std::path::Path;

use serde::Serialize;
use crate::image;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipboardImageData {
    pub rgba_bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub orientation: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardCommandError {
    pub code: &'static str,
    pub message: String,
}

impl ClipboardCommandError {
    pub(crate) fn clipboard(message: impl Into<String>) -> Self {
        Self {
            code: "clipboard_failed",
            message: message.into(),
        }
    }
}

impl From<image::DecodeImageError> for ClipboardCommandError {
    fn from(value: image::DecodeImageError) -> Self {
        Self {
            code: value.code,
            message: value.message,
        }
    }
}

pub fn prepare_clipboard_image(path: &Path) -> Result<ClipboardImageData, ClipboardCommandError> {
    let loaded = image::load_supported_image_path(path)?;
    let rgba = loaded.image.to_rgba8();

    Ok(ClipboardImageData {
        rgba_bytes: rgba.into_raw(),
        width: loaded.image.width(),
        height: loaded.image.height(),
        orientation: loaded.orientation,
    })
}

#[doc(hidden)]
pub mod __test_support {
    use super::*;

    pub fn clipboard_error(message: &str) -> ClipboardCommandError {
        ClipboardCommandError::clipboard(message)
    }
}
