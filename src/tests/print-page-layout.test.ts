import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/svelte";

import PrintPageLayout from "../lib/components/PrintPageLayout.svelte";
import { print } from "../lib/stores/print.svelte";
import { viewer } from "../lib/stores/viewer.svelte";
import {
  cellsPerPage,
  paperDimensions,
} from "../lib/utils/print-geometry";

describe("PrintPageLayout", () => {
  beforeEach(() => {
    viewer.reset();
    print.reset();
  });

  it("renders nothing when the print window is closed", () => {
    viewer.load("asset://poster.jpg", "poster.jpg");
    const { container } = render(PrintPageLayout);
    expect(
      container.querySelector("[data-testid='print-page-layout']"),
    ).toBeNull();
  });

  it("renders nothing when open but no image is loaded", () => {
    print.openWindow();
    const { container } = render(PrintPageLayout);
    expect(
      container.querySelector("[data-testid='print-page-layout']"),
    ).toBeNull();
  });

  it("stays mounted during an in-flight print after the modal closes", () => {
    // Simulate the post-Print state: the custom modal has closed (open=false)
    // but the async OS dialog is still reading the live print DOM.
    viewer.load("asset://poster.jpg", "poster.jpg");
    print.setPrintImage("data:image/png;base64,AAAA");
    print.beginPrinting();
    print.closeWindow();
    const { container } = render(PrintPageLayout);

    expect(print.open).toBe(false);
    expect(
      container.querySelector("[data-testid='print-page-layout']"),
    ).not.toBeNull();
    // The inlined data URL is what actually prints (not the asset:// source).
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("is hidden on screen and revealed only under @media print", () => {
    print.openWindow();
    viewer.load("asset://poster.jpg", "poster.jpg");
    const { container } = render(PrintPageLayout);

    const root = container.querySelector(
      "[data-testid='print-page-layout']",
    ) as HTMLElement;
    expect(root.className).toContain("hidden");
    expect(root.className).toContain("print:block");
  });

  it("renders one page box per copy", () => {
    print.openWindow();
    print.setCopies(3);
    viewer.load("asset://poster.jpg", "poster.jpg");
    const { container } = render(PrintPageLayout);

    expect(container.querySelectorAll("[data-testid='print-page']")).toHaveLength(
      3,
    );
  });

  it.each([
    ["full" as const, "letter" as const],
    ["fourUp" as const, "letter" as const],
    ["nineUp" as const, "a4" as const],
    ["contact" as const, "letter" as const],
  ])(
    "renders the correct cell count per page for template %s",
    (template, paper) => {
      print.openWindow();
      print.setTemplate(template);
      print.setPaperSize(paper);
      viewer.load("asset://poster.jpg", "poster.jpg");
      const { container } = render(PrintPageLayout);

      const expected = cellsPerPage(
        template,
        paper,
        "portrait",
        "normal",
      );
      const page = container.querySelector(
        "[data-testid='print-page']",
      ) as HTMLElement;
      // The grid still lays out `expected` cells, but the image is placed
      // once (top-left cell only), not duplicated across every cell.
      expect(
        page.querySelectorAll("[data-testid='print-cell']"),
      ).toHaveLength(expected);
      expect(page.querySelectorAll("img")).toHaveLength(1);
    },
  );

  it("sizes each page box at the real mm paper dimensions and grid", () => {
    print.openWindow();
    print.setTemplate("fourUp");
    print.setPaperSize("a4");
    viewer.load("asset://poster.jpg", "poster.jpg");
    const { container } = render(PrintPageLayout);

    const paper = paperDimensions("a4", "portrait");
    const page = container.querySelector(
      "[data-testid='print-page']",
    ) as HTMLElement;
    expect(page.style.width).toBe(`${paper.widthMm}mm`);
    expect(page.style.height).toBe(`${paper.heightMm}mm`);
    // 2×2 grid for fourUp.
    expect(page.style.gridTemplateColumns).toContain("repeat(2,");
    expect(page.style.gridTemplateRows).toContain("repeat(2,");
  });

  it("emits a dynamic @page size rule matching the selected paper/orientation", () => {
    print.openWindow();
    print.setPaperSize("a4");
    print.setOrientation("landscape");
    viewer.load("asset://poster.jpg", "poster.jpg");
    render(PrintPageLayout);

    const paper = paperDimensions("a4", "landscape");
    const styles = [...document.head.querySelectorAll("style")].map(
      (s) => s.textContent ?? "",
    );
    const hasRule = styles.some((css) =>
      css.includes(`size: ${paper.widthMm}mm ${paper.heightMm}mm`),
    );
    expect(hasRule).toBe(true);
  });

  it("uses object-contain for fit and object-cover for fill", () => {
    print.openWindow();
    viewer.load("asset://poster.jpg", "poster.jpg");

    const fitRender = render(PrintPageLayout);
    expect(
      (fitRender.container.querySelector("img") as HTMLImageElement).className,
    ).toContain("print:object-contain");
    fitRender.unmount();

    print.setFit("fill");
    const fillRender = render(PrintPageLayout);
    expect(
      (fillRender.container.querySelector("img") as HTMLImageElement).className,
    ).toContain("print:object-cover");
  });

  it("composes the viewer rotation as a transform on the image", () => {
    print.openWindow();
    viewer.load("asset://poster.jpg", "poster.jpg");
    viewer.rotateRight(); // 90deg
    const { container } = render(PrintPageLayout);

    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.style.transform).toBe("rotate(90deg)");
    expect(img.getAttribute("src")).toBe("asset://poster.jpg");
    expect(img).toHaveAttribute("alt", "poster.jpg");
  });

  it("falls back to a generic alt when the image has no name", () => {
    print.openWindow();
    viewer.load("asset://no-name.png");
    const { container } = render(PrintPageLayout);
    expect(container.querySelector("img")).toHaveAttribute("alt", "Image");
  });
});
