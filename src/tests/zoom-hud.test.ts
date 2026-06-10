import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import ZoomHud from "../lib/components/ZoomHud.svelte";
import { viewer } from "../lib/stores/viewer.svelte";

describe("ZoomHud", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    viewer.reset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing until the image is ready", () => {
    viewer.load("asset://x.jpg");
    render(ZoomHud);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it('shows "Fit" in fit mode', () => {
    viewer.load("asset://x.jpg");
    viewer.setReady(100, 100);
    viewer.fitMode = "fit";
    render(ZoomHud);
    expect(screen.getByRole("button")).toHaveTextContent("Fit");
  });

  it("shows the rounded zoom percentage when not fitting", () => {
    viewer.load("asset://x.jpg");
    viewer.setReady(100, 100);
    viewer.fitMode = "free";
    viewer.zoom = 0.753;
    render(ZoomHud);
    expect(screen.getByRole("button")).toHaveTextContent("75%");
  });

  it("invokes onToggle when clicked", async () => {
    viewer.load("asset://x.jpg");
    viewer.setReady(100, 100);
    const onToggle = vi.fn();
    render(ZoomHud, { props: { onToggle } });
    screen.getByRole("button").click();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("debounces the aria-live announcement", async () => {
    viewer.load("asset://x.jpg");
    viewer.setReady(100, 100);
    viewer.fitMode = "fit";
    render(ZoomHud);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    await vi.advanceTimersByTimeAsync(350);
    expect(live).toHaveTextContent("Zoom Fit");
  });
});
