//! Cheap, header-only dimension probing and the pixel-budget decision.
//!
//! The probe reads an image's declared dimensions without decoding any pixels,
//! so a decompression-bomb / gigapixel file can be rejected *before* any large
//! buffer is allocated. It is consumed by the `decode_to_cache` preflight (which
//! returns `DecodeImageError::too_large` over ceiling) and by the `probe_image`
//! command (frontend native-routing).
//!
//! Dimension reads are hybrid: `imagesize` first (it cheaply reads the headers of
//! the heavy formats — HEIC/JXL/AVIF/TIFF — that `image` cannot probe reliably,
//! and includes some bomb detection), falling back to `image::image_dimensions`
//! for anything `imagesize` does not recognize.

use std::path::Path;

use super::DecodeImageError;

/// Hard ceiling on the pixel count of any image the backend will decode.
/// 256 MP (16384 × 16384). Generous enough for 100 MP medium-format and large
/// stitched panoramas; only genuine decompression bombs are refused. There is no
/// best-effort scaled decode — over-ceiling files are rejected outright (most
/// formats lack a cheap scaled decode, so best-effort would defeat the guard).
pub const MAX_PIXELS: u64 = 268_435_456;

/// Header-only probe result: the declared dimensions, derived pixel count, an
/// animation flag (GIF/WebP multi-frame), and whether the file exceeds the pixel
/// ceiling.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProbeResult {
    pub width: u32,
    pub height: u32,
    pub pixels: u64,
    pub animated: bool,
    pub exceeds_limit: bool,
}

impl ProbeResult {
    fn from_dimensions(width: u32, height: u32, animated: bool) -> Self {
        let pixels = u64::from(width) * u64::from(height);
        Self {
            width,
            height,
            pixels,
            animated,
            exceeds_limit: pixels > MAX_PIXELS,
        }
    }
}

/// Probe `path` for its declared dimensions, animation flag, and over-ceiling
/// status, without decoding pixels. Returns a structured `DecodeImageError` (not
/// a panic) for corrupt/truncated/unreadable headers.
pub fn probe(path: &Path) -> Result<ProbeResult, DecodeImageError> {
    let (width, height) = read_dimensions(path)?;
    let animated = detect_animation(path);
    Ok(ProbeResult::from_dimensions(width, height, animated))
}

/// Read the declared (width, height) using the hybrid strategy. `imagesize`
/// covers the heavy formats; `image::image_dimensions` is the fallback. If both
/// fail, the file is corrupt/truncated/unsupported and a structured error is
/// returned.
fn read_dimensions(path: &Path) -> Result<(u32, u32), DecodeImageError> {
    if let Ok(size) = imagesize::size(path) {
        if let (Ok(width), Ok(height)) = (u32::try_from(size.width), u32::try_from(size.height)) {
            if width > 0 && height > 0 {
                return Ok((width, height));
            }
        }
    }

    match image::image_dimensions(path) {
        Ok((width, height)) if width > 0 && height > 0 => Ok((width, height)),
        Ok(_) => Err(DecodeImageError::decode(format!(
            "image reported zero dimensions: {}",
            path.display()
        ))),
        Err(err) => Err(DecodeImageError::decode(format!(
            "failed to probe dimensions for {}: {err}",
            path.display()
        ))),
    }
}

/// Detect whether a GIF or WebP file is animated. Static formats (and any read
/// failure) are reported as non-animated; animation is a best-effort hint used to
/// keep animated files on the direct-render path, so a false negative degrades
/// gracefully (the file would route through the backend and lose playback) and a
/// read failure simply means "treat as static".
fn detect_animation(path: &Path) -> bool {
    match super::normalized_extension(path).ok().as_deref() {
        Some("gif") => gif_is_animated(path),
        Some("webp") => webp_is_animated(path),
        _ => false,
    }
}

/// A GIF is animated if it contains more than one image frame. We count frames
/// lazily and stop as soon as a second frame is seen, so this stays cheap even
/// for long animations.
fn gif_is_animated(path: &Path) -> bool {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let decoder = match image::codecs::gif::GifDecoder::new(std::io::BufReader::new(file)) {
        Ok(decoder) => decoder,
        Err(_) => return false,
    };
    use image::AnimationDecoder;
    let mut frames = decoder.into_frames();
    // First frame present + a second frame present => animated.
    if frames.next().and_then(Result::ok).is_none() {
        return false;
    }
    frames.next().and_then(Result::ok).is_some()
}

/// A WebP is animated if its RIFF/WEBP container carries the `ANIM` chunk (the
/// VP8X extended format with the animation flag). We scan the chunk list rather
/// than fully decoding.
fn webp_is_animated(path: &Path) -> bool {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    has_webp_anim_chunk(&bytes)
}

/// Scan a RIFF/WEBP byte buffer for an `ANIM` chunk. Returns false for any
/// malformed/short header rather than erroring (animation is a hint).
fn has_webp_anim_chunk(bytes: &[u8]) -> bool {
    // Minimum: "RIFF" + u32 size + "WEBP" = 12 bytes, then chunks.
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return false;
    }

    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let fourcc = &bytes[offset..offset + 4];
        if fourcc == b"ANIM" || fourcc == b"ANMF" {
            return true;
        }
        let chunk_size = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        // Chunks are padded to an even size.
        let padded = chunk_size + (chunk_size & 1);
        offset = match offset.checked_add(8).and_then(|o| o.checked_add(padded)) {
            Some(next) => next,
            None => return false,
        };
    }

    false
}

#[doc(hidden)]
pub mod __test_support {
    use super::*;

    pub fn has_webp_anim_chunk_for(bytes: &[u8]) -> bool {
        has_webp_anim_chunk(bytes)
    }

    pub fn detect_animation_for(path: &Path) -> bool {
        detect_animation(path)
    }
}
