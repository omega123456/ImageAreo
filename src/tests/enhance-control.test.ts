import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EnhanceControl from "../lib/components/EnhanceControl.svelte";
import { chromeTone } from "../lib/stores/chrome-tone.svelte";
import { viewer } from "../lib/stores/viewer.svelte";

function resetViewer(): void {
  viewer.reset();
  viewer.enhanceAvailable = false;
  viewer.enhancing = false;
  viewer.enhanced = false;
  viewer.enhanceError = false;
  chromeTone.enhanceDark = true;
}

describe("EnhanceControl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetViewer();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetViewer();
  });

  it("renders the Available button with the correct a11y attributes and tooltip", () => {
    viewer.enhanceAvailable = true;
    render(EnhanceControl);

    const control = screen.getByTestId("enhance-control");
    expect(control.tagName).toBe("BUTTON");
    expect(control).toHaveTextContent("Enhance");
    expect(control).toHaveAttribute(
      "aria-label",
      "Enhance this RAW to full sensor resolution",
    );
    // Hover tooltip explaining the action.
    expect(control).toHaveAttribute("title");
    expect(control.getAttribute("title")).toMatch(/full-resolution/i);
    expect(control).not.toHaveAttribute("aria-pressed");
    expect(control).toHaveClass(
      "bg-toolbar-surface",
      "ring-glass-highlight",
      "backdrop-blur-xl",
      "backdrop-saturate-150",
      "text-chrome-glyph-on-dark",
      "drop-shadow-glyph",
    );
  });

  it("adapts the control foreground to a light sampled backdrop", () => {
    viewer.enhanceAvailable = true;
    chromeTone.enhanceDark = false;
    render(EnhanceControl);

    expect(screen.getByTestId("enhance-control")).toHaveClass("text-chrome-glyph-on-light");
    expect(screen.getByTestId("enhance-control")).not.toHaveClass("drop-shadow-glyph");
  });

  it("publishes its live bounds while mounted", () => {
    const onBoundsChange = vi.fn();
    viewer.enhanceAvailable = true;
    render(EnhanceControl, { props: { onBoundsChange } });

    expect(onBoundsChange).toHaveBeenCalled();
    expect(onBoundsChange.mock.calls[0][0]).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
  });

  it("calls requestEnhance on click without any confirmation dialog", async () => {
    const requestEnhance = vi
      .spyOn(viewer, "requestEnhance")
      .mockResolvedValue();
    viewer.enhanceAvailable = true;
    render(EnhanceControl);

    await fireEvent.click(screen.getByTestId("enhance-control"));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(requestEnhance).toHaveBeenCalledTimes(1);
  });

  it("renders the busy Loading state with aria-busy and a debounced announcement", async () => {
    viewer.enhancing = true;
    render(EnhanceControl);

    const control = screen.getByTestId("enhance-control");
    expect(control).toHaveAttribute("aria-busy", "true");
    expect(control).toHaveTextContent("Enhancing…");
    expect(control).toHaveClass("bg-toolbar-surface", "text-chrome-glyph-on-dark");
    expect(control.querySelector('[aria-hidden="true"]')).toHaveClass("border-current", "border-t-transparent");

    await vi.advanceTimersByTimeAsync(300);
    const live = document.querySelector(".sr-only");
    expect(live).toHaveTextContent("Enhancing image");
  });

  it("renders nothing once the image is enhanced", () => {
    viewer.enhanceAvailable = true;
    viewer.enhanced = true;
    render(EnhanceControl);

    expect(screen.queryByTestId("enhance-control")).toBeNull();
  });

  it("renders the error state and auto-dismisses it back to Available", async () => {
    viewer.enhanceError = true;
    render(EnhanceControl);

    const control = screen.getByTestId("enhance-control");
    expect(control).toHaveAttribute("role", "alert");
    expect(control).toHaveTextContent("Couldn't enhance");
    expect(control).toHaveClass("bg-toolbar-surface", "text-chrome-glyph-on-dark");

    await vi.advanceTimersByTimeAsync(2500);
    expect(viewer.enhanceError).toBe(false);
  });
});
