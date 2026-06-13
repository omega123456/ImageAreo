use std::fs;
use std::io::{BufReader, Cursor};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub mod cache_maintenance;
pub mod disk_cache;
pub mod probe;

pub use probe::{ProbeResult, MAX_PIXELS};

use disk_cache::CacheVariant;
use exif::{Exif, In, Reader as ExifReader, Tag};
use fast_image_resize as fir;
use fast_image_resize::images::Image as FirImage;
use heic::{DecoderConfig, PixelLayout};
use image::codecs::jpeg::JpegEncoder;
use image::{
    DynamicImage, GrayImage, ImageBuffer, ImageFormat, ImageReader, Rgb, RgbImage, RgbaImage,
};
use jpeg_decoder::{Decoder as JpegDecoder, PixelFormat as JpegPixelFormat};
use serde::{Deserialize, Serialize};

const NATIVE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp"];
const BACKEND_EXTENSIONS: &[&str] = &[
    "avif", "tif", "tiff", "bmp", "ico", "heic", "heif", "jxl", "raw", "cr2", "cr3", "nef", "nrw",
    "arw", "sr2", "srf", "dng", "raf", "rw2", "orf", "pef", "srw", "kdc", "erf", "3fr",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormatSupport {
    Native,
    NeedsBackend,
}

/// Metadata for a decoded image written to the on-disk cache. The viewer loads
/// `path` via `convertFileSrc`; no pixel bytes cross the IPC boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedCacheImage {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub orientation: u16,
}

/// Longest-edge cap (px) for the instant low-resolution preview image.
pub const PREVIEW_LONG_EDGE_CAP: u32 = 2560;

/// Longest-edge cap (px) for the default display image, across all backend
/// formats. The display image is `min(source long edge, this cap)`.
pub const DISPLAY_LONG_EDGE_CAP: u32 = 8192;

/// JPEG quality used when encoding an opaque display image.
pub const DISPLAY_JPEG_QUALITY: u8 = 92;

/// Floor (px) for the viewport-aware initial display tier. Even a tiny window
/// still gets a derivative at least this large, so a subsequent small zoom does
/// not immediately look soft.
pub const VIEWPORT_TIER_MIN_EDGE: u32 = 1024;

/// The discrete set of long-edge caps the viewport tier is bucketed to. A
/// requested viewport×DPR edge is rounded *up* to the smallest bucket that
/// covers it (clamped to `[VIEWPORT_TIER_MIN_EDGE, DISPLAY_LONG_EDGE_CAP]`).
/// Bucketing keeps cache reuse high: near-identical window sizes (e.g. 1390 vs
/// 1410 px) collapse onto the same cap and therefore the same cache key, instead
/// of fragmenting the cache into a derivative per pixel-width. The top bucket
/// equals `DISPLAY_LONG_EDGE_CAP`, so a maximized window on a hi-DPR display
/// still never exceeds the 8192 on-zoom ceiling.
pub const VIEWPORT_TIER_BUCKETS: &[u32] = &[1024, 1536, 2048, 3072, 4096, 6144, 8192];

/// A viewport sizing hint supplied by the frontend: the longest CSS edge of the
/// viewport in pixels and the device pixel ratio. Used to size the initial
/// display derivative to what the window can actually show.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportHint {
    pub long_edge_px: f64,
    pub dpr: f64,
}

/// Bucket a raw viewport×DPR long edge to a stable cap drawn from
/// [`VIEWPORT_TIER_BUCKETS`]. The raw target is `round(long_edge_px × dpr)`,
/// clamped to `[VIEWPORT_TIER_MIN_EDGE, DISPLAY_LONG_EDGE_CAP]`, then rounded up
/// to the smallest covering bucket. Non-finite or non-positive inputs fall back
/// to the floor bucket.
pub fn viewport_tier_cap(hint: ViewportHint) -> u32 {
    let raw = hint.long_edge_px * hint.dpr;
    let target = if raw.is_finite() && raw >= 1.0 {
        let rounded = raw.round();
        // `rounded` is finite and >= 1.0 here; clamp before the lossy cast.
        let clamped = rounded.clamp(
            f64::from(VIEWPORT_TIER_MIN_EDGE),
            f64::from(DISPLAY_LONG_EDGE_CAP),
        );
        clamped as u32
    } else {
        VIEWPORT_TIER_MIN_EDGE
    };

    VIEWPORT_TIER_BUCKETS
        .iter()
        .copied()
        .find(|&bucket| bucket >= target)
        .unwrap_or(DISPLAY_LONG_EDGE_CAP)
}

#[derive(Debug, Clone)]
pub struct LoadedImageData {
    pub image: DynamicImage,
    pub orientation: u16,
}

#[derive(Debug)]
struct ExifMetadata {
    orientation: u16,
    embedded_thumbnail: Option<DynamicImage>,
}

/// The decode intent requested by the viewer. Each intent maps to a distinct
/// on-disk cache variant and a distinct source/cap/codec strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DecodeIntent {
    /// Cheapest instant-paint image. RAW: embedded preview (or EXIF thumbnail)
    /// downscaled to the preview cap. Never demosaics.
    Preview,
    /// Default viewing image, capped at the display long edge. For RAW this is
    /// the embedded preview only — it never demosaics, so opening is always
    /// fast and light.
    Display,
    /// On-demand sharper image (RAW only): a one-time full sensor demosaic,
    /// downscaled to the display cap and encoded as JPEG. Triggered by the user
    /// via the "Enhance" control.
    Enhance,
}

/// Internal classification of the raw quality used when sourcing pixels for a
/// backend decode: the embedded preview, or a full sensor develop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RawSource {
    Preview,
    Full,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodeImageError {
    pub code: &'static str,
    pub message: String,
}

impl DecodeImageError {
    pub(crate) fn unsupported(message: impl Into<String>) -> Self {
        Self {
            code: "unsupported_format",
            message: message.into(),
        }
    }

    pub(crate) fn io(message: impl Into<String>) -> Self {
        Self {
            code: "io_error",
            message: message.into(),
        }
    }

    pub(crate) fn decode(message: impl Into<String>) -> Self {
        Self {
            code: "decode_failed",
            message: message.into(),
        }
    }

    pub(crate) fn encode(message: impl Into<String>) -> Self {
        Self {
            code: "encode_failed",
            message: message.into(),
        }
    }

    /// The image's declared pixel count exceeds the `MAX_PIXELS` ceiling and was
    /// rejected before any decode. The frontend discriminates on `code`; the UI
    /// copy derives the 256 MP figure from its own constant, so dimensions are
    /// not carried in the message.
    fn too_large(message: impl Into<String>) -> Self {
        Self {
            code: "image_too_large",
            message: message.into(),
        }
    }
}

pub fn native_extensions() -> &'static [&'static str] {
    NATIVE_EXTENSIONS
}

pub fn backend_extensions() -> &'static [&'static str] {
    BACKEND_EXTENSIONS
}

