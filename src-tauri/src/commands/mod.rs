pub mod associations_runtime;
pub mod clipboard;
pub mod clipboard_runtime;
pub mod reveal;
pub mod reveal_runtime;

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::folder::{self, ImageEntry, SortOrder};
use crate::image::{self, DecodeImageError};
use crate::scheduler::{JobClass, Priority, RunError, Scheduler, SchedulerError};
use crate::thumbnail;
pub use associations_runtime::{query_file_associations, set_default_associations};
pub use clipboard::{prepare_clipboard_image, ClipboardImageData};
pub use clipboard_runtime::copy_image_to_clipboard;
pub use reveal::validate_reveal_path;
pub use reveal_runtime::reveal_in_file_manager;
use serde::{Deserialize, Serialize};

/// Scheduling priority hint sent by the frontend with each decode-class request.
/// Maps onto the scheduler's [`Priority`]. Phase 2 callers pass a default until
/// Phases 4/6 wire real values; deserialization tolerates a missing field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestPriority {
    /// Lowest — speculative prefetch of off-screen work.
    Prefetch,
    /// Default — visible thumbnails / unspecified work.
    #[default]
    VisibleThumbnail,
    /// Highest — the image the user is actively viewing.
    CurrentImage,
}

impl From<RequestPriority> for Priority {
    fn from(value: RequestPriority) -> Self {
        match value {
            RequestPriority::Prefetch => Priority::Prefetch,
            RequestPriority::VisibleThumbnail => Priority::VisibleThumbnail,
            RequestPriority::CurrentImage => Priority::CurrentImage,
        }
    }
}

/// Map a scheduler-level supersede into the existing `DecodeImageError` shape so
/// command return types are unchanged. The frontend ignores a superseded result
/// via its stale-result guard, identical to how it ignores a stale completion.
impl From<SchedulerError> for DecodeImageError {
    fn from(err: SchedulerError) -> Self {
        DecodeImageError {
            code: "superseded",
            message: err.to_string(),
        }
    }
}

/// Flatten a [`RunError`] carrying a decode failure back into the existing
/// `DecodeImageError` shape: a scheduler-level supersede maps to the `superseded`
/// code (ignored by the frontend stale-guard), while a work failure is the
/// decode's own error, surfaced verbatim so a transient failure can be retried.
impl From<RunError<DecodeImageError>> for DecodeImageError {
    fn from(err: RunError<DecodeImageError>) -> Self {
        match err {
            RunError::Scheduler(err) => err.into(),
            RunError::Work(err) => err,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedImage {
    /// Absolute path to the on-disk cache file; the frontend wraps it with
    /// `convertFileSrc`. No pixel bytes cross the IPC boundary.
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub orientation: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    pub path: String,
}

/// Header-only dimension probe result for the frontend's native-routing decision
/// and the too-large rejection surface. No pixels are decoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbedImage {
    pub width: u32,
    pub height: u32,
    pub pixels: u64,
    pub animated: bool,
    pub exceeds_limit: bool,
}

impl From<image::ProbeResult> for ProbedImage {
    fn from(probe: image::ProbeResult) -> Self {
        Self {
            width: probe.width,
            height: probe.height,
            pixels: probe.pixels,
            animated: probe.animated,
            exceeds_limit: probe.exceeds_limit,
        }
    }
}

/// Probe `path` for its declared dimensions, animation flag, and over-ceiling
/// status without decoding pixels. Used by the frontend to route large native
/// images through the backend and to short-circuit over-ceiling files to the
/// too-large state.
#[tauri::command(rename_all = "camelCase")]
pub async fn probe_image(path: String) -> Result<ProbedImage, DecodeImageError> {
    let path = std::path::PathBuf::from(path);
    let probed = tauri::async_runtime::spawn_blocking(move || image::probe::probe(&path))
        .await
        .map_err(|err| DecodeImageError {
            code: "decode_failed",
            message: format!("probe task failed: {err}"),
        })??;

    Ok(ProbedImage::from(probed))
}

/// Camera EXIF facts for the info card. Serialized camelCase; the object is only
/// present (`camera: Some`) when the image carries at least one camera field.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub make: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lens: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iso: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aperture: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shutter_speed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focal_length: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_taken: Option<String>,
}

impl From<image::CameraMetadataParts> for CameraMetadata {
    fn from(parts: image::CameraMetadataParts) -> Self {
        Self {
            make: parts.make,
            model: parts.model,
            lens: parts.lens,
            iso: parts.iso,
            aperture: parts.aperture,
            shutter_speed: parts.shutter_speed,
            focal_length: parts.focal_length,
            date_taken: parts.date_taken,
        }
    }
}

/// On-demand, read-only metadata for one image. Serialized camelCase; assembled
/// without decoding pixels. `colorType`/`bitDepth` are best-effort (`null` for
/// formats the header reader cannot inspect); `camera` is `null` when no camera
/// EXIF is present.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadata {
    pub file_name: String,
    pub file_path: String,
    pub format: String,
    pub file_size_bytes: u64,
    pub width: u32,
    pub height: u32,
    pub pixels: u64,
    pub color_type: Option<String>,
    pub bit_depth: Option<u32>,
    pub orientation: u16,
    pub camera: Option<CameraMetadata>,
}

