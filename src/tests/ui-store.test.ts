import { afterEach, describe, expect, it } from "vitest";

import { ui } from "../lib/stores/ui.svelte";

describe("ui store", () => {
  afterEach(() => {
    ui.closeSettings();
    ui.exitFullscreen();
  });

  it("opens, closes and toggles the settings drawer", () => {
    expect(ui.settingsOpen).toBe(false);

    ui.openSettings();
    expect(ui.settingsOpen).toBe(true);

    ui.closeSettings();
    expect(ui.settingsOpen).toBe(false);

    ui.toggleSettings();
    expect(ui.settingsOpen).toBe(true);
    ui.toggleSettings();
    expect(ui.settingsOpen).toBe(false);
  });

  it("toggles and exits fullscreen", () => {
    expect(ui.fullscreen).toBe(false);

    ui.toggleFullscreen();
    expect(ui.fullscreen).toBe(true);

    ui.toggleFullscreen();
    expect(ui.fullscreen).toBe(false);

    ui.toggleFullscreen();
    ui.exitFullscreen();
    expect(ui.fullscreen).toBe(false);
  });
});
