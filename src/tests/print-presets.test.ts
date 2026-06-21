import { describe, expect, it } from "vitest";

import { icons } from "../lib/icons";
import {
  COPIES_MAX,
  COPIES_MIN,
  CONTACT_CELL_COUNT,
  CONTACT_LANDSCAPE,
  CONTACT_PORTRAIT,
  MARGIN_PRESETS,
  NAMED_SIZES,
  NAMED_SIZE_LABELS,
  PAPER_SIZES,
  PAPER_SIZE_LABELS,
  TEMPLATES,
  TEMPLATE_ORDER,
  type MarginId,
  type NamedSizeId,
  type PaperSizeId,
  type TemplateId,
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

describe("print presets — named photo sizes", () => {
  it("defines the four named sizes with exact mm cell dims", () => {
    expect(NAMED_SIZES.photo4x6).toEqual({ widthMm: 101.6, heightMm: 152.4 });
    expect(NAMED_SIZES.photo5x7).toEqual({ widthMm: 127, heightMm: 177.8 });
    expect(NAMED_SIZES.photo8x10).toEqual({ widthMm: 203.2, heightMm: 254 });
    expect(NAMED_SIZES.photo10x15).toEqual({ widthMm: 100, heightMm: 150 });
  });

  it("labels every named size", () => {
    for (const id of Object.keys(NAMED_SIZES) as NamedSizeId[]) {
      expect(NAMED_SIZE_LABELS[id]).toBeTruthy();
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
  it("contains nine templates in display order", () => {
    expect(TEMPLATE_ORDER).toHaveLength(9);
    expect(new Set(TEMPLATE_ORDER).size).toBe(9);
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

  it("defines four named templates referencing a named size", () => {
    const named: TemplateId[] = [
      "photo4x6",
      "photo5x7",
      "photo8x10",
      "photo10x15",
    ];
    for (const id of named) {
      expect(TEMPLATES[id].kind).toBe("named");
      const ref = TEMPLATES[id].namedSize as NamedSizeId;
      expect(NAMED_SIZES[ref]).toBeDefined();
    }
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
