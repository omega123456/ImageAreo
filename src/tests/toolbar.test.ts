import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import Toolbar from "../lib/components/Toolbar.svelte";
import { folder } from "../lib/stores/folder.svelte";

describe("Toolbar", () => {
  beforeEach(() => {
    folder.reset();
  });

  it("renders all action buttons with accessible labels", () => {
    render(Toolbar);
    for (const label of [
      "Open image",
      "Open folder",
      "Fit to screen",
      "Actual size",
      "Zoom in",
      "Zoom out",
      "Toggle fullscreen",
      "Rotate left",
      "Rotate right",
      "Toggle filmstrip",
      "Settings",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("floats with the translucent toolbar surface and blur", () => {
    const { container } = render(Toolbar);
    const header = container.querySelector("header");
    expect(header).toHaveClass("bg-toolbar-surface");
    expect(header).toHaveClass("backdrop-blur-sm");
  });

  it("wires each button to its callback", async () => {
    const onOpen = vi.fn();
    const onOpenFolder = vi.fn();
    const onFit = vi.fn();
    const onActualSize = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onToggleFullscreen = vi.fn();
    const onRotateLeft = vi.fn();
    const onRotateRight = vi.fn();
    const onSettings = vi.fn();
    const onToggleGallery = vi.fn();
    render(Toolbar, {
      props: {
        onOpen,
        onOpenFolder,
        onFit,
        onActualSize,
        onZoomIn,
        onZoomOut,
        onToggleFullscreen,
        onRotateLeft,
        onRotateRight,
        onSettings,
        onToggleGallery,
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Open image" }));
    await fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    await fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    await fireEvent.click(screen.getByRole("button", { name: "Actual size" }));
    await fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await fireEvent.click(screen.getByRole("button", { name: "Toggle fullscreen" }));
    await fireEvent.click(screen.getByRole("button", { name: "Rotate left" }));
    await fireEvent.click(screen.getByRole("button", { name: "Rotate right" }));
    await fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await fireEvent.click(screen.getByRole("button", { name: "Toggle filmstrip" }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpenFolder).toHaveBeenCalledOnce();
    expect(onFit).toHaveBeenCalledOnce();
    expect(onActualSize).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onToggleFullscreen).toHaveBeenCalledOnce();
    expect(onRotateLeft).toHaveBeenCalledOnce();
    expect(onRotateRight).toHaveBeenCalledOnce();
    expect(onSettings).toHaveBeenCalledOnce();
    expect(onToggleGallery).toHaveBeenCalledOnce();
  });

  it("reflects the filmstrip toggle pressed state", () => {
    render(Toolbar, { props: { galleryVisible: true } });
    expect(screen.getByRole("button", { name: "Toggle filmstrip" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reflects the fullscreen pressed state", () => {
    render(Toolbar, { props: { fullscreen: true } });
    expect(screen.getByRole("button", { name: "Toggle fullscreen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("hides the counter when no folder is loaded", () => {
    render(Toolbar);
    expect(screen.queryByLabelText("Image position")).toBeNull();
  });

  it("shows current / total when a folder is loaded", () => {
    folder.images = [
      { path: "/a.jpg", name: "a.jpg", modified: 0 },
      { path: "/b.jpg", name: "b.jpg", modified: 1 },
      { path: "/c.jpg", name: "c.jpg", modified: 2 },
    ];
    folder.currentIndex = 1;
    render(Toolbar);

    expect(screen.getByLabelText("Image position")).toHaveTextContent("2 / 3");
  });
});
