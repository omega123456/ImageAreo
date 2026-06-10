use std::path::Path;

use tauri::image::Image as TauriImage;
use tauri::{AppHandle, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

use super::clipboard::{prepare_clipboard_image, ClipboardCommandError};

#[tauri::command(rename_all = "camelCase")]
pub async fn copy_image_to_clipboard<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<(), ClipboardCommandError> {
    let prepared = prepare_clipboard_image(Path::new(&path))?;
    let image = TauriImage::new_owned(prepared.rgba_bytes, prepared.width, prepared.height);

    app.clipboard().write_image(&image).map_err(|err| {
        ClipboardCommandError::clipboard(format!("failed to write image to clipboard: {err}"))
    })?;

    Ok(())
}
