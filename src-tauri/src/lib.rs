#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // NOTE: the single-instance plugin is intentionally NOT registered so that
    // multiple ImageAreo instances can run with independent folder contexts.
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
