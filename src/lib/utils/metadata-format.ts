/**
 * Pure formatters for the image-info card (Phase 3).
 *
 * Every formatter turns one raw metadata field into a display string, or the
 * shared {@link OMIT} sentinel when the input is absent/unusable. The card uses
 * `=== OMIT` (equivalently {@link isOmitted}) to decide whether to skip a row,
 * so these helpers carry all the "is this field worth showing?" logic and the
 * card itself stays free of null-checking.
 *
 * Functions are side-effect-free and DOM-free so the full table can be asserted
 * directly in unit tests.
 */

/** Sentinel a formatter returns when its input is missing/unusable: skip the row. */
export const OMIT = "" as const;

/** A formatter result: a display string, or {@link OMIT} to omit the row. */
export type Formatted = string;

/** True when a formatter result signals "omit this row". */
export function isOmitted(value: Formatted): boolean {
  return value === OMIT;
}

/** Internal: a finite, real number guard (rejects NaN/Infinity/non-number). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Drop trailing-zero noise: `2.0` → `"2"`, `2.8` → `"2.8"`, `5.60` → `"5.6"`. */
function trimNumber(value: number): string {
  return Number.parseFloat(value.toFixed(2)).toString();
}

/**
 * Human-readable file size from a byte count. Uses binary (1024) steps and one
 * decimal place above the KB boundary; bytes render as whole numbers.
 * `OMIT` for missing, negative, or non-finite inputs.
 */
export function formatFileSize(bytes: number | null | undefined): Formatted {
  if (!isFiniteNumber(bytes) || bytes < 0) return OMIT;
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const units = ["KB", "MB", "GB", "TB"] as const;
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
}

/** `W × H` dimensions (uses a true multiplication sign). `OMIT` if either side is invalid. */
export function formatDimensions(
  width: number | null | undefined,
  height: number | null | undefined,
): Formatted {
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return OMIT;
  if (width <= 0 || height <= 0) return OMIT;
  return `${Math.round(width)} × ${Math.round(height)}`;
}

/**
 * Megapixels from a raw pixel count, one decimal place + `MP`. `OMIT` for
 * missing/invalid inputs. Pass the backend `pixels` field directly.
 */
export function formatMegapixels(pixels: number | null | undefined): Formatted {
  if (!isFiniteNumber(pixels) || pixels <= 0) return OMIT;
  return `${(pixels / 1_000_000).toFixed(1)} MP`;
}

/** Aperture as `f/<n>` from an f-number. `OMIT` for missing/invalid values. */
export function formatAperture(fNumber: number | null | undefined): Formatted {
  if (!isFiniteNumber(fNumber) || fNumber <= 0) return OMIT;
  return `f/${trimNumber(fNumber)}`;
}

/**
 * Shutter speed display. Accepts either a pre-formatted/rational string
 * (e.g. `"1/250"`, `"1/250 s"`) or a number of seconds. Sub-second numeric
 * speeds render as `1/<n> s`; one-second-and-over as `<n> s`. `OMIT` when absent.
 */
export function formatShutter(
  shutter: string | number | null | undefined,
): Formatted {
  if (typeof shutter === "string") {
    const trimmed = shutter.trim();
    if (trimmed === "") return OMIT;
    return /\bs$/i.test(trimmed) ? trimmed : `${trimmed} s`;
  }
  if (!isFiniteNumber(shutter) || shutter <= 0) return OMIT;
  if (shutter >= 1) return `${trimNumber(shutter)} s`;
  return `1/${Math.round(1 / shutter)} s`;
}

/** Focal length as `<n> mm`. `OMIT` for missing/invalid values. */
export function formatFocalLength(
  focalLength: number | null | undefined,
): Formatted {
  if (!isFiniteNumber(focalLength) || focalLength <= 0) return OMIT;
  return `${trimNumber(focalLength)} mm`;
}

/** ISO sensitivity as `ISO <n>`. `OMIT` for missing/invalid values. */
export function formatIso(iso: number | null | undefined): Formatted {
  if (!isFiniteNumber(iso) || iso <= 0) return OMIT;
  return `ISO ${Math.round(iso)}`;
}

/** Color-type label (e.g. `"RGB"`). `OMIT` when absent/blank. */
export function formatColorType(
  colorType: string | null | undefined,
): Formatted {
  const type = typeof colorType === "string" ? colorType.trim() : "";
  return type ? type : OMIT;
}

/** Bit depth as `<n>-bit` (e.g. `"8-bit"`). `OMIT` for missing/invalid values. */
export function formatBitDepth(
  bitDepth: number | null | undefined,
): Formatted {
  if (!isFiniteNumber(bitDepth) || bitDepth <= 0) return OMIT;
  return `${Math.round(bitDepth)}-bit`;
}

/** EXIF orientation codes (1–8) → human-readable transform names. */
const ORIENTATION_LABELS: Record<number, string> = {
  1: "Normal",
  2: "Flip horizontal",
  3: "Rotate 180",
  4: "Flip vertical",
  5: "Transpose",
  6: "Rotate 90 CW",
  7: "Transverse",
  8: "Rotate 270 CW",
};

/**
 * Orientation as `<n> (<name>)` for the eight EXIF codes (e.g. `"1 (Normal)"`).
 * Unknown finite codes render as the bare number. `OMIT` for missing/invalid.
 */
export function formatOrientation(
  orientation: number | null | undefined,
): Formatted {
  if (!isFiniteNumber(orientation)) return OMIT;
  const code = Math.round(orientation);
  const label = ORIENTATION_LABELS[code];
  return label ? `${code} (${label})` : String(code);
}

/**
 * Normalize an EXIF date-taken string for display. EXIF dates use the
 * `YYYY:MM:DD HH:MM:SS` form; the date portion's colons are converted to
 * hyphens so it parses/renders conventionally. Non-EXIF strings pass through
 * trimmed. `OMIT` for missing/empty input.
 */
export function formatDateTaken(
  dateTaken: string | null | undefined,
): Formatted {
  if (typeof dateTaken !== "string") return OMIT;
  const trimmed = dateTaken.trim();
  if (trimmed === "") return OMIT;

  const exif = /^(\d{4}):(\d{2}):(\d{2})([ T].*)?$/.exec(trimmed);
  if (exif) {
    const [, y, m, d, rest] = exif;
    return `${y}-${m}-${d}${rest ?? ""}`;
  }
  return trimmed;
}
