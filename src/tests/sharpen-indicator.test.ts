import { render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SharpenIndicator from "../lib/components/SharpenIndicator.svelte";
import { chromeTone } from "../lib/stores/chrome-tone.svelte";
import { viewer } from "../lib/stores/viewer.svelte";

function reset(): void {
  viewer.reset();
  viewer.sharpening = false;
  chromeTone.sharpenDark = true;
}

describe("SharpenIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    reset();
  });

  it("stays hidden until the ~350ms appear debounce elapses", async () => {
    viewer.sharpening = true;
    render(SharpenIndicator);

    // Not yet visible immediately after `sharpening` flips.
    expect(screen.queryByTestId("sharpen-indicator")).toBeNull();

    await vi.advanceTimersByTimeAsync(349);
    expect(screen.queryByTestId("sharpen-indicator")).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(screen.getByTestId("sharpen-indicator")).toBeInTheDocument();
  });

  it("renders the busy pill with the shared pill classes and a11y attributes", async () => {
    viewer.sharpening = true;
    render(SharpenIndicator);
    await vi.advanceTimersByTimeAsync(350);

    const pill = screen.getByTestId("sharpen-indicator");
    expect(pill).toHaveTextContent("Sharpening…");
    expect(pill).toHaveAttribute("role", "status");
    expect(pill).toHaveAttribute("aria-live", "polite");
    expect(pill).toHaveAttribute("aria-busy", "true");
    expect(pill).toHaveClass(
      "pointer-events-none",
      "bg-toolbar-surface",
      "ring-glass-highlight",
      "backdrop-blur-xl",
      "backdrop-saturate-150",
      "text-chrome-glyph-on-dark",
      "drop-shadow-glyph",
    );
    // Spinner matches EnhanceControl and is hidden from AT.
    expect(pill.querySelector('[aria-hidden="true"]')).toHaveClass(
      "animate-spin",
      "border-current",
      "border-t-transparent",
    );
  });

  it("dismisses ~400ms after the sharp tier paints", async () => {
    viewer.sharpening = true;
    render(SharpenIndicator);
    await vi.advanceTimersByTimeAsync(350);
    expect(screen.getByTestId("sharpen-indicator")).toBeInTheDocument();

    // Sharp tier painted: the store clears the flag.
    viewer.sharpening = false;
    await vi.advanceTimersByTimeAsync(399);
    expect(screen.getByTestId("sharpen-indicator")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1);
    expect(screen.queryByTestId("sharpen-indicator")).toBeNull();
  });

  it("never appears for a sharpening burst shorter than the appear debounce", async () => {
    viewer.sharpening = true;
    render(SharpenIndicator);

    // Fast upgrade: flag clears well before the 350ms appear delay.
    await vi.advanceTimersByTimeAsync(100);
    viewer.sharpening = false;
    await vi.advanceTimersByTimeAsync(600);

    expect(screen.queryByTestId("sharpen-indicator")).toBeNull();
  });

  it("adapts the foreground to a light sampled backdrop", async () => {
    viewer.sharpening = true;
    chromeTone.sharpenDark = false;
    render(SharpenIndicator);
    await vi.advanceTimersByTimeAsync(350);

    const pill = screen.getByTestId("sharpen-indicator");
    expect(pill).toHaveClass("text-chrome-glyph-on-light");
    expect(pill).not.toHaveClass("drop-shadow-glyph");
  });

  it("publishes its live bounds while visible", async () => {
    const onBoundsChange = vi.fn();
    viewer.sharpening = true;
    render(SharpenIndicator, { props: { onBoundsChange } });
    await vi.advanceTimersByTimeAsync(350);

    expect(onBoundsChange).toHaveBeenCalled();
    expect(onBoundsChange.mock.calls.at(-1)?.[0]).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
  });

  it("announces through a debounced sr-only aria-live mirror", async () => {
    viewer.sharpening = true;
    render(SharpenIndicator);

    await vi.advanceTimersByTimeAsync(300);
    const live = document.querySelector(".sr-only");
    expect(live).toHaveTextContent("Sharpening image");
  });
});
