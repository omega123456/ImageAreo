/**
 * Viewer state store (Svelte 5 runes).
 *
 * Holds the current image source and the live view transform (zoom/pan/
 * rotation/fit-mode) plus load status. The zoom/pan controller mutates `zoom`
 * and `pan`; components read this store to drive the `<img>` transform and the
 * zoom HUD.
 *
 * Backend-decoded images follow a preview → display → optional full lifecycle.
 * The `decode_image` command writes a cache file to disk and returns its path;
 * the IPC wrapper resolves that path to an asset URL via `convertFileSrc`, so
 * the viewer renders backend images from files (no base64 on the JS heap).
 *
 *  - Native formats (JPEG/PNG/GIF/WebP) load directly through `convertFileSrc`.
 *  - RAW: an instant low-res `preview` paints first (`upgrading = true`), then
 *    the capped `display` image — the embedded preview, never a demosaic — swaps
 *    in (`upgrading = false`, `enhanceAvailable = true`). The display is fast and
 *    light but can be soft, so the user may then opt into an `enhance` decode (a
 *    one-time full sensor demosaic, `enhancing` → `enhanced`) to sharpen it.
 *  - Non-RAW backend formats load the `display` image only.
 *
 * Navigating/closing bumps the open request id, which cancels pending decodes,
 * clears all enhance state, and ensures superseded results are never applied.
 */

import { convertFileSrc } from "@tauri-apps/api/core";

import { decodeImage, peekDecodedImage, probeImage } from "../ipc";
import type { DecodedImageWithUrl } from "../ipc";
import {
  isNativeFormat,
  isRawFormat,
  NATIVE_ROUTING_PIXELS,
} from "../utils/format";

/**
 * Viewport tier buckets (device-pixel long edge), mirroring the backend
 * `disk_cache.rs` bucket set so the frontend can predict which tier cap a
 * viewport hint resolves to and compare it against the on-zoom displayed
 * resolution. The last bucket (8192) is the maximum on-zoom sharper tier.
 */
const VIEWPORT_TIER_BUCKETS = [1024, 1536, 2048, 3072, 4096, 6144, 8192] as const;
/** Floor so tiny windows still get a usable derivative (mirrors backend). */
const VIEWPORT_TIER_MIN_EDGE = 1024;
/** Maximum (sharper) on-zoom tier cap (mirrors backend DISPLAY_LONG_EDGE_CAP). */
const DISPLAY_LONG_EDGE_CAP = 8192;

/**
 * Resolve a requested device-pixel long edge to the bucketed tier cap the
 * backend will actually produce. Picks the smallest bucket ≥ the request,
 * clamped to the [min, max] range.
 */
function bucketTierCap(requestedLongEdge: number): number {
  const target = Math.max(VIEWPORT_TIER_MIN_EDGE, Math.round(requestedLongEdge));
  for (const bucket of VIEWPORT_TIER_BUCKETS) {
    if (bucket >= target) return bucket;
  }
  return DISPLAY_LONG_EDGE_CAP;
}

export type FitMode = "fit" | "actual" | "free";
export type ViewerStatus = "idle" | "loading" | "ready" | "error";
/**
 * Why the viewer entered the `error` status. Kept as a *separate* field rather
 * than a `ViewerStatus` member because `zoom-pan-controller.ts` gates
 * interaction on `status === "ready"` and would break if the union widened.
 *  - `"corrupt"` — generic decode failure (corrupt/unsupported file).
 *  - `"limit"`   — the file exceeds the 256 MP display ceiling.
 */
export type ViewerErrorReason = "corrupt" | "limit";
export type Rotation = 0 | 90 | 180 | 270;

/** Backend error `code` for an over-ceiling image (see `image/mod.rs`). */
const IMAGE_TOO_LARGE_CODE = "image_too_large";

/** True when a rejected IPC error carries `code: "image_too_large"`. */
function isTooLargeError(error: unknown): boolean {
  // The invoke rejection is always the serialized DecodeImageError object.
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === IMAGE_TOO_LARGE_CODE
  );
}

export interface Pan {
  x: number;
  y: number;
}

class ViewerStore {
  #openRequestId = 0;
  #pendingDecodeImage: HTMLImageElement | null = null;
  #pendingEnhanceDecodeImage: HTMLImageElement | null = null;

