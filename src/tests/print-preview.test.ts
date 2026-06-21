import { render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PrintPreview from "../lib/components/PrintPreview.svelte";
import { print } from "../lib/stores/print.svelte";
import { viewer } from "../lib/stores/viewer.svelte";

function setReadyImage(): void {
  viewer.source = "asset://image.jpg";
  viewer.name = "image.jpg";
  viewer.status = "ready";
  viewer.rotation = 0;
}

describe("PrintPreview", () => {
  beforeEach(() => {
    viewer.reset();
    print.closeWindow();
    print.setTemplate("full");
    print.setPaperSize("letter");
    print.setOrientation("portrait");
    print.setMargins("normal");
    print.setCopies(1);
    print.setFit("fit");
  });

  afterEach(() => {
    viewer.reset();
    vi.restoreAllMocks();
  });

  it("renders a page card sized to the paper aspect ratio (portrait)", () => {
    setReadyImage();
    render(PrintPreview);

    const card = screen.getByTestId("print-page-card");
    const style = card.getAttribute("style") ?? "";
    const width = Number(/width:\s*([\d.]+)px/.exec(style)?.[1]);
    const height = Number(/height:\s*([\d.]+)px/.exec(style)?.[1]);

    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    // Letter portrait: 215.9 × 279.4 mm → height > width.
    expect(height).toBeGreaterThan(width);
    expect(width / height).toBeCloseTo(215.9 / 279.4, 3);
  });

  it("swaps width/height for landscape orientation", () => {
    setReadyImage();
    print.setOrientation("landscape");
    render(PrintPreview);

    const card = screen.getByTestId("print-page-card");
    const style = card.getAttribute("style") ?? "";
    const width = Number(/width:\s*([\d.]+)px/.exec(style)?.[1]);
    const height = Number(/height:\s*([\d.]+)px/.exec(style)?.[1]);

    expect(width).toBeGreaterThan(height);
  });

  it("renders one cell for the full-page template", () => {
    setReadyImage();
    render(PrintPreview);

    expect(screen.getAllByTestId("print-cell")).toHaveLength(1);
  });

  it("renders four cells for the 4-up template", () => {
    setReadyImage();
    print.setTemplate("fourUp");
    render(PrintPreview);

    expect(screen.getAllByTestId("print-cell")).toHaveLength(4);
  });

  it("renders nine cells for the 9-up template", () => {
    setReadyImage();
    print.setTemplate("nineUp");
    render(PrintPreview);

    expect(screen.getAllByTestId("print-cell")).toHaveLength(9);
  });

  it("renders 35 cells for the contact sheet template", () => {
    setReadyImage();
    print.setTemplate("contact");
    render(PrintPreview);

    expect(screen.getAllByTestId("print-cell")).toHaveLength(35);
  });

  it("renders the image with object-contain in fit mode", () => {
    setReadyImage();
    render(PrintPreview);

    const img = screen.getByTestId("print-cell").querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveClass("object-contain");
  });

  it("renders the image with object-cover in fill mode", () => {
    setReadyImage();
    print.setFit("fill");
    render(PrintPreview);

    const img = screen.getByTestId("print-cell").querySelector("img");
    expect(img).toHaveClass("object-cover");
  });

  it("applies the viewer rotation as an inline transform", () => {
    setReadyImage();
    viewer.rotation = 90;
    render(PrintPreview);

    const img = screen.getByTestId("print-cell").querySelector("img");
    expect(img?.getAttribute("style") ?? "").toContain("rotate(90deg)");
  });

  it("omits the image when the viewer is not ready", () => {
    viewer.reset();
    render(PrintPreview);

    expect(screen.getByTestId("print-cell").querySelector("img")).toBeNull();
  });

  it("shows the fill helper only when Fill is selected on a multi-cell template", () => {
    setReadyImage();
    print.setTemplate("fourUp");
    print.setFit("fill");
    render(PrintPreview);

    expect(screen.getByTestId("print-fill-helper")).toHaveTextContent(
      "Fill crops to fit cell",
    );
  });

  it("hides the fill helper on a single-cell template even in Fill mode", () => {
    setReadyImage();
    print.setTemplate("full");
    print.setFit("fill");
    render(PrintPreview);

    expect(screen.queryByTestId("print-fill-helper")).toBeNull();
  });

  it("hides the fill helper in Fit mode on a multi-cell template", () => {
    setReadyImage();
    print.setTemplate("fourUp");
    print.setFit("fit");
    render(PrintPreview);

    expect(screen.queryByTestId("print-fill-helper")).toBeNull();
  });

  it("announces the page count through a debounced aria-live region", async () => {
    vi.useFakeTimers();
    try {
      setReadyImage();
      print.setCopies(3);

      render(PrintPreview);
      await vi.advanceTimersByTimeAsync(300);

      const live = screen.getByTestId("print-page-count");
      expect(live).toHaveAttribute("aria-live", "polite");
      expect(live).toHaveTextContent("Page 1 of 3");
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});
