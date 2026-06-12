pub mod associations;
pub mod commands;
pub mod folder;
pub mod image;
pub mod menu;
pub mod startup;
pub mod thumbnail;

use startup::{LaunchPathBuffer, OPEN_PATH_EVENT};

/// Signal that the frontend has registered its event listeners and is ready to
/// receive the initial launch path. Returns the buffered path (if any) so the
/// frontend can open it directly — closing the macOS Opened-before-ready race.
///
/// This is pure handshake plumbing (the buffering logic is unit-tested in the
/// `startup` module); the command body itself is a thin managed-state accessor.
#[tauri::command]
fn frontend_ready(buffer: tauri::State<'_, LaunchPathBuffer>) -> Option<String> {
    buffer.mark_ready()
}

/// Browser-chrome lockdown (`tauri-plugin-prevent-default`).
///
/// Release builds disable every browser-native behavior the plugin covers — the
/// native right-click menu plus the reload/find/print/downloads/open/view-source
/// keyboard shortcuts, DevTools included. Debug builds keep only DevTools so the
/// inspector still opens under `tauri dev`; the webview compiles the inspector
/// into debug builds alone, so release has no DevTools regardless.
///
/// The plugin injects a bubble-phase, `preventDefault`-only listener, so the
/// canvas's own `oncontextmenu` handler still fires and the app's custom menu
/// keeps working. Text selection and image dragging are handled on the frontend
/// (`select-none` / `draggable="false"`) — the plugin has no flags for those.
#[cfg(debug_assertions)]
fn prevent_default() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_prevent_default::Flags;
    tauri_plugin_prevent_default::Builder::new()
        .with_flags(Flags::all().difference(Flags::DEV_TOOLS))
        .build()
}

#[cfg(not(debug_assertions))]
fn prevent_default() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_prevent_default::init()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // NOTE: the single-instance plugin is intentionally NOT registered so that
    // multiple ImageAreo instances can run with independent folder contexts.
    // On Windows a second launch spawns a new process naturally; on macOS the
    // OS reuses the running app, so concurrent instances are launched via
    // `open -n /Applications/ImageAreo.app`.

    // Buffer the initial launch path (argv) until the frontend signals ready.
    // The macOS "Opened" event is wired below and feeds the same buffer.
    let launch_buffer = LaunchPathBuffer::new();
    launch_buffer.seed(startup::parse_launch_path(std::env::args()));

    tauri::Builder::default()
        .plugin(prevent_default())
        // Persist window size/position across launches and restore on startup.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        // Auto-updater: the client checks the GitHub-hosted `latest.json`
        // endpoint configured in tauri.conf.json against the embedded public
        // key. Install/relaunch is an OS process side effect (coverage-excluded).
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Relaunch into the freshly installed update (used by the updater flow).
        .plugin(tauri_plugin_process::init())
        .manage(launch_buffer)
        .setup(|app| {
            // Build and attach the native application menu, routing item clicks
            // to the frontend. (OS hookup — coverage-excluded.)
            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                menu::route_menu_event(app, event.id().as_ref());
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            frontend_ready,
            commands::associations_runtime::query_file_associations,
            commands::associations_runtime::set_default_associations,
            commands::scan_folder,
            commands::decode_image,
            commands::sample_image,
            commands::generate_thumbnail,
            commands::clipboard_runtime::copy_image_to_clipboard,
            commands::reveal_runtime::reveal_in_file_manager
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // macOS delivers file-association opens via the Opened event; buffer or
        // emit depending on whether the frontend is ready. (OS hookup —
        // coverage-excluded.)
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                use tauri::{Emitter, Manager};
                if let Some(path) = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .find_map(|p| p.to_str().map(str::to_owned))
                {
                    let buffer = app.state::<LaunchPathBuffer>();
                    if buffer.offer(path.clone()) {
                        let _ = app.emit(OPEN_PATH_EVENT, path);
                    }
                }
            }
            let _ = (app, &event);
        });
}
