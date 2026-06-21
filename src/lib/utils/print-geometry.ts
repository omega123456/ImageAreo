/**
 * Pure layout math for the print domain — no DOM, no Tauri. Converts a
 * `(paperSize, orientation, margins, template)` selection into concrete physical
 * geometry: oriented paper dimensions, the printable area after margins, and a
 * grid descriptor (cols/rows + per-cell mm) for whichever template kind applies.
 */
import {
  CONTACT_LANDSCAPE,
  CONTACT_PORTRAIT,
  MARGIN_PRESETS,
  NAMED_SIZES,
  PAPER_SIZES,
  TEMPLATES,
  type MarginId,
  type Orientation,
  type PaperSizeId,
  type SizeMm,
  type TemplateId,
} from "./print-presets";

/** A printable region in mm. */
export interface PrintableArea {
  widthMm: number;
  heightMm: number;
}

/**
 * Resolved cell layout for a template within a printable area. `cols`/`rows`
 * give the packing grid; `cellWidthMm`/`cellHeightMm` are the per-cell physical
 * dimensions; `count` is cells per page (cols × rows).
 */
export interface GridDescriptor {
  cols: number;
  rows: number;
  cellWidthMm: number;
  cellHeightMm: number;
  count: number;
}

/**
 * Paper dimensions in mm for a given orientation. Portrait returns the stored
 * (width ≤ height) dims; landscape swaps them.
 */
export function paperDimensions(
  paperSize: PaperSizeId,
  orientation: Orientation,
): SizeMm {
  const { widthMm, heightMm } = PAPER_SIZES[paperSize];
  return orientation === "landscape"
    ? { widthMm: heightMm, heightMm: widthMm }
    : { widthMm, heightMm };
}

/**
 * Printable area after subtracting the margin preset from all four edges,
 * clamped at zero so an oversized margin never yields negative dimensions.
 */
export function printableArea(
  paperSize: PaperSizeId,
  orientation: Orientation,
  margins: MarginId,
): PrintableArea {
  const paper = paperDimensions(paperSize, orientation);
  const m = MARGIN_PRESETS[margins].marginMm;
  return {
    widthMm: Math.max(0, paper.widthMm - m * 2),
    heightMm: Math.max(0, paper.heightMm - m * 2),
  };
}

/**
 * Grid descriptor for a template within the given selection.
 *
 * - `grid` templates divide the printable area equally by their fixed cols/rows.
 * - `contact` sheets use a fixed 35-cell grid (portrait 5×7, landscape 7×5),
 *   each cell an equal division of the printable area.
 * - `named` sizes use fixed-mm cells, floor-packed top-left:
 *   `cols = max(1, floor(printableW/cellW))`, `rows = max(1, floor(printableH/cellH))`.
 *   The clamp to ≥1 guarantees at least one cell even when the named size
 *   exceeds the printable area.
 */
export function gridDescriptor(
  templateId: TemplateId,
  paperSize: PaperSizeId,
  orientation: Orientation,
  margins: MarginId,
): GridDescriptor {
  const template = TEMPLATES[templateId];
  const area = printableArea(paperSize, orientation, margins);

  if (template.kind === "named") {
    const cell = NAMED_SIZES[template.namedSize!];
    const cols = Math.max(1, Math.floor(area.widthMm / cell.widthMm));
    const rows = Math.max(1, Math.floor(area.heightMm / cell.heightMm));
    return {
      cols,
      rows,
      cellWidthMm: cell.widthMm,
      cellHeightMm: cell.heightMm,
      count: cols * rows,
    };
  }

  const { cols, rows } =
    template.kind === "contact"
      ? orientation === "landscape"
        ? CONTACT_LANDSCAPE
        : CONTACT_PORTRAIT
      : { cols: template.cols!, rows: template.rows! };

  return {
    cols,
    rows,
    cellWidthMm: area.widthMm / cols,
    cellHeightMm: area.heightMm / rows,
    count: cols * rows,
  };
}

/** Cells available per page for a template (cols × rows of its descriptor). */
export function cellsPerPage(
  templateId: TemplateId,
  paperSize: PaperSizeId,
  orientation: Orientation,
  margins: MarginId,
): number {
  return gridDescriptor(templateId, paperSize, orientation, margins).count;
}
