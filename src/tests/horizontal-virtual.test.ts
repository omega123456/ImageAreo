import { describe, expect, it } from "vitest";

import { computeVirtualWindow } from "../lib/utils/horizontal-virtual";

describe("computeVirtualWindow", () => {
  it("returns an empty window for no items", () => {
    expect(computeVirtualWindow(0, 72, 0, 500, 4)).toEqual({
      startIndex: 0,
      endIndex: -1,
      totalWidth: 0,
      offsetLeft: 0,
    });
  });

  it("returns an empty window for a non-positive stride", () => {
    expect(computeVirtualWindow(10, 0, 0, 500, 4)).toEqual({
      startIndex: 0,
      endIndex: -1,
      totalWidth: 0,
      offsetLeft: 0,
    });
  });

  it("computes the visible range padded by the buffer", () => {
    // stride 100, viewport 300 starting at scroll 500 -> visible 5..8,
    // buffer 2 -> 3..10, total width 100*20 = 2000.
    const w = computeVirtualWindow(20, 100, 500, 300, 2);
    expect(w.startIndex).toBe(3);
    expect(w.endIndex).toBe(10);
    expect(w.totalWidth).toBe(2000);
    expect(w.offsetLeft).toBe(300);
  });

  it("clamps the range to the item bounds", () => {
    const w = computeVirtualWindow(5, 100, 0, 1000, 4);
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(4);
    expect(w.offsetLeft).toBe(0);
  });

  it("clamps a negative scroll offset to zero", () => {
    const w = computeVirtualWindow(10, 100, -200, 300, 0);
    expect(w.startIndex).toBe(0);
  });

  it("clamps an over-scroll past the total width", () => {
    const w = computeVirtualWindow(10, 100, 5000, 300, 1);
    expect(w.endIndex).toBe(9);
  });
});
