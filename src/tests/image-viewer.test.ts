import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import ImageViewer from "../lib/components/ImageViewer.svelte";
import { viewer } from "../lib/stores/viewer.svelte";
import { chromeTone } from "../lib/stores/chrome-tone.svelte";
import { ipc } from "./ipc-mock";

describe("ImageViewer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    viewer.reset();
    chromeTone.toolbarDark = true;
    chromeTone.enhanceDark = true;
    // jsdom does not run rAF naturally; make it synchronous for fit-on-load.
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the empty state when idle", () => {
    render(ImageViewer);
    expect(screen.getByText("Open an image to get started")).toBeInTheDocument();
  });

  it("forwards the empty-state Open click", async () => {
    const onOpen = vi.fn();
    render(ImageViewer, { props: { onOpen } });
    await fireEvent.click(screen.getByRole("button", { name: "Open File" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("renders the image element once a source is loaded", () => {
    viewer.load("asset://photo.jpg", "photo.jpg");
    render(ImageViewer);
    const img = screen.getByRole("img", { name: "photo.jpg" });
    expect(img).toHaveAttribute("src", "asset://photo.jpg");
  });

  it("shows a loading spinner while loading", () => {
    viewer.load("asset://photo.jpg", "photo.jpg");
    render(ImageViewer);
    expect(screen.getByRole("status", { name: "Loading image" })).toBeInTheDocument();
  });

  it("renders only the loading UI when loading without a source", () => {
    viewer.load("", "photo.jpg");
    render(ImageViewer);
    expect(screen.getByRole("status", { name: "Loading image" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("marks the image ready on load and applies a transform", async () => {
    viewer.load("asset://photo.jpg", "photo.jpg");
    render(ImageViewer);
    const img = screen.getByRole("img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 640, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 480, configurable: true });
    await fireEvent.load(img);
    expect(viewer.status).toBe("ready");
    expect(viewer.naturalWidth).toBe(640);
    expect(img.getAttribute("style")).toContain("transform:");
  });

  it("sets error status when the image fails to load", async () => {
    viewer.load("asset://broken.jpg", "broken.jpg");
    render(ImageViewer);
    await fireEvent.error(screen.getByRole("img"));
    expect(viewer.status).toBe("error");
  });

  it("keeps the previous image visible while the next image is loading", async () => {
    viewer.load("asset://first.jpg", "first.jpg");
    render(ImageViewer);
    const img = screen.getByRole("img", { name: "first.jpg" }) as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 640, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 480, configurable: true });
    await fireEvent.load(img);

    viewer.name = "next.jpg";
    viewer.status = "loading";

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "Loading image" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "first.jpg" })).toHaveAttribute(
        "src",
        "asset://first.jpg",
      );
    });
  });

  it("applies the EXIF orientation transform for a rotated image", () => {
    viewer.load("data:image/png;base64,AAAA", "shot.heic");
    viewer.orientation = 6;
    render(ImageViewer);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.getAttribute("style")).toContain("rotate(90deg)");
  });

  it("omits an orientation fragment for the identity orientation", () => {
    viewer.load("asset://photo.jpg", "photo.jpg");
    render(ImageViewer);
    const img = screen.getByRole("img") as HTMLImageElement;
    // Only the user rotation(0deg) should be present, not an EXIF fragment.
    expect(img.getAttribute("style")).toContain("rotate(0deg)");
  });

  it("recreates the img element when the source changes", async () => {
    viewer.load("asset://first.jpg", "first.jpg");
    render(ImageViewer);
    const first = screen.getByRole("img", { name: "first.jpg" });

    viewer.load("asset://second.jpg", "second.jpg");

    const second = await waitFor(() => {
      return screen.getByRole("img", { name: "second.jpg" });
    });
    expect(second).not.toBe(first);
    expect(second).toHaveAttribute("src", "asset://second.jpg");
  });

  it("exposes a controller via the bound prop and tears it down on unmount", () => {
    viewer.load("asset://photo.jpg", "photo.jpg");
    const { unmount } = render(ImageViewer);
    // The container exists, so the $effect should have constructed a controller.
    expect(document.querySelector(".bg-canvas-surround")).not.toBeNull();
    unmount();
  });

  it("fires the on-zoom sharper-tier upgrade with the displayed long edge after the debounce", async () => {
    vi.useFakeTimers();
    const upgradeSpy = vi
      .spyOn(viewer, "maybeUpgradeTier")
      .mockResolvedValue(undefined);

    viewer.load("asset://photo.jpg", "photo.jpg");
    viewer.path = "/photos/photo.jpg";
    viewer.setReady(4000, 3000);

    render(ImageViewer);

    // A zoom-in re-runs the debounced effect; only the post-zoom firing matters.
    upgradeSpy.mockClear();
    viewer.zoom = 3;
    await tick();
    await vi.advanceTimersByTimeAsync(200);

    // Wired to the controller's displayed long edge: 4000 (long edge) × zoom 3.
    expect(upgradeSpy).toHaveBeenCalledTimes(1);
    expect(upgradeSpy).toHaveBeenCalledWith(12000);

    vi.useRealTimers();
  });

  it("does not fire the upgrade before the debounce elapses", async () => {
    vi.useFakeTimers();
    const upgradeSpy = vi
      .spyOn(viewer, "maybeUpgradeTier")
      .mockResolvedValue(undefined);

    viewer.load("asset://photo.jpg", "photo.jpg");
    viewer.path = "/photos/photo.jpg";
    viewer.setReady(4000, 3000);

    render(ImageViewer);
    upgradeSpy.mockClear();
    viewer.zoom = 3;
    await tick();
    await vi.advanceTimersByTimeAsync(199);

    expect(upgradeSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("re-samples the toolbar tone when the first-open layout settles after mount", async () => {
    const resizeCallbacks: ResizeObserverCallback[] = [];
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver as unknown as typeof ResizeObserver);
    const timeoutSpy = vi.spyOn(window, "setTimeout");

    viewer.load("asset://photo.jpg", "photo.jpg");
    viewer.path = "/photos/photo.jpg";
    viewer.setReady(800, 600);

    render(ImageViewer);
    const callsAfterMount = timeoutSpy.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);
    expect(resizeCallbacks.length).toBeGreaterThan(1);

    timeoutSpy.mockClear();
    for (const callback of resizeCallbacks) {
      callback([], {} as ResizeObserver);
    }

    await Promise.resolve();
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 80);
  });

  it("re-samples after the visible image load settles even when fit keeps the same zoom", async () => {
    const timeoutSpy = vi.spyOn(window, "setTimeout");

    viewer.load("asset://photo.jpg", "photo.jpg");
    viewer.path = "/photos/photo.jpg";
    viewer.samplePath = "/photos/photo.jpg";
    viewer.setReady(800, 600);

    render(ImageViewer);
    const scheduledBeforeLoad = timeoutSpy.mock.calls.length;
    const img = screen.getByRole("img", { name: "photo.jpg" }) as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });

    await fireEvent.load(img);

    expect(timeoutSpy.mock.calls.length).toBeGreaterThan(scheduledBeforeLoad);
    expect(timeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 80);
  });

  it("does not restart sample fetching when the sampler image becomes ready", async () => {
    class MockImage {
      decoding = "async";
      onload: (() => void) | null = null;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", MockImage as unknown as typeof Image);

    viewer.load("asset://photo.jpg", "photo.jpg");
    viewer.path = "/photos/photo.jpg";
    viewer.samplePath = "/photos/photo.jpg";
    viewer.setReady(800, 600);

    render(ImageViewer);

    await waitFor(() => {
      expect(ipc.calls("sample_image")).toHaveLength(1);
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(ipc.calls("sample_image")).toHaveLength(1);
  });

});
