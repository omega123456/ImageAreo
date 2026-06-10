import { beforeEach, describe, expect, it } from "vitest";

import { galleryUi } from "../lib/stores/gallery-ui.svelte";

describe("galleryUi store", () => {
  beforeEach(() => {
    galleryUi.reset();
  });

  it("is visible by default", () => {
    expect(galleryUi.visible).toBe(true);
  });

  it("toggles visibility", () => {
    galleryUi.toggle();
    expect(galleryUi.visible).toBe(false);
    galleryUi.toggle();
    expect(galleryUi.visible).toBe(true);
  });

  it("shows and hides explicitly", () => {
    galleryUi.hide();
    expect(galleryUi.visible).toBe(false);
    galleryUi.show();
    expect(galleryUi.visible).toBe(true);
  });

  it("resets to visible", () => {
    galleryUi.hide();
    galleryUi.reset();
    expect(galleryUi.visible).toBe(true);
  });
});