pub fn classify_extension(ext: &str) -> Option<ImageFormatSupport> {
    let normalized = ext.trim_start_matches('.').to_ascii_lowercase();

    if NATIVE_EXTENSIONS.contains(&normalized.as_str()) {
        Some(ImageFormatSupport::Native)
    } else if BACKEND_EXTENSIONS.contains(&normalized.as_str()) {
        Some(ImageFormatSupport::NeedsBackend)
    } else {
        None
    }
}

pub fn classify_path(path: &Path) -> Option<ImageFormatSupport> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .and_then(classify_extension)
}

pub fn is_supported_image_path(path: &Path) -> bool {
    classify_path(path).is_some()
}

/// Decode `path` for the requested intent, writing the result to the on-disk
/// cache and returning its metadata. A cache hit short-circuits all decoding.
/// Only backend (non-native) formats are valid here; native formats render
/// directly in the frontend.
pub fn decode_to_cache(
    path: &Path,
    intent: DecodeIntent,
) -> Result<DecodedCacheImage, DecodeImageError> {
    decode_to_cache_viewport(path, intent, None)
}

/// Like [`decode_to_cache`], but for a `Display` decode `viewport` may carry a
/// viewport sizing hint. When present (and only for `DecodeIntent::Display`) the
/// result is sized to the bucketed viewport×DPR edge and written under the
/// distinct `Viewport` cache variant, leaving the 8192 `Display` tier untouched
/// for the on-zoom sharper request. A `None` hint reproduces the original
/// behaviour exactly. The hint is ignored for `Preview`/`Enhance` intents.
pub fn decode_to_cache_viewport(
    path: &Path,
    intent: DecodeIntent,
    viewport: Option<ViewportHint>,
) -> Result<DecodedCacheImage, DecodeImageError> {
    match classify_path(path) {
        Some(ImageFormatSupport::NeedsBackend) => {}
        Some(ImageFormatSupport::Native) => {
            return Err(DecodeImageError::unsupported(format!(
                "native format decode is handled by the frontend: {}",
                path.display()
            )));
        }
        None => {
            return Err(DecodeImageError::unsupported(format!(
                "unsupported image format: {}",
                path.display()
            )));
        }
    }

    let orientation = read_orientation(path);

    // Resolve the cache variant + cap once: a `Display` decode with a viewport
    // hint maps to the bucketed `Viewport` tier; everything else uses the
    // intent's default tier.
    let (variant, cap) = display_tier(intent, viewport);

    // Cache hit: re-read dimensions only; never re-develop.
    if let Some(cached) = lookup_cached_at(path, variant, cap, orientation)? {
        return Ok(cached);
    }

    // Budget preflight: read header dimensions only and reject over-ceiling files
    // before any pixel buffer is allocated. A probe failure (corrupt/truncated
    // header) is not fatal here — fall through to the decoder, which produces its
    // own structured decode error.
    if let Ok(probed) = probe::probe(path) {
        if probed.exceeds_limit {
            return Err(DecodeImageError::too_large(format!(
                "image exceeds the {MAX_PIXELS}px decode ceiling ({}x{} = {}px): {}",
                probed.width,
                probed.height,
                probed.pixels,
                path.display()
            )));
        }
    }

    let result = match intent {
        DecodeIntent::Preview => decode_preview_intent(path, orientation),
        DecodeIntent::Display => decode_display_intent(path, orientation, variant, cap),
        DecodeIntent::Enhance => decode_enhance_intent(path, orientation),
    };
    // Decoding (especially the RAW develop) allocates large transient buffers
    // that Rust has now freed, but the system allocator tends to retain those
    // pages as process RSS rather than returning them to the OS. Nudge it to
    // release the freed pages now so a one-off heavy decode does not leave the
    // process sitting at a multi-GB resident footprint.
    release_freed_memory_to_os();
    result
}

/// The cache variant and cap that a decode intent maps to.
fn intent_variant_cap(intent: DecodeIntent) -> (CacheVariant, u32) {
    match intent {
        DecodeIntent::Preview => (CacheVariant::Preview, PREVIEW_LONG_EDGE_CAP),
        DecodeIntent::Display => (CacheVariant::Display, DISPLAY_LONG_EDGE_CAP),
        DecodeIntent::Enhance => (CacheVariant::Enhance, DISPLAY_LONG_EDGE_CAP),
    }
}

/// Resolve the cache variant + cap for a decode. A `Display` decode carrying a
/// viewport hint is sized to the bucketed viewport tier (distinct `Viewport`
/// variant + bucketed cap-in-key); without a hint, or for any other intent, the
/// intent's default tier applies. This is what keeps the viewport derivative and
/// the 8192 on-zoom `Display` tier from colliding.
fn display_tier(intent: DecodeIntent, viewport: Option<ViewportHint>) -> (CacheVariant, u32) {
    match (intent, viewport) {
        (DecodeIntent::Display, Some(hint)) => (CacheVariant::Viewport, viewport_tier_cap(hint)),
        _ => intent_variant_cap(intent),
    }
}

/// The resolved (variant, cap) for a decode, exposed for the command layer so it
/// can fold the tier cap into the scheduler single-flight key. The variant is
/// returned for completeness; callers currently key on the cap.
pub fn tier_for(intent: DecodeIntent, viewport: Option<ViewportHint>) -> (CacheVariant, u32) {
    display_tier(intent, viewport)
}

/// Return the cached decode result for `path`/`intent` if one already exists on
/// disk, without ever decoding. Used by the viewer to prefer an already-enhanced
/// image when reopening a RAW, without triggering a fresh (heavy) demosaic.
/// Returns `Ok(None)` for native formats (which are never cached here) and when
/// no cache file is present.
pub fn lookup_cached(
    path: &Path,
    intent: DecodeIntent,
) -> Result<Option<DecodedCacheImage>, DecodeImageError> {
    if classify_path(path) != Some(ImageFormatSupport::NeedsBackend) {
        return Ok(None);
    }
    let orientation = read_orientation(path);
    lookup_cached_with_orientation(path, intent, orientation)
}

fn lookup_cached_with_orientation(
    path: &Path,
    intent: DecodeIntent,
    orientation: u16,
) -> Result<Option<DecodedCacheImage>, DecodeImageError> {
    let (variant, cap) = intent_variant_cap(intent);
    lookup_cached_at(path, variant, cap, orientation)
}

fn lookup_cached_at(
    path: &Path,
    variant: CacheVariant,
    cap: u32,
    orientation: u16,
) -> Result<Option<DecodedCacheImage>, DecodeImageError> {
    match disk_cache::lookup(path, variant, cap)? {
        Some(existing) => {
            let (width, height) = disk_cache::read_cached_dimensions(&existing)?;
            Ok(Some(DecodedCacheImage {
                path: existing,
                width,
                height,
                orientation,
            }))
        }
        None => Ok(None),
    }
}

