mod common;

use std::path::Path;

use common::TempImageDir;
use filetime::{set_file_mtime, FileTime};
use imageareo_lib::commands;
use imageareo_lib::folder::{self, SortOrder};

#[test]
fn scan_folder_filters_to_supported_images_only() {
    let dir = TempImageDir::new();
    dir.touch("img1.jpg");
    dir.touch("img2.PNG");
    dir.touch("img3.jxl");
    dir.touch("notes.txt");
    dir.touch("archive.zip");
    std::fs::create_dir(dir.path().join("nested")).expect("should create nested dir");

    let entries = folder::scan_folder(dir.path(), SortOrder::Name).expect("scan should succeed");
    let names = entry_names(&entries);

    assert_eq!(names, vec!["img1.jpg", "img2.PNG", "img3.jxl"]);
}

#[test]
fn scan_folder_naturally_sorts_names() {
    let dir = TempImageDir::new();
    dir.touch("img10.jpg");
    dir.touch("img2.jpg");
    dir.touch("img1.jpg");

    let entries = folder::scan_folder(dir.path(), SortOrder::Name).expect("scan should succeed");
    let names = entry_names(&entries);

    assert_eq!(names, vec!["img1.jpg", "img2.jpg", "img10.jpg"]);
}

#[test]
fn scan_folder_sorts_by_modified_date_descending() {
    let dir = TempImageDir::new();
    let oldest = dir.touch("oldest.jpg");
    let newest = dir.touch("newest.jpg");
    let middle = dir.touch("middle.jpg");

    set_file_mtime(&oldest, FileTime::from_unix_time(1_700_000_000, 0)).expect("should set mtime");
    set_file_mtime(&middle, FileTime::from_unix_time(1_700_000_100, 0)).expect("should set mtime");
    set_file_mtime(&newest, FileTime::from_unix_time(1_700_000_200, 0)).expect("should set mtime");

    let entries = folder::scan_folder(dir.path(), SortOrder::Date).expect("scan should succeed");
    let names = entry_names(&entries);

    assert_eq!(names, vec!["newest.jpg", "middle.jpg", "oldest.jpg"]);
    assert!(entries[0].modified > entries[1].modified);
    assert!(entries[1].modified > entries[2].modified);
}

#[test]
fn resolve_scan_root_uses_the_containing_folder_for_file_paths() {
    let dir = TempImageDir::new();
    let file_path = dir.touch("img1.jpg");

    let resolved = folder::resolve_scan_root(&file_path).expect("should resolve containing folder");

    assert_eq!(resolved, dir.path());
}

#[tokio::test]
async fn scan_folder_command_accepts_file_paths_and_returns_folder_listing() {
    let dir = TempImageDir::new();
    let selected = dir.touch("img10.jpg");
    dir.touch("img2.jpg");
    dir.touch("notes.md");

    let entries = commands::scan_folder(path_string(&selected), Some(SortOrder::Name))
        .await
        .expect("command should succeed");

    assert_eq!(entry_names(&entries), vec!["img2.jpg", "img10.jpg"]);
}

#[test]
fn sort_order_defaults_to_name() {
    assert_eq!(SortOrder::default(), SortOrder::Name);
}

#[test]
fn scan_folder_returns_empty_listing_for_folder_without_supported_images() {
    let dir = TempImageDir::new();
    dir.touch("notes.txt");
    dir.touch("archive.zip");

    let entries = folder::scan_folder(dir.path(), SortOrder::Name).expect("scan should succeed");

    assert!(entries.is_empty());
}

#[test]
fn scan_folder_returns_empty_listing_for_empty_folder() {
    let dir = TempImageDir::new();

    let entries = folder::scan_folder(dir.path(), SortOrder::Date).expect("scan should succeed");

    assert!(entries.is_empty());
}

#[test]
fn scan_folder_errors_when_folder_cannot_be_read() {
    let dir = TempImageDir::new();
    // Point at a file inside a missing subdirectory: resolve_scan_root returns the
    // (also-missing) parent dir, and read_dir on it fails.
    let missing = dir.path().join("missing-subdir").join("image.jpg");

    let error = folder::scan_folder(&missing, SortOrder::Name)
        .expect_err("scanning a missing folder should error");

    assert!(error.contains("failed to read folder"));
}

#[test]
fn resolve_scan_root_errors_for_path_without_parent() {
    let error =
        folder::resolve_scan_root(Path::new("")).expect_err("empty path has no containing folder");

    assert!(error.contains("no containing folder"));
}

#[test]
fn scan_folder_natural_sort_handles_prefix_and_leading_zero_ties() {
    let dir = TempImageDir::new();
    // "img" is a prefix of "img1" -> shorter string sorts first (None vs Some branch).
    dir.touch("img.jpg");
    dir.touch("img1.jpg");
    // Leading-zero numeric chunks compare equal on value, then by raw length.
    dir.touch("img01.jpg");

    let entries = folder::scan_folder(dir.path(), SortOrder::Name).expect("scan should succeed");
    let names = entry_names(&entries);

    assert_eq!(names, vec!["img.jpg", "img1.jpg", "img01.jpg"]);
}

