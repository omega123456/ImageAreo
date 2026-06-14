import { describe, expect, it } from "vitest";

import {
  OMIT,
  formatAperture,
  formatBitDepth,
  formatColorType,
  formatDateTaken,
  formatDimensions,
  formatFileSize,
  formatFocalLength,
  formatIso,
  formatMegapixels,
  formatOrientation,
  formatShutter,
  isOmitted,
} from "../lib/utils/metadata-format";

describe("isOmitted / OMIT", () => {
  it("recognizes the omit sentinel", () => {
    expect(isOmitted(OMIT)).toBe(true);
    expect(isOmitted("anything")).toBe(false);
  });
});

describe("formatFileSize", () => {
  it("renders bytes, KB, MB and GB on binary boundaries", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(3.2 * 1024 * 1024)).toBe("3.2 MB");
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatFileSize(2 * 1024 ** 4)).toBe("2.0 TB");
  });

  it("rounds sub-KB byte counts to whole numbers", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(999.6)).toBe("1000 B");
  });

  it("omits missing, negative or non-finite sizes", () => {
    expect(formatFileSize(null)).toBe(OMIT);
    expect(formatFileSize(undefined)).toBe(OMIT);
    expect(formatFileSize(-1)).toBe(OMIT);
    expect(formatFileSize(Number.NaN)).toBe(OMIT);
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe(OMIT);
  });
});

describe("formatDimensions", () => {
  it("renders W × H with a multiplication sign", () => {
    expect(formatDimensions(6000, 4000)).toBe("6000 × 4000");
    expect(formatDimensions(1920.4, 1080.6)).toBe("1920 × 1081");
  });

  it("omits when either side is missing or non-positive", () => {
    expect(formatDimensions(null, 4000)).toBe(OMIT);
    expect(formatDimensions(6000, undefined)).toBe(OMIT);
    expect(formatDimensions(0, 4000)).toBe(OMIT);
    expect(formatDimensions(6000, -1)).toBe(OMIT);
  });
});

describe("formatMegapixels", () => {
  it("renders one decimal place plus MP", () => {
    expect(formatMegapixels(24_000_000)).toBe("24.0 MP");
    expect(formatMegapixels(12_200_000)).toBe("12.2 MP");
  });

  it("omits invalid pixel counts", () => {
    expect(formatMegapixels(0)).toBe(OMIT);
    expect(formatMegapixels(null)).toBe(OMIT);
    expect(formatMegapixels(Number.NaN)).toBe(OMIT);
  });
});

describe("formatAperture", () => {
  it("renders f/<n> trimming trailing zeros", () => {
    expect(formatAperture(2.8)).toBe("f/2.8");
    expect(formatAperture(2)).toBe("f/2");
    expect(formatAperture(5.6)).toBe("f/5.6");
  });

  it("omits invalid f-numbers", () => {
    expect(formatAperture(0)).toBe(OMIT);
    expect(formatAperture(undefined)).toBe(OMIT);
  });
});

describe("formatShutter", () => {
  it("formats sub-second numeric seconds as a fraction", () => {
    expect(formatShutter(1 / 250)).toBe("1/250 s");
    expect(formatShutter(0.004)).toBe("1/250 s");
  });

  it("formats one-second-and-over numeric speeds plainly", () => {
    expect(formatShutter(1)).toBe("1 s");
    expect(formatShutter(2.5)).toBe("2.5 s");
  });

  it("passes through rational/string speeds and appends the unit", () => {
    expect(formatShutter("1/250")).toBe("1/250 s");
    expect(formatShutter("1/250 s")).toBe("1/250 s");
    expect(formatShutter("2 s")).toBe("2 s");
  });

  it("omits empty or invalid speeds", () => {
    expect(formatShutter("")).toBe(OMIT);
    expect(formatShutter("   ")).toBe(OMIT);
    expect(formatShutter(0)).toBe(OMIT);
    expect(formatShutter(null)).toBe(OMIT);
  });
});