/// Ask the system allocator to return freed-but-cached pages to the OS.
///
/// After a heavy decode the developed/transient buffers are dropped, but the
/// allocator commonly keeps that address space mapped for reuse, so process RSS
/// stays high. This nudges the platform allocator to decommit its freed regions:
///   - macOS: `malloc_zone_pressure_relief` (all zones).
///   - Windows: `HeapCompact` on the process heap (Rust's system allocator
///     allocates from `GetProcessHeap`), which coalesces free blocks and
///     decommits unused pages at the tail of the heap.
/// On other platforms this is a no-op.
fn release_freed_memory_to_os() {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: FFI to the libmalloc entry point. A null zone means "all
        // zones"; a goal of 0 means "release as much as possible". The call has
        // no ownership effects on Rust-managed memory.
        unsafe {
            malloc_zone_pressure_relief(std::ptr::null_mut(), 0);
        }
    }

    #[cfg(target_os = "windows")]
    {
        // SAFETY: FFI to kernel32. `GetProcessHeap` returns the default process
        // heap (the one Rust's `System` allocator uses on Windows); `HeapCompact`
        // with no flags coalesces free blocks and decommits unused tail pages. No
        // ownership effects on Rust-managed memory.
        unsafe {
            let heap = GetProcessHeap();
            if !heap.is_null() {
                HeapCompact(heap, 0);
            }
        }
    }
}

#[cfg(target_os = "macos")]
extern "C" {
    fn malloc_zone_pressure_relief(zone: *mut std::ffi::c_void, goal: usize) -> usize;
}

#[cfg(target_os = "windows")]
extern "system" {
    fn GetProcessHeap() -> *mut std::ffi::c_void;
    fn HeapCompact(heap: *mut std::ffi::c_void, flags: u32) -> usize;
}

fn decode_preview_intent(
    path: &Path,
    orientation: u16,
) -> Result<DecodedCacheImage, DecodeImageError> {
    // Cheapest path: prefer the EXIF embedded thumbnail, then the RAW embedded
    // preview. Never demosaics.
    let exif = read_exif_metadata(path, 0);
    let source = if let Some(thumbnail) = exif.embedded_thumbnail {
        thumbnail
    } else {
        load_backend_image_path_with_orientation(path, orientation, RawSource::Preview)?.image
    };

    let downscaled = downscale_to_cap(&source, PREVIEW_LONG_EDGE_CAP)?;
    let bytes = encode_display_jpeg(&downscaled)?;
    let cache_path = disk_cache::write(
        path,
        CacheVariant::Preview,
        PREVIEW_LONG_EDGE_CAP,
        "jpg",
        &bytes,
    )?;

    Ok(DecodedCacheImage {
        path: cache_path,
        width: downscaled.width(),
        height: downscaled.height(),
        orientation,
    })
}

fn decode_display_intent(
    path: &Path,
    orientation: u16,
    variant: CacheVariant,
    cap: u32,
) -> Result<DecodedCacheImage, DecodeImageError> {
    // RAW: use the embedded preview at whatever size it is — never demosaic on
    // open. Non-RAW: the existing full decode. The source is downscaled to the
    // requested tier cap (8192 default, or the bucketed viewport cap) and
    // dropped before the cache file is written.
    let source = display_source_image(path, orientation)?;
    let downscaled = downscale_owned_to_cap(source, cap)?;

    let has_alpha = image_has_transparency(&downscaled);
    let (bytes, ext) = if has_alpha {
        (encode_png(&downscaled)?, "png")
    } else {
        (encode_display_jpeg(&downscaled)?, "jpg")
    };
    let cache_path = disk_cache::write(path, variant, cap, ext, &bytes)?;
    let (width, height) = (downscaled.width(), downscaled.height());
    drop(downscaled);

    Ok(DecodedCacheImage {
        path: cache_path,
        width,
        height,
        orientation,
    })
}

fn decode_enhance_intent(
    path: &Path,
    orientation: u16,
) -> Result<DecodedCacheImage, DecodeImageError> {
    // User-triggered "Enhance": one-time full sensor demosaic, downscaled to the
    // display cap and encoded as JPEG (opaque) / PNG (alpha). This is the heavy
    // develop the open path deliberately avoids; it is cached and age-evicted.
    let source =
        load_backend_image_path_with_orientation(path, orientation, RawSource::Full)?.image;
    let downscaled = downscale_owned_to_cap(source, DISPLAY_LONG_EDGE_CAP)?;

    let has_alpha = image_has_transparency(&downscaled);
    let (bytes, ext) = if has_alpha {
        (encode_png(&downscaled)?, "png")
    } else {
        (encode_display_jpeg(&downscaled)?, "jpg")
    };
    let cache_path = disk_cache::write(
        path,
        CacheVariant::Enhance,
        DISPLAY_LONG_EDGE_CAP,
        ext,
        &bytes,
    )?;
    let (width, height) = (downscaled.width(), downscaled.height());
    drop(downscaled);

    Ok(DecodedCacheImage {
        path: cache_path,
        width,
        height,
        orientation,
    })
}

/// Choose the display-intent source. RAW never demosaics on open: it uses the
/// embedded preview at whatever size it is. Only when a RAW has no embedded
/// preview at all (rare) does it fall back to a develop so the viewer can still
/// show something. Non-RAW backend formats use their normal full decode.
fn display_source_image(path: &Path, orientation: u16) -> Result<DynamicImage, DecodeImageError> {
    if is_raw_extension(path) {
        if let Ok(preview) = decode_preview_raw(path) {
            return Ok(preview);
        }
    }

    Ok(load_backend_image_path_with_orientation(path, orientation, RawSource::Full)?.image)
}

fn is_raw_extension(path: &Path) -> bool {
    matches!(
        normalized_extension(path).ok().as_deref(),
        Some(
            "raw"
                | "cr2"
                | "cr3"
                | "nef"
                | "nrw"
                | "arw"
                | "sr2"
                | "srf"
                | "dng"
                | "raf"
                | "rw2"
                | "orf"
                | "pef"
                | "srw"
                | "kdc"
                | "erf"
                | "3fr"
        )
    )
}

pub fn load_supported_image_path(path: &Path) -> Result<LoadedImageData, DecodeImageError> {
    match classify_path(path) {
        Some(ImageFormatSupport::Native) => decode_native_image(path),
        Some(ImageFormatSupport::NeedsBackend) => load_backend_image_path(path, RawSource::Full),
        None => Err(DecodeImageError::unsupported(format!(
            "unsupported image format: {}",
            path.display()
        ))),
    }
}

/// Load a fully-developed image (shared `Arc`) for consumers that need raw
/// pixels — currently the clipboard copy. Backend formats are sourced from the
/// on-disk display cache (built if absent), so the RAW is not re-developed.
/// Native formats are cheap and decoded directly.
pub fn load_full_image_cached(path: &Path) -> Result<(Arc<DynamicImage>, u16), DecodeImageError> {
    match classify_path(path) {
        Some(ImageFormatSupport::Native) => {
            let loaded = decode_native_image(path)?;
            Ok((Arc::new(loaded.image), loaded.orientation))
        }
        Some(ImageFormatSupport::NeedsBackend) => {
            let display = decode_to_cache(path, DecodeIntent::Display)?;
            let image = ImageReader::open(&display.path)
                .map_err(|err| {
                    DecodeImageError::io(format!(
                        "failed to open display cache {}: {err}",
                        display.path.display()
                    ))
                })?
                .with_guessed_format()
                .map_err(|err| {
                    DecodeImageError::decode(format!(
                        "failed to inspect display cache {}: {err}",
                        display.path.display()
                    ))
                })?
                .decode()
                .map_err(|err| {
                    DecodeImageError::decode(format!(
                        "failed to decode display cache {}: {err}",
                        display.path.display()
                    ))
                })?;
            Ok((Arc::new(image), display.orientation))
        }
        None => Err(DecodeImageError::unsupported(format!(
            "unsupported image format: {}",
            path.display()
        ))),
    }
}

