/**
 * Viewer state store (Svelte 5 runes).
 *
 * Holds the current image source and the live view transform (zoom/pan/
 * rotation/fit-mode) plus load status. The zoom/pan controller mutates `zoom`
 * and `pan`; components read this store to drive the `<img>` transform and the
 * zoom HUD. Later phases (P8/P9/P11/P14) extend this module — do not rewrite it.
 */

export type FitMode = "fit" | "actual" | "free";
export type ViewerStatus = "idle" | "loading" | "ready" | "error";
export type Rotation = 0 | 90 | 180 | 270;

export interface Pan {
  x: number;
  y: number;
}

class ViewerStore {
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
  /** Display rotation in degrees. */
  rotation = $state<Rotation>(0);
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
    this.fitMode = "fit";
  }

  /** Begin loading a new source; resets the transform to a centered fit. */
  load(source: string, name?: string): void {
    this.resetTransform();
    this.source = source;
    this.name = name ?? null;
    this.status = "loading";
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

  /** Clear the viewer back to the empty state. */
  reset(): void {
    this.resetTransform();
    this.source = "";
    this.name = null;
    this.status = "idle";
  }
}

export const viewer = new ViewerStore();
