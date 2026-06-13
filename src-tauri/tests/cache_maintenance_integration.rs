mod common;

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use common::TempImageDir;
use imageareo_lib::image::cache_maintenance::{self, select_stale, sweep_dir, EVICTION_WINDOW};

const TWO_DAYS: Duration = Duration::from_secs(2 * 24 * 60 * 60);

#[test]
fn eviction_window_is_two_days() {
    assert_eq!(EVICTION_WINDOW, TWO_DAYS);
}

#[test]
fn select_stale_returns_only_files_older_than_cutoff() {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(10 * 24 * 60 * 60);

    let old = now - Duration::from_secs(3 * 24 * 60 * 60); // 3 days -> stale
    let fresh = now - Duration::from_secs(1 * 24 * 60 * 60); // 1 day -> kept
    let boundary = now - TWO_DAYS; // exactly 2 days -> kept (strictly older only)

    let entries = vec![
        (PathBuf::from("/cache/old.jpg"), old),
        (PathBuf::from("/cache/fresh.jpg"), fresh),
        (PathBuf::from("/cache/boundary.jpg"), boundary),
    ];

    let stale = select_stale(&entries, now, TWO_DAYS);

    assert_eq!(stale, vec![PathBuf::from("/cache/old.jpg")]);
}

#[test]
fn select_stale_tolerates_future_mtimes() {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(10 * 24 * 60 * 60);
    let future = now + Duration::from_secs(60 * 60);

    let entries = vec![(PathBuf::from("/cache/future.jpg"), future)];
    let stale = select_stale(&entries, now, TWO_DAYS);

    assert!(stale.is_empty());
}

#[test]
fn sweep_dir_deletes_stale_files_and_keeps_fresh() {
    let dir = TempImageDir::new();
    let stale_path = dir.touch("stale.jpg");
    let fresh_path = dir.touch("fresh.jpg");

    // Backdate the stale file's modification time well past the window.
    let stale_mtime = SystemTime::now() - Duration::from_secs(5 * 24 * 60 * 60);
    filetime_set(&stale_path, stale_mtime);

    let now = SystemTime::now();
    let deleted = sweep_dir(dir.path(), now, TWO_DAYS);

    assert_eq!(deleted, 1);
    assert!(!stale_path.exists());
    assert!(fresh_path.exists());
}

#[test]
fn sweep_missing_directory_is_a_noop() {
    let dir = TempImageDir::new();
    let missing = dir.path().join("does-not-exist");

    let deleted = sweep_dir(&missing, SystemTime::now(), TWO_DAYS);
    assert_eq!(deleted, 0);
}

#[test]
fn sweep_caches_aggregates_across_directories() {
    let dir_a = TempImageDir::new();
    let dir_b = TempImageDir::new();

    let stale_a = dir_a.touch("a-stale.jpg");
    let _fresh_a = dir_a.touch("a-fresh.jpg");
    let stale_b = dir_b.touch("b-stale.jpg");

    let stale_mtime = SystemTime::now() - Duration::from_secs(5 * 24 * 60 * 60);
    filetime_set(&stale_a, stale_mtime);
    filetime_set(&stale_b, stale_mtime);

    let deleted =
        cache_maintenance::sweep_caches(&[dir_a.path().to_path_buf(), dir_b.path().to_path_buf()]);

    assert_eq!(deleted, 2);
    assert!(!stale_a.exists());
    assert!(!stale_b.exists());
}

/// Set a file's modification time using raw libc/utimes via std where possible.
/// The test harness does not depend on the `filetime` crate, so this writes the
/// mtime through `std::fs::File::set_modified` (stable since Rust 1.75).
fn filetime_set(path: &std::path::Path, mtime: SystemTime) {
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .expect("fixture file should open for mtime set");
    file.set_modified(mtime).expect("should set modified time");
}
