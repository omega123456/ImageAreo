pub mod associations;
pub mod cache_dirs;
pub mod commands;
pub mod folder;
pub mod image;
pub mod logging;
pub mod menu;
pub mod scheduler;
pub mod startup;
pub mod thumbnail;

use std::path::Path;
#[cfg(windows)]
use std::path::PathBuf;

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

/// Recover a launch whose main window failed to create: relaunch this exe with
/// the same arguments after a backoff, or give up once attempts run out. Never
/// returns — a process without its window would otherwise linger forever.
///
/// The relaunch runs on a spare WebView2 data folder, so it starts its own
/// browser process instead of attaching to the stuck one that owns the shared
/// folder. It also starts from the executable's folder rather than the opened
/// file's folder, the way Start-menu launches do.
/// (OS process side effect — the retry policy is tested in `startup`.)
fn recover_from_failed_main_window(attempt: u32, default_webview_data_dir: Option<&Path>) -> ! {
    match startup::relaunch_plan(attempt) {
        Some((next_attempt, delay)) => {
            let webview_data_dir =
                default_webview_data_dir.and_then(startup::fallback_webview_data_dir);
            log::warn!(
                target: "startup",
                "main window failed to create (attempt {attempt}/{}); relaunching in {delay:?} with webview data dir {webview_data_dir:?}",
                startup::MAX_LAUNCH_ATTEMPTS
            );
            std::thread::sleep(delay);
            let cwd = std::env::current_dir().unwrap_or_default();
            let spawned = std::env::current_exe().and_then(|exe| {
                let mut command = std::process::Command::new(&exe);
                command
                    .args(startup::relaunch_args(std::env::args_os().skip(1), &cwd))
                    .env(startup::LAUNCH_ATTEMPT_ENV, next_attempt.to_string());
                if let Some(exe_dir) = exe.parent() {
                    command.current_dir(exe_dir);
                }
                if let Some(dir) = &webview_data_dir {
                    command.env(startup::WEBVIEW2_USER_DATA_FOLDER_ENV, dir);
                }
                command.spawn()
            });
            if let Err(err) = spawned {
                log::error!(target: "startup", "relaunch failed: {err}");
            }
        }
        None => log::error!(
            target: "startup",
            "main window failed to create after {attempt} attempts; giving up"
        ),
    }
    std::process::exit(1)
}

/// Log the WebView2 runtime and data folder this launch will use, and whether
/// a browser process already owns that folder: a failed launch whose folder was
/// already owned points at that process, not at this launch.
#[cfg(windows)]
fn log_webview2_environment(default_data_dir: Option<&Path>) {
    use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;

    let mut version = windows::core::PWSTR::null();
    // SAFETY: on success the loader returns a CoTaskMem string, which
    // `take_pwstr` copies and frees.
    let runtime = unsafe {
        GetAvailableCoreWebView2BrowserVersionString(windows::core::PCWSTR::null(), &mut version)
    }
    .map(|()| webview2_com::take_pwstr(version));
    let data_dir = std::env::var_os(startup::WEBVIEW2_USER_DATA_FOLDER_ENV)
        .map(PathBuf::from)
        .or_else(|| default_data_dir.map(Path::to_path_buf));
    log::info!(
        target: "startup",
        "webview2 runtime={runtime:?} data_dir={data_dir:?} in_use={}",
        data_dir.as_deref().is_some_and(startup::webview_data_dir_in_use)
    );
}

/// Signal that the frontend has registered its event listeners and is ready to
/// receive the initial launch path. Returns the buffered path (if any) so the
/// frontend can open it directly — closing the macOS Opened-before-ready race.
///
/// This is pure handshake plumbing (the buffering logic is unit-tested in the
/// `startup` module); the command body itself is a thin managed-state accessor.
#[tauri::command]
fn frontend_ready(buffer: tauri::State<'_, LaunchPathBuffer>) -> Option<String> {
    log::info!(target: "startup", "frontend ready");
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
    // Install the logger before anything else so a launch that hangs or dies
    // before its window appears still logs the last stage it reached. The local
    // offset must be read now, while the process is still single-threaded.
    let config_dir = logging::config_dir();
    let local_offset = time::UtcOffset::current_local_offset().unwrap_or(time::UtcOffset::UTC);
    let logger = logging::FileLogger::new(
        &logging::log_dir(config_dir.as_deref()),
        logging::initial_level(config_dir.as_deref()),
        local_offset,
    )
    .ok();
    if let Some(logger) = &logger {
        logging::logger::install_global(std::sync::Arc::clone(logger));
    }
    logging::logger::install_panic_hook();
    let launch_attempt =
        startup::parse_launch_attempt(std::env::var(startup::LAUNCH_ATTEMPT_ENV).ok().as_deref());
    log::info!(
        target: "startup",
        "launch v{} attempt={launch_attempt} os={} args={:?} cwd={:?}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::args_os().collect::<Vec<_>>(),
        std::env::current_dir().ok()
    );
    let default_webview_data_dir = if cfg!(windows) {
        startup::default_webview_data_dir(std::env::var_os("LOCALAPPDATA"))
    } else {
        None
    };
    #[cfg(windows)]
    log_webview2_environment(default_webview_data_dir.as_deref());

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
        .manage(logging::LoggingState { logger })
        .on_page_load(|webview, payload| {
            log::info!(
                target: "startup",
                "page load {:?} label={} url={}",
                payload.event(),
                webview.label(),
                payload.url()
            );
        })
        .setup(move |app| {
            use tauri::Manager;
            // Tauri builds the config windows (window + WebView2/WKWebView)
            // right before calling this hook, but a failed webview creation is
            // only logged: the label stays registered with no native window
            // behind it, so a native-window query is the reliable check.
            let main_window_ok = app
                .get_webview_window("main")
                .is_some_and(|window| window.is_visible().is_ok());
            if !main_window_ok {
                recover_from_failed_main_window(
                    launch_attempt,
                    default_webview_data_dir.as_deref(),
                );
            }
            log::info!(target: "startup", "setup: main window and webview created");
            if launch_attempt > 1 {
                // The webview has read the data-folder override; keep it out of
                // processes this instance starts (other WebView2 apps honor it too).
                std::env::remove_var(startup::WEBVIEW2_USER_DATA_FOLDER_ENV);
            }
            // The decode scheduler spawns per-class dispatcher tasks on the Tauri
            // async runtime, so it must be constructed inside `setup` (which runs
            // within the runtime) rather than during builder configuration.
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
            commands::logging::log_frontend,
            commands::logging::set_log_level,
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
            commands::reveal_runtime::reveal_in_file_manager,
            commands::print_runtime::print_current_view
        ])
        .build(tauri::generate_context!())
        .inspect(|_| log::info!(target: "startup", "tauri app built (plugins initialized)"))
        .expect("error while building tauri application")
        // macOS delivers file-association opens via the Opened event. Cold
        // launches buffer the path for this process; warm launches spawn a new
        // app instance because Finder routes document opens to the running app.
        // (OS hookup — coverage-excluded.)
        .run(|app, event| {
            match &event {
                tauri::RunEvent::Ready => {
                    log::info!(target: "startup", "event loop ready (setup complete)")
                }
                tauri::RunEvent::ExitRequested { code, .. } => {
                    log::info!(target: "startup", "exit requested code={code:?}")
                }
                tauri::RunEvent::Exit => log::info!(target: "startup", "exit"),
                _ => {}
            }
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
