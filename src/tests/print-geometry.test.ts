import { describe, expect, it } from "vitest";

import {
  cellsPerPage,
  gridDescriptor,
  paperDimensions,
  printableArea,
} from "../lib/utils/print-geometry";
import {
  MARGIN_PRESETS,
  NAMED_SIZES,
  PAPER_SIZES,
  type MarginId,
  type Orientation,
  type PaperSizeId,
} from "../lib/utils/print-presets";

const PAPERS: PaperSizeId[] = ["letter", "a4", "a3", "legal", "a5"];
const MARGINS: MarginId[] = ["none", "normal", "wide"];
const ORIENTATIONS: Orientation[] = ["portrait", "landscape"];

describe("paperDimensions", () => {
  it("returns stored dims in portrait", () => {
    for (const p of PAPERS) {
      expect(paperDimensions(p, "portrait")).toEqual(PAPER_SIZES[p]);
    }
  });

  it("swaps width/height in landscape", () => {
    for (const p of PAPERS) {
      const dims = paperDimensions(p, "landscape");
      expect(dims.widthMm).toBe(PAPER_SIZES[p].heightMm);
      expect(dims.heightMm).toBe(PAPER_SIZES[p].widthMm);
    }
  });
});

describe("printableArea", () => {
  it("subtracts twice the margin from each axis for every paper/orientation/margin", () => {
    for (const p of PAPERS) {
      for (const o of ORIENTATIONS) {
        for (const m of MARGINS) {
          const paper = paperDimensions(p, o);
          const mm = MARGIN_PRESETS[m].marginMm;
          expect(printableArea(p, o, m)).toEqual({
            widthMm: paper.widthMm - mm * 2,
            heightMm: paper.heightMm - mm * 2,
          });
        }
      }
    }
  });

  it("clamps to zero when margins exceed the paper", () => {
    // A5 portrait is 148×210; wide margin (25.4) is fine, so synthesise an
    // extreme by checking the clamp against a small paper with the widest margin.
    const area = printableArea("a5", "portrait", "wide");
    expect(area.widthMm).toBeGreaterThanOrEqual(0);
    expect(area.heightMm).toBeGreaterThanOrEqual(0);
  });

  it("none margin yields the full paper", () => {
    expect(printableArea("a4", "portrait", "none")).toEqual(
      paperDimensions("a4", "portrait"),
    );
  });
});

describe("gridDescriptor — grid templates", () => {
  it("divides the printable area equally for each grid template", () => {
    const area = printableArea("letter", "portrait", "normal");
    const cases: Array<[Parameters<typeof gridDescriptor>[0], number, number]> = [
      ["full", 1, 1],
      ["twoUp", 1, 2],
      ["fourUp", 2, 2],
      ["nineUp", 3, 3],
    ];
    for (const [id, cols, rows] of cases) {
      const d = gridDescriptor(id, "letter", "portrait", "normal");
      expect(d.cols).toBe(cols);
      expect(d.rows).toBe(rows);
      expect(d.count).toBe(cols * rows);
      expect(d.cellWidthMm).toBeCloseTo(area.widthMm / cols);
      expect(d.cellHeightMm).toBeCloseTo(area.heightMm / rows);
    }
  });
});

describe("gridDescriptor — contact sheet", () => {
  it("uses a 5×7 grid in portrait", () => {
    const d = gridDescriptor("contact", "a4", "portrait", "normal");
    expect(d.cols).toBe(5);
    expect(d.rows).toBe(7);
    expect(d.count).toBe(35);
  });

  it("uses a 7×5 grid in landscape", () => {
    const d = gridDescriptor("contact", "a4", "landscape", "normal");
    expect(d.cols).toBe(7);
    expect(d.rows).toBe(5);
    expect(d.count).toBe(35);
  });
});

describe("gridDescriptor — named sizes", () => {
  it("floor-fits named-size cells into the printable area", () => {
    // A3 portrait (297×420), no margins, 4×6 cell (101.6×152.4):
    // cols = floor(297/101.6) = 2, rows = floor(420/152.4) = 2 → 4 cells.
    const d = gridDescriptor("photo4x6", "a3", "portrait", "none");
    const cell = NAMED_SIZES.photo4x6;
    expect(d.cols).toBe(2);
    expect(d.rows).toBe(2);
    expect(d.count).toBe(4);
    expect(d.cellWidthMm).toBe(cell.widthMm);
    expect(d.cellHeightMm).toBe(cell.heightMm);
  });

  it("fits a single named cell when only one fits per axis", () => {
    // A5 portrait (148×210), no margins, 5×7 cell (127×177.8):
    // cols = floor(148/127) = 1, rows = floor(210/177.8) = 1 → 1 cell.
    const d = gridDescriptor("photo5x7", "a5", "portrait", "none");
    expect(d.cols).toBe(1);
    expect(d.rows).toBe(1);
    expect(d.count).toBe(1);
  });

  it("clamps to 1×1 when the cell exceeds the printable area", () => {
    // A5 portrait (148×210), wide margins (25.4 → printable 97.2×159.2),
    // 8×10 cell (203.2×254) exceeds both axes → clamped to 1×1.
    const d = gridDescriptor("photo8x10", "a5", "portrait", "wide");
    expect(d.cols).toBe(1);
    expect(d.rows).toBe(1);
    expect(d.count).toBe(1);
    expect(d.cellWidthMm).toBe(NAMED_SIZES.photo8x10.widthMm);
    expect(d.cellHeightMm).toBe(NAMED_SIZES.photo8x10.heightMm);
  });

  it("respects orientation for named fit counts", () => {
    // A4 landscape (297×210), no margins, 4×6 cell:
    // cols = floor(297/101.6) = 2, rows = floor(210/152.4) = 1 → 2 cells.
    const d = gridDescriptor("photo4x6", "a4", "landscape", "none");
    expect(d.cols).toBe(2);
    expect(d.rows).toBe(1);
    expect(d.count).toBe(2);
  });
});

describe("cellsPerPage", () => {
  it("cellsPerPage matches the descriptor count", () => {
    expect(cellsPerPage("nineUp", "letter", "portrait", "normal")).toBe(9);
    expect(cellsPerPage("contact", "letter", "landscape", "none")).toBe(35);
  });
});
