//! Age-based eviction for the on-disk caches.
//!
//! Cache files are regenerable, so growth is bounded by a simple age window
//! rather than a size budget. The pure selection function decides which files
//! are stale given their modification times and a cutoff; the sweep entry point
//! applies that decision to one or more directories and deletes the selected
//! files. The selection logic is unit-testable in isolation; only the
//! filesystem sweep performs side effects.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// The age beyond which a cache file is considered stale (two days).
pub const EVICTION_WINDOW: Duration = Duration::from_secs(2 * 24 * 60 * 60);

/// Pure selection: given `(file, modified-time)` pairs, the reference `now`, and
/// a maximum age, return the files whose age exceeds `max_age` (strictly older
/// than the cutoff). Files at or newer than the cutoff are retained.
pub fn select_stale<P>(
    entries: &[(P, SystemTime)],
    now: SystemTime,
    max_age: Duration,
) -> Vec<PathBuf>
where
    P: AsRef<Path>,
{
    entries
        .iter()
        .filter_map(|(path, modified)| match now.duration_since(*modified) {
            Ok(age) if age > max_age => Some(path.as_ref().to_path_buf()),
            _ => None,
        })
        .collect()
}

/// List the immediate files in `dir` paired with their modification times.
/// Returns an empty vector when the directory is absent (first run) or
/// unreadable, so a missing cache directory never errors the sweep.
fn list_files_with_mtime(dir: &Path) -> Vec<(PathBuf, SystemTime)> {
    let read_dir = match fs::read_dir(dir) {
        Ok(read_dir) => read_dir,
        Err(_) => return Vec::new(),
    };

    let mut out = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Ok(metadata) = entry.metadata() {
            if let Ok(modified) = metadata.modified() {
                out.push((path, modified));
            }
        }
    }
    out
}

/// Sweep a single directory: delete every file strictly older than `max_age`
/// relative to `now`. Returns the number of files deleted. A missing directory
/// is a no-op.
pub fn sweep_dir(dir: &Path, now: SystemTime, max_age: Duration) -> usize {
    let entries = list_files_with_mtime(dir);
    let stale = select_stale(&entries, now, max_age);

    let mut deleted = 0;
    for path in stale {
        if fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }
    deleted
}

/// Sweep every directory in `dirs` with the standard two-day window, using the
/// current time. This is the entry point wired into app startup. Returns the
/// total number of files deleted across all directories.
pub fn sweep_caches(dirs: &[PathBuf]) -> usize {
    let now = SystemTime::now();
    dirs.iter()
        .map(|dir| sweep_dir(dir, now, EVICTION_WINDOW))
        .sum()
}
