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

#[doc(hidden)]
pub mod __test_support {
    use super::*;

    pub fn print_error(message: &str) -> PrintCommandError {
        PrintCommandError::print(message)
    }
}