  /** Original filesystem path of the loaded image, when present. */
  path = $state<string | null>(null);
  /** Filesystem path currently used for backdrop sampling. */
  samplePath = $state<string | null>(null);
  /** Resolved image source (asset URL — native path or backend cache file). */
  source = $state<string>("");
  /** Human-readable name (filename) of the loaded image, for accessibility. */
  name = $state<string | null>(null);
  /** Intrinsic pixel dimensions of the loaded image. */
  naturalWidth = $state<number>(0);
  naturalHeight = $state<number>(0);
  /** Current zoom factor (1 = 100%). */
  zoom = $state<number>(1);
  /** Pan offset in CSS pixels, applied after scaling. */
  pan = $state<Pan>({ x: 0, y: 0 });
  /** Display rotation in degrees (user-driven, P11). */
  rotation = $state<Rotation>(0);
  /**
   * EXIF orientation (1–8) of the decoded image, applied as a display
   * transform. Native formats are oriented by the WebView itself, so this
   * stays at the identity value (1) for them.
   */
  orientation = $state<number>(1);
  /** Active sizing mode. */
  fitMode = $state<FitMode>("fit");
  /** Load lifecycle status. */
  status = $state<ViewerStatus>("idle");
  /**
   * Discriminator for the `error` status: `"corrupt"` for a generic decode
   * failure, `"limit"` when the file exceeds the 256 MP ceiling. `null` when not
   * in an error state. Drives which `ErrorState` variant `ImageViewer` renders.
   */
  errorReason = $state<ViewerErrorReason | null>(null);
  /**
   * True while the instant RAW preview is shown but the capped `display` image
   * (the embedded preview, no demosaic) is still being prepared in the
   * background. The image stays visible and interactive throughout; while this
   * is set, the Enhance control is withheld until the display is ready.
   */
  upgrading = $state<boolean>(false);
  /**
   * True when a RAW display image is ready and the user may opt into the heavier
   * "Enhance" decode (a full sensor demosaic). Cleared while `upgrading`, on
   * non-RAW images, and on navigate/reset.
   */
  enhanceAvailable = $state<boolean>(false);
  /** True while the on-demand Enhance decode runs. */
  enhancing = $state<boolean>(false);
  /** True once the viewer is rendering the enhanced (demosaiced) image. */
  enhanced = $state<boolean>(false);
  /** Transient flag that drives the Enhance control's error state. */
  enhanceError = $state<boolean>(false);
  /**
   * True while a sharper-tier (8192) display derivative is being fetched after
   * a zoom-in past the current viewport tier. Drives the debounced "Sharpening…"
   * pill. Never set on zoom-out or when already at the max tier.
   */
  sharpening = $state<boolean>(false);

  /**
   * Viewport long edge (CSS px) used to size the initial display tier. Set by
   * the host viewer from its container before each open; defaults to a sane
   * value for headless contexts.
   */
  #viewportLongEdgePx = 0;
  /**
   * Device-pixel long-edge cap of the *current* display derivative. `0` means
   * the image is rendered at full/native resolution (native direct path or RAW
   * preview) and has no further sharper tier to fetch.
   */
  #currentTierLongEdge = 0;
  /** True once the max (8192) tier has been requested for the current open. */
  #sharperTierRequested = false;
  /**
   * Set when the next `<img>` load is a seamless tier swap (the on-zoom sharper
   * tier replacing the same image) so the host preserves the user's zoom/pan
   * instead of re-fitting. Consumed once by `consumePreserveTransform`.
   */
  #preserveTransformLoad = false;
  /**
   * Paths with a heavy decode/enhance still running. Lets a navigate-back to an
   * in-flight image re-show the matching indicator; the backend single-flight
   * guarantees no duplicate decode is started.
   */
  #inFlightPaths = new Set<string>();

  /**
   * Record the host viewport's long edge (CSS px) so the next display open can
   * size its initial tier to the viewport. Called by `ImageViewer` on layout.
   */
  setViewportLongEdge(longEdgePx: number): void {
    this.#viewportLongEdgePx = longEdgePx > 0 ? longEdgePx : 0;
  }

  /** True when a heavy decode/enhance for `path` is still in flight. */
  isInFlight(path: string): boolean {
    return this.#inFlightPaths.has(path);
  }

