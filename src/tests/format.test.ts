import { describe, it, expect } from "vitest";
import {
  extensionOf,
  isNativeFormat,
  isSupportedImage,
  supportedExtensions,
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
});
