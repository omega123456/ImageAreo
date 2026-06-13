/**
 * Format routing for the viewer.
 *
 * Only JPEG, PNG, GIF and WebP are rendered directly by the OS WebView's
 * native `<img>` (via `convertFileSrc`) on both macOS 14+ (WKWebView) and
 * Windows 11+ (WebView2). Every other supported format must be decoded by the
 * Rust backend (wired in P9). This classifier decides which path a file takes.
 */

/** Extensions the native WebView `<img>` renders reliably (no backend). */
export const NATIVE_EXTENSIONS: ReadonlySet<string> = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
]);

/** Supported formats that must be decoded by the Rust backend. */
export const NEEDS_BACKEND_EXTENSIONS: ReadonlySet<string> = new Set([
  "avif",
  "tif",
  "tiff",
  "bmp",
  "ico",
  "heic",
  "heif",
  "jxl",
  // Camera RAW formats — must stay in sync with is_raw_extension() in src-tauri/src/image/mod.rs.
  "raw",
  "cr2",
  "cr3",
  "nef",
  "arw",
  "dng",
  "orf",
  "rw2",
  "raf",
  "srw",
  "pef",
  "nrw",
  "sr2",
  "srf",
  "kdc",
  "erf",
  "3fr",
]);

/** RAW formats that benefit from a staged preview-then-upgrade load.
 * Must stay in sync with is_raw_extension() in src-tauri/src/image/mod.rs. */
export const RAW_EXTENSIONS: ReadonlySet<string> = new Set([
  "raw",
  "cr2",
  "cr3",
  "nef",
  "arw",
  "dng",
  "orf",
  "rw2",
  "raf",
  "srw",
  "pef",
  "nrw",
  "sr2",
  "srf",
  "kdc",
  "erf",
  "3fr",
]);

/**
 * Pixel-count threshold above which a *native* image (jpg/jpeg/png/gif/webp) is
 * routed through the backend display pipeline instead of being rendered at full
 * resolution in the WebView. Common DSLR/phone photos stay on the fast direct
 * path; only genuinely large native images route through the backend cap.
 *
 * Kept in sync with `NATIVE_ROUTING_PIXELS` in src-tauri/src/image/probe.rs.
 */
export const NATIVE_ROUTING_PIXELS = 50_000_000;

/**
 * Hard pixel ceiling (256 MP = 16384 × 16384). Images whose pixel count exceeds
 * this are refused by the backend with an `image_too_large` error; the viewer
 * surfaces the "limit" state. The MP figure shown to the user is derived from
 * this constant, never hardcoded.
 *
 * Kept in sync with `MAX_PIXELS` in src-tauri/src/image/mod.rs.
 */
export const MAX_DISPLAY_PIXELS = 268_435_456;

/** Lower-cased extension of a path/filename, without the leading dot. */
export function extensionOf(path: string): string {
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** True when the file is rendered natively; false when it needs backend decode. */
export function isNativeFormat(path: string): boolean {
  return NATIVE_EXTENSIONS.has(extensionOf(path));
}

/** True when the extension is a supported image format (native or backend). */
export function isSupportedImage(path: string): boolean {
  const ext = extensionOf(path);
  return NATIVE_EXTENSIONS.has(ext) || NEEDS_BACKEND_EXTENSIONS.has(ext);
}

/** True when the path is a camera RAW format. */
export function isRawFormat(path: string): boolean {
  return RAW_EXTENSIONS.has(extensionOf(path));
}

/** All supported extensions, for use in open-dialog filters. */
export function supportedExtensions(): string[] {
  return [...NATIVE_EXTENSIONS, ...NEEDS_BACKEND_EXTENSIONS];
}

/**
 * CSS `transform` fragment that applies an EXIF orientation (1–8) as a
 * display-time transform — never by re-encoding pixels. Returned as an
 * image-space transform to be composed *after* the zoom/pan transform so the
 * reorientation happens in the image's own coordinate space.
 *
 * The eight EXIF orientation values (TIFF tag 0x0112) map to combinations of
 * a horizontal mirror and a rotation. Unknown values fall back to identity.
 */
export function orientationTransform(orientation: number): string {
  switch (orientation) {
    case 2:
      return "scaleX(-1)";
    case 3:
      return "rotate(180deg)";
    case 4:
      return "scaleY(-1)";
    case 5:
      return "rotate(90deg) scaleX(-1)";
    case 6:
      return "rotate(90deg)";
    case 7:
      return "rotate(270deg) scaleX(-1)";
    case 8:
      return "rotate(270deg)";
    case 1:
    default:
      return "";
  }
}
