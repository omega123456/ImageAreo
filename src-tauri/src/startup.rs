//! Launch-path handling and the frontend-ready handshake (Phase 12).
//!
//! ImageAreo can be launched with an initial image/folder to open via:
//!   * Windows / Linux: the path is passed as a process argument.
//!   * macOS: the OS delivers the path via the "Opened" application event,
//!     which can fire *before* the webview JS has registered its listener.
//!
//! To avoid losing that initial path, the Rust side buffers it in a
//! [`LaunchPathBuffer`] until the frontend calls the `frontend_ready` command.
//! Once ready, any buffered path is flushed and emitted to the frontend; paths
//! that arrive after the frontend is ready are emitted immediately.
//!
//! Only the pure logic (argv parsing + buffering state machine) lives here and
//! is unit-tested. The OS-event hookup itself is wired in `lib.rs` and is on the
//! coverage-exclusion list (it cannot be asserted headlessly).

use std::sync::Mutex;

/// The event name emitted to the frontend carrying a path to open.
pub const OPEN_PATH_EVENT: &str = "imageareo://open-path";

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
