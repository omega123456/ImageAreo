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
});
