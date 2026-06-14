import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readFullscreen, writeFullscreen } = vi.hoisted(() => ({
  readFullscreen: vi.fn(async () => false),
  writeFullscreen: vi.fn(async () => {}),
}));

vi.mock("../lib/utils/native-window", () => ({
  readFullscreen,
  writeFullscreen,
}));

import { ui } from "../lib/stores/ui.svelte";

describe("ui store", () => {
  beforeEach(() => {
    readFullscreen.mockClear();
    writeFullscreen.mockClear();
    readFullscreen.mockResolvedValue(false);
    writeFullscreen.mockResolvedValue(undefined);
  });

  afterEach(() => {
    ui.closeSettings();
    ui.closeInfo();
    ui.fullscreen = false;
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

  it("opens, closes and toggles the info card independently of settings", () => {
    expect(ui.infoOpen).toBe(false);

    ui.openInfo();
    expect(ui.infoOpen).toBe(true);

    ui.closeInfo();
    expect(ui.infoOpen).toBe(false);

    ui.toggleInfo();
    expect(ui.infoOpen).toBe(true);
    ui.toggleInfo();
    expect(ui.infoOpen).toBe(false);
  });

  it("does not couple info and settings open state", () => {
    ui.openSettings();
    ui.openInfo();
    expect(ui.settingsOpen).toBe(true);
    expect(ui.infoOpen).toBe(true);

    ui.closeInfo();
    expect(ui.settingsOpen).toBe(true);
    expect(ui.infoOpen).toBe(false);
  });

  it("syncs fullscreen from the native window on startup", async () => {
    readFullscreen.mockResolvedValue(true);

    await ui.initializeFullscreen();

    expect(readFullscreen).toHaveBeenCalledOnce();
    expect(ui.fullscreen).toBe(true);
  });

  it("toggles and exits fullscreen through the native window seam", async () => {
    expect(ui.fullscreen).toBe(false);

    await ui.toggleFullscreen();
    expect(ui.fullscreen).toBe(true);
    expect(writeFullscreen).toHaveBeenNthCalledWith(1, true);

    await ui.toggleFullscreen();
    expect(ui.fullscreen).toBe(false);
    expect(writeFullscreen).toHaveBeenNthCalledWith(2, false);

    await ui.toggleFullscreen();
    await ui.exitFullscreen();
    expect(ui.fullscreen).toBe(false);
    expect(writeFullscreen).toHaveBeenNthCalledWith(4, false);
  });
});