#[test]
fn scan_folder_date_sort_breaks_ties_by_natural_name() {
    let dir = TempImageDir::new();
    let first = dir.touch("b10.jpg");
    let second = dir.touch("b2.jpg");

    // Same mtime forces the tie-break path (then_with natural_compare) in date sort.
    set_file_mtime(&first, FileTime::from_unix_time(1_700_000_000, 0)).expect("should set mtime");
    set_file_mtime(&second, FileTime::from_unix_time(1_700_000_000, 0)).expect("should set mtime");

    let entries = folder::scan_folder(dir.path(), SortOrder::Date).expect("scan should succeed");
    let names = entry_names(&entries);

    assert_eq!(names, vec!["b2.jpg", "b10.jpg"]);
}

#[test]
fn scan_folder_natural_sort_orders_mixed_prefixes_and_numeric_chunks() {
    let dir = TempImageDir::new();
    // A spread of names that forces every natural_compare branch regardless of
    // which side the sort feeds as left/right: prefix-of (None/Some both ways),
    // pure char differences, and differing numeric chunk values.
    for name in ["a.jpg", "a1.jpg", "a2.jpg", "a10.jpg", "ab.jpg", "b.jpg"] {
        dir.touch(name);
    }

    let entries = folder::scan_folder(dir.path(), SortOrder::Name).expect("scan should succeed");
    let names = entry_names(&entries);

    assert_eq!(
        names,
        vec!["a.jpg", "a1.jpg", "a2.jpg", "a10.jpg", "ab.jpg", "b.jpg"]
    );
}

#[test]
fn scan_folder_date_sort_orders_distinct_and_tied_timestamps() {
    let dir = TempImageDir::new();
    let a = dir.touch("a5.jpg");
    let b = dir.touch("a40.jpg");
    let c = dir.touch("c.jpg");

    // a and b share a timestamp (tie -> natural_compare branch); c is newer.
    set_file_mtime(&a, FileTime::from_unix_time(1_700_000_000, 0)).expect("mtime");
    set_file_mtime(&b, FileTime::from_unix_time(1_700_000_000, 0)).expect("mtime");
    set_file_mtime(&c, FileTime::from_unix_time(1_700_000_500, 0)).expect("mtime");

    let entries = folder::scan_folder(dir.path(), SortOrder::Date).expect("scan should succeed");
    let names = entry_names(&entries);

    assert_eq!(names, vec!["c.jpg", "a5.jpg", "a40.jpg"]);
}

#[test]
fn folder_signature_returns_directory_mtime() {
    let dir = TempImageDir::new();
    set_file_mtime(dir.path(), FileTime::from_unix_time(1_700_000_000, 0)).expect("set dir mtime");

    let signature = folder::folder_signature(dir.path()).expect("signature should succeed");

    assert_eq!(signature, 1_700_000_000_000);
}

#[test]
fn folder_signature_resolves_containing_folder_for_file_paths() {
    let dir = TempImageDir::new();
    let file_path = dir.touch("img1.jpg");
    set_file_mtime(dir.path(), FileTime::from_unix_time(1_700_000_500, 0)).expect("set dir mtime");

    let signature = folder::folder_signature(&file_path).expect("signature should succeed");

    assert_eq!(signature, 1_700_000_500_000);
}

#[test]
fn folder_signature_changes_when_an_entry_is_added() {
    let dir = TempImageDir::new();
    let before = folder::folder_signature(dir.path()).expect("signature should succeed");

    // Force a later directory mtime to deterministically observe the bump
    // (filesystem mtime resolution can otherwise collapse rapid changes).
    dir.touch("new.jpg");
    set_file_mtime(dir.path(), FileTime::from_unix_time(2_000_000_000, 0)).expect("set dir mtime");

    let after = folder::folder_signature(dir.path()).expect("signature should succeed");

    assert_ne!(before, after);
}

#[test]
fn folder_signature_errors_when_folder_is_missing() {
    let dir = TempImageDir::new();
    // File inside a missing subdir: resolve_scan_root returns the (missing)
    // parent dir, and stat on it fails.
    let missing = dir.path().join("missing-subdir").join("image.jpg");

    let error = folder::folder_signature(&missing).expect_err("missing folder should error");

    assert!(error.contains("failed to stat folder"));
}

#[tokio::test]
async fn folder_signature_command_accepts_file_paths() {
    let dir = TempImageDir::new();
    let selected = dir.touch("img1.jpg");
    set_file_mtime(dir.path(), FileTime::from_unix_time(1_700_000_900, 0)).expect("set dir mtime");

    let signature = commands::folder_signature(path_string(&selected))
        .await
        .expect("command should succeed");

    assert_eq!(signature, 1_700_000_900_000);
}

fn entry_names(entries: &[folder::ImageEntry]) -> Vec<&str> {
    entries.iter().map(|entry| entry.name.as_str()).collect()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
