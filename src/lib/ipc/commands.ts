export const IPC_COMMANDS = {
  frontendReady: "frontend_ready",
  queryFileAssociations: "query_file_associations",
  setDefaultAssociations: "set_default_associations",
  scanFolder: "scan_folder",
  folderSignature: "folder_signature",
  probeImage: "probe_image",
  decodeImage: "decode_image",
  peekDecodedImage: "peek_decoded_image",
  sampleImage: "sample_image",
  generateThumbnail: "generate_thumbnail",
  copyImageToClipboard: "copy_image_to_clipboard",
  revealInFileManager: "reveal_in_file_manager",
  readImageMetadata: "read_image_metadata",
  printCurrentView: "print_current_view",
} as const;

/**
 * Backend → frontend event names (Phase 12). Kept in sync with the Rust
 * `startup::OPEN_PATH_EVENT` and `menu::MENU_EVENT` constants.
 */
export const IPC_EVENTS = {
  /** Carries a filesystem path to open (launch path / macOS Opened event). */
  openPath: "imageareo://open-path",
  /** Carries a native-menu action key (matches the Rust menu item ids). */
  menu: "imageareo://menu",
} as const;

/**
 * Native-menu action keys. These mirror `src-tauri/src/menu/mod.rs::ids` and
 * are the payloads delivered on the `menu` event.
 */
export const MENU_ACTIONS = {
  open: "file.open",
  openFolder: "file.open_folder",
  fit: "view.fit",
  actualSize: "view.actual_size",
  toggleGallery: "view.toggle_gallery",
  toggleFullscreen: "view.toggle_fullscreen",
  settings: "app.settings",
} as const;

export type MenuAction = (typeof MENU_ACTIONS)[keyof typeof MENU_ACTIONS];

export type SortOrder = "name" | "date";

export interface ImageEntry {
  path: string;
  name: string;
  modified: number;
}

export interface DecodedImage {
  /** On-disk cache file path returned by the backend decode command. */
  path: string;
  width: number;
  height: number;
  orientation: number;
}

/**
 * Header-only dimension probe of an image file (no full pixel decode). Used by
 * the viewer to route large native images through the backend and to
 * short-circuit over-ceiling files to the "limit" state before decoding.
 */
export interface ProbedImage {
  width: number;
  height: number;
  /** `width * height` reported by the backend. */
  pixels: number;
  /** True for multi-frame GIF / animated WebP — never routed (preserve playback). */
  animated: boolean;
  /** True when `pixels` exceeds the 256 MP hard ceiling (`MAX_DISPLAY_PIXELS`). */
  exceedsLimit: boolean;
}

export interface ProbeImageRequest {
  path: string;
}

export type DecodeImageQuality = "preview" | "display" | "enhance";

/**
 * Scheduling priority hint sent with each decode-class request. Maps onto the
 * backend scheduler's priority queue (current image > visible thumbnails >
 * prefetch). Optional; callers that have not yet wired a real priority (Phase 2)
 * may omit it, and the backend defaults to `"visibleThumbnail"`. Real values are
 * wired by Phases 4/6.
 */
export type RequestPriority = "prefetch" | "visibleThumbnail" | "currentImage";

/**
 * Optional scheduler hints carried by every decode-class request. `priority`
 * drives the backend's priority queue; `generation` is a per-open token that
 * complements the existing frontend stale-result guard (the backend dedups by
 * key and never cancels running work).
 */
export interface SchedulerHint {
  priority?: RequestPriority;
  generation?: number;
}

export interface Thumbnail {
  url: string;
}

export interface OkResponse {
  ok: true;
}

export interface ExtAssociation {
  ext: string;
  isDefault: boolean;
}

export interface ScanFolderRequest {
  path: string;
  sortOrder: SortOrder;
}

export interface FolderSignatureRequest {
  path: string;
}

