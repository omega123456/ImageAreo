import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import Toolbar from "../lib/components/Toolbar.svelte";
import { folder } from "../lib/stores/folder.svelte";
import { chromeTone } from "../lib/stores/chrome-tone.svelte";

describe("Toolbar", () => {
  beforeEach(() => {
    folder.reset();
    chromeTone.toolbarDark = true;
    chromeTone.enhanceDark = true;
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
      "Image info",
      "Settings",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("floats with the translucent toolbar surface and liquid-glass blur", () => {
    const { container } = render(Toolbar);
    const header = container.querySelector("header");
    expect(header).toHaveClass("bg-toolbar-surface");
    expect(header).toHaveClass("backdrop-blur-xl");
    expect(header).toHaveClass("backdrop-saturate-150");
    expect(header).toHaveClass("ring-glass-highlight");
  });

  it("uses sampled-tone hover and active fills over dark backdrops", () => {
    chromeTone.toolbarDark = true;
    render(Toolbar, { props: { galleryVisible: true } });

    const openButton = screen.getByRole("button", { name: "Open image" });
    const galleryButton = screen.getByRole("button", { name: "Toggle filmstrip" });
    expect(openButton).toHaveClass("hover:bg-chrome-hover-on-dark");
    expect(openButton).not.toHaveClass("hover:preset-tonal-surface");
    expect(galleryButton).toHaveClass("bg-chrome-active-on-dark");
  });

  it("uses sampled-tone hover and active fills over light backdrops", () => {
    chromeTone.toolbarDark = false;
    render(Toolbar, { props: { galleryVisible: true } });

    const openButton = screen.getByRole("button", { name: "Open image" });
    const galleryButton = screen.getByRole("button", { name: "Toggle filmstrip" });
    expect(openButton).toHaveClass("hover:bg-chrome-hover-on-light");
    expect(openButton).not.toHaveClass("hover:preset-tonal-surface");
    expect(galleryButton).toHaveClass("bg-chrome-active-on-light");
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

  it("renders the Info toggle and fires its callback", async () => {
    const onToggleInfo = vi.fn();
    render(Toolbar, { props: { onToggleInfo } });

    const infoButton = screen.getByRole("button", { name: "Image info" });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");

    await fireEvent.click(infoButton);
    expect(onToggleInfo).toHaveBeenCalledOnce();
  });

  it("reflects the Info toggle pressed state when open", () => {
    render(Toolbar, { props: { infoOpen: true } });
    expect(screen.getByRole("button", { name: "Image info" })).toHaveAttribute(
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

  it("disables image-specific actions when no image is loaded", () => {
    render(Toolbar, { props: { hasImage: false } });

    for (const label of [
      "Fit to screen",
      "Actual size",
      "Zoom in",
      "Zoom out",
      "Rotate left",
      "Rotate right",
      "Toggle filmstrip",
      "Image info",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }

    for (const label of ["Open image", "Open folder", "Toggle fullscreen", "Settings"]) {
      expect(screen.getByRole("button", { name: label })).not.toBeDisabled();
    }
  });

  it("enables all actions when an image is loaded", () => {
    render(Toolbar, { props: { hasImage: true } });

    for (const label of ["Fit to screen", "Zoom in", "Rotate left", "Image info"]) {
      expect(screen.getByRole("button", { name: label })).not.toBeDisabled();
    }
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
