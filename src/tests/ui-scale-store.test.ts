import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowMocks = vi.hoisted(() => {
  let movedHandler: (() => void) | null = null;
  let scaleHandler: (() => void) | null = null;

  const unlistenMoved = vi.fn();
  const unlistenScale = vi.fn();
  const onMoved = vi.fn(async (handler: () => void) => {
    movedHandler = handler;
    return unlistenMoved;
  });
  const onScaleChanged = vi.fn(async (handler: () => void) => {
    scaleHandler = handler;
    return unlistenScale;
  });

  return {
    currentMonitor: vi.fn(),
    getCurrentWindow: vi.fn(() => ({
      onMoved,
      onScaleChanged,
    })),
    onMoved,
    onScaleChanged,
    unlistenMoved,
    unlistenScale,
    installDefaultListeners() {
      onMoved.mockImplementation(async (handler: () => void) => {
        movedHandler = handler;
        return unlistenMoved;
      });
      onScaleChanged.mockImplementation(async (handler: () => void) => {
        scaleHandler = handler;
        return unlistenScale;
      });
    },
    triggerMoved: () => movedHandler?.(),
    triggerScaleChanged: () => scaleHandler?.(),
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: windowMocks.currentMonitor,
  getCurrentWindow: windowMocks.getCurrentWindow,
}));

import {
  computeTextScaling,
  uiScale,
} from "../lib/stores/ui-scale.svelte";

describe("ui scale store", () => {
  beforeEach(() => {
    uiScale.resetForTests();
    windowMocks.currentMonitor.mockReset();
    windowMocks.getCurrentWindow.mockClear();
    windowMocks.onMoved.mockReset();
    windowMocks.onScaleChanged.mockReset();
    windowMocks.unlistenMoved.mockClear();
    windowMocks.unlistenScale.mockClear();
    windowMocks.installDefaultListeners();

    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(window, "screen", {
      configurable: true,
      value: { width: 1920, height: 1080 },
    });
  });

  afterEach(() => {
    uiScale.resetForTests();
  });

  it("keeps the default scaling on a standard display", () => {
    expect(
      computeTextScaling({ scaleFactor: 1, physicalShortEdge: 1080 }),
    ).toBe(1);
  });

  it("increases scaling for larger and denser displays", () => {
    expect(
      computeTextScaling({ scaleFactor: 1, physicalShortEdge: 2160 }),
    ).toBe(1.09);
    expect(
      computeTextScaling({ scaleFactor: 1.5, physicalShortEdge: 2160 }),
    ).toBe(1.05);
    expect(
      computeTextScaling({ scaleFactor: 2, physicalShortEdge: 1600 }),
    ).toBe(1.04);
  });

  it("writes the document root font size and typography tokens", () => {
    uiScale.applyMetrics({ scaleFactor: 1, physicalShortEdge: 2160 });

    const root = document.documentElement;
    expect(root.style.getPropertyValue("font-size")).toBe("17.44px");
    expect(root.style.getPropertyValue("--text-scaling")).toBe("1.090");
    expect(root.style.getPropertyValue("--base-font-size")).toBe("17.44px");
  });

  it("refreshes from the native monitor and updates on window events", async () => {
    windowMocks.currentMonitor.mockResolvedValue({
      scaleFactor: 1,
      size: { width: 3840, height: 2160 },
    });

    await uiScale.start();

    expect(document.documentElement.style.getPropertyValue("font-size")).toBe("17.44px");
    expect(document.documentElement.style.getPropertyValue("--text-scaling")).toBe(
      "1.090",
    );
    expect(windowMocks.onMoved).toHaveBeenCalledOnce();
    expect(windowMocks.onScaleChanged).toHaveBeenCalledOnce();

    windowMocks.currentMonitor.mockResolvedValue({
      scaleFactor: 1.5,
      size: { width: 3840, height: 2160 },
    });

    windowMocks.triggerScaleChanged();

    await vi.waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue("--text-scaling"),
      ).toBe("1.050");
    });
  });

  it("falls back to browser metrics when the native bridge is unavailable", async () => {
    windowMocks.currentMonitor.mockRejectedValue(new Error("no monitor"));
    windowMocks.onMoved.mockRejectedValue(new Error("no window"));

    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 1.5,
    });
    Object.defineProperty(window, "screen", {
      configurable: true,
      value: { width: 2560, height: 1440 },
    });

    await uiScale.start();

    expect(document.documentElement.style.getPropertyValue("font-size")).toBe("16.8px");
    expect(document.documentElement.style.getPropertyValue("--text-scaling")).toBe(
      "1.050",
    );
  });

  it("cleans up native listeners and removes overrides in test resets", async () => {
    windowMocks.currentMonitor.mockResolvedValue({
      scaleFactor: 1,
      size: { width: 3840, height: 2160 },
    });

    await uiScale.start();
    uiScale.stop();

    expect(windowMocks.unlistenMoved).toHaveBeenCalledOnce();
    expect(windowMocks.unlistenScale).toHaveBeenCalledOnce();

    uiScale.resetForTests();
    expect(document.documentElement.style.getPropertyValue("font-size")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--text-scaling")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--base-font-size")).toBe("");
  });
});
