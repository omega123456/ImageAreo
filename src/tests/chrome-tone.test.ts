import { describe, expect, it } from "vitest";

import { chromeTone } from "../lib/stores/chrome-tone.svelte";

describe("chrome tone store", () => {
  it("defaults every floating-chrome tone flag to dark", () => {
    expect(chromeTone.toolbarDark).toBe(true);
    expect(chromeTone.enhanceDark).toBe(true);
    expect(chromeTone.sharpenDark).toBe(true);
    expect(chromeTone.infoDark).toBe(true);
  });

  it("exposes a writable infoDark flag", () => {
    chromeTone.infoDark = false;
    expect(chromeTone.infoDark).toBe(false);
    chromeTone.infoDark = true;
    expect(chromeTone.infoDark).toBe(true);
  });
});