pub fn load_thumbnail_source(
    path: &Path,
    max_edge: u32,
) -> Result<LoadedImageData, DecodeImageError> {
    let exif_metadata = read_exif_metadata(path, max_edge / 2);
    if let Some(image) = exif_metadata.embedded_thumbnail {
        return Ok(LoadedImageData {
            image,
            orientation: exif_metadata.orientation,
        });
    }

    match classify_path(path) {
        Some(ImageFormatSupport::Native) => decode_native_thumbnail_image_with_orientation(
            path,
            max_edge,
            exif_metadata.orientation,
        ),
        Some(ImageFormatSupport::NeedsBackend) => load_backend_image_path_with_orientation(
            path,
            exif_metadata.orientation,
            RawSource::Preview,
        ),
        None => Err(DecodeImageError::unsupported(format!(
            "unsupported image format: {}",
            path.display()
        ))),
    }
}

/// The cheapest-source thumbnail/sample chain (Phase 8b). Selects the least
/// expensive source that can satisfy a small (`max_edge`) output, avoiding a
/// full-source decode of a large image whenever a cheaper source already exists:
///
/// 1. **Embedded preview** (EXIF thumbnail / RAW embedded preview) — free-ish.
/// 2. **Existing display-cache derivative** (lookup-ONLY; never force-creates an
///    8192 display decode just to make a tiny thumbnail). If the viewer has
///    already produced a viewport/display/preview/enhance derivative for this
///    source, we open that small cached JPEG/PNG instead of touching the
///    original. This is the key win for large non-JPEG images (HEIC/JXL/TIFF):
///    once they have a display derivative, thumbnails come from it.
/// 3. **Scaled JPEG decode** — native JPEG decodes at a reduced scale directly.
/// 4. **Guarded full decode** — last resort for non-JPEG sources with no cheaper
///    source, subject to the `MAX_PIXELS` ceiling so a decompression bomb is
///    refused rather than allocated.
///
/// This is a strict superset of [`load_thumbnail_source`] (step 2 is the new
/// behaviour); it is the source used by `thumbnail::generate_thumbnail` and
/// `thumbnail::sample_jpeg`.
pub fn load_thumbnail_source_chain(
    path: &Path,
    max_edge: u32,
) -> Result<LoadedImageData, DecodeImageError> {
    // 1. Embedded preview (EXIF thumbnail / RAW embedded preview).
    let exif_metadata = read_exif_metadata(path, max_edge / 2);
    if let Some(image) = exif_metadata.embedded_thumbnail {
        return Ok(LoadedImageData {
            image,
            orientation: exif_metadata.orientation,
        });
    }

    let orientation = exif_metadata.orientation;

    // 2. Existing display-cache derivative (lookup-only — never force-create).
    if let Some(loaded) = existing_display_derivative(path, orientation) {
        return Ok(loaded);
    }

    // 3 & 4. Format-specific decode (scaled JPEG / guarded full decode).
    match classify_path(path) {
        Some(ImageFormatSupport::Native) => {
            decode_native_thumbnail_image_with_orientation(path, max_edge, orientation)
        }
        Some(ImageFormatSupport::NeedsBackend) => {
            // RAW prefers its embedded preview (cheap, never demosaics); other
            // backend formats (HEIC/JXL/TIFF/AVIF/…) have no scaled-decode path,
            // so they full-decode — guard that against the MAX_PIXELS ceiling
            // first so a declared bomb is refused before any allocation.
            if !is_raw_extension(path) {
                if let Ok(probed) = probe::probe(path) {
                    if probed.exceeds_limit {
                        return Err(DecodeImageError::too_large(format!(
                            "image exceeds the {MAX_PIXELS}px decode ceiling ({}x{} = {}px): {}",
                            probed.width,
                            probed.height,
                            probed.pixels,
                            path.display()
                        )));
                    }
                }
            }
            load_backend_image_path_with_orientation(path, orientation, RawSource::Preview)
        }
        None => Err(DecodeImageError::unsupported(format!(
            "unsupported image format: {}",
            path.display()
        ))),
    }
}

/// Open an already-existing display-cache derivative for `path`, if any, as a
/// thumbnail/sample source. **Lookup-only:** never decodes the original or
/// force-creates a derivative. Tries the cheapest existing tier first
/// (`Preview`, then `Viewport`, then `Display`, then `Enhance`). Returns `None`
/// for native formats (not cached here) and when no derivative exists or the
/// cached file fails to open. The cached file already has EXIF orientation baked
/// into its pixels, so the returned orientation is `1` (identity) — the caller
/// must not re-apply orientation to it.
fn existing_display_derivative(path: &Path, _orientation: u16) -> Option<LoadedImageData> {
    if classify_path(path) != Some(ImageFormatSupport::NeedsBackend) {
        return None;
    }

    // Cheapest (smallest) first. Viewport derivatives are keyed by a bucketed
    // cap; we probe the standard buckets. Display/Enhance use the 8192 cap.
    let mut candidates: Vec<(CacheVariant, u32)> = vec![
        (CacheVariant::Preview, PREVIEW_LONG_EDGE_CAP),
    ];
    for &bucket in VIEWPORT_TIER_BUCKETS {
        candidates.push((CacheVariant::Viewport, bucket));
    }
    candidates.push((CacheVariant::Display, DISPLAY_LONG_EDGE_CAP));
    candidates.push((CacheVariant::Enhance, DISPLAY_LONG_EDGE_CAP));

    for (variant, cap) in candidates {
        if let Ok(Some(existing)) = disk_cache::lookup(path, variant, cap) {
            if let Some(image) = open_cached_image(&existing) {
                // The cached derivative already baked in EXIF orientation, so it
                // is upright: report identity orientation so the caller does not
                // rotate it again.
                return Some(LoadedImageData {
                    image,
                    orientation: 1,
                });
            }
        }
    }

    None
}