  /** Build the viewport hint for a primary display decode, if dims are known. */
  #viewportHint(): { longEdgePx: number; dpr: number } | undefined {
    if (this.#viewportLongEdgePx <= 0) return undefined;
    const dpr =
      typeof window !== "undefined" && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
    return { longEdgePx: this.#viewportLongEdgePx, dpr };
  }

  /** Clear all Enhance lifecycle state. */
  #resetEnhanceState(): void {
    this.enhanceAvailable = false;
    this.enhancing = false;
    this.enhanced = false;
    this.enhanceError = false;
    this.#cancelPendingEnhanceDecode();
  }

  /** Clear all sharper-tier upgrade state. */
  #resetSharpenState(): void {
    this.sharpening = false;
    this.#currentTierLongEdge = 0;
    this.#sharperTierRequested = false;
  }

  /** Reset the view transform and intrinsic dimensions to their defaults. */
  #resetTransform(): void {
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.rotation = 0;
    this.orientation = 1;
    this.fitMode = "fit";
  }

  /**
   * Whether the next `<img>` load should preserve the current zoom/pan (a
   * seamless tier swap) rather than re-fitting. Reads-and-clears the flag.
   */
  consumePreserveTransform(): boolean {
    const preserve = this.#preserveTransformLoad;
    this.#preserveTransformLoad = false;
    return preserve;
  }

  /** Begin loading a new source; resets the transform to a centered fit. */
  load(source: string, name?: string): void {
    this.#openRequestId += 1;
    this.#cancelPendingDecode();
    this.#resetTransform();
    this.#preserveTransformLoad = false;
    this.upgrading = false;
    this.#resetEnhanceState();
    this.#resetSharpenState();
    this.source = source;
    this.samplePath = null;
    this.name = name ?? null;
    this.status = "loading";
    this.errorReason = null;
  }

  /** Stop any detached decode work that has not yet completed. */
  #cancelPendingDecode(): void {
    if (!this.#pendingDecodeImage) {
      return;
    }
    this.#pendingDecodeImage.src = "";
    this.#pendingDecodeImage = null;
  }

  /** Stop any detached Enhance decode work that has not yet completed. */
  #cancelPendingEnhanceDecode(): void {
    if (!this.#pendingEnhanceDecodeImage) {
      return;
    }
    this.#pendingEnhanceDecodeImage.src = "";
    this.#pendingEnhanceDecodeImage = null;
  }

  /**
   * Decode an image source off the main render path before swapping it into the
   * visible `<img>`, so the loading state can paint immediately.
   *
   * `useEnhanceSlot` selects a separate cancellation slot
   * (`#pendingEnhanceDecodeImage`) so an Enhance decode does not clobber the
   * background display-upgrade decode's cleanup guard (or vice versa).
   */
  async #decodeOffThread(
    source: string,
    requestId: number,
    useEnhanceSlot: boolean = false,
  ): Promise<{ width: number; height: number }> {
    const img = new Image();
    if (useEnhanceSlot) {
      this.#pendingEnhanceDecodeImage = img;
    } else {
      this.#pendingDecodeImage = img;
    }
    img.decoding = "async";
    img.src = source;
    try {
      await img.decode();
      if (requestId !== this.#openRequestId) {
        throw new Error("decode superseded");
      }
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    } finally {
      if (useEnhanceSlot) {
        if (this.#pendingEnhanceDecodeImage === img) {
          this.#pendingEnhanceDecodeImage = null;
        }
      } else if (this.#pendingDecodeImage === img) {
        this.#pendingDecodeImage = null;
      }
    }
  }

  #isCurrentRequest(requestId: number, path: string): boolean {
    return requestId === this.#openRequestId && this.path === path;
  }

  async #applyBackendDecoded(
    decoded: DecodedImageWithUrl,
    requestId: number,
    path: string,
    resetTransform: boolean,
    useEnhanceSlot: boolean = false,
    preserveTransform: boolean = false,
  ): Promise<boolean> {
    await this.#decodeOffThread(decoded.url, requestId, useEnhanceSlot);
    if (!this.#isCurrentRequest(requestId, path)) {
      return false;
    }

    if (resetTransform) {
      this.#resetTransform();
    }

    if (preserveTransform) {
      // A seamless tier swap: the new derivative has different intrinsic pixels
      // than the one on screen, but the displayed size is `naturalSize × zoom`,
      // so rescale zoom by the long-edge ratio to keep the image visually fixed.
      // Pan is screen-space and stays valid. The host skips its re-fit.
      const prevLong = Math.max(this.naturalWidth, this.naturalHeight);
      const nextLong = Math.max(decoded.width, decoded.height);
      if (prevLong > 0 && nextLong > 0 && nextLong !== prevLong) {
        this.zoom = (this.zoom * prevLong) / nextLong;
      }
      this.#preserveTransformLoad = true;
    }

    this.source = decoded.url;
    this.samplePath = decoded.path;
    this.orientation = decoded.orientation;
    this.naturalWidth = decoded.width;
    this.naturalHeight = decoded.height;
    this.status = "ready";
    return true;
  }

  /**
   * After an instant RAW preview, swap in the sharper image. If this RAW was
   * already enhanced in a previous session (an enhanced cache file exists on
   * disk), that image is preferred — so reopening a RAW shows the enhanced
   * result rather than dropping back to the soft preview. Otherwise the capped
   * `display` image (the embedded preview, never a demosaic) is loaded and the
   * Enhance control is offered. On failure the preview is kept (non-fatal).
   */
  async #upgradeRaw(path: string, requestId: number): Promise<void> {
    // An enhance already running from before a navigate-away leaves the path in
    // the in-flight registry. Captured up front so we can re-attach to it below
    // even if it finishes (and clears the registry) during this upgrade's awaits.
    const enhanceWasInFlight = this.#inFlightPaths.has(path);
    try {
      // Prefer an already-cached enhanced image (no fresh demosaic is triggered
      // — `peek` only looks up the disk cache).
      const cachedEnhanced = await peekDecodedImage({ path, quality: "enhance" });
      if (!this.#isCurrentRequest(requestId, path)) {
        return;
      }
      if (cachedEnhanced) {
        const applied = await this.#applyBackendDecoded(
          cachedEnhanced,
          requestId,
          path,
          false,
        );
        if (applied) {
          this.enhanceAvailable = true;
          this.enhanced = true;
        }
        return;
      }

      const decoded = await decodeImage({ path, quality: "display" });
      if (!this.#isCurrentRequest(requestId, path)) {
        return;
      }

      const applied = await this.#applyBackendDecoded(
        decoded,
        requestId,
        path,
        false,
      );
      if (applied) {
        this.enhanceAvailable = true;
      }
    } catch (error) {
      if (!this.#isCurrentRequest(requestId, path)) {
        return;
      }
      // The preview is already shown, so a failed upgrade is non-fatal: keep the
      // preview rather than dropping to the error state.
      console.warn(`RAW display upgrade failed for ${path}`, error);
    } finally {
      if (this.#isCurrentRequest(requestId, path)) {
        this.upgrading = false;
        // Re-attach to an enhance that was still running when we navigated back:
        // re-issue it under the current request so its result is applied here and
        // the spinner clears. The backend single-flight joins the running job, so
        // no duplicate demosaic is started. If it already cached during our awaits
        // the re-issued request resolves instantly from cache.
        if (
          enhanceWasInFlight &&
          this.enhanceAvailable &&
          !this.enhanced &&
          !this.enhancing
        ) {
          void this.requestEnhance();
        }
      }
    }
  }

  /**
   * Load a filesystem path through the frontend format-routing rules.
   *
   * Native formats (JPEG/PNG/GIF/WebP) are handed straight to the WebView via
   * `convertFileSrc` — no backend round-trip. Every other supported format is
   * decoded by the Rust `decode_image` command, which writes a cache file and
   * returns its path (resolved to an asset URL) plus intrinsic dimensions and
   * EXIF orientation. RAW files paint an instant preview first, then upgrade to
   * the capped display image. On decode failure the viewer transitions to the
   * error status.
   */
  async openPath(path: string): Promise<void> {
    const requestId = ++this.#openRequestId;
    this.#cancelPendingDecode();
    const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Image";
    this.path = path;
    this.name = name;
    this.status = "loading";
    this.errorReason = null;
    this.upgrading = false;
    this.#preserveTransformLoad = false;
    this.#resetEnhanceState();
    this.#resetSharpenState();

    try {
      if (isNativeFormat(path)) {
        // Probe header dimensions first so over-ceiling native files are refused
        // without a full WebView decode, and large native images are routed
        // through the backend display cap rather than expanding to a giant
        // bitmap in the WebView. Animated GIF/WebP always render directly.
        const probed = await probeImage({ path });
        if (!this.#isCurrentRequest(requestId, path)) {
          return;
        }
        if (probed.exceedsLimit) {
          this.setError("limit");
          return;
        }

        if (!probed.animated && probed.pixels > NATIVE_ROUTING_PIXELS) {
          await this.#openPrimaryDisplay(path, requestId);
          return;
        }

        const source = convertFileSrc(path);
        const decoded = await this.#decodeOffThread(source, requestId);
        if (!this.#isCurrentRequest(requestId, path)) {
          return;
        }
        this.#resetTransform();
        this.source = source;
        this.samplePath = path;
        this.setReady(decoded.width, decoded.height);
        return;
      }

      if (isRawFormat(path)) {
        const preview = await decodeImage({ path, quality: "preview" });
        const applied = await this.#applyBackendDecoded(
          preview,
          requestId,
          path,
          true,
        );
        if (!applied) {
          return;
        }

        this.upgrading = true;
        void this.#upgradeRaw(path, requestId);
        return;
      }

      await this.#openPrimaryDisplay(path, requestId);
    } catch (error) {
      if (!this.#isCurrentRequest(requestId, path)) {
        return;
      }
      this.setError(isTooLargeError(error) ? "limit" : "corrupt");
    }
  }

  /**
   * Open a primary (non-RAW / native-routed) image through the backend display
   * pipeline, sized to the viewport tier. Records the tier cap so an on-zoom
   * upgrade can fetch the sharper (8192) tier when needed. The heavy decode is
   * registered in the in-flight path set so a navigate-back re-shows the loading
   * indicator while the (single-flighted) decode is still running.
   */
  async #openPrimaryDisplay(path: string, requestId: number): Promise<void> {
    const viewport = this.#viewportHint();
    this.#inFlightPaths.add(path);
    try {
      const decoded = await decodeImage({
        path,
        quality: "display",
        priority: "currentImage",
        generation: requestId,
        viewport,
      });
      const applied = await this.#applyBackendDecoded(
        decoded,
        requestId,
        path,
        true,
      );
      if (applied) {
        this.#currentTierLongEdge = viewport
          ? bucketTierCap(viewport.longEdgePx * viewport.dpr)
          : DISPLAY_LONG_EDGE_CAP;
        this.#sharperTierRequested =
          this.#currentTierLongEdge >= DISPLAY_LONG_EDGE_CAP;
      }
    } finally {
      this.#inFlightPaths.delete(path);
    }
  }

  /**
   * Fetch the sharper (8192) display tier and swap it in. Triggered by the host
   * when a zoom-in pushes the displayed resolution past the current tier's cap.
   * Drives the `sharpening` flag (consumed by the debounced pill). No-ops when
   * already at/above the max tier, mid-fetch, or not showing a backend image.
   *
   * `displayedLongEdgeDevicePx` is the on-screen long edge in device pixels; the
   * upgrade is skipped when it does not exceed the current tier (e.g. zoom-out).
   */
  async maybeUpgradeTier(displayedLongEdgeDevicePx: number): Promise<void> {
    const path = this.path;
    if (
      path === null ||
      this.status !== "ready" ||
      this.#sharperTierRequested ||
      this.#currentTierLongEdge <= 0 ||
      this.#currentTierLongEdge >= DISPLAY_LONG_EDGE_CAP
    ) {
      return;
    }
    if (displayedLongEdgeDevicePx <= this.#currentTierLongEdge) {
      return;
    }

    const requestId = this.#openRequestId;
    this.#sharperTierRequested = true;
    this.sharpening = true;
    this.#inFlightPaths.add(path);
    try {
      const decoded = await decodeImage({
        path,
        quality: "display",
        priority: "currentImage",
        generation: requestId,
        viewport: { longEdgePx: DISPLAY_LONG_EDGE_CAP, dpr: 1 },
      });
      if (!this.#isCurrentRequest(requestId, path)) {
        return;
      }
      const applied = await this.#applyBackendDecoded(
        decoded,
        requestId,
        path,
        false,
        false,
        true,
      );
      if (applied) {
        this.#currentTierLongEdge = DISPLAY_LONG_EDGE_CAP;
      }
    } catch (error) {
      // A failed upgrade is non-fatal: the current tier stays up. Allow a later
      // retry by clearing the requested flag.
      if (this.#isCurrentRequest(requestId, path)) {
        this.#sharperTierRequested = false;
      }
      console.warn(`Sharper-tier upgrade failed for ${path}`, error);
    } finally {
      this.#inFlightPaths.delete(path);
      if (this.#isCurrentRequest(requestId, path)) {
        this.sharpening = false;
      }
    }
  }

  /** Record intrinsic dimensions and mark the image ready to display. */
  setReady(naturalWidth: number, naturalHeight: number): void {
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;
    this.status = "ready";
    this.errorReason = null;
  }

  /**
   * Mark the current load as failed. `reason` defaults to `"corrupt"` (a generic
   * decode failure); pass `"limit"` for an over-ceiling file so the viewer can
   * surface the dedicated too-large state.
   */
  setError(reason: ViewerErrorReason = "corrupt"): void {
    this.status = "error";
    this.errorReason = reason;
  }

  /**
   * Rotate the display by `delta` degrees (a multiple of 90), wrapping within
   * the 0/90/180/270 cycle. Rotation is display-only (a CSS transform composed
   * by `ImageViewer`); the underlying pixels are never re-encoded.
   */
  private rotateBy(delta: number): void {
    const next = (((this.rotation + delta) % 360) + 360) % 360;
    this.rotation = next as Rotation;
  }

  /** Rotate 90° counter-clockwise (wraps 0 → 270). */
  rotateLeft(): void {
    this.rotateBy(-90);
  }

  /** Rotate 90° clockwise (wraps 270 → 0). */
  rotateRight(): void {
    this.rotateBy(90);
  }

  /**
   * Opt into the heavier "Enhance" RAW decode: a one-time full sensor demosaic,
   * downscaled to the display cap and encoded as JPEG. Flags `enhancing` while
   * the decode runs, then swaps `source` to the enhanced image and sets
   * `enhanced`. A superseded request (navigation) is never applied; a failure
   * surfaces `enhanceError` and leaves the current display image up.
   */
  async requestEnhance(): Promise<void> {
    if (this.upgrading) {
      return;
    }

    const path = this.path;
    if (
      path === null ||
      !this.enhanceAvailable ||
      this.enhancing ||
      this.enhanced
    ) {
      return;
    }

    const requestId = this.#openRequestId;
    this.enhancing = true;
    this.enhanceError = false;
    this.#inFlightPaths.add(path);

    try {
      const decoded = await decodeImage({
        path,
        quality: "enhance",
        priority: "currentImage",
        generation: requestId,
      });
      if (!this.#isCurrentRequest(requestId, path)) {
        return;
      }

      const applied = await this.#applyBackendDecoded(
        decoded,
        requestId,
        path,
        false,
        true,
      );
      if (applied) {
        this.enhanced = true;
      } else if (this.#isCurrentRequest(requestId, path)) {
        // `applied === false` can mean the request was superseded by navigation;
        // only surface an error if this is still the current image.
        this.enhanceError = true;
      }
    } catch (error) {
      if (!this.#isCurrentRequest(requestId, path)) {
        return;
      }
      this.enhanceError = true;
      console.warn(`Enhance RAW decode failed for ${path}`, error);
    } finally {
      this.#inFlightPaths.delete(path);
      if (this.#isCurrentRequest(requestId, path)) {
        this.enhancing = false;
      }
    }
  }

  /** Clear the viewer back to the empty state. */
  reset(): void {
    this.#openRequestId += 1;
    this.#cancelPendingDecode();
    this.#resetTransform();
    this.upgrading = false;
    this.#resetEnhanceState();
    this.#resetSharpenState();
    this.path = null;
    this.samplePath = null;
    this.source = "";
    this.name = null;
    this.status = "idle";
    this.errorReason = null;
  }
}

export const viewer = new ViewerStore();
