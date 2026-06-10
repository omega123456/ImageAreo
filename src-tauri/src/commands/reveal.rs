use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealCommandError {
    pub code: &'static str,
    pub message: String,
}

impl RevealCommandError {
    fn invalid_path(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_path",
            message: message.into(),
        }
    }

    fn reveal(message: impl Into<String>) -> Self {
        Self {
            code: "reveal_failed",
            message: message.into(),
        }
    }
}

pub fn validate_reveal_path(path: &Path) -> Result<PathBuf, RevealCommandError> {
    if path.as_os_str().is_empty() {
        return Err(RevealCommandError::invalid_path("path must not be empty"));
    }

    let canonical = std::fs::canonicalize(path).map_err(|err| {
        RevealCommandError::invalid_path(format!("failed to resolve {}: {err}", path.display()))
    })?;

    let metadata = std::fs::metadata(&canonical).map_err(|err| {
        RevealCommandError::invalid_path(format!(
            "failed to inspect {}: {err}",
            canonical.display()
        ))
    })?;

    if metadata.is_file() || metadata.is_dir() {
        Ok(canonical)
    } else {
        Err(RevealCommandError::invalid_path(format!(
            "path is not a file or directory: {}",
            canonical.display()
        )))
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reveal_in_file_manager(path: String) -> Result<(), RevealCommandError> {
    let validated = validate_reveal_path(Path::new(&path))?;

    tauri_plugin_opener::reveal_item_in_dir(&validated).map_err(|err| {
        RevealCommandError::reveal(format!("failed to reveal {}: {err}", validated.display()))
    })?;

    Ok(())
}
