import { describe, expect, it } from "vitest";

import {
  ACTIVE_CAPABLE_ICONS,
  ICON_SIZE,
  ICON_WEIGHT,
  iconWeightFor,
  icons,
  type IconName,
} from "../lib/icons";

/**
 * Every action/indicator named in the Architecture section of the redesign plan
 * must resolve to a defined icon component through the semantic map. Active-
 * capable icons must additionally resolve to the Fill weight when active.
 */
const REQUIRED_NAMES: IconName[] = [
  "openFile",
  "openFolder",
  "fit",
  "actualSize",
  "zoomIn",
  "zoomOut",
  "rotateLeft",
  "rotateRight",
  "filmstrip",
  "info",
  "settings",
  "appearance",
  "close",
  "previous",
  "next",
  "updateAvailable",
  "imageFailed",
  "emptyPlaceholder",
];

describe("semantic icon module", () => {
  it("resolves a defined component for every required semantic name", () => {
    for (const name of REQUIRED_NAMES) {
      const component = icons[name];
      expect(component, `icon "${name}" must be defined`).toBeDefined();
      // Phosphor icons are Svelte components (functions).
      expect(typeof component, `icon "${name}" must be a component`).toBe(
        "function",
      );
    }
  });

  it("exposes no undefined entries in the map", () => {
    for (const [name, component] of Object.entries(icons)) {
      expect(component, `icon "${name}" must not be undefined`).toBeDefined();
    }
  });

  it("declares the active-capable (Fill) icons", () => {
    // Toggle/active states exist for the filmstrip toggle and the update badge.
    expect(ACTIVE_CAPABLE_ICONS.has("filmstrip")).toBe(true);
    expect(ACTIVE_CAPABLE_ICONS.has("updateAvailable")).toBe(true);
    // The info card toggle fills when the card is open.
    expect(ACTIVE_CAPABLE_ICONS.has("info")).toBe(true);
    // Every active-capable name must itself resolve to a component.
    for (const name of ACTIVE_CAPABLE_ICONS) {
      expect(icons[name]).toBeDefined();
    }
  });

  it("uses the Fill weight for active-capable icons only when active", () => {
    expect(iconWeightFor("filmstrip", true)).toBe(ICON_WEIGHT.fill);
    expect(iconWeightFor("filmstrip", false)).toBe(ICON_WEIGHT.regular);
    expect(iconWeightFor("info", true)).toBe(ICON_WEIGHT.fill);
    expect(iconWeightFor("info", false)).toBe(ICON_WEIGHT.regular);
  });

  it("never uses the Fill weight for non-active-capable icons", () => {
    expect(iconWeightFor("openFile", true)).toBe(ICON_WEIGHT.regular);
    expect(iconWeightFor("settings", true)).toBe(ICON_WEIGHT.regular);
  });

  it("defaults chrome icons to 16px", () => {
    expect(ICON_SIZE).toBe(16);
  });
});
