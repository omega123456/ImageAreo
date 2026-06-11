/**
 * Viewer state store (Svelte 5 runes).
 *
 * Holds the current image source and the live view transform (zoom/pan/
 * rotation/fit-mode) plus load status. The zoom/pan controller mutates `zoom`
 * and `pan`; components read this store to drive the `<img>` transform and the
 * zoom HUD. Later phases (P8/P9/P11/P14) extend this module — do not rewrite it.
 */

import { convertFileSrc } from "@tauri-apps/api/core";

import { decodeImage } from "../ipc";
import { isNativeFormat } from "../utils/format";

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

  /** Original filesystem path of the loaded image, when present. */
  path = $state<string | null>(null);
  /** Resolved image source (asset URL for native; data URL for backend in P9). */
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
    this.source = source;
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

  /**
   * Decode an image source off the main render path before swapping it into the
   * visible `<img>`, so the loading state can paint immediately.
   */
  async #decodeOffThread(
    source: string,
    requestId: number,
  ): Promise<{ width: number; height: number }> {
    const img = new Image();
    this.#pendingDecodeImage = img;
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
      if (this.#pendingDecodeImage === img) {
        this.#pendingDecodeImage = null;
      }
    }
  }

  /**
   * Load a filesystem path through the frontend format-routing rules.
   *
   * Native formats (JPEG/PNG/GIF/WebP) are handed straight to the WebView via
   * `convertFileSrc` — no backend round-trip. Every other supported format is
   * decoded by the Rust `decode_image` command, which returns a data URL plus
   * intrinsic dimensions and EXIF orientation. On decode failure the viewer
   * transitions to the error status.
   */
  async openPath(path: string): Promise<void> {
    const requestId = ++this.#openRequestId;
    this.#cancelPendingDecode();
    const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Image";
    this.path = path;
    this.name = name;
    this.status = "loading";

    try {
      if (isNativeFormat(path)) {
        const source = convertFileSrc(path);
        const decoded = await this.#decodeOffThread(source, requestId);
        if (requestId !== this.#openRequestId || this.path !== path) {
          return;
        }
        this.resetTransform();
        this.source = source;
        this.setReady(decoded.width, decoded.height);
        return;
      }

      const decoded = await decodeImage({ path });
      if (requestId !== this.#openRequestId || this.path !== path) {
        return;
      }

      await this.#decodeOffThread(decoded.dataUrl, requestId);
      if (requestId !== this.#openRequestId || this.path !== path) {
        return;
      }

      this.resetTransform();
      this.source = decoded.dataUrl;
      this.orientation = decoded.orientation;
      this.setReady(decoded.width, decoded.height);
    } catch {
      if (requestId !== this.#openRequestId || this.path !== path) {
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

  /** Clear the viewer back to the empty state. */
  reset(): void {
    this.#openRequestId += 1;
    this.#cancelPendingDecode();
    this.resetTransform();
    this.path = null;
    this.source = "";
    this.name = null;
    this.status = "idle";
  }
}

export const viewer = new ViewerStore();
