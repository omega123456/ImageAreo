import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ZoomPanController,
  MIN_ZOOM,
  MAX_ZOOM,
  type ViewerLike,
  type ControllerDeps,
} from "../lib/utils/zoom-pan-controller";

const CONTAINER_W = 400;
const CONTAINER_H = 300;

function makeViewer(overrides: Partial<ViewerLike> = {}): ViewerLike {
  return {
    naturalWidth: 800,
    naturalHeight: 600,
    zoom: 1,
    pan: { x: 0, y: 0 },
    rotation: 0,
    orientation: 1,
    fitMode: "fit",
    status: "ready",
    ...overrides,
  };
}

/**
 * A controllable rAF stub: frames are queued and flushed manually so animated
 * tweens run deterministically. `now()` is driven by a manually advanced clock.
 */
function makeDeps() {
  let clock = 0;
  const queue: Array<(t: number) => void> = [];
  const deps: ControllerDeps = {
    now: () => clock,
    requestFrame: (cb) => {
      queue.push(cb);
      return queue.length; // non-zero handle
    },
    cancelFrame: vi.fn(),
  };
  return {
    deps,
    advance(ms: number): void {
      clock += ms;
    },
    /** Flush all currently-queued frames once at the current clock. */
    flush(): void {
      const pending = queue.splice(0);
      for (const cb of pending) cb(clock);
    },
    /** Run frames until the queue drains, advancing the clock each step. */
    run(stepMs = 30, maxSteps = 100): void {
      let steps = 0;
      while (queue.length > 0 && steps < maxSteps) {
        clock += stepMs;
        const pending = queue.splice(0);
        for (const cb of pending) cb(clock);
        steps += 1;
      }
    },
  };
}

