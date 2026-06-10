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

fn entry_names(entries: &[folder::ImageEntry]) -> Vec<&str> {
    entries.iter().map(|entry| entry.name.as_str()).collect()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
