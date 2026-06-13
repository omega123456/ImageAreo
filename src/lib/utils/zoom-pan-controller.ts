/**
 * Hand-rolled zoom/pan controller.
 *
 * Drives the viewer store's `zoom`, `pan` and `fitMode` from pointer and wheel
 * input. The smooth cursor-anchored wheel zoom is the centerpiece: each pixel
 * of wheel delta multiplies the zoom by a factor very close to 1, so the result
 * is continuous and fine-grained rather than coarse fixed steps. The cursor
 * point is kept stationary by adjusting the pan offset.
 *
 * Discrete actions (`+`/`−`, fit, actual size) animate via an eased JS tween and
 * signal the host component (through `onTransition`) so it can suppress the
 * controller's direct updates from fighting a CSS transition — here we tween in
 * JS so the same render path applies throughout.
 *
 * The single permitted inline-style use (the `scale`/`translate` transform) is
 * applied by the host `ImageViewer` component from the store values this
 * controller writes.
 */

import { clamp, easeOutCubic, easeOutQuint, lerp } from "./easing";
import type { FitMode, Pan, Rotation, ViewerStatus } from "../stores/viewer.svelte";

export interface ViewerLike {
  naturalWidth: number;
  naturalHeight: number;
  zoom: number;
  pan: Pan;
  rotation: Rotation;
  /** EXIF orientation (1–8) applied as a display transform by `ImageViewer`. */
  orientation: number;
  fitMode: FitMode;
  status: ViewerStatus;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 20.0;

/** Multiplicative zoom per pixel of wheel delta — tuned for a smooth feel. */
const WHEEL_FACTOR_PER_PIXEL = 1.0015;
/** Discrete `+`/`−` step (≈ +22% / −18%). */
const STEP_FACTOR = 1.22;
/** Duration of an eased discrete zoom tween, in ms. */
const STEP_DURATION = 180;
/** Maximum momentum animation duration, in ms. */
const MOMENTUM_DURATION = 450;
/** Velocity below this (px/ms) on release does not trigger momentum. */
const MOMENTUM_MIN_VELOCITY = 0.05;
/**
 * Dimensionless coefficient applied to the release velocity (px/ms) to
 * determine the momentum throw distance in pixels.
 */
const MOMENTUM_COEFF = 120;

type Now = () => number;
type Raf = (cb: (t: number) => void) => number;
type CancelRaf = (handle: number) => void;

export interface ControllerDeps {
  now?: Now;
  requestFrame?: Raf;
  cancelFrame?: CancelRaf;
}

export class ZoomPanController {
  private container: HTMLElement;
  private viewer: ViewerLike;
  private now: Now;
  private requestFrame: Raf;
  private cancelFrame: CancelRaf;

  private animationHandle: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /**
   * Height (px) of floating chrome overlapping the bottom of the canvas (the
   * filmstrip). The canvas itself is full-height so zoomed/panned images render
   * behind the translucent strip, but "fit" reserves this inset so a fitted
   * image stays fully visible above the strip.
   */
  private bottomInset = 0;

  // Drag tracking.
  private dragging = false;
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private lastTime = 0;
  private velX = 0;
  private velY = 0;

  private detachers: Array<() => void> = [];

  constructor(container: HTMLElement, viewer: ViewerLike, deps: ControllerDeps = {}) {
    this.container = container;
    this.viewer = viewer;
    this.now = deps.now ?? (() => performance.now());
    this.requestFrame =
      deps.requestFrame ?? ((cb) => requestAnimationFrame(cb));
    this.cancelFrame = deps.cancelFrame ?? ((h) => cancelAnimationFrame(h));

    this.attach();
  }

