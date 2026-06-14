import { describe, expect, it } from "vitest";

import { APP_TITLE, windowTitle } from "../lib/utils/native-window";

describe("windowTitle", () => {
  it("returns the bare app name when no image is open", () => {
    expect(windowTitle(null, null)).toBe(APP_TITLE);
  });

  it("shows the filename, full path, and app name for a loaded image", () => {
    expect(windowTitle("/photos/img1.jpg", "img1.jpg")).toBe(
      `img1.jpg — /photos/img1.jpg — ${APP_TITLE}`,
    );
  });

  it("falls back to the path as the label when the name is missing", () => {
    expect(windowTitle("/photos/img1.jpg", null)).toBe(
      `/photos/img1.jpg — /photos/img1.jpg — ${APP_TITLE}`,
    );
  });

  it("inserts the dimensions after the filename when both are present", () => {
    expect(windowTitle("/a/b/photo.jpg", "photo.jpg", 4032, 3024)).toBe(
      `photo.jpg (4032×3024) — /a/b/photo.jpg — ${APP_TITLE}`,
    );
  });

  it("omits the dimensions when they are absent", () => {
    expect(windowTitle("/a/b/photo.jpg", "photo.jpg")).toBe(
      `photo.jpg — /a/b/photo.jpg — ${APP_TITLE}`,
    );
  });

  it("omits the dimensions when either is zero", () => {
    expect(windowTitle("/a/b/photo.jpg", "photo.jpg", 0, 3024)).toBe(
      `photo.jpg — /a/b/photo.jpg — ${APP_TITLE}`,
    );
    expect(windowTitle("/a/b/photo.jpg", "photo.jpg", 4032, 0)).toBe(
      `photo.jpg — /a/b/photo.jpg — ${APP_TITLE}`,
    );
  });

  it("returns the bare app name regardless of dimensions when no path", () => {
    expect(windowTitle(null, null, 4032, 3024)).toBe(APP_TITLE);
  });
});
