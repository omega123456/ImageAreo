import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/svelte";

import { setupIpc } from "./ipc-mock";

// Register IPC mock hooks (beforeEach + afterEach) for all tests.
setupIpc();

// ---------------------------------------------------------------------------
// jsdom polyfills
// ---------------------------------------------------------------------------

// ResizeObserver — used by layout-aware components.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof globalThis.ResizeObserver;
}

// Element.animate — Web Animations API, used by Svelte transitions (e.g. the
// settings drawer slide-in). jsdom does not implement it; return a no-op
// animation stub so transition code paths run headlessly.
if (typeof Element.prototype.animate === "undefined") {
  Element.prototype.animate = function () {
    return {
      cancel: () => {},
      finished: Promise.resolve(),
      onfinish: null,
      play: () => {},
      pause: () => {},
      finish: () => {},
      reverse: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as Animation;
  };
}

// matchMedia — used by the system-follow theme.
if (typeof window.matchMedia === "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// navigator.clipboard — used by copy-path flows.
if (typeof navigator.clipboard === "undefined") {
  Object.defineProperty(navigator, "clipboard", {
    writable: true,
    configurable: true,
    value: {
      writeText: vi.fn(() => Promise.resolve()),
      readText: vi.fn(() => Promise.resolve("")),
    },
  });
}

// Pointer capture — jsdom does not implement these; the zoom/pan controller
// guards them, but stub them so capture paths can be exercised.
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = function () {};
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = function () {};
}

if (typeof window !== "undefined") {
  const internals = ((window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> })
    .__TAURI_INTERNALS__ ??= {});
  if (typeof internals.convertFileSrc !== "function") {
    internals.convertFileSrc = (path: string, protocol = "asset") =>
      `${protocol}://${path}`;
  }
}

// Metadata for getCurrentWindow()/getCurrentWebview() — used by the Phase-12
// native drag-drop listener registration. Re-stamped before each test because
// the IPC mock setup (mockIPC) re-initializes __TAURI_INTERNALS__.
beforeEach(() => {
  const internals = ((window as typeof window & {
    __TAURI_INTERNALS__?: Record<string, unknown>;
  }).__TAURI_INTERNALS__ ??= {});
  if (typeof internals.convertFileSrc !== "function") {
    internals.convertFileSrc = (path: string, protocol = "asset") =>
      `${protocol}://${path}`;
  }
  internals.metadata = {
    currentWindow: { label: "main" },
    currentWebview: { windowLabel: "main", label: "main" },
  };
});

afterEach(() => {
  cleanup();
});