  private attach(): void {
    const wheel = (e: WheelEvent) => this.onWheel(e);
    const pointerDown = (e: PointerEvent) => this.onPointerDown(e);
    const pointerMove = (e: PointerEvent) => this.onPointerMove(e);
    const pointerUp = (e: PointerEvent) => this.onPointerUp(e);

    this.container.addEventListener("wheel", wheel, { passive: false });
    this.container.addEventListener("pointerdown", pointerDown);
    this.container.addEventListener("pointermove", pointerMove);
    this.container.addEventListener("pointerup", pointerUp);
    this.container.addEventListener("pointercancel", pointerUp);

    this.detachers = [
      () => this.container.removeEventListener("wheel", wheel),
      () => this.container.removeEventListener("pointerdown", pointerDown),
      () => this.container.removeEventListener("pointermove", pointerMove),
      () => this.container.removeEventListener("pointerup", pointerUp),
      () => this.container.removeEventListener("pointercancel", pointerUp),
    ];

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.container);
      this.detachers.push(() => {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
      });
    }
  }

  /** Detach all listeners and stop any running animation. */
  destroy(): void {
    this.stopAnimation();
    for (const off of this.detachers) off();
    this.detachers = [];
  }

  /**
   * Keep the view consistent when the container size changes (window resize,
   * fullscreen toggle, chrome show/hide). In fit mode the image is re-fitted to
   * the new bounds so it grows/shrinks with the window; otherwise the pan is
   * re-clamped so a smaller container cannot leave the image stranded off-edge.
   */
  handleResize(): void {
    if (this.viewer.status !== "ready") return;
    if (this.viewer.fitMode === "fit") {
      this.refit();
      return;
    }
    this.viewer.pan = this.clampPan(this.viewer.pan);
  }

  /**
   * Set the bottom chrome inset and, when currently fitted, re-fit so the image
   * stays centered in the area above the strip as the strip appears/resizes.
   */
  setBottomInset(px: number): void {
    if (px === this.bottomInset) return;
    this.bottomInset = px;
    if (this.viewer.status === "ready" && this.viewer.fitMode === "fit") {
      this.refit();
    }
  }

  /** Re-fit the image to the area above the bottom inset, centered in it. */
  private refit(): void {
    this.stopAnimation();
    this.viewer.zoom = this.clampZoom(this.fitZoom());
    this.viewer.pan = { x: 0, y: this.bottomInset ? -this.bottomInset / 2 : 0 };
  }

  // ---- Geometry helpers -------------------------------------------------

  private containerSize(): { width: number; height: number } {
    const rect = this.container.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  /**
   * The image's on-screen dimensions, accounting for the quarter-turns applied
   * by EXIF orientation and the user's rotation. A single quarter-turn (90°/270°)
   * swaps width and height; two quarter-turns cancel. Without this, the fit and
   * pan-clamp math would treat a rotated portrait image as if it were landscape.
   */
  private effectiveDimensions(): { width: number; height: number } {
    const { naturalWidth, naturalHeight, orientation, rotation } = this.viewer;
    const orientationSwaps = orientation >= 5 && orientation <= 8;
    const rotationSwaps = rotation === 90 || rotation === 270;
    if (orientationSwaps !== rotationSwaps) {
      return { width: naturalHeight, height: naturalWidth };
    }
    return { width: naturalWidth, height: naturalHeight };
  }

  /** The zoom factor that fits the image inside the container. */
  fitZoom(): number {
    const { width: imageWidth, height: imageHeight } = this.effectiveDimensions();
    if (imageWidth <= 0 || imageHeight <= 0) return 1;
    const { width, height } = this.containerSize();
    const fitHeight = height - this.bottomInset;
    if (width <= 0 || fitHeight <= 0) return 1;
    return Math.min(width / imageWidth, fitHeight / imageHeight);
  }

  private clampZoom(z: number): number {
    return clamp(z, MIN_ZOOM, MAX_ZOOM);
  }

  /**
   * The image's currently-displayed long edge in *device* pixels — the on-screen
   * resolution the user is actually viewing. Used by the viewer store to decide
   * whether the current display tier still has enough pixels or whether a
   * sharper tier should be fetched (#5 on-zoom upgrade).
   *
   * Returns the larger of the two scaled, orientation-aware dimensions times the
   * device pixel ratio. Zero when no image is loaded.
   */
  displayedLongEdgeDevicePx(): number {
    const { width, height } = this.effectiveDimensions();
    const longEdge = Math.max(width, height);
    if (longEdge <= 0) return 0;
    const dpr =
      typeof window !== "undefined" && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
    return longEdge * this.viewer.zoom * dpr;
  }

  /**
   * Constrain a pan offset so the scaled image cannot be flung entirely out of
   * the container (ImageGlass-style edge-bounding). The image is centered at the
   * origin, so pan is measured from center. On each axis: when the scaled
   * dimension fits within the container, clamp to centered (0); otherwise allow
   * the offset to range so the image edge stops at the container edge.
   */
  private clampPan(pan: Pan): Pan {
    const { zoom } = this.viewer;
    const { width: imageWidth, height: imageHeight } = this.effectiveDimensions();
    const { width, height } = this.containerSize();
    const scaledW = imageWidth * zoom;
    const scaledH = imageHeight * zoom;

    const clampAxis = (offset: number, scaled: number, container: number): number => {
      if (scaled <= container) return 0;
      const max = (scaled - container) / 2;
      return clamp(offset, -max, max);
    };

    return {
      x: clampAxis(pan.x, scaledW, width),
      y: clampAxis(pan.y, scaledH, height),
    };
  }

  // ---- Wheel zoom (continuous, cursor-anchored) -------------------------

  private onWheel(e: WheelEvent): void {
    if (this.viewer.status !== "ready") return;
    e.preventDefault();
    this.stopAnimation();

    const oldZoom = this.viewer.zoom;
    // Negative deltaY (scroll up) zooms in.
    const factor = Math.pow(WHEEL_FACTOR_PER_PIXEL, -e.deltaY);
    const newZoom = this.clampZoom(oldZoom * factor);
    if (newZoom === oldZoom) return;

    const rect = this.container.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    this.applyZoomAnchored(newZoom, cursorX, cursorY);
    this.viewer.fitMode = "free";
  }

  /**
   * Set zoom while keeping the container point (ax, ay) fixed on the image.
   * The image is centered in the container at the origin, then panned.
   */
  private applyZoomAnchored(newZoom: number, ax: number, ay: number): void {
    const { width, height } = this.containerSize();
    const cx = width / 2;
    const cy = height / 2;
    const oldZoom = this.viewer.zoom;
    const { x: px, y: py } = this.viewer.pan;

    // Image-space offset of the anchor point under the old transform.
    const imgX = (ax - cx - px) / oldZoom;
    const imgY = (ay - cy - py) / oldZoom;

    // Solve for the new pan that keeps (imgX, imgY) under (ax, ay).
    const newPanX = ax - cx - imgX * newZoom;
    const newPanY = ay - cy - imgY * newZoom;

    this.viewer.zoom = newZoom;
    this.viewer.pan = this.clampPan({ x: newPanX, y: newPanY });
  }

  // ---- Discrete eased zoom ---------------------------------------------

  zoomIn(): void {
    this.stepZoom(STEP_FACTOR);
  }

  zoomOut(): void {
    this.stepZoom(1 / STEP_FACTOR);
  }

  private stepZoom(factor: number): void {
    if (this.viewer.status !== "ready") return;
    const target = this.clampZoom(this.viewer.zoom * factor);
    const { width, height } = this.containerSize();
    // Anchor a discrete step at the container center.
    this.animateZoomTo(target, width / 2, height / 2);
    this.viewer.fitMode = "free";
  }

  private animateZoomTo(target: number, ax: number, ay: number): void {
    this.stopAnimation();
    const startZoom = this.viewer.zoom;
    const startPan = { ...this.viewer.pan };

    // Precompute the destination pan for the anchored target zoom.
    const { width, height } = this.containerSize();
    const cx = width / 2;
    const cy = height / 2;
    const imgX = (ax - cx - startPan.x) / startZoom;
    const imgY = (ay - cy - startPan.y) / startZoom;
    const endPanX = ax - cx - imgX * target;
    const endPanY = ay - cy - imgY * target;

    const start = this.now();
    const tick = (t: number) => {
      const progress = clamp((t - start) / STEP_DURATION, 0, 1);
      const e = easeOutCubic(progress);
      this.viewer.zoom = lerp(startZoom, target, e);
      this.viewer.pan = {
        x: lerp(startPan.x, endPanX, e),
        y: lerp(startPan.y, endPanY, e),
      };
      if (progress < 1) {
        this.animationHandle = this.requestFrame(tick);
      } else {
        this.animationHandle = null;
      }
    };
    this.animationHandle = this.requestFrame(tick);
  }

  // ---- Fit / actual size ------------------------------------------------

  /** Scale to fill the container preserving aspect; reset pan to center. */
  fitToScreen(): void {
    if (this.viewer.status !== "ready") return;
    this.refit();
    this.viewer.fitMode = "fit";
  }

  /** 100% zoom, centered. */
  setActualSize(): void {
    if (this.viewer.status !== "ready") return;
    this.stopAnimation();
    this.viewer.zoom = this.clampZoom(1);
    this.viewer.pan = { x: 0, y: 0 };
    this.viewer.fitMode = "actual";
  }

  // ---- Drag pan with momentum ------------------------------------------

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || this.viewer.status !== "ready") return;
    this.stopAnimation();
    this.dragging = true;
    this.pointerId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastTime = this.now();
    this.velX = 0;
    this.velY = 0;
    if (typeof this.container.setPointerCapture === "function") {
      this.container.setPointerCapture(e.pointerId);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging || e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    const t = this.now();
    const dt = t - this.lastTime;
    if (dt > 0) {
      this.velX = dx / dt;
      this.velY = dy / dt;
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastTime = t;

    this.viewer.pan = this.clampPan({
      x: this.viewer.pan.x + dx,
      y: this.viewer.pan.y + dy,
    });
    this.viewer.fitMode = "free";
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.dragging || e.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
    if (typeof this.container.releasePointerCapture === "function") {
      try {
        this.container.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer may already be released; ignore.
      }
    }
    this.applyMomentum();
  }

  private applyMomentum(): void {
    const speed = Math.hypot(this.velX, this.velY);
    if (speed < MOMENTUM_MIN_VELOCITY) return;

    const startPan = { ...this.viewer.pan };
    const endPanX = startPan.x + this.velX * MOMENTUM_COEFF;
    const endPanY = startPan.y + this.velY * MOMENTUM_COEFF;
    const start = this.now();

    const tick = (t: number) => {
      const progress = clamp((t - start) / MOMENTUM_DURATION, 0, 1);
      const e = easeOutQuint(progress);
      this.viewer.pan = this.clampPan({
        x: lerp(startPan.x, endPanX, e),
        y: lerp(startPan.y, endPanY, e),
      });
      if (progress < 1) {
        this.animationHandle = this.requestFrame(tick);
      } else {
        this.animationHandle = null;
      }
    };
    this.animationHandle = this.requestFrame(tick);
  }

  // ---- Animation lifecycle ---------------------------------------------

  private stopAnimation(): void {
    if (this.animationHandle !== null) {
      this.cancelFrame(this.animationHandle);
      this.animationHandle = null;
    }
  }
}
