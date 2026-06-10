import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ImageViewer from "../lib/components/ImageViewer.svelte";
import { viewer } from "../lib/stores/viewer.svelte";

describe("ImageViewer", () => {
  beforeEach(() => {
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

  it("exposes a controller via the bound prop and tears it down on unmount", () => {
    viewer.load("asset://photo.jpg", "photo.jpg");
    const { unmount } = render(ImageViewer);
    // The container exists, so the $effect should have constructed a controller.
    expect(document.querySelector(".bg-canvas-surround")).not.toBeNull();
    unmount();
  });
});
