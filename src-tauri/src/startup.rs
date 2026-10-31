//! Launch-path handling and the frontend-ready handshake (Phase 12).
//!
//! ImageAreo can be launched with an initial image/folder to open via:
//!   * Windows / Linux: the path is passed as a process argument.
//!   * macOS: the OS delivers the path via the "Opened" application event,
//!     which can fire *before* the webview JS has registered its listener.
//!
//! To avoid losing that initial path, the Rust side buffers it in a
//! [`LaunchPathBuffer`] until the frontend calls the `frontend_ready` command.
//! Once ready, any buffered path is flushed and emitted to the frontend. Paths
//! that arrive after the frontend is ready are left to the OS-event caller:
//! Windows argv launches open in their own process naturally, while macOS warm
//! document opens are forwarded to a fresh `open -n` app instance.
//!
//! Only the pure logic (argv parsing + buffering state machine) lives here and
//! is unit-tested. The OS-event hookup itself is wired in `lib.rs` and is on the
//! coverage-exclusion list (it cannot be asserted headlessly).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// The event name emitted to the frontend carrying a path to open.
pub const OPEN_PATH_EVENT: &str = "imageareo://open-path";

/// Carries the 1-based launch attempt into a relaunched process.
pub const LAUNCH_ATTEMPT_ENV: &str = "IMAGEAREO_LAUNCH_ATTEMPT";

/// Total launches (the first plus relaunches) before giving up on a main
/// window that keeps failing to create.
pub const MAX_LAUNCH_ATTEMPTS: u32 = 4;

/// Parse the launch attempt from [`LAUNCH_ATTEMPT_ENV`]; missing, invalid, or
/// zero values mean this is the first attempt.
pub fn parse_launch_attempt(value: Option<&str>) -> u32 {
    value
        .and_then(|raw| raw.trim().parse::<u32>().ok())
        .filter(|attempt| *attempt > 0)
        .unwrap_or(1)
}

/// What to do after launch `attempt` failed to create its main window.
///
/// On Windows, WebView2 creation can fail (e.g. `RPC_E_DISCONNECTED`) when the
/// browser process that owns the shared data folder is stuck, which waiting
/// alone does not fix. Tauri only logs that failure and keeps the `main` label
/// registered, so the window cannot be rebuilt in-process; the recovery is a
/// fresh process on a spare data folder ([`fallback_webview_data_dir`]) after
/// a backoff (1s, 2s, 4s).
/// Returns `Some((next_attempt, delay))`, or `None` once attempts run out.
pub fn relaunch_plan(attempt: u32) -> Option<(u32, Duration)> {
    if attempt >= MAX_LAUNCH_ATTEMPTS {
        return None;
    }
    let delay = Duration::from_secs(1u64 << (attempt.max(1) - 1).min(10));
    Some((attempt + 1, delay))
}

/// WebView2's documented override for its user data folder. It wins over the
/// folder Tauri passes in, so a relaunch can move to another folder without
/// touching the window config.
pub const WEBVIEW2_USER_DATA_FOLDER_ENV: &str = "WEBVIEW2_USER_DATA_FOLDER";

/// Number of spare WebView2 data folders a relaunch can choose from.
pub const WEBVIEW_FALLBACK_SLOTS: u32 = 8;

/// Tauri's default WebView2 data folder on Windows, `%LOCALAPPDATA%\<identifier>`
/// (WebView2 keeps its files in an `EBWebView` folder inside it).
pub fn default_webview_data_dir(local_app_data: Option<OsString>) -> Option<PathBuf> {
    local_app_data
        .filter(|dir| !dir.is_empty())
        .map(|dir| PathBuf::from(dir).join(crate::logging::APP_IDENTIFIER))
}

/// Whether a WebView2 browser process owns `data_dir`. The browser holds
/// `EBWebView\lockfile` open with delete-on-close for its whole life, so the
/// file exists while any browser process, stuck or not, owns the folder.
pub fn webview_data_dir_in_use(data_dir: &Path) -> bool {
    data_dir.join("EBWebView").join("lockfile").exists()
}

