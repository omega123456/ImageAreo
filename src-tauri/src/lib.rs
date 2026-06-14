pub mod associations;
pub mod cache_dirs;
pub mod commands;
pub mod folder;
pub mod image;
pub mod menu;
pub mod scheduler;
pub mod startup;
pub mod thumbnail;

use startup::LaunchPathBuffer;

#[cfg(target_os = "macos")]
fn spawn_macos_new_instance(path: &str) -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let Some(app_bundle) = startup::macos_app_bundle_path(&exe) else {
        return false;
    };

    match std::process::Command::new("open")
        .arg("-n")
        .arg(app_bundle)
        .arg("--args")
        .arg(path)
        .spawn()
    {
        Ok(mut child) => {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            true
        }
        Err(_) => false,
    }
}

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
    // On Windows a second launch spawns a new process naturally. On macOS,
    // Finder routes warm document opens into the running process, so the
    // RunEvent::Opened handler below forwards those paths to a fresh instance.

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
            // The decode scheduler spawns per-class dispatcher tasks on the Tauri
            // async runtime, so it must be constructed inside `setup` (which runs
            // within the runtime) rather than during builder configuration.
            use tauri::Manager;
            app.manage(scheduler::Scheduler::new());

            if menu::should_attach_native_menu() {
                // Build and attach the native application menu, routing item
                // clicks to the frontend. (OS hookup — coverage-excluded.)
                let menu = menu::build_menu(app.handle())?;
                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    menu::route_menu_event(app, event.id().as_ref());
                });
            }

            // Evict cache files older than the two-day window from both the
            // decoded-image cache and the thumbnail cache. The sweep runs off the
            // UI thread so it never delays launch, and a missing cache directory
            // on first run is a no-op (handled inside `sweep_caches`). The
            // decision logic is unit-tested in `cache_maintenance`; this is pure
            // OS-side-effect hookup (coverage-excluded).
            std::thread::spawn(|| {
                let dirs = [
                    image::disk_cache::cache_dir(),
                    thumbnail::thumbnail_cache_dir(),
                ];
                image::cache_maintenance::sweep_caches(&dirs);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            frontend_ready,
            commands::associations_runtime::query_file_associations,
            commands::associations_runtime::set_default_associations,
            commands::scan_folder,
            commands::folder_signature,
            commands::probe_image,
            commands::read_image_metadata,
            commands::decode_image,
            commands::peek_decoded_image,
            commands::sample_image,
            commands::generate_thumbnail,
            commands::clipboard_runtime::copy_image_to_clipboard,
            commands::reveal_runtime::reveal_in_file_manager
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // macOS delivers file-association opens via the Opened event. Cold
        // launches buffer the path for this process; warm launches spawn a new
        // app instance because Finder routes document opens to the running app.
        // (OS hookup — coverage-excluded.)
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
                        if !spawn_macos_new_instance(&path) {
                            let _ = app.emit(startup::OPEN_PATH_EVENT, path);
                        }
                    }
                }
            }
            let _ = (app, &event);
        });
}
