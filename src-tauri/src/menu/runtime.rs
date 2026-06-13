use super::{ids, MenuAction, MENU_EVENT};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

/// Build the native application menu (File / View / + macOS app menu).
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            "ImageAreo",
            true,
            &[
                &PredefinedMenuItem::about(app, Some("ImageAreo"), None)?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, ids::SETTINGS, "Settings…", true, Some("Cmd+,"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        menu.append(&app_menu)?;
    }

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, ids::OPEN, "Open…", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(
                app,
                ids::OPEN_FOLDER,
                "Open Folder…",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?,
        ],
    )?;
    menu.append(&file_menu)?;

    // macOS reserves F11 (Mission Control), so it never reaches the menu item.
    // AppKit routes the standard mac fullscreen chord (Ctrl+Cmd+F) reliably.
    #[cfg(target_os = "macos")]
    let fullscreen_accel = "Ctrl+Cmd+F";
    #[cfg(not(target_os = "macos"))]
    let fullscreen_accel = "F11";

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, ids::FIT, "Fit to Screen", true, Some("F"))?,
            &MenuItem::with_id(app, ids::ACTUAL_SIZE, "Actual Size", true, Some("1"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                ids::TOGGLE_GALLERY,
                "Toggle Gallery",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                ids::TOGGLE_FULLSCREEN,
                "Toggle Fullscreen",
                true,
                Some(fullscreen_accel),
            )?,
        ],
    )?;
    menu.append(&view_menu)?;

    Ok(menu)
}

/// Route a clicked menu item to the frontend via the `MENU_EVENT` event.
/// Natively-handled items (Quit, About, …) carry no frontend key and are
/// ignored here.
pub fn route_menu_event<R: Runtime>(app: &AppHandle<R>, menu_id: &str) {
    if let Some(key) = MenuAction::from_id(menu_id).frontend_key() {
        let _ = app.emit(MENU_EVENT, key);
    }
}
