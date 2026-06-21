/**
 * Static, pure definitions for the print domain: paper sizes, named photo-size
 * cells, margin presets, the template catalog, and copies bounds. All physical
 * dimensions are millimetres in portrait orientation (width × height); geometry
 * code swaps for landscape. No DOM, no Tauri — consumed by `print-geometry.ts`,
 * the print store, and the print UI.
 */
import type { IconName } from "../icons";

/** Physical paper or cell dimensions in millimetres (portrait: w ≤ h). */
export interface SizeMm {
  widthMm: number;
  heightMm: number;
}

/** Identifier for a standard paper size. */
export type PaperSizeId = "letter" | "a4" | "a3" | "legal" | "a5";

/** Identifier for a margin preset. */
export type MarginId = "none" | "normal" | "wide";

/** Page orientation. */
export type Orientation = "portrait" | "landscape";

/** How an image is sized within its cell. */
export type FitMode = "fit" | "fill";

/** A template kind drives which geometry branch produces its grid descriptor. */
export type TemplateKind = "grid" | "contact";

/** Identifier for a print template. */
export type TemplateId = "full" | "twoUp" | "fourUp" | "nineUp" | "contact";

/**
 * Standard paper sizes in mm, portrait. Letter/Legal are imperial-derived
 * (8.5×11 in, 8.5×14 in); A-series are ISO 216.
 */
export const PAPER_SIZES: Record<PaperSizeId, SizeMm> = {
  letter: { widthMm: 215.9, heightMm: 279.4 },
  a4: { widthMm: 210, heightMm: 297 },
  a3: { widthMm: 297, heightMm: 420 },
  legal: { widthMm: 215.9, heightMm: 355.6 },
  a5: { widthMm: 148, heightMm: 210 },
} as const;

/** Human-readable label per paper size. */
export const PAPER_SIZE_LABELS: Record<PaperSizeId, string> = {
  letter: "Letter",
  a4: "A4",
  a3: "A3",
  legal: "Legal",
  a5: "A5",
} as const;

/** Margin preset, in mm applied to all four edges. */
export interface MarginPreset {
  label: string;
  marginMm: number;
}

/** Margin presets: None 0, Normal 12.7 mm (0.5 in), Wide 25.4 mm (1 in). */
export const MARGIN_PRESETS: Record<MarginId, MarginPreset> = {
  none: { label: "None", marginMm: 0 },
  normal: { label: "Normal", marginMm: 12.7 },
  wide: { label: "Wide", marginMm: 25.4 },
} as const;

/** A print template definition. */
export interface Template {
  id: TemplateId;
  label: string;
  icon: IconName;
  kind: TemplateKind;
  /** Fixed column count — only for `grid` kinds. */
  cols?: number;
  /** Fixed row count — only for `grid` kinds. */
  rows?: number;
}

/**
 * The five-template catalog: four equal-division grids and one contact sheet.
 * Icon keys reference {@link IconName} registered in `icons.ts`.
 */
export const TEMPLATES: Record<TemplateId, Template> = {
  full: { id: "full", label: "Full page", icon: "printFull", kind: "grid", cols: 1, rows: 1 },
  twoUp: { id: "twoUp", label: "2-up", icon: "printTwoUp", kind: "grid", cols: 1, rows: 2 },
  fourUp: { id: "fourUp", label: "4-up", icon: "printFourUp", kind: "grid", cols: 2, rows: 2 },
  nineUp: { id: "nineUp", label: "9-up", icon: "printNineUp", kind: "grid", cols: 3, rows: 3 },
  contact: { id: "contact", label: "Contact sheet", icon: "printContact", kind: "contact" },
} as const;

/** Display order for the template catalog in the UI. */
export const TEMPLATE_ORDER: TemplateId[] = [
  "full",
  "twoUp",
  "fourUp",
  "nineUp",
  "contact",
];

/** Contact-sheet fixed cell grid: portrait 5×7, landscape 7×5 (35 cells). */
export const CONTACT_PORTRAIT = { cols: 5, rows: 7 } as const;
export const CONTACT_LANDSCAPE = { cols: 7, rows: 5 } as const;
export const CONTACT_CELL_COUNT = 35;

/** Inclusive bounds for the copies field. */
export const COPIES_MIN = 1;
export const COPIES_MAX = 99;
