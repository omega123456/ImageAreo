use std::path::{Path, PathBuf};

use crate::image;
use serde::Serialize;

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

    fn io(message: impl Into<String>) -> Self {
        Self {
            code: "io_error",
            message: message.into(),
        }
    }

    fn unsupported(message: impl Into<String>) -> Self {
        Self {
            code: "unsupported_format",
            message: message.into(),
        }
    }
}

pub fn validate_clipboard_file_path(path: &Path) -> Result<PathBuf, ClipboardCommandError> {
    if !image::is_supported_image_path(path) {
        return Err(ClipboardCommandError::unsupported(format!(
            "unsupported image format: {}",
            path.display()
        )));
    }

    let path = path.canonicalize().map_err(|err| {
        ClipboardCommandError::io(format!("failed to resolve {}: {err}", path.display()))
    })?;
    if !path.is_file() {
        return Err(ClipboardCommandError::io(format!(
            "not a file: {}",
            path.display()
        )));
    }

    Ok(path)
}

#[doc(hidden)]
pub mod __test_support {
    use super::*;

    pub fn clipboard_error(message: &str) -> ClipboardCommandError {
        ClipboardCommandError::clipboard(message)
    }
}
