use std::path::PathBuf;

pub const IMAGE_CACHE_DIR_ENV: &str = "IMAGEAREO_IMAGE_CACHE_DIR";
pub const THUMBNAIL_CACHE_DIR_ENV: &str = "IMAGEAREO_THUMBNAIL_CACHE_DIR";

const IMAGE_CACHE_DIR_NAME: &str = "imageareo-images";
const THUMBNAIL_CACHE_DIR_NAME: &str = "imageareo-thumbnails";

fn resolve(env_var: &str, default_dir_name: &str) -> PathBuf {
    match std::env::var_os(env_var) {
        Some(dir) => PathBuf::from(dir),
        None => std::env::temp_dir().join(default_dir_name),
    }
}

pub fn image_cache_dir() -> PathBuf {
    resolve(IMAGE_CACHE_DIR_ENV, IMAGE_CACHE_DIR_NAME)
}

pub fn thumbnail_cache_dir() -> PathBuf {
    resolve(THUMBNAIL_CACHE_DIR_ENV, THUMBNAIL_CACHE_DIR_NAME)
}
