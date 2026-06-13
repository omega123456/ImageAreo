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

import { decodeImage, peekDecodedImage } from "../ipc";
import type { DecodedImageWithUrl } from "../ipc";
import { isNativeFormat, isRawFormat } from "../utils/format";

export type FitMode = "fit" | "actual" | "free";
export type ViewerStatus = "idle" | "loading" | "ready" | "error";
export type Rotation = 0 | 90 | 180 | 270;

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

  /** Clear all Enhance lifecycle state. */
  #resetEnhanceState(): void {
    this.enhanceAvailable = false;
    this.enhancing = false;
    this.enhanced = false;
    this.enhanceError = false;
    this.#cancelPendingEnhanceDecode();
  }

  /** Reset the view transform and intrinsic dimensions to their defaults. */
  private resetTransform(): void {
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.rotation = 0;
    this.orientation = 1;
    this.fitMode = "fit";
  }

  /** Begin loading a new source; resets the transform to a centered fit. */
  load(source: string, name?: string): void {
    this.#openRequestId += 1;
    this.#cancelPendingDecode();
    this.resetTransform();
    this.upgrading = false;
    this.#resetEnhanceState();
    this.source = source;
    this.samplePath = null;
    this.name = name ?? null;
    this.status = "loading";
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
  ): Promise<boolean> {
    await this.#decodeOffThread(decoded.url, requestId, useEnhanceSlot);
    if (!this.#isCurrentRequest(requestId, path)) {
      return false;
    }

    if (resetTransform) {
      this.resetTransform();
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
    this.upgrading = false;
    this.#resetEnhanceState();

    try {
      if (isNativeFormat(path)) {
        const source = convertFileSrc(path);
        const decoded = await this.#decodeOffThread(source, requestId);
        if (!this.#isCurrentRequest(requestId, path)) {
          return;
        }
        this.resetTransform();
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

      const decoded = await decodeImage({ path, quality: "display" });
      await this.#applyBackendDecoded(decoded, requestId, path, true);
    } catch {
      if (!this.#isCurrentRequest(requestId, path)) {
        return;
      }
      this.setError();
    }
  }

  /** Record intrinsic dimensions and mark the image ready to display. */
  setReady(naturalWidth: number, naturalHeight: number): void {
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;
    this.status = "ready";
  }

  /** Mark the current load as failed. */
  setError(): void {
    this.status = "error";
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

    try {
      const decoded = await decodeImage({ path, quality: "enhance" });
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
      if (this.#isCurrentRequest(requestId, path)) {
        this.enhancing = false;
      }
    }
  }

  /** Clear the viewer back to the empty state. */
  reset(): void {
    this.#openRequestId += 1;
    this.#cancelPendingDecode();
    this.resetTransform();
    this.upgrading = false;
    this.#resetEnhanceState();
    this.path = null;
    this.samplePath = null;
    this.source = "";
    this.name = null;
    this.status = "idle";
  }
}

export const viewer = new ViewerStore();
