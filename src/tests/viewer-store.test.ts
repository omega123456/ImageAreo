import { describe, it, expect, beforeEach } from "vitest";
import { viewer } from "../lib/stores/viewer.svelte";

describe("viewer store", () => {
  beforeEach(() => {
    viewer.reset();
  });

  it("starts idle and empty", () => {
    expect(viewer.status).toBe("idle");
    expect(viewer.source).toBe("");
    expect(viewer.name).toBeNull();
    expect(viewer.zoom).toBe(1);
    expect(viewer.fitMode).toBe("fit");
  });

  it("load() sets source/name, marks loading and resets the transform", () => {
    viewer.zoom = 3;
    viewer.pan = { x: 50, y: 50 };
    viewer.rotation = 90;

    viewer.load("asset://photo.jpg", "photo.jpg");

    expect(viewer.source).toBe("asset://photo.jpg");
    expect(viewer.name).toBe("photo.jpg");
    expect(viewer.status).toBe("loading");
    expect(viewer.zoom).toBe(1);
    expect(viewer.pan).toEqual({ x: 0, y: 0 });
    expect(viewer.rotation).toBe(0);
    expect(viewer.fitMode).toBe("fit");
  });

  it("load() defaults name to null when omitted", () => {
    viewer.load("asset://photo.jpg");
    expect(viewer.name).toBeNull();
  });

  it("setReady() records dimensions and marks ready", () => {
    viewer.load("asset://photo.jpg", "photo.jpg");
    viewer.setReady(800, 600);
    expect(viewer.naturalWidth).toBe(800);
    expect(viewer.naturalHeight).toBe(600);
    expect(viewer.status).toBe("ready");
  });

  it("setError() marks the load as failed", () => {
    viewer.load("asset://broken.jpg");
    viewer.setError();
    expect(viewer.status).toBe("error");
  });

  it("reset() returns to the empty idle state", () => {
    viewer.load("asset://photo.jpg", "photo.jpg");
    viewer.setReady(100, 100);
    viewer.reset();
    expect(viewer.status).toBe("idle");
    expect(viewer.source).toBe("");
    expect(viewer.name).toBeNull();
    expect(viewer.naturalWidth).toBe(0);
    expect(viewer.naturalHeight).toBe(0);
  });
});
