import { describe, expect, it } from "vitest";

import { icons } from "../lib/icons";
import {
  COPIES_MAX,
  COPIES_MIN,
  CONTACT_CELL_COUNT,
  CONTACT_LANDSCAPE,
  CONTACT_PORTRAIT,
  MARGIN_PRESETS,
  PAPER_SIZES,
  PAPER_SIZE_LABELS,
  TEMPLATES,
  TEMPLATE_ORDER,
  type MarginId,
  type PaperSizeId,
} from "../lib/utils/print-presets";

describe("print presets — paper sizes", () => {
  it("defines the five paper sizes with exact portrait mm dims", () => {
    expect(PAPER_SIZES.letter).toEqual({ widthMm: 215.9, heightMm: 279.4 });
    expect(PAPER_SIZES.a4).toEqual({ widthMm: 210, heightMm: 297 });
    expect(PAPER_SIZES.a3).toEqual({ widthMm: 297, heightMm: 420 });
    expect(PAPER_SIZES.legal).toEqual({ widthMm: 215.9, heightMm: 355.6 });
    expect(PAPER_SIZES.a5).toEqual({ widthMm: 148, heightMm: 210 });
  });

  it("stores every paper size in portrait (width ≤ height)", () => {
    for (const [id, size] of Object.entries(PAPER_SIZES)) {
      expect(size.widthMm, id).toBeLessThanOrEqual(size.heightMm);
    }
  });

  it("labels every paper size", () => {
    for (const id of Object.keys(PAPER_SIZES) as PaperSizeId[]) {
      expect(PAPER_SIZE_LABELS[id]).toBeTruthy();
    }
  });
});

describe("print presets — margins", () => {
  it("defines None/Normal/Wide with exact mm values", () => {
    expect(MARGIN_PRESETS.none.marginMm).toBe(0);
    expect(MARGIN_PRESETS.normal.marginMm).toBe(12.7);
    expect(MARGIN_PRESETS.wide.marginMm).toBe(25.4);
  });

  it("labels every margin preset", () => {
    for (const id of Object.keys(MARGIN_PRESETS) as MarginId[]) {
      expect(MARGIN_PRESETS[id].label).toBeTruthy();
    }
  });
});

describe("print presets — template catalog", () => {
  it("contains five templates in display order", () => {
    expect(TEMPLATE_ORDER).toHaveLength(5);
    expect(new Set(TEMPLATE_ORDER).size).toBe(5);
    for (const id of TEMPLATE_ORDER) {
      expect(TEMPLATES[id]).toBeDefined();
    }
  });

  it("defines the four grid templates with fixed cols/rows", () => {
    expect(TEMPLATES.full).toMatchObject({ kind: "grid", cols: 1, rows: 1 });
    expect(TEMPLATES.twoUp).toMatchObject({ kind: "grid", cols: 1, rows: 2 });
    expect(TEMPLATES.fourUp).toMatchObject({ kind: "grid", cols: 2, rows: 2 });
    expect(TEMPLATES.nineUp).toMatchObject({ kind: "grid", cols: 3, rows: 3 });
  });

  it("defines the contact sheet as a contact kind", () => {
    expect(TEMPLATES.contact.kind).toBe("contact");
    expect(TEMPLATES.contact.cols).toBeUndefined();
    expect(TEMPLATES.contact.rows).toBeUndefined();
  });

  it("references a registered icon for every template", () => {
    for (const id of TEMPLATE_ORDER) {
      expect(icons[TEMPLATES[id].icon]).toBeDefined();
    }
  });
});

describe("print presets — contact + copies constants", () => {
  it("fixes the contact grid at 35 cells (portrait 5×7, landscape 7×5)", () => {
    expect(CONTACT_PORTRAIT).toEqual({ cols: 5, rows: 7 });
    expect(CONTACT_LANDSCAPE).toEqual({ cols: 7, rows: 5 });
    expect(CONTACT_CELL_COUNT).toBe(35);
    expect(CONTACT_PORTRAIT.cols * CONTACT_PORTRAIT.rows).toBe(CONTACT_CELL_COUNT);
    expect(CONTACT_LANDSCAPE.cols * CONTACT_LANDSCAPE.rows).toBe(
      CONTACT_CELL_COUNT,
    );
  });

  it("bounds copies at 1–99", () => {
    expect(COPIES_MIN).toBe(1);
    expect(COPIES_MAX).toBe(99);
  });
});