/// Decode an existing cache file to a `DynamicImage`, swallowing any I/O or
/// decode error (a corrupt/partial cache file just means "no cheaper source").
fn open_cached_image(cache_path: &Path) -> Option<DynamicImage> {
    ImageReader::open(cache_path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()
}

fn load_backend_image_path(
    path: &Path,
    raw_source: RawSource,
) -> Result<LoadedImageData, DecodeImageError> {
    let orientation = read_orientation(path);
    load_backend_image_path_with_orientation(path, orientation, raw_source)
}

fn load_backend_image_path_with_orientation(
    path: &Path,
    orientation: u16,
    raw_source: RawSource,
) -> Result<LoadedImageData, DecodeImageError> {
    match classify_path(path) {
        Some(ImageFormatSupport::Native) => {
            return Err(DecodeImageError::unsupported(format!(
                "native format decode is handled by the frontend: {}",
                path.display()
            )));
        }
        Some(ImageFormatSupport::NeedsBackend) => {}
        None => {
            return Err(DecodeImageError::unsupported(format!(
                "unsupported image format: {}",
                path.display()
            )));
        }
    }

    let image = match normalized_extension(path)?.as_str() {
        "avif" => decode_heic(path)?,
        "tif" | "tiff" | "bmp" | "ico" => decode_with_image_crate(path)?,
        "heic" | "heif" => decode_heic(path)?,
        "jxl" => decode_jxl(path)?,
        "raw" | "cr2" | "cr3" | "nef" | "nrw" | "arw" | "sr2" | "srf" | "dng" | "raf" | "rw2"
        | "orf" | "pef" | "srw" | "kdc" | "erf" | "3fr" => decode_raw(path, raw_source)?,
        _ => unreachable!(
            "backend extension set and decode dispatch are out of sync for {}",
            path.display()
        ),
    };

    Ok(LoadedImageData { image, orientation })
}

fn normalized_extension(path: &Path) -> Result<String, DecodeImageError> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .ok_or_else(|| {
            DecodeImageError::unsupported(format!("missing file extension: {}", path.display()))
        })
}

fn decode_with_image_crate(path: &Path) -> Result<DynamicImage, DecodeImageError> {
    let format = match normalized_extension(path)?.as_str() {
        "jpg" | "jpeg" => ImageFormat::Jpeg,
        "png" => ImageFormat::Png,
        "gif" => ImageFormat::Gif,
        "webp" => ImageFormat::WebP,
        "avif" => ImageFormat::Avif,
        "tif" | "tiff" => ImageFormat::Tiff,
        "bmp" => ImageFormat::Bmp,
        "ico" => ImageFormat::Ico,
        ext => {
            return Err(DecodeImageError::unsupported(format!(
                "unsupported image crate decode format: {ext}"
            )));
        }
    };

    let mut reader = ImageReader::open(path)
        .map_err(|err| DecodeImageError::io(format!("failed to open {}: {err}", path.display())))?
        .with_guessed_format()
        .map_err(|err| {
            DecodeImageError::decode(format!("failed to inspect {}: {err}", path.display()))
        })?;
    reader.set_format(format);

    reader.decode().map_err(|err| {
        DecodeImageError::decode(format!("failed to decode {}: {err}", path.display()))
    })
}

fn decode_native_image(path: &Path) -> Result<LoadedImageData, DecodeImageError> {
    let image = decode_with_image_crate(path)?;

    Ok(LoadedImageData {
        image,
        orientation: read_orientation(path),
    })
}

fn decode_native_thumbnail_image_with_orientation(
    path: &Path,
    max_edge: u32,
    orientation: u16,
) -> Result<LoadedImageData, DecodeImageError> {
    let image = match normalized_extension(path)?.as_str() {
        "jpg" | "jpeg" => decode_jpeg_thumbnail_image(path, max_edge)?,
        _ => decode_with_image_crate(path)?,
    };

    Ok(LoadedImageData { image, orientation })
}

fn decode_jpeg_thumbnail_image(
    path: &Path,
    max_edge: u32,
) -> Result<DynamicImage, DecodeImageError> {
    let file = std::fs::File::open(path)
        .map_err(|err| DecodeImageError::io(format!("failed to open {}: {err}", path.display())))?;
    let mut decoder = JpegDecoder::new(BufReader::new(file));
    let requested_edge = max_edge.clamp(1, u32::from(u16::MAX)) as u16;

    decoder
        .scale(requested_edge, requested_edge)
        .map_err(|err| {
            DecodeImageError::decode(format!(
                "failed to configure scaled JPEG decode for {}: {err}",
                path.display()
            ))
        })?;

    let pixels = decoder.decode().map_err(|err| {
        DecodeImageError::decode(format!(
            "failed to decode scaled JPEG {}: {err}",
            path.display()
        ))
    })?;
    let info = decoder.info().ok_or_else(|| {
        DecodeImageError::decode(format!(
            "scaled JPEG decoder did not report metadata for {}",
            path.display()
        ))
    })?;

    image_from_jpeg_pixels(
        u32::from(info.width),
        u32::from(info.height),
        info.pixel_format,
        pixels,
        path,
    )
}

fn image_from_jpeg_pixels(
    width: u32,
    height: u32,
    pixel_format: JpegPixelFormat,
    pixels: Vec<u8>,
    path: &Path,
) -> Result<DynamicImage, DecodeImageError> {
    match pixel_format {
        JpegPixelFormat::L8 => GrayImage::from_vec(width, height, pixels)
            .map(DynamicImage::ImageLuma8)
            .ok_or_else(|| {
                DecodeImageError::decode(format!(
                    "scaled JPEG decoder returned invalid grayscale pixels for {}",
                    path.display()
                ))
            }),
        JpegPixelFormat::L16 => {
            let luma8 = pixels
                .chunks_exact(2)
                .map(|chunk| chunk[0])
                .collect::<Vec<_>>();

            GrayImage::from_vec(width, height, luma8)
                .map(DynamicImage::ImageLuma8)
                .ok_or_else(|| {
                    DecodeImageError::decode(format!(
                        "scaled JPEG decoder returned invalid 16-bit grayscale pixels for {}",
                        path.display()
                    ))
                })
        }
        JpegPixelFormat::RGB24 => RgbImage::from_vec(width, height, pixels)
            .map(DynamicImage::ImageRgb8)
            .ok_or_else(|| {
                DecodeImageError::decode(format!(
                    "scaled JPEG decoder returned invalid RGB pixels for {}",
                    path.display()
                ))
            }),
        JpegPixelFormat::CMYK32 => {
            let mut rgb_pixels = Vec::with_capacity((width as usize) * (height as usize) * 3);

            for chunk in pixels.chunks_exact(4) {
                let cyan = u16::from(chunk[0]);
                let magenta = u16::from(chunk[1]);
                let yellow = u16::from(chunk[2]);
                let key = u16::from(chunk[3]);

                let red = (((255 - cyan) * (255 - key)) + 127) / 255;
                let green = (((255 - magenta) * (255 - key)) + 127) / 255;
                let blue = (((255 - yellow) * (255 - key)) + 127) / 255;

                rgb_pixels.push(red as u8);
                rgb_pixels.push(green as u8);
                rgb_pixels.push(blue as u8);
            }

            RgbImage::from_vec(width, height, rgb_pixels)
                .map(DynamicImage::ImageRgb8)
                .ok_or_else(|| {
                    DecodeImageError::decode(format!(
                        "scaled JPEG decoder returned invalid CMYK pixels for {}",
                        path.display()
                    ))
                })
        }
    }
}

