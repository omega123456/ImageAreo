use crate::associations::{self, AssociationError, ExtAssociation};

#[tauri::command]
pub async fn query_file_associations() -> Result<Vec<ExtAssociation>, AssociationError> {
    associations::query_file_associations()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_default_associations(exts: Vec<String>) -> Result<(), AssociationError> {
    associations::set_default_associations(&exts)
}
