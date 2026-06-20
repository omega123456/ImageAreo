import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/svelte";

import PrintLayout from "../lib/components/PrintLayout.svelte";
import { viewer } from "../lib/stores/viewer.svelte";

describe("PrintLayout", () => {
  beforeEach(() => {
    viewer.reset();
  });

  it("renders nothing when no image is loaded", () => {
    const { container } = render(PrintLayout);
    expect(container.querySelector("[data-testid='print-layout']")).toBeNull();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the loaded source as the print image", () => {
    viewer.load("asset://poster.jpg", "poster.jpg");
    const { container } = render(PrintLayout);

    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("asset://poster.jpg");
    expect(img).toHaveAttribute("alt", "poster.jpg");
    // No zoom/pan/rotation transform is applied to the printed image.
    expect(img.style.transform).toBe("");

    // Hidden on screen; revealed only under `@media print` (Tailwind `print:`).
    const root = container.querySelector(
      "[data-testid='print-layout']",
    ) as HTMLElement;
    expect(root.className).toContain("hidden");
    expect(root.className).toContain("print:flex");
    expect(img.className).toContain("print:object-contain");
  });

  it("falls back to a generic alt when the image has no name", () => {
    viewer.load("asset://no-name.png");
    render(PrintLayout);
    expect(screen.getByRole("img")).toHaveAttribute("alt", "Image");
  });
});
