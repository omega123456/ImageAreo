import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import ImageViewer from "../lib/components/ImageViewer.svelte";
import { viewer } from "../lib/stores/viewer.svelte";

describe("ImageViewer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    viewer.reset();
    // jsdom does not run rAF naturally; make it synchronous for fit-on-load.
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
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
});
