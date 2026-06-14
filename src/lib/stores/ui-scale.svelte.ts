import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  currentMonitor,
  getCurrentWindow,
  type Monitor,
} from "@tauri-apps/api/window";

export interface UiScaleMetrics {
  scaleFactor: number;
  physicalShortEdge: number;
}

const DEFAULT_TEXT_SCALING = 1;
const BASE_FONT_SIZE_PX = 16;
const MAX_TEXT_SCALING = 1.12;
const LOGICAL_SHORT_EDGE_BASELINE = 1080;
const LOGICAL_SHORT_EDGE_RANGE = 1440;
const MAX_RESOLUTION_BOOST = 0.12;
const MAX_DPI_BOOST = 0.04;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeScaleFactor(scaleFactor: number): number {
  return Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
}

function normalizePhysicalShortEdge(physicalShortEdge: number): number {
  return Number.isFinite(physicalShortEdge) && physicalShortEdge > 0
    ? physicalShortEdge
    : LOGICAL_SHORT_EDGE_BASELINE;
}

export function computeTextScaling({
  scaleFactor,
  physicalShortEdge,
}: UiScaleMetrics): number {
  const normalizedScaleFactor = normalizeScaleFactor(scaleFactor);
  const normalizedPhysicalShortEdge =
    normalizePhysicalShortEdge(physicalShortEdge);
  const logicalShortEdge =
    normalizedPhysicalShortEdge / normalizedScaleFactor;
  const resolutionBoost =
    clamp(
      (logicalShortEdge - LOGICAL_SHORT_EDGE_BASELINE) /
        LOGICAL_SHORT_EDGE_RANGE,
      0,
      1,
    ) * MAX_RESOLUTION_BOOST;
  const dpiBoost =
    clamp(normalizedScaleFactor - 1, 0, 1) * MAX_DPI_BOOST;

  return roundTo(
    clamp(
      DEFAULT_TEXT_SCALING + resolutionBoost + dpiBoost,
      DEFAULT_TEXT_SCALING,
      MAX_TEXT_SCALING,
    ),
    3,
  );
}

function measureShortEdge(monitor: Monitor | null): UiScaleMetrics {
  if (monitor) {
    return {
      scaleFactor: normalizeScaleFactor(monitor.scaleFactor),
      physicalShortEdge: normalizePhysicalShortEdge(
        Math.min(monitor.size.width, monitor.size.height),
      ),
    };
  }

  const scaleFactor =
    typeof window !== "undefined" ? normalizeScaleFactor(window.devicePixelRatio) : 1;
  const shortEdge =
    typeof window !== "undefined"
      ? Math.min(window.screen.width, window.screen.height) * scaleFactor
      : LOGICAL_SHORT_EDGE_BASELINE;

  return {
    scaleFactor,
    physicalShortEdge: normalizePhysicalShortEdge(shortEdge),
  };
}

function baseFontSize(textScaling: number): string {
  return `${roundTo(BASE_FONT_SIZE_PX * textScaling, 2)}px`;
}

class UiScaleStore {
  #started = false;
  #removeWindowListeners: UnlistenFn[] = [];
  #boundRefresh = () => {
    void this.refresh();
  };

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;

    await this.refresh();
    this.#attachBrowserListener();
    await this.#attachTauriListeners();
  }

  stop(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.#boundRefresh);
    }
    for (const unlisten of this.#removeWindowListeners.splice(0)) {
      unlisten();
    }
    this.#started = false;
  }

  resetForTests(): void {
    this.stop();
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.removeProperty("font-size");
    root.style.removeProperty("--text-scaling");
    root.style.removeProperty("--base-font-size");
  }

  async refresh(): Promise<void> {
    this.applyMetrics(await this.#readMetrics());
  }

  applyMetrics(metrics: UiScaleMetrics): void {
    if (typeof document === "undefined") return;

    const textScaling = computeTextScaling(metrics);
    const root = document.documentElement;
    root.style.setProperty("font-size", baseFontSize(textScaling));
    root.style.setProperty("--text-scaling", textScaling.toFixed(3));
    root.style.setProperty("--base-font-size", baseFontSize(textScaling));
  }

  #attachBrowserListener(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("resize", this.#boundRefresh);
  }

  async #attachTauriListeners(): Promise<void> {
    try {
      const appWindow = getCurrentWindow();
      this.#removeWindowListeners.push(
        await appWindow.onMoved(this.#boundRefresh),
      );
      this.#removeWindowListeners.push(
        await appWindow.onScaleChanged(this.#boundRefresh),
      );
    } catch {
      // Browser-only dev mode does not expose the native window bridge.
    }
  }

  async #readMetrics(): Promise<UiScaleMetrics> {
    try {
      return measureShortEdge(await currentMonitor());
    } catch {
      return measureShortEdge(null);
    }
  }
}

export const uiScale = new UiScaleStore();
