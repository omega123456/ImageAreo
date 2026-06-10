//! Smoke integration test proving the Rust test harness runs (P3).
//!
//! This exercises the shared `common` helper end-to-end so later phases (P4+)
//! can add real `*_integration.rs` suites against the same scaffolding without
//! re-establishing fixtures. It deliberately asserts only harness behavior — no
//! application commands exist yet at this phase.

mod common;

use common::TempImageDir;

#[test]
fn temp_image_dir_is_created_and_isolated() {
    let a = TempImageDir::new();
    let b = TempImageDir::new();
    assert!(a.path().exists());
    assert!(b.path().exists());
    assert_ne!(a.path(), b.path(), "each temp dir must be unique");
}

#[test]
fn touch_creates_an_empty_fixture_file() {
    let dir = TempImageDir::new();
    let path = dir.touch("img1.jpg");
    assert!(path.exists());
    assert_eq!(std::fs::metadata(&path).unwrap().len(), 0);
}

#[test]
fn write_persists_fixture_bytes() {
    let dir = TempImageDir::new();
    let bytes = [0u8, 1, 2, 3, 4];
    let path = dir.write("data.bin", &bytes);
    let read = std::fs::read(&path).unwrap();
    assert_eq!(read, bytes);
}

#[tokio::test]
async fn async_harness_runs_under_tokio() {
    // Confirms the `tokio` test-util dev-dependency is wired so later phases can
    // write `#[tokio::test]` command bodies.
    let value = async { 21 * 2 }.await;
    assert_eq!(value, 42);
}