fn decode_heic(path: &Path) -> Result<DynamicImage, DecodeImageError> {
    let bytes = fs::read(path)
        .map_err(|err| DecodeImageError::io(format!("failed to read {}: {err}", path.display())))?;
    let output = DecoderConfig::new()
        .decode(&bytes, PixelLayout::Rgba8)
        .map_err(|err| {
            DecodeImageError::decode(format!("failed to decode {}: {err}", path.display()))
        })?;

    let image = RgbaImage::from_vec(output.width, output.height, output.data).ok_or_else(|| {
        DecodeImageError::decode(format!(
            "decoder returned invalid RGBA buffer for {}",
            path.display()
        ))
    })?;

    Ok(DynamicImage::ImageRgba8(image))
}

fn decode_raw(path: &Path, source: RawSource) -> Result<DynamicImage, DecodeImageError> {
    let result = match source {
        RawSource::Full => decode_full_raw(path),
        RawSource::Preview => decode_preview_raw(path),
    };

    result.map_err(|err| {
        DecodeImageError::decode(format!("failed to decode RAW {}: {err}", path.display()))
    })
}

fn decode_full_raw(path: &Path) -> rawler::Result<DynamicImage> {
    let params = rawler::decoders::RawDecodeParams::default();

    match rawler::analyze::extract_raw_pixels(path, &params) {
        Ok(raw_image) => {
            let cpp = raw_image.cpp;
            let sensor_long_edge =
                u32::try_from(raw_image.width.max(raw_image.height)).unwrap_or(u32::MAX);
            // The unpacked sensor buffer (~100 MB for a 50 MP file) is no longer
            // needed once we have its scalars; drop it before extract_full_pixels
            // / raw_to_srgb re-decode and develop, so it is not resident during
            // the heavy f32 demosaic peak.
            if cpp == 1 {
                drop(raw_image);
                let full_image = rawler::analyze::extract_full_pixels(path, &params)?;
                let full_long_edge = full_image.width().max(full_image.height());

                if full_long_edge.saturating_mul(10) >= sensor_long_edge.saturating_mul(9) {
                    Ok(full_image)
                } else {
                    rawler::analyze::raw_to_srgb(path, &params)
                }
            } else {
                raw_image_to_dynamic_image(raw_image)
            }
        }
        Err(_) => rawler::analyze::extract_full_pixels(path, &params),
    }
}

fn raw_image_to_dynamic_image(raw_image: rawler::RawImage) -> rawler::Result<DynamicImage> {
    let width = u32::try_from(raw_image.width)
        .map_err(|_| rawler::RawlerError::DecoderFailed("RAW width overflowed u32".to_string()))?;
    let height = u32::try_from(raw_image.height)
        .map_err(|_| rawler::RawlerError::DecoderFailed("RAW height overflowed u32".to_string()))?;

    match raw_image.data {
        rawler::RawImageData::Integer(samples) => {
            if raw_image.cpp != 3 {
                return Err(rawler::RawlerError::DecoderFailed(format!(
                    "unsupported RAW integer channel count: {}",
                    raw_image.cpp
                )));
            }

            if raw_image.bps <= 8 {
                let rgb8 = samples
                    .into_iter()
                    .map(|sample| sample as u8)
                    .collect::<Vec<_>>();
                let image = ImageBuffer::<Rgb<u8>, Vec<u8>>::from_raw(width, height, rgb8)
                    .ok_or_else(|| {
                        rawler::RawlerError::DecoderFailed(
                            "failed to build RAW RGB8 image".to_string(),
                        )
                    })?;

                Ok(DynamicImage::ImageRgb8(image))
            } else {
                let image = ImageBuffer::<Rgb<u16>, Vec<u16>>::from_raw(width, height, samples)
                    .ok_or_else(|| {
                        rawler::RawlerError::DecoderFailed(
                            "failed to build RAW RGB16 image".to_string(),
                        )
                    })?;

                Ok(DynamicImage::ImageRgb16(image))
            }
        }
        rawler::RawImageData::Float(samples) => {
            if raw_image.cpp != 3 {
                return Err(rawler::RawlerError::DecoderFailed(format!(
                    "unsupported RAW float channel count: {}",
                    raw_image.cpp
                )));
            }

            let image = ImageBuffer::<Rgb<f32>, Vec<f32>>::from_raw(width, height, samples)
                .ok_or_else(|| {
                    rawler::RawlerError::DecoderFailed(
                        "failed to build RAW RGB32F image".to_string(),
                    )
                })?;

            Ok(DynamicImage::ImageRgb32F(image))
        }
    }
}

fn decode_preview_raw(path: &Path) -> rawler::Result<DynamicImage> {
    rawler::analyze::extract_preview_pixels(path, &rawler::decoders::RawDecodeParams::default())
}

fn decode_jxl(path: &Path) -> Result<DynamicImage, DecodeImageError> {
    let image = jxl_oxide::JxlImage::builder().open(path).map_err(|err| {
        DecodeImageError::decode(format!("failed to open {}: {err}", path.display()))
    })?;
    let render = image.render_frame(0).map_err(|err| {
        DecodeImageError::decode(format!("failed to render {}: {err}", path.display()))
    })?;
    let buffer = render.image_all_channels();
    let rgba = framebuffer_to_rgba(buffer)?;

    Ok(DynamicImage::ImageRgba8(rgba))
}

fn framebuffer_to_rgba(buffer: jxl_oxide::FrameBuffer) -> Result<RgbaImage, DecodeImageError> {
    let width = u32::try_from(buffer.width())
        .map_err(|_| DecodeImageError::decode("JPEG XL width overflowed u32"))?;
    let height = u32::try_from(buffer.height())
        .map_err(|_| DecodeImageError::decode("JPEG XL height overflowed u32"))?;

    let channels = buffer.channels();
    if channels < 3 {
        return Err(DecodeImageError::decode(format!(
            "JPEG XL image had unsupported channel count: {channels}"
        )));
    }

    let floats = buffer.buf();
    let mut rgba = Vec::with_capacity((width as usize) * (height as usize) * 4);

    for pixel in floats.chunks(channels) {
        let r = linear_sample_to_u8(pixel[0]);
        let g = linear_sample_to_u8(pixel[1]);
        let b = linear_sample_to_u8(pixel[2]);
        let a = if channels >= 4 {
            linear_sample_to_u8(pixel[3])
        } else {
            u8::MAX
        };

        rgba.extend_from_slice(&[r, g, b, a]);
    }

    ImageBuffer::from_vec(width, height, rgba)
        .ok_or_else(|| DecodeImageError::decode("failed to build JPEG XL RGBA image"))
}