impl From<image::ImageMetadataParts> for ImageMetadata {
    fn from(parts: image::ImageMetadataParts) -> Self {
        Self {
            file_name: parts.file_name,
            file_path: parts.file_path,
            format: parts.format,
            file_size_bytes: parts.file_size_bytes,
            width: parts.width,
            height: parts.height,
            pixels: parts.pixels,
            color_type: parts.color_type,
            bit_depth: parts.bit_depth,
            orientation: parts.orientation,
            camera: parts.camera.map(CameraMetadata::from),
        }
    }
}

/// Return on-demand, read-only metadata for `path` (file size, header-only
/// dimensions, best-effort color type/bit depth, orientation, camera EXIF)
/// without decoding pixels and without touching the decode scheduler. Runs on a
/// blocking task like [`probe_image`].
#[tauri::command(rename_all = "camelCase")]
pub async fn read_image_metadata(path: String) -> Result<ImageMetadata, DecodeImageError> {
    let path = std::path::PathBuf::from(path);
    let parts = tauri::async_runtime::spawn_blocking(move || image::gather_image_metadata(&path))
        .await
        .map_err(|err| DecodeImageError {
            code: "decode_failed",
            message: format!("metadata task failed: {err}"),
        })??;

    Ok(ImageMetadata::from(parts))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn scan_folder(
    path: String,
    sort_order: Option<SortOrder>,
) -> Result<Vec<ImageEntry>, String> {
    folder::scan_folder(std::path::Path::new(&path), sort_order.unwrap_or_default())
}

/// The scheduler permit class a decode intent runs in: an `Enhance` decode is a
/// heavy full-sensor develop (serialized), while preview/display are the lighter
/// viewport tier.
fn intent_job_class(intent: image::DecodeIntent) -> JobClass {
    match intent {
        image::DecodeIntent::Enhance => JobClass::FullEnhance,
        image::DecodeIntent::Preview | image::DecodeIntent::Display => JobClass::DisplayViewport,
    }
}

/// IPC entry point. Pulls the managed [`Scheduler`] and delegates to
/// [`decode_image_via`]; integration tests call the latter directly with a
/// test-owned scheduler (a `tauri::State` cannot be constructed in unit tests).
#[tauri::command(rename_all = "camelCase")]
pub async fn decode_image(
    scheduler: tauri::State<'_, Scheduler>,
    path: String,
    quality: Option<image::DecodeIntent>,
    priority: Option<RequestPriority>,
    generation: Option<u64>,
    viewport: Option<image::ViewportHint>,
) -> Result<DecodedImage, DecodeImageError> {
    decode_image_via(scheduler.inner(), path, quality, priority, generation, viewport).await
}

/// Schedule a decode of `path` at `quality`/`priority` through `scheduler`.
/// `generation` is threaded for parity with the frontend stale-guard; the
/// scheduler dedups by key and the frontend ignores stale results, so the backend
/// does not act on it directly.
pub async fn decode_image_via(
    scheduler: &Scheduler,
    path: String,
    quality: Option<image::DecodeIntent>,
    priority: Option<RequestPriority>,
    generation: Option<u64>,
    viewport: Option<image::ViewportHint>,
) -> Result<DecodedImage, DecodeImageError> {
    let _ = generation;
    let intent = quality.unwrap_or(image::DecodeIntent::Display);
    let priority = Priority::from(priority.unwrap_or_default());
    let class = intent_job_class(intent);
    // Fold the resolved tier cap into the single-flight key so a viewport-sized
    // decode and the 8192 on-zoom decode (and different viewport buckets) never
    // coalesce onto the same job — they produce distinct cache files.
    let (_, tier_cap) = image::tier_for(intent, viewport);
    let key = format!("decode:{intent:?}:{tier_cap}:{path}");
    let decode_path = std::path::PathBuf::from(path);

    let result = scheduler
        .run(class, priority, key, move || async move {
            // The closure returns `Result<Descriptor, DecodeImageError>`; the
            // scheduler memoizes only the `Ok` descriptor, so a decode failure is
            // never cached and the next request re-attempts the decode.
            match tauri::async_runtime::spawn_blocking(move || {
                image::decode_to_cache_viewport(&decode_path, intent, viewport)
            })
            .await
            {
                Ok(decoded) => decoded,
                Err(err) => Err(DecodeImageError {
                    code: "decode_failed",
                    message: format!("decode task failed: {err}"),
                }),
            }
        })
        .await?;
    // `run` returns `Arc<Descriptor>` on success (cloned to every joiner); clone
    // the shared descriptor out of the Arc.
    let decoded = (*result).clone();

    Ok(DecodedImage {
        path: decoded.path.to_string_lossy().into_owned(),
        width: decoded.width,
        height: decoded.height,
        orientation: decoded.orientation,
    })
}

/// Return an already-cached decode result for `path`/`quality` without ever
/// decoding. The viewer uses this on reopen to prefer a previously-enhanced
/// image, without triggering a fresh (heavy) demosaic when none is cached.
/// Resolves to `null` when no cache file exists.
/// A peek is a pure cache lookup (no decode), so it does not enter the scheduler.
/// `generation` is threaded for parity with `decode_image` and is not acted on.
#[tauri::command(rename_all = "camelCase")]
pub async fn peek_decoded_image(
    path: String,
    quality: image::DecodeIntent,
    generation: Option<u64>,
) -> Result<Option<DecodedImage>, DecodeImageError> {
    let _ = generation;
    let path = std::path::PathBuf::from(path);
    let cached = tauri::async_runtime::spawn_blocking(move || image::lookup_cached(&path, quality))
        .await
        .map_err(|err| DecodeImageError {
            code: "decode_failed",
            message: format!("cache lookup task failed: {err}"),
        })??;

    Ok(cached.map(|decoded| DecodedImage {
        path: decoded.path.to_string_lossy().into_owned(),
        width: decoded.width,
        height: decoded.height,
        orientation: decoded.orientation,
    }))
}

/// Return a small downscaled JPEG of `path` as a base64 data URL, used by the
/// frontend to sample the image brightness behind the floating toolbar. A data
/// URL is same-origin, so the sampling canvas is readable (asset-protocol URLs
/// taint the canvas and cannot be sampled).
#[tauri::command(rename_all = "camelCase")]
pub async fn sample_image(
    scheduler: tauri::State<'_, Scheduler>,
    path: String,
    size: u32,
    priority: Option<RequestPriority>,
    generation: Option<u64>,
) -> Result<String, DecodeImageError> {
    sample_image_via(scheduler.inner(), path, size, priority, generation).await
}

/// Schedule a backdrop-sample of `path` through `scheduler`. See
/// [`decode_image_via`] for the test-vs-IPC split rationale.
pub async fn sample_image_via(
    scheduler: &Scheduler,
    path: String,
    size: u32,
    priority: Option<RequestPriority>,
    generation: Option<u64>,
) -> Result<String, DecodeImageError> {
    let _ = generation;
    let priority = Priority::from(priority.unwrap_or_default());
    let key = format!("sample:{size}:{path}");
    let sample_path = std::path::PathBuf::from(path);

    let result = scheduler
        .run(JobClass::ThumbSample, priority, key, move || async move {
            match tauri::async_runtime::spawn_blocking(move || {
                thumbnail::sample_jpeg(&sample_path, size)
            })
            .await
            {
                Ok(sampled) => sampled,
                Err(err) => Err(DecodeImageError {
                    code: "decode_failed",
                    message: format!("sample task failed: {err}"),
                }),
            }
        })
        .await?;
    let bytes = (*result).clone();

    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn generate_thumbnail(
    scheduler: tauri::State<'_, Scheduler>,
    path: String,
    size: u32,
    priority: Option<RequestPriority>,
    generation: Option<u64>,
) -> Result<Thumbnail, DecodeImageError> {
    generate_thumbnail_via(scheduler.inner(), path, size, priority, generation).await
}

/// Schedule a thumbnail generation of `path` through `scheduler`. See
/// [`decode_image_via`] for the test-vs-IPC split rationale.
pub async fn generate_thumbnail_via(
    scheduler: &Scheduler,
    path: String,
    size: u32,
    priority: Option<RequestPriority>,
    generation: Option<u64>,
) -> Result<Thumbnail, DecodeImageError> {
    let _ = generation;
    let priority = Priority::from(priority.unwrap_or_default());
    let key = format!("thumbnail:{size}:{path}");
    let thumb_path = std::path::PathBuf::from(path);

    let result = scheduler
        .run(JobClass::ThumbSample, priority, key, move || async move {
            match tauri::async_runtime::spawn_blocking(move || {
                thumbnail::generate_thumbnail(&thumb_path, size)
            })
            .await
            {
                Ok(generated) => generated,
                Err(err) => Err(DecodeImageError {
                    code: "decode_failed",
                    message: format!("thumbnail task failed: {err}"),
                }),
            }
        })
        .await?;
    let thumbnail = (*result).clone();

    Ok(Thumbnail {
        path: thumbnail.path,
    })
}
