import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import Toolbar from "../lib/components/Toolbar.svelte";

describe("Toolbar", () => {
  it("renders all action buttons with accessible labels", () => {
    render(Toolbar);
    for (const label of [
      "Open image",
      "Fit to screen",
      "Actual size",
      "Zoom in",
      "Zoom out",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("wires each button to its callback", async () => {
    const onOpen = vi.fn();
    const onFit = vi.fn();
    const onActualSize = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    render(Toolbar, {
      props: { onOpen, onFit, onActualSize, onZoomIn, onZoomOut },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Open image" }));
    await fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    await fireEvent.click(screen.getByRole("button", { name: "Actual size" }));
    await fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onFit).toHaveBeenCalledOnce();
    expect(onActualSize).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
  });
});