function makeContainer(): HTMLDivElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: CONTAINER_W,
      bottom: CONTAINER_H,
      width: CONTAINER_W,
      height: CONTAINER_H,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe("ZoomPanController", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = makeContainer();
  });

  it("computes a fit zoom that fits the image in the container", () => {
    const viewer = makeViewer();
    const c = new ZoomPanController(container, viewer);
    // min(400/800, 300/600) = 0.5
    expect(c.fitZoom()).toBeCloseTo(0.5);
    c.destroy();
  });

  it("fitZoom swaps width/height for a 90°/270° EXIF orientation", () => {
    // Orientation 8 (rotate 270) turns the 800x600 image into a 600x800 display
    // image, so the fit must use the swapped dimensions:
    // min(400/600, 300/800) = 0.375, not the unrotated 0.5.
    const viewer = makeViewer({ orientation: 8 });
    const c = new ZoomPanController(container, viewer);
    expect(c.fitZoom()).toBeCloseTo(0.375);
    c.destroy();
  });

  it("fitZoom swaps width/height for a 90° user rotation", () => {
    const viewer = makeViewer({ rotation: 90 });
    const c = new ZoomPanController(container, viewer);
    expect(c.fitZoom()).toBeCloseTo(0.375);
    c.destroy();
  });

  it("fitZoom: a 90° orientation and a 90° rotation cancel out", () => {
    // Two quarter-turns return the image to its original landscape aspect.
    const viewer = makeViewer({ orientation: 8, rotation: 90 });
    const c = new ZoomPanController(container, viewer);
    expect(c.fitZoom()).toBeCloseTo(0.5);
    c.destroy();
  });

  it("fitZoom returns 1 when image or container has no size", () => {
    const c1 = new ZoomPanController(
      container,
      makeViewer({ naturalWidth: 0 }),
    );
    expect(c1.fitZoom()).toBe(1);
    c1.destroy();

    const empty = document.createElement("div");
    empty.getBoundingClientRect = () =>
      ({ width: 0, height: 0, left: 0, top: 0 }) as DOMRect;
    const c2 = new ZoomPanController(empty, makeViewer());
    expect(c2.fitZoom()).toBe(1);
    c2.destroy();
  });

  it("fitToScreen sets fit zoom, centers pan and marks fitMode", () => {
    const viewer = makeViewer({ zoom: 4, pan: { x: 30, y: 30 }, fitMode: "free" });
    const c = new ZoomPanController(container, viewer);
    c.fitToScreen();
    expect(viewer.zoom).toBeCloseTo(0.5);
    expect(viewer.pan).toEqual({ x: 0, y: 0 });
    expect(viewer.fitMode).toBe("fit");
    c.destroy();
  });

  it("setActualSize goes to 100% centered", () => {
    const viewer = makeViewer({ zoom: 0.5, fitMode: "fit" });
    const c = new ZoomPanController(container, viewer);
    c.setActualSize();
    expect(viewer.zoom).toBe(1);
    expect(viewer.pan).toEqual({ x: 0, y: 0 });
    expect(viewer.fitMode).toBe("actual");
    c.destroy();
  });

  it("applyInitialFit fits an image larger than the container", () => {
    // 800x600 in a 400x300 container: fitZoom 0.5 < 1, so it must fit, not 1:1.
    const viewer = makeViewer({ zoom: 4, fitMode: "free" });
    const c = new ZoomPanController(container, viewer);
    c.applyInitialFit();
    expect(viewer.zoom).toBeCloseTo(0.5);
    expect(viewer.pan).toEqual({ x: 0, y: 0 });
    expect(viewer.fitMode).toBe("fit");
    c.destroy();
  });

  it("applyInitialFit shows a small image at real (100%) size", () => {
    // 200x150 fits inside the 400x300 container (fitZoom 2 >= 1), so show 1:1
    // rather than upscaling it to fill the window.
    const viewer = makeViewer({
      naturalWidth: 200,
      naturalHeight: 150,
      zoom: 0.5,
      fitMode: "fit",
    });
    const c = new ZoomPanController(container, viewer);
    c.applyInitialFit();
    expect(viewer.zoom).toBe(1);
    expect(viewer.pan).toEqual({ x: 0, y: 0 });
    expect(viewer.fitMode).toBe("actual");
    c.destroy();
  });

  it("applyInitialFit ignores a non-ready viewer", () => {
    const viewer = makeViewer({ status: "loading", zoom: 3, fitMode: "free" });
    const c = new ZoomPanController(container, viewer);
    c.applyInitialFit();
    expect(viewer.zoom).toBe(3);
    expect(viewer.fitMode).toBe("free");
    c.destroy();
  });

  it("ignores actions when status is not ready", () => {
    const viewer = makeViewer({ status: "loading", zoom: 1 });
    const c = new ZoomPanController(container, viewer);
    c.fitToScreen();
    c.setActualSize();
    c.zoomIn();
    c.zoomOut();
    expect(viewer.zoom).toBe(1);
    expect(viewer.fitMode).toBe("fit");
    c.destroy();
  });

  it("wheel zoom is continuous, cursor-anchored and sets fitMode free", () => {
    const viewer = makeViewer({ zoom: 1 });
    const c = new ZoomPanController(container, viewer);
    const before = viewer.zoom;
    container.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        clientX: 200,
        clientY: 150,
        cancelable: true,
      }),
    );
    expect(viewer.zoom).toBeGreaterThan(before);
    expect(viewer.fitMode).toBe("free");
    c.destroy();
  });

  it("wheel zoom anchored at the center leaves pan centered", () => {
    const viewer = makeViewer({ zoom: 1 });
    const c = new ZoomPanController(container, viewer);
    // Anchor at the exact container center => pan stays at origin.
    container.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        clientX: CONTAINER_W / 2,
        clientY: CONTAINER_H / 2,
        cancelable: true,
      }),
    );
    expect(viewer.pan.x).toBeCloseTo(0);
    expect(viewer.pan.y).toBeCloseTo(0);
    c.destroy();
  });

  it("wheel zoom does nothing when not ready", () => {
    const viewer = makeViewer({ status: "error", zoom: 1 });
    const c = new ZoomPanController(container, viewer);
    container.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, cancelable: true }),
    );
    expect(viewer.zoom).toBe(1);
    c.destroy();
  });

  it("wheel zoom clamps to MAX_ZOOM and stops at the bound", () => {
    const viewer = makeViewer({ zoom: MAX_ZOOM });
    const c = new ZoomPanController(container, viewer);
    container.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -500, cancelable: true }),
    );
    expect(viewer.zoom).toBe(MAX_ZOOM);
    c.destroy();
  });

  it("wheel zoom clamps to MIN_ZOOM when zooming out hard", () => {
    const viewer = makeViewer({ zoom: MIN_ZOOM });
    const c = new ZoomPanController(container, viewer);
    container.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 500, cancelable: true }),
    );
    expect(viewer.zoom).toBe(MIN_ZOOM);
    c.destroy();
  });

  it("zoomIn animates toward a larger zoom via injected rAF", () => {
    const { deps, run } = makeDeps();
    const viewer = makeViewer({ zoom: 1 });
    const c = new ZoomPanController(container, viewer, deps);
    c.zoomIn();
    run();
    expect(viewer.zoom).toBeGreaterThan(1);
    expect(viewer.fitMode).toBe("free");
    c.destroy();
  });

  it("zoomOut animates toward a smaller zoom", () => {
    const { deps, run } = makeDeps();
    const viewer = makeViewer({ zoom: 4 });
    const c = new ZoomPanController(container, viewer, deps);
    c.zoomOut();
    run();
    expect(viewer.zoom).toBeLessThan(4);
    c.destroy();
  });

  it("a new discrete step cancels the previous animation", () => {
    const { deps } = makeDeps();
    const viewer = makeViewer({ zoom: 1 });
    const c = new ZoomPanController(container, viewer, deps);
    c.zoomIn();
    c.zoomIn();
    expect(deps.cancelFrame).toHaveBeenCalled();
    c.destroy();
  });

  it("drag pans the image and sets fitMode free", () => {
    const { deps } = makeDeps();
    const viewer = makeViewer({ zoom: 2 });
    const c = new ZoomPanController(container, viewer, deps);
    container.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    container.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 130,
        clientY: 120,
      }),
    );
    expect(viewer.pan.x).toBeGreaterThan(0);
    expect(viewer.pan.y).toBeGreaterThan(0);
    expect(viewer.fitMode).toBe("free");
    c.destroy();
  });

  it("ignores non-primary mouse buttons on pointerdown", () => {
    const viewer = makeViewer({ zoom: 2 });
    const c = new ZoomPanController(container, viewer);
    container.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 2,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    container.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 200,
        clientY: 200,
      }),
    );
    expect(viewer.pan).toEqual({ x: 0, y: 0 });
    c.destroy();
  });

  it("applies momentum on a fast release", () => {
    const { deps, advance, run } = makeDeps();
    const viewer = makeViewer({ zoom: 4 });
    const c = new ZoomPanController(container, viewer, deps);

    container.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    advance(10);
    container.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 160,
        clientY: 100,
      }),
    );
    const panBeforeRelease = viewer.pan.x;
    container.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, clientX: 160, clientY: 100 }),
    );
    run();
    expect(viewer.pan.x).toBeGreaterThan(panBeforeRelease);
    c.destroy();
  });

  it("does not start momentum on a slow release", () => {
    const { deps, advance } = makeDeps();
    const viewer = makeViewer({ zoom: 4 });
    const c = new ZoomPanController(container, viewer, deps);
    container.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    advance(1000);
    container.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 101,
        clientY: 100,
      }),
    );
    const panX = viewer.pan.x;
    container.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, clientX: 101, clientY: 100 }),
    );
    expect(viewer.pan.x).toBe(panX);
    c.destroy();
  });

  it("ignores pointermove for a different pointer id", () => {
    const viewer = makeViewer({ zoom: 2 });
    const c = new ZoomPanController(container, viewer);
    container.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    container.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 99,
        clientX: 200,
        clientY: 200,
      }),
    );
    expect(viewer.pan).toEqual({ x: 0, y: 0 });
    c.destroy();
  });

  it("clamps pan so the image cannot be flung off-screen", () => {
    const viewer = makeViewer({ zoom: 2 });
    const c = new ZoomPanController(container, viewer);
    container.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
      }),
    );
    container.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 100000,
        clientY: 100000,
      }),
    );
    // scaledW = 1600, container 400 => max offset (1600-400)/2 = 600.
    expect(viewer.pan.x).toBeLessThanOrEqual(600);
    expect(viewer.pan.y).toBeLessThanOrEqual(450);
    c.destroy();
  });

  it("destroy detaches listeners so further events are ignored", () => {
    const viewer = makeViewer({ zoom: 1 });
    const c = new ZoomPanController(container, viewer);
    c.destroy();
    container.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, cancelable: true }),
    );
    expect(viewer.zoom).toBe(1);
  });

  describe("handleResize", () => {
    function setContainerSize(el: HTMLElement, width: number, height: number): void {
      el.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          right: width,
          bottom: height,
          width,
          height,
          x: 0,
          y: 0,
          toJSON() {},
        }) as DOMRect;
    }

    it("re-fits the image to the new container size while in fit mode", () => {
      const viewer = makeViewer({ fitMode: "fit", zoom: 0.5, pan: { x: 10, y: 10 } });
      const c = new ZoomPanController(container, viewer);
      // Grow the container; fit zoom = min(800/800, 600/600) = 1.
      setContainerSize(container, 800, 600);
      c.handleResize();
      expect(viewer.zoom).toBeCloseTo(1);
      expect(viewer.pan).toEqual({ x: 0, y: 0 });
      c.destroy();
    });

    it("re-clamps pan but keeps zoom when not in fit mode", () => {
      const viewer = makeViewer({
        fitMode: "free",
        zoom: 2,
        pan: { x: 600, y: 450 },
      });
      const c = new ZoomPanController(container, viewer);
      // Shrink the container; scaledW = 1600, new container 200 =>
      // max offset (1600-200)/2 = 700 (x stays), height side re-clamps.
      setContainerSize(container, 200, 150);
      c.handleResize();
      expect(viewer.zoom).toBe(2);
      // scaledH = 1200, container 150 => max (1200-150)/2 = 525; 450 <= 525.
      expect(viewer.pan.x).toBeLessThanOrEqual(700);
      expect(viewer.pan.y).toBeLessThanOrEqual(525);
      c.destroy();
    });

    it("does nothing when the image is not ready", () => {
      const viewer = makeViewer({ status: "loading", zoom: 0.5 });
      const c = new ZoomPanController(container, viewer);
      setContainerSize(container, 800, 600);
      c.handleResize();
      expect(viewer.zoom).toBe(0.5);
      c.destroy();
    });

    it("re-fits when the observed container resizes", () => {
      const viewer = makeViewer({ fitMode: "fit", zoom: 0.5 });
      const observed: Array<() => void> = [];
      const RealResizeObserver = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class {
        constructor(private cb: () => void) {}
        observe(): void {
          observed.push(this.cb);
        }
        unobserve(): void {}
        disconnect(): void {}
      } as unknown as typeof globalThis.ResizeObserver;

      try {
        const c = new ZoomPanController(container, viewer);
        setContainerSize(container, 800, 600);
        // Simulate the observer firing on a window resize.
        for (const cb of observed) cb();
        expect(viewer.zoom).toBeCloseTo(1);
        c.destroy();
      } finally {
        globalThis.ResizeObserver = RealResizeObserver;
      }
    });
  });

  describe("displayedLongEdgeDevicePx", () => {
    it("returns the scaled, orientation-aware long edge in device pixels", () => {
      const viewer = makeViewer({ naturalWidth: 4000, naturalHeight: 3000, zoom: 2 });
      const c = new ZoomPanController(container, viewer);
      // dpr is 1 in jsdom; long edge 4000 * zoom 2 = 8000.
      expect(c.displayedLongEdgeDevicePx()).toBe(8000);
      c.destroy();
    });

    it("uses the orientation-swapped long edge for a 90° image", () => {
      const viewer = makeViewer({
        naturalWidth: 600,
        naturalHeight: 4000,
        orientation: 6,
        zoom: 1,
      });
      const c = new ZoomPanController(container, viewer);
      // Orientation swap does not change which dimension is the max here (4000).
      expect(c.displayedLongEdgeDevicePx()).toBe(4000);
      c.destroy();
    });

    it("returns 0 when no image is loaded", () => {
      const viewer = makeViewer({ naturalWidth: 0, naturalHeight: 0 });
      const c = new ZoomPanController(container, viewer);
      expect(c.displayedLongEdgeDevicePx()).toBe(0);
      c.destroy();
    });
  });
});
