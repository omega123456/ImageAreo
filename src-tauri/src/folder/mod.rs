use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::image::is_supported_image_path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageEntry {
    pub path: String,
    pub name: String,
    pub modified: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    Name,
    Date,
}

impl Default for SortOrder {
    fn default() -> Self {
        Self::Name
    }
}

pub fn resolve_scan_root(path: &Path) -> Result<PathBuf, String> {
    if path.is_dir() {
        return Ok(path.to_path_buf());
    }

    path.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("path has no containing folder: {}", path.display()))
}

pub fn scan_folder(path: &Path, sort_order: SortOrder) -> Result<Vec<ImageEntry>, String> {
    let folder_path = resolve_scan_root(path)?;
    let mut entries = fs::read_dir(&folder_path)
        .map_err(|error| format!("failed to read folder {}: {error}", folder_path.display()))?
        .filter_map(Result::ok)
        .filter_map(|entry| image_entry_from_dir_entry(entry).ok().flatten())
        .collect::<Vec<_>>();

    sort_entries(&mut entries, sort_order);
    Ok(entries)
}

fn image_entry_from_dir_entry(entry: fs::DirEntry) -> Result<Option<ImageEntry>, String> {
    let path = entry.path();
    if !path.is_file() || !is_supported_image_path(&path) {
        return Ok(None);
    }

    let metadata = entry
        .metadata()
        .map_err(|error| format!("failed to read metadata {}: {error}", path.display()))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    Ok(Some(ImageEntry {
        path: path.to_string_lossy().into_owned(),
        name: entry.file_name().to_string_lossy().into_owned(),
        modified,
    }))
}

fn sort_entries(entries: &mut [ImageEntry], sort_order: SortOrder) {
    match sort_order {
        SortOrder::Name => {
            entries.sort_by(|left, right| natural_compare(&left.name, &right.name));
        }
        SortOrder::Date => {
            entries.sort_by(|left, right| {
                right
                    .modified
                    .cmp(&left.modified)
                    .then_with(|| natural_compare(&left.name, &right.name))
            });
        }
    }
}

fn natural_compare(left: &str, right: &str) -> Ordering {
    let mut left_chars = left.chars().peekable();
    let mut right_chars = right.chars().peekable();

    loop {
        match (left_chars.peek(), right_chars.peek()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(left_char), Some(right_char)) => {
                if left_char.is_ascii_digit() && right_char.is_ascii_digit() {
                    let left_number = take_while_digits(&mut left_chars);
                    let right_number = take_while_digits(&mut right_chars);
                    let number_cmp = compare_numeric_chunks(&left_number, &right_number);
                    if number_cmp != Ordering::Equal {
                        return number_cmp;
                    }
                } else {
                    let left_char = left_chars.next().expect("peeked char should exist");
                    let right_char = right_chars.next().expect("peeked char should exist");
                    let char_cmp = left_char
                        .to_ascii_lowercase()
                        .cmp(&right_char.to_ascii_lowercase());
                    if char_cmp != Ordering::Equal {
                        return char_cmp;
                    }
                }
            }
        }
    }
}

fn take_while_digits<I>(chars: &mut std::iter::Peekable<I>) -> String
where
    I: Iterator<Item = char>,
{
    let mut buffer = String::new();
    while matches!(chars.peek(), Some(next) if next.is_ascii_digit()) {
        buffer.push(chars.next().expect("peeked digit should exist"));
    }
    buffer
}

fn compare_numeric_chunks(left: &str, right: &str) -> Ordering {
    let left_trimmed = left.trim_start_matches('0');
    let right_trimmed = right.trim_start_matches('0');
    let left_significant = if left_trimmed.is_empty() {
        "0"
    } else {
        left_trimmed
    };
    let right_significant = if right_trimmed.is_empty() {
        "0"
    } else {
        right_trimmed
    };

    left_significant
        .len()
        .cmp(&right_significant.len())
        .then_with(|| left_significant.cmp(right_significant))
        .then_with(|| left.len().cmp(&right.len()))
}
