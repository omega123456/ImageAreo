use std::path::Path;

use tauri::{AppHandle, Runtime};

use super::clipboard::{validate_clipboard_file_path, ClipboardCommandError};

#[tauri::command(rename_all = "camelCase")]
pub async fn copy_image_to_clipboard<R: Runtime>(
    _app: AppHandle<R>,
    path: String,
) -> Result<(), ClipboardCommandError> {
    copy_original_file_to_clipboard(Path::new(&path))
}

/// OS-level copy: place the original file path on the native clipboard. This
/// behaves like copying the file in Finder/Explorer and deliberately avoids any
/// in-app decode/resize/re-encode path. The actual clipboard write is an OS
/// side effect, so it lives in this coverage-excluded runtime module.
fn copy_original_file_to_clipboard(path: &Path) -> Result<(), ClipboardCommandError> {
    let path = validate_clipboard_file_path(path)?;

    arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.set().file_list(&[path]))
        .map_err(|err| {
            ClipboardCommandError::clipboard(format!(
                "failed to copy original image file to clipboard: {err}"
            ))
        })
}
