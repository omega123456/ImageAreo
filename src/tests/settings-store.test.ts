import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ipc } from "./ipc-mock";
import {
  DENSITY_DIMENSIONS,
  settings,
} from "../lib/stores/settings.svelte";

function installMatchMedia(matches = false) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let currentMatches = matches;
  const query = {
    get matches() {
      return currentMatches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
    ),
    removeEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
    ),
    dispatchEvent: vi.fn(() => true),
  } as MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => query),
  });

  return {
    emit(nextMatches: boolean) {
      currentMatches = nextMatches;
      const event = { matches: nextMatches, media: query.media } as MediaQueryListEvent;
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

describe("settings store", () => {
  beforeEach(() => {
    settings.resetForTests();
  });

  afterEach(() => {
    settings.resetForTests();
  });

  it("defaults gallery density to large", async () => {
    installMatchMedia(false);
    await settings.initialize();

    expect(settings.galleryDensity).toBe("large");
  });

  it("loads persisted settings on boot and applies the resolved theme", async () => {
    installMatchMedia(true);
    const persisted = new Map<string, unknown>([
      ["theme", "system"],
      ["galleryDensity", "small"],
      ["sortOrder", "date"],
    ]);

    ipc.override("plugin:store|get", (args) => {
      const key = String(args?.key ?? "");
      return [persisted.get(key), persisted.has(key)];
    });

    await settings.initialize();

    expect(settings.theme).toBe("system");
    expect(settings.galleryDensity).toBe("small");
    expect(settings.sortOrder).toBe("date");
    expect(settings.resolvedTheme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.dataset.appearance).toBe("dark");
  });

  it("falls back to the default density when the persisted value is invalid", async () => {
    installMatchMedia(false);
    const persisted = new Map<string, unknown>([["galleryDensity", "huge"]]);

    ipc.override("plugin:store|get", (args) => {
      const key = String(args?.key ?? "");
      return [persisted.get(key), persisted.has(key)];
    });

    await settings.initialize();

    expect(settings.galleryDensity).toBe("large");
  });

  it("persists writes through the store plugin", async () => {
    installMatchMedia(false);
    await settings.initialize();

    await settings.setTheme("dark");
    await settings.setGalleryDensity("medium");
    await settings.setSortOrder("date");

    expect(ipc.calls("plugin:store|set")).toEqual([
      { rid: 1, key: "theme", value: "dark" },
      { rid: 1, key: "galleryDensity", value: "medium" },
      { rid: 1, key: "sortOrder", value: "date" },
    ]);
    expect(ipc.calls("plugin:store|save")).toHaveLength(3);
    expect(settings.galleryDensity).toBe("medium");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("maps each density tier to the correct strip height and thumbnail size", () => {
    expect(DENSITY_DIMENSIONS.small).toEqual({ stripHeight: 96, thumbnailSize: 80 });
    expect(DENSITY_DIMENSIONS.medium).toEqual({ stripHeight: 144, thumbnailSize: 128 });
    expect(DENSITY_DIMENSIONS.large).toEqual({ stripHeight: 208, thumbnailSize: 192 });
  });

  it("exposes the dimensions for the active density", async () => {
    installMatchMedia(false);
    await settings.initialize();

    await settings.setGalleryDensity("small");
    expect(settings.densityDimensions).toEqual(DENSITY_DIMENSIONS.small);
  });

  it("updates the document when the system theme changes", async () => {
    const media = installMatchMedia(false);
    await settings.initialize();

    expect(document.documentElement.style.colorScheme).toBe("light");
    media.emit(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
