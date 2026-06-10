import { describe, it, expect } from "vitest";
import { clamp, lerp, easeOutCubic, easeOutQuint } from "../lib/utils/easing";

describe("clamp", () => {
  it("returns the value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("clamps below the minimum", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });
  it("clamps above the maximum", () => {
    expect(clamp(42, 0, 10)).toBe(10);
  });
});

describe("lerp", () => {
  it("returns a at t=0 and b at t=1", () => {
    expect(lerp(2, 8, 0)).toBe(2);
    expect(lerp(2, 8, 1)).toBe(8);
  });
  it("interpolates linearly at the midpoint", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe("easeOutCubic", () => {
  it("maps the endpoints to 0 and 1", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });
  it("decelerates (output exceeds linear in the first half)", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
  it("clamps out-of-range input", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe("easeOutQuint", () => {
  it("maps the endpoints to 0 and 1", () => {
    expect(easeOutQuint(0)).toBe(0);
    expect(easeOutQuint(1)).toBe(1);
  });
  it("decelerates more strongly than cubic at the midpoint", () => {
    expect(easeOutQuint(0.5)).toBeGreaterThan(easeOutCubic(0.5));
  });
  it("clamps out-of-range input", () => {
    expect(easeOutQuint(-5)).toBe(0);
    expect(easeOutQuint(5)).toBe(1);
  });
});
