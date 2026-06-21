use serde::Serialize;

/// Structured error returned by the `print_current_view` command. Mirrors the
/// shape of [`super::reveal::RevealCommandError`] so the frontend can treat all
/// OS-action command failures uniformly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintCommandError {
    pub code: &'static str,
    pub message: String,
}

impl PrintCommandError {
    /// The native print operation could not be started (e.g. the webview handle
    /// was unavailable, or the platform print API failed).
    pub(crate) fn print(message: impl Into<String>) -> Self {
        Self {
            code: "print_failed",
            message: message.into(),
        }
    }
}

/// Page orientation requested by the frontend (mirrors the `print` store).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrintOrientation {
    Portrait,
    Landscape,
}

impl PrintOrientation {
    /// Map a serialized orientation string to the enum. Unknown values fall back
    /// to portrait (the store's default) rather than failing the print.
    pub fn from_str(value: &str) -> Self {
        match value {
            "landscape" => PrintOrientation::Landscape,
            _ => PrintOrientation::Portrait,
        }
    }
}

/// Convert millimetres to PostScript/typographic points (the unit AppKit's
/// `NSPrintInfo` paper size uses): `pt = mm × 72 / 25.4`.
pub fn mm_to_points(mm: f64) -> f64 {
    mm * 72.0 / 25.4
}

#[doc(hidden)]
pub mod __test_support {
    use super::PrintCommandError;

    pub use super::{mm_to_points, PrintOrientation};

    pub fn print_error(message: &str) -> PrintCommandError {
        PrintCommandError::print(message)
    }
}
