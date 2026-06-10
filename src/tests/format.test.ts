import { describe, it, expect } from "vitest";
import {
  extensionOf,
  isNativeFormat,
  isSupportedImage,
  supportedExtensions,
  orientationTransform,
  NATIVE_EXTENSIONS,
  NEEDS_BACKEND_EXTENSIONS,
} from "../lib/utils/format";

describe("extensionOf", () => {
  it("extracts a lower-cased extension", () => {
    expect(extensionOf("/a/b/Photo.JPG")).toBe("jpg");
  });
  it("handles Windows separators", () => {
    expect(extensionOf("C:\\images\\pic.PNG")).toBe("png");
  });
  it("returns empty for a dotfile with no real extension", () => {
    expect(extensionOf("/a/.gitignore")).toBe("");
  });
  it("returns empty when there is no extension", () => {
    expect(extensionOf("/a/b/README")).toBe("");
  });
  it("returns empty for a trailing dot", () => {
    expect(extensionOf("/a/b/file.")).toBe("");
  });
  it("ignores trailing slashes", () => {
    expect(extensionOf("/a/b/dir.webp/")).toBe("webp");
  });
});

describe("isNativeFormat", () => {
  it.each(["a.jpg", "a.jpeg", "a.png", "a.gif", "a.webp"])(
    "treats %s as native",
    (p) => {
      expect(isNativeFormat(p)).toBe(true);
    },
  );
  it.each(["a.heic", "a.tiff", "a.cr2", "a.jxl", "a.bmp"])(
    "treats %s as non-native",
    (p) => {
      expect(isNativeFormat(p)).toBe(false);
    },
  );
});

describe("isSupportedImage", () => {
  it("accepts native formats", () => {
    expect(isSupportedImage("x.png")).toBe(true);
  });
  it("accepts backend formats", () => {
    expect(isSupportedImage("x.dng")).toBe(true);
  });
  it("rejects unsupported formats", () => {
    expect(isSupportedImage("x.txt")).toBe(false);
    expect(isSupportedImage("x")).toBe(false);
  });
});

describe("supportedExtensions", () => {
  it("is the union of native and backend sets", () => {
    const all = supportedExtensions();
    expect(all.length).toBe(
      NATIVE_EXTENSIONS.size + NEEDS_BACKEND_EXTENSIONS.size,
    );
    for (const ext of [...NATIVE_EXTENSIONS, ...NEEDS_BACKEND_EXTENSIONS]) {
      expect(all).toContain(ext);
    }
  });

  it.each(["raw", "cr3", "orf", "rw2", "raf", "srw", "pef"])(
    "includes supported RAW extension %s",
    (ext) => {
      expect(supportedExtensions()).toContain(ext);
    },
  );
});

describe("orientationTransform", () => {
  it("returns identity (empty) for orientation 1", () => {
    expect(orientationTransform(1)).toBe("");
  });
  it.each([
    [2, "scaleX(-1)"],
    [3, "rotate(180deg)"],
    [4, "scaleY(-1)"],
    [5, "rotate(90deg) scaleX(-1)"],
    [6, "rotate(90deg)"],
    [7, "rotate(270deg) scaleX(-1)"],
    [8, "rotate(270deg)"],
  ])("maps EXIF orientation %i to its CSS transform", (value, expected) => {
    expect(orientationTransform(value)).toBe(expected);
  });
  it("falls back to identity for unknown/zero orientation", () => {
    expect(orientationTransform(0)).toBe("");
    expect(orientationTransform(99)).toBe("");
  });
});
