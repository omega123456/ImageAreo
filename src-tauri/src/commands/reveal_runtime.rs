use std::path::Path;

use super::reveal::{validate_reveal_path, RevealCommandError};

#[tauri::command(rename_all = "camelCase")]
pub async fn reveal_in_file_manager(path: String) -> Result<(), RevealCommandError> {
    let validated = validate_reveal_path(Path::new(&path))?;

    tauri_plugin_opener::reveal_item_in_dir(&validated).map_err(|err| {
        RevealCommandError::reveal(format!("failed to reveal {}: {err}", validated.display()))
    })?;

    Ok(())
}
