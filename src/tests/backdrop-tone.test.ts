import { describe, expect, it } from "vitest";

import {
  cssColorLuminance,
  rectWithinContainer,
} from "../lib/utils/backdrop-tone";

describe("cssColorLuminance", () => {
  it("parses rgb colors", () => {
    expect(cssColorLuminance("rgb(255, 255, 255)")).toBeCloseTo(1);
    expect(cssColorLuminance("rgba(0, 0, 0, 0.5)")).toBe(0);
  });

  it("parses oklch colors emitted by theme tokens", () => {
    expect(cssColorLuminance("oklch(1 0 0)")).toBe(1);
    expect(cssColorLuminance("oklch(0.18 0.01 250)")).toBe(0.18);
    expect(cssColorLuminance("oklch(42% 0.01 250 / 0.8)")).toBe(0.42);
  });
});

describe("rectWithinContainer", () => {
  it("converts viewport bounds into container-local coordinates", () => {
    expect(
      rectWithinContainer(
        { left: 260, top: 120, width: 480, height: 64 },
        { left: 0, top: 0, width: 1000, height: 800 },
      ),
    ).toEqual({
      x: 260,
      y: 120,
      w: 480,
      h: 64,
    });
  });

  it("clips overlay bounds to the visible portion of the container", () => {
    expect(
      rectWithinContainer(
        { left: -20, top: 760, width: 120, height: 80 },
        { left: 0, top: 0, width: 1000, height: 800 },
      ),
    ).toEqual({
      x: 0,
      y: 760,
      w: 100,
      h: 40,
    });
  });

  it("returns null when the overlay is completely outside the container", () => {
    expect(
      rectWithinContainer(
        { left: 1200, top: 40, width: 200, height: 60 },
        { left: 0, top: 0, width: 1000, height: 800 },
      ),
    ).toBeNull();
  });
});
