pub mod commands;
pub mod folder;
pub mod image;
pub mod thumbnail;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // NOTE: the single-instance plugin is intentionally NOT registered so that
    // multiple ImageAreo instances can run with independent folder contexts.
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::scan_folder,
            commands::decode_image,
            commands::generate_thumbnail,
            commands::clipboard::copy_image_to_clipboard,
            commands::reveal::reveal_in_file_manager
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