/**
 * Viewport hint for sizing the initial display derivative (#5). The backend
 * sizes the tier to `clamp(round(longEdgePx), VIEWPORT_TIER_MIN_EDGE,
 * DISPLAY_LONG_EDGE_CAP)`, bucketed for cache reuse. Applies only to
 * `quality: "display"` decodes; omitted for `preview`/`enhance` and for the
 * on-zoom sharper-tier request (which targets the full 8192 tier).
 *
 * devicePixelRatio is deliberately not part of the hint: scaling by DPR sized
 * the tier to the (super-sampled) framebuffer rather than the physical panel,
 * which overshot on macOS scaled-HiDPI modes.
 */
export interface ViewportHint {
  /** Viewport long edge in CSS pixels. */
  longEdgePx: number;
}

export interface DecodeImageRequest extends SchedulerHint {
  path: string;
  quality?: DecodeImageQuality;
  viewport?: ViewportHint;
}

export interface GenerateThumbnailRequest extends SchedulerHint {
  path: string;
  size: number;
}

export interface SampleImageRequest extends SchedulerHint {
  path: string;
  size: number;
}

export interface CopyImageToClipboardRequest {
  path: string;
}

export interface RevealInFileManagerRequest {
  path: string;
}

export interface SetDefaultAssociationsRequest {
  exts: string[];
}

/**
 * Camera/EXIF metadata for an image. Every field is optional; the backend only
 * emits this object (as `ImageMetadata.camera`) when at least one field is
 * present. Mirrors the Rust `CameraMetadata` camelCase serialization.
 */
export interface CameraMetadata {
  make?: string;
  model?: string;
  lens?: string;
  /** ISO speed rating. */
  iso?: number;
  /** Aperture as an f-number (e.g. `4.0`). */
  aperture?: number;
  /** Exposure time, formatted on the frontend (e.g. `1/250 s`). */
  shutterSpeed?: string;
  /** Focal length in millimetres. */
  focalLength?: number;
  /** EXIF capture datetime string. */
  dateTaken?: string;
}

/**
 * Full on-demand metadata for a single image returned by `read_image_metadata`.
 * Mirrors the Rust `ImageMetadata` camelCase serialization. `colorType` and
 * `bitDepth` are `null` when not determinable header-side; `camera` is `null`
 * when the file carries no camera EXIF.
 */
export interface ImageMetadata {
  fileName: string;
  filePath: string;
  /** Container format (e.g. `JPEG`, `PNG`, `HEIC`). */
  format: string;
  fileSizeBytes: number;
  width: number;
  height: number;
  /** `width * height` reported by the backend. */
  pixels: number;
  /** e.g. `RGB`, `RGBA`, `Grayscale`; `null` when not determinable. */
  colorType: string | null;
  /** Bits per channel; `null` when not determinable. */
  bitDepth: number | null;
  /** EXIF orientation (1–8). */
  orientation: number;
  camera: CameraMetadata | null;
}

export interface ReadImageMetadataRequest {
  path: string;
}

/** Page orientation for the native print job. Mirrors the print store. */
export type PrintOrientation = "portrait" | "landscape";

/**
 * Arguments for `print_current_view`: the selected paper size in millimetres
 * (portrait/native dimensions as stored) plus the chosen orientation. The
 * backend converts mm → points and applies them to a copied `NSPrintInfo`.
 */
export interface PrintCurrentViewRequest {
  paperWidthMm: number;
  paperHeightMm: number;
  orientation: PrintOrientation;
}

/**
 * Fallback print request (US Letter portrait), matching the print store's
 * defaults. The real caller (PrintDialog) always passes explicit args, so this
 * is only a safe default for the optional-arg `printCurrentView` and is
 * exercised by tests; `Ctrl/Cmd+P` opens the dialog rather than quick-printing.
 */
export const DEFAULT_PRINT_REQUEST: PrintCurrentViewRequest = {
  paperWidthMm: 215.9,
  paperHeightMm: 279.4,
  orientation: "portrait",
};