/// The first spare data folder (`webview-fallback-<n>` inside the default one)
/// that no browser process owns, so a relaunch starts a browser process of its
/// own instead of attaching to the one that just failed. `None` when every
/// slot is taken.
pub fn fallback_webview_data_dir(default_dir: &Path) -> Option<PathBuf> {
    (1..=WEBVIEW_FALLBACK_SLOTS)
        .map(|slot| default_dir.join(format!("webview-fallback-{slot}")))
        .find(|dir| !webview_data_dir_in_use(dir))
}

/// Arguments for a relaunch that runs from the executable's folder: relative
/// paths are resolved against the failed process's `cwd` so they still point
/// at the same file. Flags and absolute paths pass through unchanged.
pub fn relaunch_args<I>(args: I, cwd: &Path) -> Vec<OsString>
where
    I: IntoIterator<Item = OsString>,
{
    args.into_iter()
        .map(|arg| {
            let is_flag = arg.as_encoded_bytes().first() == Some(&b'-');
            if arg.is_empty() || is_flag || Path::new(&arg).is_absolute() {
                arg
            } else {
                cwd.join(arg).into_os_string()
            }
        })
        .collect()
}

/// Extract the launch path (image or folder to open) from process arguments.
///
/// `argv[0]` is the executable path and is always skipped. The first remaining
/// argument that is not an option flag (does not start with `-`) is treated as
/// the path to open. Returns `None` when no such argument is present.
pub fn parse_launch_path<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    args.into_iter()
        .map(Into::into)
        .skip(1)
        .find(|arg| !arg.is_empty() && !arg.starts_with('-'))
}

/// Resolve the surrounding `.app` bundle for a macOS executable path.
///
/// Bundled app executables live under `ImageAreo.app/Contents/MacOS/`; Finder
/// document opens route to the already-running process, so the runtime uses this
/// bundle path with `open -n` when it needs a fresh viewer instance.
pub fn macos_app_bundle_path(executable_path: &Path) -> Option<PathBuf> {
    executable_path
        .ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .map(Path::to_path_buf)
}

/// Buffers an initial launch path until the frontend signals it is ready.
///
/// This is the core of the ready-handshake: a launch path that arrives before
/// the webview registers its listener is held here and flushed on
/// [`LaunchPathBuffer::mark_ready`]. Paths arriving after the frontend is ready
/// are not buffered (the caller emits them directly) — [`offer`](Self::offer)
/// reports whether buffering happened.
#[derive(Debug, Default)]
pub struct LaunchPathBuffer {
    inner: Mutex<BufferState>,
}

#[derive(Debug, Default)]
struct BufferState {
    /// Whether the frontend has signalled readiness.
    ready: bool,
    /// A path captured before the frontend was ready, awaiting flush.
    pending: Option<String>,
}

impl LaunchPathBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Seed the buffer with the launch path discovered at startup (if any),
    /// before the frontend is ready. Equivalent to calling [`offer`](Self::offer)
    /// for each, but intended for the single startup path.
    pub fn seed(&self, path: Option<String>) {
        if let Some(path) = path {
            self.offer(path);
        }
    }

    /// Offer a path to open.
    ///
    /// * If the frontend is not yet ready, the path is buffered and `false` is
    ///   returned (the caller should NOT emit yet — it will be flushed on
    ///   [`mark_ready`](Self::mark_ready)).
    /// * If the frontend is ready, nothing is buffered and `true` is returned
    ///   (the caller should emit the path immediately).
    ///
    /// Only the most recent pre-ready path is retained.
    pub fn offer(&self, path: String) -> bool {
        let mut state = self.inner.lock().expect("launch buffer poisoned");
        if state.ready {
            true
        } else {
            state.pending = Some(path);
            false
        }
    }

    /// Mark the frontend as ready and return any buffered path to flush.
    ///
    /// Returns the pending path exactly once; subsequent calls return `None`.
    pub fn mark_ready(&self) -> Option<String> {
        let mut state = self.inner.lock().expect("launch buffer poisoned");
        state.ready = true;
        state.pending.take()
    }

    /// Whether the frontend has signalled readiness.
    pub fn is_ready(&self) -> bool {
        self.inner.lock().expect("launch buffer poisoned").ready
    }
}
