//! Shared helpers for integration tests under `tests/`.
//!
//! Each integration-test binary only uses a subset of these helpers, so unused
//! items are expected — the `dead_code` allow keeps the harness warning-free as
//! later phases (P4+) add command-specific helpers here.
#![allow(dead_code)]

use std::fs::File;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

/// A throwaway temporary directory plus convenience constructors for seeding it
/// with fixture image files. Dropped automatically at the end of a test, which
/// removes the directory tree.
pub struct TempImageDir {
    pub dir: TempDir,
}

impl TempImageDir {
    /// Create a fresh, empty temporary directory.
    pub fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("should create temp dir"),
        }
    }

    /// The directory's root path.
    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    /// Create an empty file with the given name inside the temp dir and return
    /// its absolute path. Useful for folder-scan/extension-filter fixtures that
    /// only need a name, not real pixel data.
    pub fn touch(&self, name: &str) -> PathBuf {
        let p = self.dir.path().join(name);
        File::create(&p).expect("should create fixture file");
        p
    }

    /// Write raw bytes to a named file inside the temp dir and return its path.
    pub fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let p = self.dir.path().join(name);
        std::fs::write(&p, bytes).expect("should write fixture file");
        p
    }
}

impl Default for TempImageDir {
    fn default() -> Self {
        Self::new()
    }
}
