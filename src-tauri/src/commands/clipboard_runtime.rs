use std::path::Path;

use tauri::image::Image as TauriImage;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

use super::clipboard::{prepare_clipboard_image, ClipboardCommandError};
use crate::scheduler::{JobClass, Priority, RunError, Scheduler};

#[tauri::command(rename_all = "camelCase")]
pub async fn copy_image_to_clipboard<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<(), ClipboardCommandError> {
    // Preparing a large RAW for the clipboard is a full develop + RGBA expand; it
    // runs through the scheduler's full-decode permit class so it cannot pile up
    // concurrently with other heavy decodes (which is what bounds peak memory).
    // The clipboard write itself stays a current-image-priority, foreground action.
    let scheduler = app.state::<Scheduler>().inner().clone();
    let key = format!("clipboard:{path}");
    let prepare_path = path.clone();
    let result = scheduler
        .run(
            JobClass::FullEnhance,
            Priority::CurrentImage,
            key,
            move || async move {
                // Returns `Result<ClipboardImageData, ClipboardCommandError>`; a
                // failure is surfaced (not cached) so a transient prepare error can
                // be retried rather than sticking for the single-flight TTL.
                match tauri::async_runtime::spawn_blocking(move || {
                    prepare_clipboard_image(Path::new(&prepare_path))
                })
                .await
                {
                    Ok(prepared) => prepared,
                    Err(err) => Err(ClipboardCommandError::clipboard(format!(
                        "clipboard task failed: {err}"
                    ))),
                }
            },
        )
        .await
        .map_err(|err| match err {
            RunError::Scheduler(err) => ClipboardCommandError::clipboard(err.to_string()),
            RunError::Work(err) => err,
        })?;
    let prepared = (*result).clone();
    let image = TauriImage::new_owned(prepared.rgba_bytes, prepared.width, prepared.height);

    app.clipboard().write_image(&image).map_err(|err| {
        ClipboardCommandError::clipboard(format!("failed to write image to clipboard: {err}"))
    })?;

    Ok(())
}
