//! Native application menu construction and event routing (Phase 12).
//!
//! The menu mirrors the toolbar actions. Most items route a typed event to the
//! frontend (so the same store actions used elsewhere drive them); the
//! exception is fullscreen, which the frontend toggles via a window API after
//! receiving its menu event.
//!
//! The menu-item ID → [`MenuAction`] mapping is pure and unit-tested. The
//! Tauri menu *construction* and the OS event hookup live behind `tauri` types
//! and are exercised only at runtime (the launch/menu hookup is on the
//! coverage-exclusion list).

/// Stable menu-item identifiers. These double as the action keys routed to the
/// frontend, keeping the Rust menu and the frontend dispatcher in sync.
pub mod ids {
    pub const OPEN: &str = "file.open";
    pub const OPEN_FOLDER: &str = "file.open_folder";
    pub const FIT: &str = "view.fit";
    pub const ACTUAL_SIZE: &str = "view.actual_size";
    pub const TOGGLE_GALLERY: &str = "view.toggle_gallery";
    pub const TOGGLE_FULLSCREEN: &str = "view.toggle_fullscreen";
    pub const SETTINGS: &str = "app.settings";
}

/// The event name carrying a menu-driven action to the frontend.
pub const MENU_EVENT: &str = "imageareo://menu";

/// A menu action, resolved from a clicked menu-item ID.
///
/// `OpenDialog`/`OpenFolderDialog` are surfaced to the frontend so it can drive
/// the existing dialog-based open flow; the rest map 1:1 to frontend view/store
/// actions. `Unknown` covers OS-provided items (Quit, Copy, etc.) that Tauri
/// handles natively and that the frontend must ignore.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuAction {
    OpenDialog,
    OpenFolderDialog,
    Fit,
    ActualSize,
    ToggleGallery,
    ToggleFullscreen,
    OpenSettings,
    Unknown,
}

impl MenuAction {
    /// Resolve a menu-item ID to its action.
    pub fn from_id(id: &str) -> Self {
        match id {
            ids::OPEN => MenuAction::OpenDialog,
            ids::OPEN_FOLDER => MenuAction::OpenFolderDialog,
            ids::FIT => MenuAction::Fit,
            ids::ACTUAL_SIZE => MenuAction::ActualSize,
            ids::TOGGLE_GALLERY => MenuAction::ToggleGallery,
            ids::TOGGLE_FULLSCREEN => MenuAction::ToggleFullscreen,
            ids::SETTINGS => MenuAction::OpenSettings,
            _ => MenuAction::Unknown,
        }
    }

    /// The action key emitted to the frontend, or `None` for natively-handled
    /// items the frontend should ignore.
    pub fn frontend_key(self) -> Option<&'static str> {
        match self {
            MenuAction::OpenDialog => Some(ids::OPEN),
            MenuAction::OpenFolderDialog => Some(ids::OPEN_FOLDER),
            MenuAction::Fit => Some(ids::FIT),
            MenuAction::ActualSize => Some(ids::ACTUAL_SIZE),
            MenuAction::ToggleGallery => Some(ids::TOGGLE_GALLERY),
            MenuAction::ToggleFullscreen => Some(ids::TOGGLE_FULLSCREEN),
            MenuAction::OpenSettings => Some(ids::SETTINGS),
            MenuAction::Unknown => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri menu construction + hookup (runtime-only; coverage-excluded).
// ---------------------------------------------------------------------------

mod runtime;

pub use runtime::{build_menu, route_menu_event};
