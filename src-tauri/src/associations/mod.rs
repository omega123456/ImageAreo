use std::collections::HashSet;
use std::fmt;

use serde::Serialize;

use crate::image;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

pub const BUNDLE_ID: &str = "app.imageareo.viewer";
pub const WINDOWS_APPLICATION_NAME: &str = "ImageAreo";
pub const WINDOWS_CAPABILITIES_PATH: &str = r"Software\ImageAreo\Capabilities";
pub const WINDOWS_REGISTERED_APPLICATIONS_PATH: &str = r"Software\RegisteredApplications";
pub const WINDOWS_CLASSES_PATH: &str = r"Software\Classes";
pub const WINDOWS_FILE_EXTS_PATH: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts";

pub const ASSOCIABLE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "avif", "tif", "tiff", "bmp", "ico", "heic", "heif",
    "jxl", "raw", "cr2", "cr3", "nef", "nrw", "arw", "sr2", "srf", "dng", "raf", "rw2", "orf",
    "pef", "srw", "kdc", "erf", "3fr",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssociationError {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtAssociation {
    pub ext: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowsAssociationPaths {
    pub extension_key: String,
    pub open_with_progids_key: String,
    pub user_choice_key: String,
    pub progid: String,
    pub progid_command_key: String,
}

impl fmt::Display for AssociationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.message, self.code)
    }
}

impl std::error::Error for AssociationError {}

impl AssociationError {
    pub(crate) fn invalid_extension(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_extension",
            message: message.into(),
        }
    }

    pub(crate) fn query(message: impl Into<String>) -> Self {
        Self {
            code: "association_query_failed",
            message: message.into(),
        }
    }

    pub(crate) fn register(message: impl Into<String>) -> Self {
        Self {
            code: "association_register_failed",
            message: message.into(),
        }
    }

    pub(crate) fn unsupported(message: impl Into<String>) -> Self {
        Self {
            code: "unsupported_platform",
            message: message.into(),
        }
    }
}

pub fn normalized_extension(ext: &str) -> String {
    ext.trim().trim_start_matches('.').to_ascii_lowercase()
}

pub fn supported_extension_union() -> Vec<String> {
    let mut seen = HashSet::new();
    let mut exts = Vec::new();

    for ext in image::native_extensions()
        .iter()
        .chain(image::backend_extensions().iter())
    {
        if seen.insert(*ext) {
            exts.push((*ext).to_string());
        }
    }

    exts
}

pub fn validate_extensions<I, S>(exts: I) -> Result<Vec<String>, AssociationError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut seen = HashSet::new();
    let mut validated = Vec::new();

    for ext in exts {
        let normalized = normalized_extension(ext.as_ref());
        if normalized.is_empty() {
            return Err(AssociationError::invalid_extension(
                "file extension must not be empty",
            ));
        }

        if !ASSOCIABLE_EXTENSIONS.contains(&normalized.as_str()) {
            return Err(AssociationError::invalid_extension(format!(
                "unsupported file extension: {normalized}"
            )));
        }

        if seen.insert(normalized.clone()) {
            validated.push(normalized);
        }
    }

    Ok(validated)
}

pub fn progid_for(ext: &str) -> String {
    let normalized = normalized_extension(ext);
    format!("ImageAreo.AssocFile.{}", normalized.to_ascii_uppercase())
}

pub fn registry_key_paths(ext: &str) -> WindowsAssociationPaths {
    let normalized = normalized_extension(ext);
    let extension_key = format!(r"{}\.{}", WINDOWS_CLASSES_PATH, normalized);
    let open_with_progids_key = format!(r"{}\OpenWithProgids", extension_key);
    let user_choice_key = format!(r"{}\.{}\UserChoice", WINDOWS_FILE_EXTS_PATH, normalized);
    let progid = progid_for(&normalized);
    let progid_command_key = format!(r"{}\{}\shell\open\command", WINDOWS_CLASSES_PATH, progid);

    WindowsAssociationPaths {
        extension_key,
        open_with_progids_key,
        user_choice_key,
        progid,
        progid_command_key,
    }
}

pub fn uti_for(ext: &str) -> Option<&'static str> {
    match normalized_extension(ext).as_str() {
        "jpg" | "jpeg" => Some("public.jpeg"),
        "png" => Some("public.png"),
        "gif" => Some("com.compuserve.gif"),
        "webp" => Some("org.webmproject.webp"),
        "avif" => Some("public.avif"),
        "tif" | "tiff" => Some("public.tiff"),
        "bmp" => Some("com.microsoft.bmp"),
        "ico" => Some("com.microsoft.ico"),
        "heic" => Some("public.heic"),
        "heif" => Some("public.heif"),
        "jxl" => Some("public.jpeg-xl"),
        "raw" | "cr2" | "cr3" | "nef" | "nrw" | "arw" | "sr2" | "srf" | "dng" | "raf" | "rw2"
        | "orf" | "pef" | "srw" | "kdc" | "erf" | "3fr" => Some("com.adobe.raw-image"),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
pub fn query_file_associations() -> Result<Vec<ExtAssociation>, AssociationError> {
    macos::query_file_associations()
}

#[cfg(windows)]
pub fn query_file_associations() -> Result<Vec<ExtAssociation>, AssociationError> {
    windows::query_file_associations()
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn query_file_associations() -> Result<Vec<ExtAssociation>, AssociationError> {
    Err(AssociationError::unsupported(
        "file associations are not supported on this platform",
    ))
}

#[cfg(target_os = "macos")]
pub fn set_default_associations(exts: &[String]) -> Result<(), AssociationError> {
    macos::set_default_associations(exts)
}

#[cfg(windows)]
pub fn set_default_associations(exts: &[String]) -> Result<(), AssociationError> {
    windows::set_default_associations(exts)
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn set_default_associations(_exts: &[String]) -> Result<(), AssociationError> {
    Err(AssociationError::unsupported(
        "file associations are not supported on this platform",
    ))
}

#[doc(hidden)]
pub mod __test_support {
    use super::*;

    pub fn invalid_extension_error(message: &str) -> AssociationError {
        AssociationError::invalid_extension(message)
    }

    pub fn query_error(message: &str) -> AssociationError {
        AssociationError::query(message)
    }

    pub fn register_error(message: &str) -> AssociationError {
        AssociationError::register(message)
    }

    pub fn unsupported_error(message: &str) -> AssociationError {
        AssociationError::unsupported(message)
    }
}
