import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import Toolbar from "../lib/components/Toolbar.svelte";

describe("Toolbar", () => {
  it("renders all action buttons with accessible labels", () => {
    render(Toolbar);
    for (const label of [
      "Open image",
      "Open folder",
      "Fit to screen",
      "Actual size",
      "Zoom in",
      "Zoom out",
      "Rotate left",
      "Rotate right",
      "Settings",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("wires each button to its callback", async () => {
    const onOpen = vi.fn();
    const onOpenFolder = vi.fn();
    const onFit = vi.fn();
    const onActualSize = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onRotateLeft = vi.fn();
    const onRotateRight = vi.fn();
    const onSettings = vi.fn();
    render(Toolbar, {
      props: {
        onOpen,
        onOpenFolder,
        onFit,
        onActualSize,
        onZoomIn,
        onZoomOut,
        onRotateLeft,
        onRotateRight,
        onSettings,
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Open image" }));
    await fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    await fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    await fireEvent.click(screen.getByRole("button", { name: "Actual size" }));
    await fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await fireEvent.click(screen.getByRole("button", { name: "Rotate left" }));
    await fireEvent.click(screen.getByRole("button", { name: "Rotate right" }));
    await fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpenFolder).toHaveBeenCalledOnce();
    expect(onFit).toHaveBeenCalledOnce();
    expect(onActualSize).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onRotateLeft).toHaveBeenCalledOnce();
    expect(onRotateRight).toHaveBeenCalledOnce();
    expect(onSettings).toHaveBeenCalledOnce();
  });
});
