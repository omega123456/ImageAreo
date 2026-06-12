import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openDialog } = vi.hoisted(() => ({
  openDialog: vi.fn(),
}));

const { readFullscreen, writeFullscreen } = vi.hoisted(() => ({
  readFullscreen: vi.fn(async () => false),
  writeFullscreen: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openDialog,
}));

vi.mock("../lib/utils/native-window", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/utils/native-window")
  >("../lib/utils/native-window");
  return {
    ...actual,
    readFullscreen,
    writeFullscreen,
    writeTitle: vi.fn(async () => {}),
  };
});

vi.mock("../lib/utils/open-entry", async () => {
  const actual = await vi.importActual<typeof import("../lib/utils/open-entry")>(
    "../lib/utils/open-entry",
  );

  return {
    ...actual,
    registerEntryPoints: vi.fn(async () => () => {}),
  };
});

import App from "../App.svelte";
import { CHROME_IDLE_MS, chrome } from "../lib/stores/chrome.svelte";
import { folder } from "../lib/stores/folder.svelte";
import { galleryUi } from "../lib/stores/gallery-ui.svelte";
import { ui } from "../lib/stores/ui.svelte";
import { viewer } from "../lib/stores/viewer.svelte";

let reducedMotionValue = false;

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
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

function seedReadyFolder(): void {
  folder.images = [
    { path: "/photos/img1.jpg", name: "img1.jpg", modified: 1 },
    { path: "/photos/img2.jpg", name: "img2.jpg", modified: 2 },
  ];
  folder.currentIndex = 0;
  viewer.status = "ready";
}

describe("fullscreen chrome", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    openDialog.mockReset();
    openDialog.mockResolvedValue(null);
    readFullscreen.mockReset();
    readFullscreen.mockResolvedValue(false);
    writeFullscreen.mockReset();
    writeFullscreen.mockResolvedValue(undefined);
    chrome.stop();
    folder.reset();
    galleryUi.reset();
    galleryUi.show();
    ui.closeSettings();
    ui.fullscreen = false;
    viewer.reset();
    reducedMotionValue = false;
    document.body.style.cursor = "";
  });

  afterEach(() => {
    chrome.stop();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.style.cursor = "";
  });

  it("paints the canvas black and slides chrome out when entering fullscreen", async () => {
    seedReadyFolder();
    render(App);

    const canvas = screen.getByTestId("viewer-canvas");
    const toolbar = screen.getByTestId("toolbar-overlay");
    const filmstrip = screen.getByTestId("filmstrip-overlay");

    expect(canvas).toHaveClass("bg-canvas-surround");
    expect(toolbar).toHaveClass("opacity-100", "visible");
    expect(filmstrip).toHaveClass("translate-y-0");

    await ui.toggleFullscreen();

    expect(writeFullscreen).toHaveBeenCalledWith(true);
    expect(canvas).toHaveClass("bg-black");
    expect(toolbar).toHaveClass("-translate-y-full");
    expect(filmstrip).toHaveClass("translate-y-full");
  });

  it("reveals chrome on activity and re-hides it after the idle timeout", async () => {
    seedReadyFolder();
    render(App);

    await ui.toggleFullscreen();

    const toolbar = screen.getByTestId("toolbar-overlay");
    const filmstrip = screen.getByTestId("filmstrip-overlay");
    expect(toolbar).toHaveClass("-translate-y-full");
    expect(filmstrip).toHaveClass("translate-y-full");

    await fireEvent.pointerMove(window);
    expect(toolbar).toHaveClass("translate-y-0");
    expect(filmstrip).toHaveClass("translate-y-0");

    await vi.advanceTimersByTimeAsync(CHROME_IDLE_MS);
    expect(toolbar).toHaveClass("-translate-y-full");
    expect(filmstrip).toHaveClass("translate-y-full");
  });

  it("hides the cursor when idle in fullscreen and restores it on activity", async () => {
    seedReadyFolder();
    render(App);

    expect(document.body.style.cursor).toBe("");

    await ui.toggleFullscreen();
    expect(document.body.style.cursor).toBe("none");

    await fireEvent.pointerMove(window);
    expect(document.body.style.cursor).toBe("");

    await vi.advanceTimersByTimeAsync(CHROME_IDLE_MS);
    expect(document.body.style.cursor).toBe("none");

    await ui.exitFullscreen();
    expect(document.body.style.cursor).toBe("");
  });

  it("keeps keyboard shortcuts live while chrome is hidden in fullscreen", async () => {
    seedReadyFolder();
    render(App);

    await ui.toggleFullscreen();
    // Drive to the idle/hidden state without faking a pointer move.
    chrome.setFullscreen(true);
    expect(screen.getByTestId("toolbar-overlay")).toHaveClass("-translate-y-full");
    expect(folder.currentIndex).toBe(0);

    await fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(folder.currentIndex).toBe(1);
  });

  it("uses instant transitions in fullscreen when reduced motion is enabled", async () => {
    reducedMotionValue = true;
    seedReadyFolder();
    render(App);

    await ui.toggleFullscreen();

    expect(screen.getByTestId("toolbar-overlay")).toHaveClass("transition-none");
    expect(screen.getByTestId("filmstrip-overlay")).toHaveClass("transition-none");
  });
});