fn linear_sample_to_u8(sample: f32) -> u8 {
    (sample.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// Compute the resize target (long edge capped to `cap`) for a `width`×`height`
/// source. Returns `None` when the source is empty or already within the cap
/// (i.e. no resize needed). Shared by the RGB and RGBA downscale paths so both
/// derive identical target dimensions.
fn resize_target(width: u32, height: u32, cap: u32) -> Option<(u32, u32)> {
    let long_edge = width.max(height);
    if long_edge == 0 || long_edge <= cap {
        return None;
    }
    let target = if width >= height {
        let scaled = ((u64::from(height) * u64::from(cap)) / u64::from(width)).max(1);
        (cap, u32::try_from(scaled).unwrap_or(1))
    } else {
        let scaled = ((u64::from(width) * u64::from(cap)) / u64::from(height)).max(1);
        (u32::try_from(scaled).unwrap_or(1), cap)
    };
    Some(target)
}

/// Whether a source image is opaque-typed (no alpha channel in its color type).
/// This is the discriminator for the resize/encode format split: opaque-typed
/// sources take the alpha-free RGB path, alpha-typed sources take the RGBA path.
/// It reads only the color *type* — it does not scan pixels for actual
/// transparency (that scan, when needed, happens only on the alpha path after
/// resize). Most JPEG/TIFF photos are opaque-typed and therefore avoid an alpha
/// plane entirely.
fn is_opaque_source(image: &DynamicImage) -> bool {
    !image.color().has_alpha()
}

/// Downscale `image` so its longest edge is at most `cap`, using a Lanczos3
/// convolution for high display quality. Images already within the cap are
/// cloned through unchanged. Opaque-typed sources resize as RGB (no alpha
/// plane); alpha-typed sources resize as RGBA. The borrowed form is used by the
/// preview path; prefer [`downscale_owned_to_cap`] where the source can be
/// consumed to free its backing buffer before the destination is allocated.
fn downscale_to_cap(image: &DynamicImage, cap: u32) -> Result<DynamicImage, DecodeImageError> {
    if resize_target(image.width(), image.height(), cap).is_none() {
        return Ok(image.clone());
    }
    if is_opaque_source(image) {
        downscale_rgb8_to_cap(image.to_rgb8(), cap)
    } else {
        downscale_rgba8_to_cap(image.to_rgba8(), cap)
    }
}

/// Owning variant: consume `image`, drop its (potentially large, e.g. Rgb16
/// 50 MP ≈ 300 MB) backing buffer as soon as the working copy exists, then
/// resize. This keeps the source and the resize destination from being resident
/// at the same time — meaningful headroom on the RAW-develop path.
///
/// Opaque-typed sources are converted to RGB8 (3 bytes/px, no alpha allocation)
/// and resized via the RGB path; alpha-typed sources keep the RGBA8 path. The
/// drop-source-before-destination pattern applies on both.
fn downscale_owned_to_cap(image: DynamicImage, cap: u32) -> Result<DynamicImage, DecodeImageError> {
    if resize_target(image.width(), image.height(), cap).is_none() {
        return Ok(image);
    }
    if is_opaque_source(&image) {
        let rgb = image.to_rgb8();
        drop(image);
        downscale_rgb8_to_cap(rgb, cap)
    } else {
        let rgba = image.to_rgba8();
        drop(image);
        downscale_rgba8_to_cap(rgba, cap)
    }
}

/// Shared fast_image_resize primitive: resize a raw pixel buffer of `pixel_type`
/// from `src_w`×`src_h` to `dst_w`×`dst_h` using `filter`, returning the raw
/// destination bytes. Callers own dimension/cap derivation and re-wrapping the
/// result into a typed image. The thumbnail path supplies Bilinear; the display
/// path supplies Lanczos3.
pub(crate) fn fir_resize(
    source_raw: Vec<u8>,
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    pixel_type: fir::PixelType,
    filter: fir::FilterType,
) -> Result<Vec<u8>, DecodeImageError> {
    let source_image = FirImage::from_vec_u8(src_w, src_h, source_raw, pixel_type)
        .map_err(|err| DecodeImageError::decode(format!("failed to prepare resize source buffer: {err}")))?;

    let mut destination = FirImage::new(dst_w, dst_h, pixel_type);
    fir::Resizer::new()
        .resize(
            &source_image,
            &mut destination,
            &fir::ResizeOptions::new().resize_alg(fir::ResizeAlg::Convolution(filter)),
        )
        .map_err(|err| DecodeImageError::decode(format!("failed to resize image: {err}")))?;
    drop(source_image);

    Ok(destination.into_vec())
}

fn downscale_rgba8_to_cap(source: RgbaImage, cap: u32) -> Result<DynamicImage, DecodeImageError> {
    let (width, height) = (source.width(), source.height());
    let Some((target_width, target_height)) = resize_target(width, height, cap) else {
        return Ok(DynamicImage::ImageRgba8(source));
    };

    let raw = fir_resize(
        source.into_raw(),
        width,
        height,
        target_width,
        target_height,
        fir::PixelType::U8x4,
        fir::FilterType::Lanczos3,
    )?;

    let resized = RgbaImage::from_vec(target_width, target_height, raw)
        .ok_or_else(|| DecodeImageError::decode("downscaler returned an invalid RGBA buffer"))?;

    Ok(DynamicImage::ImageRgba8(resized))
}

/// Resize an opaque RGB8 source to `cap`, with no alpha plane allocated at any
/// point (3 bytes/px source and destination). Mirrors [`downscale_rgba8_to_cap`]
/// but on `fir::PixelType::U8x3`. Always returns a `DynamicImage::ImageRgb8`, so
/// the downstream transparency scan short-circuits and the JPEG encoder takes
/// its zero-copy RGB branch. Reusable by the Phase 8b thumbnail path.
fn downscale_rgb8_to_cap(source: RgbImage, cap: u32) -> Result<DynamicImage, DecodeImageError> {
    let (width, height) = (source.width(), source.height());
    let Some((target_width, target_height)) = resize_target(width, height, cap) else {
        return Ok(DynamicImage::ImageRgb8(source));
    };

    let raw = fir_resize(
        source.into_raw(),
        width,
        height,
        target_width,
        target_height,
        fir::PixelType::U8x3,
        fir::FilterType::Lanczos3,
    )?;

    let resized = RgbImage::from_vec(target_width, target_height, raw)
        .ok_or_else(|| DecodeImageError::decode("downscaler returned an invalid RGB buffer"))?;

    Ok(DynamicImage::ImageRgb8(resized))
}

fn image_has_transparency(image: &DynamicImage) -> bool {
    if !image.color().has_alpha() {
        return false;
    }

    match image {
        DynamicImage::ImageLumaA8(buf) => buf.pixels().any(|pixel| pixel.0[1] != u8::MAX),
        DynamicImage::ImageLumaA16(buf) => buf.pixels().any(|pixel| pixel.0[1] != u16::MAX),
        DynamicImage::ImageRgba8(buf) => buf.pixels().any(|pixel| pixel.0[3] != u8::MAX),
        DynamicImage::ImageRgba16(buf) => buf.pixels().any(|pixel| pixel.0[3] != u16::MAX),
        DynamicImage::ImageRgba32F(buf) => buf.pixels().any(|pixel| pixel.0[3] < 1.0),
        _ => true,
    }
}

fn encode_display_jpeg(image: &DynamicImage) -> Result<Vec<u8>, DecodeImageError> {
    let mut cursor = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut cursor, DISPLAY_JPEG_QUALITY);

    // An opaque-typed source coming off the RGB resize path is already RGB8, so
    // encode it directly and skip the `to_rgb8()` copy. Only non-RGB8 inputs
    // (e.g. the alpha path's RGBA when its content turns out opaque) need the
    // conversion to drop their extra channels.
    let result = match image {
        DynamicImage::ImageRgb8(rgb) => encoder.encode_image(rgb),
        other => encoder.encode_image(&other.to_rgb8()),
    };
    result
        .map_err(|err| DecodeImageError::encode(format!("failed to encode display JPEG: {err}")))?;

    Ok(cursor.into_inner())
}

fn encode_png(image: &DynamicImage) -> Result<Vec<u8>, DecodeImageError> {
    let mut cursor = Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|err| {
            DecodeImageError::encode(format!("failed to encode PNG transport bytes: {err}"))
        })?;

    Ok(cursor.into_inner())
}

