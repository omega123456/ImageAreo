import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
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
import { supportedExtensions } from "../lib/utils/format";

let reducedMotionValue = false;

function setReducedMotion(matches: boolean): void {
  reducedMotionValue = matches;
}

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

describe("App", () => {
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
    ui.closeSettings();
    ui.fullscreen = false;
    viewer.reset();
    setReducedMotion(false);
  });

  afterEach(() => {
    chrome.stop();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("uses the full supported extension set for File > Open", async () => {
    viewer.status = "ready";
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Open image" }));

    expect(openDialog).toHaveBeenCalledWith({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: supportedExtensions() }],
    });
  });

  it("blocks viewer shortcuts behind the settings drawer but still allows Escape", async () => {
    viewer.status = "ready";
    viewer.rotation = 0;
    ui.openSettings();
    render(App);

    const sortSelect = screen.getByLabelText("Sort order");
    sortSelect.focus();

    await fireEvent.keyDown(sortSelect, { key: "]", ctrlKey: true });
    expect(viewer.rotation).toBe(0);
    expect(ui.settingsOpen).toBe(true);

    await fireEvent.keyDown(sortSelect, { key: "Escape" });
    expect(ui.settingsOpen).toBe(false);
  });

  it("renders overlay chrome over the viewer, auto-hides on idle, and keeps the filmstrip visible", async () => {
    folder.images = [
      { path: "/photos/img1.jpg", name: "img1.jpg", modified: 1 },
      { path: "/photos/img2.jpg", name: "img2.jpg", modified: 2 },
    ];
    folder.currentIndex = 0;
    viewer.status = "ready";

    render(App);

    const toolbarOverlay = screen.getByTestId("toolbar-overlay");
    const zoomHudOverlay = screen.getByTestId("zoom-hud-overlay");
    const filmstrip = screen.getByLabelText("Filmstrip");

    expect(toolbarOverlay).toHaveClass("absolute", "opacity-100", "visible");
    expect(zoomHudOverlay).toHaveClass("absolute", "opacity-100", "visible");
    expect(filmstrip).toBeInTheDocument();

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(CHROME_IDLE_MS);

    expect(toolbarOverlay).toHaveClass("opacity-0", "invisible", "pointer-events-none");
    expect(zoomHudOverlay).toHaveClass("opacity-0", "invisible", "pointer-events-none");
    expect(filmstrip).toBeInTheDocument();

    await fireEvent.pointerMove(window);
    expect(toolbarOverlay).toHaveClass("opacity-100", "visible");
    expect(zoomHudOverlay).toHaveClass("opacity-100", "visible");

    await ui.toggleFullscreen();
    // In fullscreen the toolbar slides (translate) instead of fading; the HUD,
    // being canvas chrome, keeps fading.
    expect(toolbarOverlay).toHaveClass("-translate-y-full");
    expect(zoomHudOverlay).toHaveClass("opacity-0", "invisible");

    await fireEvent.pointerMove(window);
    expect(toolbarOverlay).toHaveClass("translate-y-0");
    expect(zoomHudOverlay).toHaveClass("opacity-100", "visible");

    await vi.advanceTimersByTimeAsync(CHROME_IDLE_MS);
    expect(toolbarOverlay).toHaveClass("-translate-y-full");
    expect(zoomHudOverlay).toHaveClass("opacity-0", "invisible");
  });

  it("hydrates fullscreen state from the native window and toggles the native mode", async () => {
    readFullscreen.mockResolvedValue(true);
    viewer.status = "ready";

    render(App);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Toggle fullscreen" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await fireEvent.click(screen.getByRole("button", { name: "Toggle fullscreen" }));

    expect(writeFullscreen).toHaveBeenCalledWith(false);
  });

  it("opens the context menu at the canvas center via a window-level Shift+F10", async () => {
    viewer.load("asset://a.jpg", "a.jpg");
    viewer.path = "/photos/a.jpg";
    viewer.status = "ready";

    render(App);

    const canvas = screen.getByTestId("viewer-canvas");
    canvas.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 200, height: 100 }) as DOMRect;

    await fireEvent.keyDown(window, { key: "F10", shiftKey: true });

    const menu = await screen.findByRole("menu", { name: "Image actions" });
    expect(menu.style.left).toBe("200px");
    expect(menu.style.top).toBe("100px");
  });

  it("ignores Shift+F10 when no image is loaded", async () => {
    viewer.reset();
    render(App);

    await fireEvent.keyDown(window, { key: "F10", shiftKey: true });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("hides the toolbar when no image is loaded", () => {
    viewer.reset();
    render(App);

    expect(screen.queryByTestId("toolbar-overlay")).toBeNull();
  });

  it("disables chrome fade transitions when reduced motion is enabled", () => {
    setReducedMotion(true);
    viewer.status = "ready";

    render(App);

    expect(screen.getByTestId("toolbar-overlay")).toHaveClass("transition-none");
    expect(screen.getByTestId("zoom-hud-overlay")).toHaveClass("transition-none");
  });
});
