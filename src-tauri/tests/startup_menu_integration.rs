//! Phase 12 integration tests: launch-path parsing, the ready-handshake
//! buffering state machine, and native-menu action routing.
//!
//! These exercise the pure, headless-assertable logic. The Tauri menu
//! construction and the macOS Opened/launch OS hookup in `lib.rs` are on the
//! coverage-exclusion list (they require a real OS event loop) and are
//! verified manually.

use imageareo_lib::menu::{ids, MenuAction, MENU_EVENT};
use imageareo_lib::startup::{parse_launch_path, LaunchPathBuffer, OPEN_PATH_EVENT};

#[test]
fn parse_launch_path_reads_first_non_flag_argument() {
    assert_eq!(
        parse_launch_path(["imageareo", "/photos/a.jpg"]).as_deref(),
        Some("/photos/a.jpg")
    );
    assert_eq!(
        parse_launch_path(["imageareo.exe", "--flag", "C:/imgs/b.png"]).as_deref(),
        Some("C:/imgs/b.png")
    );
    assert_eq!(parse_launch_path(["imageareo"]), None);
}

#[test]
fn cold_launch_buffers_path_until_frontend_ready() {
    // Simulates the macOS Opened-before-ready race: the path arrives first.
    let buffer = LaunchPathBuffer::new();
    let emit_immediately = buffer.offer("/photos/cold.heic".to_string());

    assert!(!emit_immediately, "pre-ready path must be buffered, not emitted");
    assert!(!buffer.is_ready());

    // Frontend signals ready -> the buffered path is flushed exactly once.
    assert_eq!(buffer.mark_ready().as_deref(), Some("/photos/cold.heic"));
    assert_eq!(buffer.mark_ready(), None);
}

#[test]
fn warm_open_after_ready_emits_directly() {
    let buffer = LaunchPathBuffer::new();
    buffer.mark_ready();
    assert!(
        buffer.offer("/photos/warm.jpg".to_string()),
        "post-ready path should be emitted directly, not buffered"
    );
}

#[test]
fn seed_threads_the_startup_argv_path_through_the_buffer() {
    let buffer = LaunchPathBuffer::new();
    buffer.seed(parse_launch_path(["imageareo", "/photos/seed.jxl"]));
    assert_eq!(buffer.mark_ready().as_deref(), Some("/photos/seed.jxl"));
}

#[test]
fn menu_ids_route_to_frontend_keys() {
    for id in [
        ids::OPEN,
        ids::OPEN_FOLDER,
        ids::FIT,
        ids::ACTUAL_SIZE,
        ids::TOGGLE_GALLERY,
        ids::TOGGLE_FULLSCREEN,
        ids::SETTINGS,
    ] {
        assert_eq!(MenuAction::from_id(id).frontend_key(), Some(id));
    }
}

#[test]
fn natively_handled_menu_items_have_no_frontend_key() {
    assert_eq!(MenuAction::from_id("predefined.quit"), MenuAction::Unknown);
    assert_eq!(MenuAction::from_id("predefined.quit").frontend_key(), None);
}

#[test]
fn event_names_are_stable_contract_constants() {
    assert_eq!(OPEN_PATH_EVENT, "imageareo://open-path");
    assert_eq!(MENU_EVENT, "imageareo://menu");
}
