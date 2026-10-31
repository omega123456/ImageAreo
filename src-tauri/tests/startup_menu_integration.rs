//! Phase 12 integration tests: launch-path parsing, the ready-handshake
//! buffering state machine, and native-menu action routing.
//!
//! These exercise the pure, headless-assertable logic. The Tauri menu
//! construction and the macOS Opened/launch OS hookup in `lib.rs` are on the
//! coverage-exclusion list (they require a real OS event loop) and are
//! verified manually.

use imageareo_lib::logging::APP_IDENTIFIER;
use imageareo_lib::menu::{ids, should_attach_native_menu, MenuAction, MENU_EVENT};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use imageareo_lib::startup::{
    default_webview_data_dir, fallback_webview_data_dir, macos_app_bundle_path,
    parse_launch_attempt, parse_launch_path, relaunch_args, relaunch_plan, webview_data_dir_in_use,
    LaunchPathBuffer, MAX_LAUNCH_ATTEMPTS, OPEN_PATH_EVENT, WEBVIEW2_USER_DATA_FOLDER_ENV,
    WEBVIEW_FALLBACK_SLOTS,
};

/// Simulate a WebView2 browser process owning `data_dir`.
fn lock_webview_data_dir(data_dir: &Path) {
    let ebwebview = data_dir.join("EBWebView");
    std::fs::create_dir_all(&ebwebview).unwrap();
    std::fs::write(ebwebview.join("lockfile"), b"").unwrap();
}

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

    assert!(
        !emit_immediately,
        "pre-ready path must be buffered, not emitted"
    );
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
fn native_menu_attachment_matches_platform_policy() {
    #[cfg(target_os = "macos")]
    assert!(should_attach_native_menu());

    #[cfg(not(target_os = "macos"))]
    assert!(!should_attach_native_menu());
}

#[test]
fn event_names_are_stable_contract_constants() {
    assert_eq!(OPEN_PATH_EVENT, "imageareo://open-path");
    assert_eq!(MENU_EVENT, "imageareo://menu");
}

#[test]
fn macos_plist_allows_document_opens_to_spawn_new_instances() {
    let plist_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("Info.plist");
    let plist = std::fs::read_to_string(&plist_path)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", plist_path.display()));

    assert!(plist.contains("<key>LSMultipleInstancesProhibited</key>"));
    assert!(plist.contains("<false/>"));
}

#[test]
fn macos_app_bundle_path_resolves_from_bundled_executable() {
    let exe = std::path::Path::new("/Applications/ImageAreo.app/Contents/MacOS/imageareo");

    assert_eq!(
        macos_app_bundle_path(exe).as_deref(),
        Some(std::path::Path::new("/Applications/ImageAreo.app"))
    );
    assert_eq!(
        macos_app_bundle_path(std::path::Path::new("/tmp/imageareo")),
        None
    );
}

#[test]
fn parse_launch_attempt_defaults_to_the_first_attempt() {
    assert_eq!(parse_launch_attempt(None), 1);
    assert_eq!(parse_launch_attempt(Some("")), 1);
    assert_eq!(parse_launch_attempt(Some("0")), 1);
    assert_eq!(parse_launch_attempt(Some("-2")), 1);
    assert_eq!(parse_launch_attempt(Some("two")), 1);
    assert_eq!(parse_launch_attempt(Some(" 3 ")), 3);
}

#[test]
fn relaunch_plan_backs_off_then_gives_up() {
    assert_eq!(MAX_LAUNCH_ATTEMPTS, 4);
    assert_eq!(relaunch_plan(1), Some((2, Duration::from_secs(1))));
    assert_eq!(relaunch_plan(2), Some((3, Duration::from_secs(2))));
    assert_eq!(relaunch_plan(3), Some((4, Duration::from_secs(4))));
    assert_eq!(relaunch_plan(MAX_LAUNCH_ATTEMPTS), None);
    assert_eq!(relaunch_plan(u32::MAX), None);
    // A zero attempt (never produced by the parser) still yields a sane delay.
    assert_eq!(relaunch_plan(0), Some((1, Duration::from_secs(1))));
}

#[test]
fn default_webview_data_dir_matches_tauris_local_data_folder() {
    assert_eq!(WEBVIEW2_USER_DATA_FOLDER_ENV, "WEBVIEW2_USER_DATA_FOLDER");
    assert_eq!(default_webview_data_dir(None), None);
    assert_eq!(default_webview_data_dir(Some(OsString::new())), None);
    assert_eq!(
        default_webview_data_dir(Some(OsString::from("/users/omega/local"))),
        Some(PathBuf::from("/users/omega/local").join(APP_IDENTIFIER))
    );
}

#[test]
fn webview_data_dir_is_in_use_only_while_its_lockfile_exists() {
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    assert!(!webview_data_dir_in_use(&data_dir));

    std::fs::create_dir_all(data_dir.join("EBWebView")).unwrap();
    assert!(!webview_data_dir_in_use(&data_dir));

    lock_webview_data_dir(&data_dir);
    assert!(webview_data_dir_in_use(&data_dir));
}

#[test]
fn fallback_webview_data_dir_picks_the_first_unowned_slot() {
    let root = tempfile::tempdir().unwrap();
    let default_dir = root.path();
    assert_eq!(
        fallback_webview_data_dir(default_dir),
        Some(default_dir.join("webview-fallback-1"))
    );

    // The shared folder being owned does not matter; owned slots are skipped.
    lock_webview_data_dir(default_dir);
    lock_webview_data_dir(&default_dir.join("webview-fallback-1"));
    lock_webview_data_dir(&default_dir.join("webview-fallback-3"));
    assert_eq!(
        fallback_webview_data_dir(default_dir),
        Some(default_dir.join("webview-fallback-2"))
    );

    for slot in 1..=WEBVIEW_FALLBACK_SLOTS {
        lock_webview_data_dir(&default_dir.join(format!("webview-fallback-{slot}")));
    }
    assert_eq!(fallback_webview_data_dir(default_dir), None);
}

#[test]
fn relaunch_args_resolve_relative_paths_against_the_old_cwd() {
    let cwd = std::env::temp_dir().join("trip");
    let absolute = cwd.join("b.png").into_os_string();
    let args = [
        OsString::from("shots/a.jpg"),
        absolute.clone(),
        OsString::from("--flag"),
        OsString::from("-x"),
        OsString::new(),
    ];
    assert_eq!(
        relaunch_args(args, &cwd),
        vec![
            cwd.join("shots/a.jpg").into_os_string(),
            absolute,
            OsString::from("--flag"),
            OsString::from("-x"),
            OsString::new(),
        ]
    );
    assert!(relaunch_args(Vec::<OsString>::new(), &cwd).is_empty());
}
