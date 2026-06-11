import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chrome, CHROME_IDLE_MS } from "../lib/stores/chrome.svelte";

/**
 * Override window.matchMedia so the reduced-motion query reports `matches`.
 * Returns nothing; restored by setup.ts's default polyfill across tests via the
 * afterEach reset below.
 */
let motionListeners: Array<() => void> = [];
let reducedMotionValue = false;

function setReducedMotion(matches: boolean): void {
  reducedMotionValue = matches;
}

// Install a matchMedia stub whose `matches` tracks `reducedMotionValue` live, so
// firing a captured change listener reflects the updated preference.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    get matches() {
      return query.includes("prefers-reduced-motion") ? reducedMotionValue : false;
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, cb: () => void) => {
      motionListeners.push(cb);
    },
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

describe("chrome auto-hide store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    motionListeners = [];
    setReducedMotion(false);
  });

  afterEach(() => {
    chrome.stop();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("starts visible", () => {
    expect(chrome.chromeVisible).toBe(true);
  });

  it("hides after the idle timeout elapses", () => {
    chrome.registerActivity();
    expect(chrome.chromeVisible).toBe(true);

    vi.advanceTimersByTime(CHROME_IDLE_MS);
    expect(chrome.chromeVisible).toBe(false);
  });

  it("re-shows on activity and resets the idle timer", () => {
    chrome.registerActivity();
    vi.advanceTimersByTime(CHROME_IDLE_MS);
    expect(chrome.chromeVisible).toBe(false);

    // Activity brings chrome back.
    chrome.registerActivity();
    expect(chrome.chromeVisible).toBe(true);

    // Advancing just under the timeout keeps it visible (timer was reset).
    vi.advanceTimersByTime(CHROME_IDLE_MS - 1);
    expect(chrome.chromeVisible).toBe(true);

    // Further activity resets the countdown again.
    vi.advanceTimersByTime(CHROME_IDLE_MS - 1);
    chrome.registerActivity();
    vi.advanceTimersByTime(CHROME_IDLE_MS - 1);
    expect(chrome.chromeVisible).toBe(true);

    // Crossing the full idle period from the last activity hides it.
    vi.advanceTimersByTime(1);
    expect(chrome.chromeVisible).toBe(false);
  });

  it("hides chrome when fullscreen is entered, then re-shows on activity", () => {
    chrome.registerActivity();
    expect(chrome.chromeVisible).toBe(true);

    chrome.setFullscreen(true);
    expect(chrome.chromeVisible).toBe(false);

    // Activity should still reveal chrome while fullscreen remains active.
    chrome.registerActivity();
    expect(chrome.chromeVisible).toBe(true);

    vi.advanceTimersByTime(CHROME_IDLE_MS);
    expect(chrome.chromeVisible).toBe(false);

    chrome.setFullscreen(false);
    expect(chrome.chromeVisible).toBe(true);
  });

  it("exposes the reduced-motion instant flag", () => {
    setReducedMotion(false);
    chrome.start();
    expect(chrome.instant).toBe(false);
    chrome.stop();

    setReducedMotion(true);
    chrome.start();
    expect(chrome.instant).toBe(true);
  });

  it("updates the instant flag when the reduced-motion query changes", () => {
    setReducedMotion(false);
    chrome.start();
    expect(chrome.instant).toBe(false);

    // Flip the underlying query, then fire the registered change listener.
    setReducedMotion(true);
    motionListeners.forEach((cb) => cb());
    expect(chrome.instant).toBe(true);
  });

  it("start() seeds activity and begins the idle countdown", () => {
    chrome.start();
    expect(chrome.chromeVisible).toBe(true);

    vi.advanceTimersByTime(CHROME_IDLE_MS);
    expect(chrome.chromeVisible).toBe(false);
  });

  it("stop() clears the pending idle timer", () => {
    chrome.registerActivity();
    chrome.stop();

    // No pending timer should flip visibility after stop.
    vi.advanceTimersByTime(CHROME_IDLE_MS * 2);
    expect(chrome.chromeVisible).toBe(true);
  });
});