fn read_exif_metadata(path: &Path, min_thumbnail_long_edge: u32) -> ExifMetadata {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => {
            return ExifMetadata {
                orientation: 1,
                embedded_thumbnail: None,
            };
        }
    };
    let mut reader = BufReader::new(file);
    let exif = match ExifReader::new().read_from_container(&mut reader) {
        Ok(exif) => exif,
        Err(_) => {
            return ExifMetadata {
                orientation: 1,
                embedded_thumbnail: None,
            };
        }
    };

    ExifMetadata {
        orientation: orientation_from_exif(&exif),
        embedded_thumbnail: embedded_thumbnail_image(&exif, min_thumbnail_long_edge),
    }
}

fn orientation_from_exif(exif: &Exif) -> u16 {
    exif.get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|field| field.value.get_uint(0))
        .and_then(|value| u16::try_from(value).ok())
        .filter(|value| (1..=8).contains(value))
        .unwrap_or(1)
}

fn embedded_thumbnail_image(exif: &Exif, min_long_edge: u32) -> Option<DynamicImage> {
    let offset = exif
        .get_field(Tag::JPEGInterchangeFormat, In::THUMBNAIL)
        .and_then(|field| field.value.get_uint(0))
        .and_then(|value| usize::try_from(value).ok())?;
    let length = exif
        .get_field(Tag::JPEGInterchangeFormatLength, In::THUMBNAIL)
        .and_then(|field| field.value.get_uint(0))
        .and_then(|value| usize::try_from(value).ok())?;
    let end = offset.checked_add(length)?;
    let jpeg = exif.buf().get(offset..end)?;
    let image = image::load_from_memory_with_format(jpeg, ImageFormat::Jpeg).ok()?;

    if image.width().max(image.height()) < min_long_edge {
        return None;
    }

    Some(image)
}

fn read_orientation(path: &Path) -> u16 {
    read_exif_metadata(path, 0).orientation
}

/// Bake an EXIF orientation (1–8) into the pixels of `image`, returning a
/// correctly-oriented image. Used where the consumer cannot apply orientation as
/// a display transform — notably the filmstrip thumbnail, which renders the
/// cached JPEG directly. The operations mirror the frontend's
/// `orientationTransform` so a baked thumbnail matches the main viewer exactly.
pub fn apply_exif_orientation(image: DynamicImage, orientation: u16) -> DynamicImage {
    match orientation {
        2 => image.fliph(),
        3 => image.rotate180(),
        4 => image.flipv(),
        5 => image.fliph().rotate90(),
        6 => image.rotate90(),
        7 => image.fliph().rotate270(),
        8 => image.rotate270(),
        _ => image,
    }
}

#[doc(hidden)]
pub mod __test_support {
    use super::*;
    use jpeg_decoder::PixelFormat as JpegPixelFormat;

    pub fn normalized_extension_for(path: &Path) -> Result<String, DecodeImageError> {
        normalized_extension(path)
    }

    pub fn linear_sample_to_u8_for(sample: f32) -> u8 {
        linear_sample_to_u8(sample)
    }

    pub fn encode_png_for(image: &DynamicImage) -> Result<Vec<u8>, DecodeImageError> {
        encode_png(image)
    }

    pub fn encode_display_jpeg_for(image: &DynamicImage) -> Result<Vec<u8>, DecodeImageError> {
        encode_display_jpeg(image)
    }

    pub fn downscale_to_cap_for(
        image: &DynamicImage,
        cap: u32,
    ) -> Result<DynamicImage, DecodeImageError> {
        downscale_to_cap(image, cap)
    }

    pub fn downscale_owned_to_cap_for(
        image: DynamicImage,
        cap: u32,
    ) -> Result<DynamicImage, DecodeImageError> {
        downscale_owned_to_cap(image, cap)
    }

    pub fn is_opaque_source_for(image: &DynamicImage) -> bool {
        is_opaque_source(image)
    }

    pub fn resize_target_for(width: u32, height: u32, cap: u32) -> Option<(u32, u32)> {
        resize_target(width, height, cap)
    }

    pub fn is_raw_extension_for(path: &Path) -> bool {
        is_raw_extension(path)
    }

    pub fn display_tier_for(
        intent: DecodeIntent,
        viewport: Option<ViewportHint>,
    ) -> (CacheVariant, u32) {
        display_tier(intent, viewport)
    }

    pub fn read_orientation_for(path: &Path) -> u16 {
        read_orientation(path)
    }

    pub fn decode_with_image_crate_for(path: &Path) -> Result<DynamicImage, DecodeImageError> {
        decode_with_image_crate(path)
    }

    pub fn load_thumbnail_source_chain_for(
        path: &Path,
        max_edge: u32,
    ) -> Result<LoadedImageData, DecodeImageError> {
        load_thumbnail_source_chain(path, max_edge)
    }

    pub fn load_thumbnail_source_for(
        path: &Path,
        max_edge: u32,
    ) -> Result<LoadedImageData, DecodeImageError> {
        load_thumbnail_source(path, max_edge)
    }

    pub fn load_backend_image_path_for(
        path: &Path,
        orientation: u16,
    ) -> Result<LoadedImageData, DecodeImageError> {
        load_backend_image_path_with_orientation(path, orientation, RawSource::Full)
    }

    pub fn unsupported_error(message: &str) -> DecodeImageError {
        DecodeImageError::unsupported(message)
    }

    pub fn io_error(message: &str) -> DecodeImageError {
        DecodeImageError::io(message)
    }

    pub fn decode_error(message: &str) -> DecodeImageError {
        DecodeImageError::decode(message)
    }

    pub fn encode_error(message: &str) -> DecodeImageError {
        DecodeImageError::encode(message)
    }

    pub fn image_from_jpeg_pixels_for(
        width: u32,
        height: u32,
        pixel_format: JpegPixelFormat,
        pixels: Vec<u8>,
        path: &Path,
    ) -> Result<DynamicImage, DecodeImageError> {
        image_from_jpeg_pixels(width, height, pixel_format, pixels, path)
    }

    pub fn raw_image_to_dynamic_image_for(
        raw_image: rawler::RawImage,
    ) -> rawler::Result<DynamicImage> {
        raw_image_to_dynamic_image(raw_image)
    }
}
