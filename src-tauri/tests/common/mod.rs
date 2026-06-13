//! Shared helpers for integration tests under `tests/`.
//!
//! Each integration-test binary only uses a subset of these helpers, so unused
//! items are expected — the `dead_code` allow keeps the harness warning-free as
//! later phases (P4+) add command-specific helpers here.
#![allow(dead_code)]

use std::ffi::OsString;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use tempfile::TempDir;

use ::image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use imageareo_lib::cache_dirs::{IMAGE_CACHE_DIR_ENV, THUMBNAIL_CACHE_DIR_ENV};

static CACHE_ENV_LOCK: Mutex<()> = Mutex::new(());
static PROCESS_CACHE_ROOTS: OnceLock<ProcessCacheRoots> = OnceLock::new();

struct ProcessCacheRoots {
    _image: TempDir,
    _thumbnail: TempDir,
    image_path: PathBuf,
    thumbnail_path: PathBuf,
}

fn install_process_cache_roots() -> &'static ProcessCacheRoots {
    PROCESS_CACHE_ROOTS.get_or_init(|| {
        let image = tempfile::tempdir().expect("should create process image cache temp dir");
        let thumbnail =
            tempfile::tempdir().expect("should create process thumbnail cache temp dir");
        let roots = ProcessCacheRoots {
            image_path: image.path().to_path_buf(),
            thumbnail_path: thumbnail.path().to_path_buf(),
            _image: image,
            _thumbnail: thumbnail,
        };

        std::env::set_var(IMAGE_CACHE_DIR_ENV, &roots.image_path);
        std::env::set_var(THUMBNAIL_CACHE_DIR_ENV, &roots.thumbnail_path);

        roots
    })
}

#[ctor::ctor]
fn initialize_process_cache_roots() {
    let _lock = CACHE_ENV_LOCK
        .lock()
        .expect("process cache env lock should not be poisoned");
    let _ = install_process_cache_roots();
}

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

pub fn write_dynamic_fixture(path: &Path, width: u32, height: u32, format: ImageFormat) {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_fn(width, height, |x, y| {
        let r = ((x + 1) * 17) as u8;
        let g = ((y + 1) * 29) as u8;
        let b = ((x + y + 1) * 13) as u8;
        Rgba([r, g, b, u8::MAX])
    }));

    image
        .save_with_format(path, format)
        .expect("fixture image should be written");
}

/// Redirects the decoded-image and thumbnail disk caches into fresh, disposable
/// temp directories for the lifetime of the guard. Committed fixtures have a
/// stable cache key (path + mtime + size), so a cache warmed by a previous run
/// would short-circuit `decode_to_cache`/`generate_thumbnail` and hide their
/// decode paths from coverage. Each test that holds a guard decodes cold and in
/// isolation; the directories are removed when the guard drops.
///
/// Relies on nextest's process-per-test model for env isolation (the project's
/// Rust test runner) — the override env vars are process-global.
pub struct CacheGuard {
    _env_lock: MutexGuard<'static, ()>,
    previous_image: Option<OsString>,
    previous_thumbnail: Option<OsString>,
    _image: TempDir,
    _thumbnail: TempDir,
}

impl CacheGuard {
    pub fn new() -> Self {
        let env_lock = CACHE_ENV_LOCK
            .lock()
            .expect("cache env lock should not be poisoned");
        let previous_image = std::env::var_os(IMAGE_CACHE_DIR_ENV);
        let previous_thumbnail = std::env::var_os(THUMBNAIL_CACHE_DIR_ENV);
        let image = tempfile::tempdir().expect("should create image cache temp dir");
        let thumbnail = tempfile::tempdir().expect("should create thumbnail cache temp dir");
        std::env::set_var(IMAGE_CACHE_DIR_ENV, image.path());
        std::env::set_var(THUMBNAIL_CACHE_DIR_ENV, thumbnail.path());
        Self {
            _env_lock: env_lock,
            previous_image,
            previous_thumbnail,
            _image: image,
            _thumbnail: thumbnail,
        }
    }
}

impl Default for CacheGuard {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for CacheGuard {
    fn drop(&mut self) {
        match &self.previous_image {
            Some(path) => std::env::set_var(IMAGE_CACHE_DIR_ENV, path),
            None => std::env::remove_var(IMAGE_CACHE_DIR_ENV),
        }
        match &self.previous_thumbnail {
            Some(path) => std::env::set_var(THUMBNAIL_CACHE_DIR_ENV, path),
            None => std::env::remove_var(THUMBNAIL_CACHE_DIR_ENV),
        }
    }
}
