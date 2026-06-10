import { beforeEach, describe, expect, it } from "vitest";

import { ipc } from "./ipc-mock";
import { galleryThumbnails } from "../lib/stores/gallery-thumbnails.svelte";

describe("galleryThumbnails cache", () => {
  beforeEach(() => {
    galleryThumbnails.clear();
  });

  it("requests a thumbnail and caches the ready result", async () => {
    ipc.override("generate_thumbnail", () => ({ dataUrl: "data:image/png;a" }));

    await galleryThumbnails.request("/photos/a.jpg", 120);

    expect(ipc.calls("generate_thumbnail")).toEqual([
      { path: "/photos/a.jpg", size: 120 },
    ]);
    expect(galleryThumbnails.get("/photos/a.jpg", 120)).toEqual({
      status: "ready",
      dataUrl: "data:image/png;a",
    });
  });

  it("does not issue a duplicate call for a cached key", async () => {
    ipc.override("generate_thumbnail", () => ({ dataUrl: "data:image/png;a" }));

    await galleryThumbnails.request("/photos/a.jpg", 120);
    await galleryThumbnails.request("/photos/a.jpg", 120);

    expect(ipc.calls("generate_thumbnail")).toHaveLength(1);
  });

  it("de-duplicates concurrent in-flight requests for the same key", async () => {
    ipc.override("generate_thumbnail", () => ({ dataUrl: "data:image/png;a" }));

    await Promise.all([
      galleryThumbnails.request("/photos/a.jpg", 120),
      galleryThumbnails.request("/photos/a.jpg", 120),
    ]);

    expect(ipc.calls("generate_thumbnail")).toHaveLength(1);
  });

  it("treats different sizes as distinct cache keys", async () => {
    ipc.override("generate_thumbnail", (args) => ({
      dataUrl: `data:${args?.size}`,
    }));

    await galleryThumbnails.request("/photos/a.jpg", 120);
    await galleryThumbnails.request("/photos/a.jpg", 64);

    expect(ipc.calls("generate_thumbnail")).toHaveLength(2);
    expect(galleryThumbnails.get("/photos/a.jpg", 64)?.dataUrl).toBe("data:64");
  });

  it("records an error entry on generation failure", async () => {
    ipc.override("generate_thumbnail", () => {
      throw new Error("boom");
    });

    await galleryThumbnails.request("/photos/bad.jpg", 120);

    expect(galleryThumbnails.get("/photos/bad.jpg", 120)).toEqual({
      status: "error",
      dataUrl: null,
    });
  });

  it("invalidate clears an entry so it can be retried", async () => {
    let calls = 0;
    ipc.override("generate_thumbnail", () => {
      calls += 1;
      return { dataUrl: "data:image/png;a" };
    });

    await galleryThumbnails.request("/photos/a.jpg", 120);
    galleryThumbnails.invalidate("/photos/a.jpg", 120);
    expect(galleryThumbnails.has("/photos/a.jpg", 120)).toBe(false);
    await galleryThumbnails.request("/photos/a.jpg", 120);

    expect(calls).toBe(2);
  });

  it("invalidate is a no-op for an unknown key", () => {
    expect(() => galleryThumbnails.invalidate("/nope.jpg", 120)).not.toThrow();
  });
});