describe("formatFocalLength", () => {
  it("renders <n> mm", () => {
    expect(formatFocalLength(35)).toBe("35 mm");
    expect(formatFocalLength(85.5)).toBe("85.5 mm");
  });

  it("omits invalid focal lengths", () => {
    expect(formatFocalLength(0)).toBe(OMIT);
    expect(formatFocalLength(null)).toBe(OMIT);
  });
});

describe("formatIso", () => {
  it("renders ISO <n>", () => {
    expect(formatIso(400)).toBe("ISO 400");
    expect(formatIso(1600.4)).toBe("ISO 1600");
  });

  it("omits invalid ISO values", () => {
    expect(formatIso(0)).toBe(OMIT);
    expect(formatIso(undefined)).toBe(OMIT);
  });
});

describe("formatColorType", () => {
  it("renders the trimmed color-type label", () => {
    expect(formatColorType("RGB")).toBe("RGB");
    expect(formatColorType("  RGBA  ")).toBe("RGBA");
    expect(formatColorType("Grayscale")).toBe("Grayscale");
  });

  it("omits missing or blank color types", () => {
    expect(formatColorType(null)).toBe(OMIT);
    expect(formatColorType(undefined)).toBe(OMIT);
    expect(formatColorType("")).toBe(OMIT);
    expect(formatColorType("   ")).toBe(OMIT);
  });
});

describe("formatBitDepth", () => {
  it("renders <n>-bit", () => {
    expect(formatBitDepth(8)).toBe("8-bit");
    expect(formatBitDepth(16)).toBe("16-bit");
    expect(formatBitDepth(8.4)).toBe("8-bit");
  });

  it("omits missing or invalid bit depths", () => {
    expect(formatBitDepth(null)).toBe(OMIT);
    expect(formatBitDepth(undefined)).toBe(OMIT);
    expect(formatBitDepth(0)).toBe(OMIT);
    expect(formatBitDepth(-1)).toBe(OMIT);
    expect(formatBitDepth(Number.NaN)).toBe(OMIT);
  });
});

describe("formatOrientation", () => {
  it("renders the code plus its EXIF transform name", () => {
    expect(formatOrientation(1)).toBe("1 (Normal)");
    expect(formatOrientation(2)).toBe("2 (Flip horizontal)");
    expect(formatOrientation(3)).toBe("3 (Rotate 180)");
    expect(formatOrientation(4)).toBe("4 (Flip vertical)");
    expect(formatOrientation(5)).toBe("5 (Transpose)");
    expect(formatOrientation(6)).toBe("6 (Rotate 90 CW)");
    expect(formatOrientation(7)).toBe("7 (Transverse)");
    expect(formatOrientation(8)).toBe("8 (Rotate 270 CW)");
  });

  it("renders the bare number for unknown finite codes", () => {
    expect(formatOrientation(0)).toBe("0");
    expect(formatOrientation(9)).toBe("9");
  });

  it("omits missing or non-finite orientations", () => {
    expect(formatOrientation(null)).toBe(OMIT);
    expect(formatOrientation(undefined)).toBe(OMIT);
    expect(formatOrientation(Number.NaN)).toBe(OMIT);
  });
});

describe("formatDateTaken", () => {
  it("normalizes EXIF colon dates to hyphenated dates", () => {
    expect(formatDateTaken("2026:06:14 10:30:00")).toBe("2026-06-14 10:30:00");
    expect(formatDateTaken("2026:06:14")).toBe("2026-06-14");
  });

  it("passes through non-EXIF strings trimmed", () => {
    expect(formatDateTaken("  June 14, 2026  ")).toBe("June 14, 2026");
  });

  it("omits empty or missing dates", () => {
    expect(formatDateTaken("")).toBe(OMIT);
    expect(formatDateTaken("   ")).toBe(OMIT);
    expect(formatDateTaken(null)).toBe(OMIT);
    expect(formatDateTaken(undefined)).toBe(OMIT);
  });
});
