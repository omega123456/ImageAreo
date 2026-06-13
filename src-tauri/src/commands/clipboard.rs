use std::path::Path;

use crate::image;
use ::image::{imageops::FilterType, DynamicImage, RgbaImage};
use serde::Serialize;

/// Cap the longest edge of an image placed on the OS clipboard. A full RAW is
/// tens of megapixels; expanded to RGBA that is hundreds of MB, which the macOS
/// (`NSPasteboard`/TIFF) and Windows (DIB) clipboard paths fail to write or
/// accept. Downscaling to this bound keeps the copy reliable and fast while
/// staying large enough for any realistic paste target.
const CLIPBOARD_MAX_EDGE: u32 = 4096;

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
    // Source from the on-disk display cache (built if absent), so a RAW copy
    // reuses the capped display image instead of re-developing the sensor.
    let (image, orientation) = image::load_full_image_cached(path)?;
    let rgba = clipboard_rgba(image.as_ref());

    Ok(ClipboardImageData {
        width: rgba.width(),
        height: rgba.height(),
        rgba_bytes: rgba.into_raw(),
        orientation,
    })
}

/// Expand the image to RGBA for the clipboard, downscaling first when it is
/// larger than {@link CLIPBOARD_MAX_EDGE} so the OS clipboard write stays within
/// a size the platform pasteboards can actually accept.
fn clipboard_rgba(image: &DynamicImage) -> RgbaImage {
    if image.width().max(image.height()) > CLIPBOARD_MAX_EDGE {
        image
            .resize(CLIPBOARD_MAX_EDGE, CLIPBOARD_MAX_EDGE, FilterType::Triangle)
            .to_rgba8()
    } else {
        image.to_rgba8()
    }
}

#[doc(hidden)]
pub mod __test_support {
    use super::*;

    pub fn clipboard_error(message: &str) -> ClipboardCommandError {
        ClipboardCommandError::clipboard(message)
    }
}
