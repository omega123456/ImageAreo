import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openDialog } = vi.hoisted(() => ({
  openDialog: vi.fn(),
}));

const { readFullscreen, writeFullscreen, writeTitle } = vi.hoisted(() => ({
  readFullscreen: vi.fn(async () => false),
  writeFullscreen: vi.fn(async () => {}),
  writeTitle: vi.fn(async (_title: string) => {}),
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
    writeTitle,
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
import { ipc } from "./ipc-mock";
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
    writeTitle.mockReset();
    writeTitle.mockResolvedValue(undefined);
    chrome.stop();
    folder.reset();
    galleryUi.reset();
    ui.closeSettings();
    ui.closeInfo();
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

  it("hydrates the document root font size from monitor-aware ui scaling", async () => {
    viewer.status = "ready";
    render(App);

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("font-size")).toBe("16px");
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

  it("keeps chrome alive on any key press, even one a child stops propagating", async () => {
    folder.images = [
      { path: "/photos/img1.jpg", name: "img1.jpg", modified: 1 },
      { path: "/photos/img2.jpg", name: "img2.jpg", modified: 2 },
    ];
    folder.currentIndex = 0;
    viewer.status = "ready";

    render(App);

    const toolbarOverlay = screen.getByTestId("toolbar-overlay");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(CHROME_IDLE_MS);
    expect(toolbarOverlay).toHaveClass("opacity-0", "invisible");

    // The filmstrip stops arrow-key propagation in the bubble phase; a
    // capture-phase listener must still register the activity and re-show chrome.
    const filmstripOption = screen
      .getByLabelText("Filmstrip")
      .querySelector<HTMLElement>('[role="option"]');
    expect(filmstripOption).not.toBeNull();
    await fireEvent.keyDown(filmstripOption!, { key: "ArrowRight" });

    expect(toolbarOverlay).toHaveClass("opacity-100", "visible");

    // And the countdown is armed again from that key press.
    await vi.advanceTimersByTimeAsync(CHROME_IDLE_MS);
    expect(toolbarOverlay).toHaveClass("opacity-0", "invisible");

    // Mouse-wheel scrolling counts as activity too (capture phase, so a child's
    // wheel-zoom stopping propagation can't suppress it).
    await fireEvent.wheel(filmstripOption!, { deltaY: 120 });
    expect(toolbarOverlay).toHaveClass("opacity-100", "visible");
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

  it("shows the toolbar with image actions disabled when no image is loaded", () => {
    viewer.reset();
    render(App);

    expect(screen.getByTestId("toolbar-overlay")).toBeInTheDocument();
    // File/settings actions stay enabled; image-specific ones are disabled.
    expect(screen.getByRole("button", { name: "Open image" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Settings" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Fit to screen" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rotate left" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Image info" })).toBeDisabled();
  });

  it("shows the Enhance control only for a RAW image once the display is ready", async () => {
    viewer.status = "ready";
    viewer.path = "/photos/shot.dng";
    viewer.upgrading = false;
    viewer.enhanceAvailable = false;

    render(App);

    expect(screen.queryByTestId("enhance-control")).toBeNull();

    viewer.enhanceAvailable = true;
    await waitFor(() => {
      expect(screen.getByTestId("enhance-control")).toBeInTheDocument();
    });
  });

  it("hides the Enhance control while a RAW upgrade is still in flight", async () => {
    viewer.status = "ready";
    viewer.path = "/photos/shot.dng";
    viewer.enhanceAvailable = true;
    viewer.upgrading = true;

    render(App);

    expect(screen.queryByTestId("enhance-control")).toBeNull();
  });

  it("never shows the Enhance control for a non-RAW image", () => {
    viewer.status = "ready";
    viewer.path = "/photos/photo.jpg";
    viewer.enhanceAvailable = true;
    viewer.upgrading = false;

    render(App);

    expect(screen.queryByTestId("enhance-control")).toBeNull();
  });

  it("toggles the info card via the toolbar button and the I key", async () => {
    viewer.status = "ready";
    viewer.path = "/photos/a.jpg";

    render(App);

    expect(screen.queryByTestId("image-info-card")).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "Image info" }));
    expect(ui.infoOpen).toBe(true);
    await waitFor(() => {
      expect(screen.getByTestId("image-info-card")).toBeInTheDocument();
    });

    await fireEvent.keyDown(window, { key: "i" });
    expect(ui.infoOpen).toBe(false);
    await waitFor(() => {
      expect(screen.queryByTestId("image-info-card")).toBeNull();
    });
  });

  it("does not mount the info card on launch (closed by default)", () => {
    viewer.status = "ready";
    render(App);
    expect(screen.queryByTestId("image-info-card")).toBeNull();
  });

  it("Esc closes info first, then settings, then exits fullscreen", async () => {
    readFullscreen.mockResolvedValue(true);
    viewer.status = "ready";
    ui.openInfo();
    ui.openSettings();

    render(App);

    await waitFor(() => expect(ui.fullscreen).toBe(true));

    await fireEvent.keyDown(window, { key: "Escape" });
    expect(ui.infoOpen).toBe(false);
    expect(ui.settingsOpen).toBe(true);
    expect(ui.fullscreen).toBe(true);

    await fireEvent.keyDown(window, { key: "Escape" });
    expect(ui.settingsOpen).toBe(false);
    expect(ui.fullscreen).toBe(true);

    await fireEvent.keyDown(window, { key: "Escape" });
    expect(writeFullscreen).toHaveBeenCalledWith(false);
  });

  it("reflects image dimensions in the window title once loaded", async () => {
    viewer.path = "/photos/shot.jpg";
    viewer.name = "shot.jpg";
    viewer.naturalWidth = 4032;
    viewer.naturalHeight = 3024;

    render(App);

    await waitFor(() => {
      expect(writeTitle).toHaveBeenCalled();
    });
    const titles = writeTitle.mock.calls.map((c) => c[0]);
    expect(titles.some((t) => String(t).includes("(4032×3024)"))).toBe(true);
  });

  it("shows the true source dimensions from metadata, not the displayed derivative size", async () => {
    // A large image shown as a downsized backend derivative: naturalWidth/Height
    // are the derivative's, but the title must report the original source size
    // (the same number the info card shows). Real timers so the async metadata
    // fetch resolves within waitFor.
    vi.useRealTimers();
    ipc.override("read_image_metadata", (args) => ({
      fileName: "huge.heic",
      filePath: String(args?.path),
      format: "HEIC",
      fileSizeBytes: 1_000_000,
      width: 8000,
      height: 6000,
      pixels: 48_000_000,
      colorType: "RGB",
      bitDepth: 8,
      orientation: 1,
      camera: null,
    }));
    viewer.path = "/photos/huge.heic";
    viewer.name = "huge.heic";
    viewer.naturalWidth = 1500;
    viewer.naturalHeight = 1125;

    render(App);

    await waitFor(() => {
      const titles = writeTitle.mock.calls.map((c) => String(c[0]));
      expect(titles.some((t) => t.includes("(8000×6000)"))).toBe(true);
    });
    expect(String(writeTitle.mock.calls.at(-1)?.[0])).toContain("(8000×6000)");

    // Restore fake timers (+ stop chrome's real timer) so the shared afterEach,
    // which calls vi.runOnlyPendingTimers(), runs against mocked timers.
    chrome.stop();
    vi.useFakeTimers();
  });

  it("disables chrome fade transitions when reduced motion is enabled", () => {
    setReducedMotion(true);
    viewer.status = "ready";

    render(App);

    expect(screen.getByTestId("toolbar-overlay")).toHaveClass("transition-none");
    expect(screen.getByTestId("zoom-hud-overlay")).toHaveClass("transition-none");
  });
});
