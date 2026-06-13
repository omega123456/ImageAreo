import { beforeEach, describe, expect, it } from "vitest";

import { ipc } from "./ipc-mock";
import {
  galleryThumbnails,
  GALLERY_THUMBNAIL_MAX_CONCURRENT,
  GALLERY_THUMBNAIL_LRU_CAP,
} from "../lib/stores/gallery-thumbnails.svelte";

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("galleryThumbnails cache", () => {
  beforeEach(() => {
    galleryThumbnails.clear();
  });

  it("requests a thumbnail and caches the ready result", async () => {
    ipc.override("generate_thumbnail", () => ({ path: "/tmp/a.jpg" }));

    await galleryThumbnails.request("/photos/a.jpg", 120);

    expect(ipc.calls("generate_thumbnail")).toEqual([
      { path: "/photos/a.jpg", size: 120 },
    ]);
    expect(galleryThumbnails.get("/photos/a.jpg", 120)).toEqual({
      status: "ready",
      url: "asset:///tmp/a.jpg",
    });
  });

  it("does not issue a duplicate call for a cached key", async () => {
    ipc.override("generate_thumbnail", () => ({ path: "/tmp/a.jpg" }));

    await galleryThumbnails.request("/photos/a.jpg", 120);
    await galleryThumbnails.request("/photos/a.jpg", 120);

    expect(ipc.calls("generate_thumbnail")).toHaveLength(1);
  });

  it("de-duplicates concurrent in-flight requests for the same key", async () => {
    ipc.override("generate_thumbnail", () => ({ path: "/tmp/a.jpg" }));

    await Promise.all([
      galleryThumbnails.request("/photos/a.jpg", 120),
      galleryThumbnails.request("/photos/a.jpg", 120),
    ]);

    expect(ipc.calls("generate_thumbnail")).toHaveLength(1);
  });

  it("treats different sizes as distinct cache keys", async () => {
    ipc.override("generate_thumbnail", (args) => ({
      path: `/tmp/${args?.size}.jpg`,
    }));

    await galleryThumbnails.request("/photos/a.jpg", 120);
    await galleryThumbnails.request("/photos/a.jpg", 64);

    expect(ipc.calls("generate_thumbnail")).toHaveLength(2);
    expect(galleryThumbnails.get("/photos/a.jpg", 64)?.url).toBe("asset:///tmp/64.jpg");
  });

  it("caps concurrent thumbnail generations and drains the queue", async () => {
    const resolvers: Array<() => void> = [];

    ipc.override(
      "generate_thumbnail",
      (args) =>
        new Promise((resolve) => {
          resolvers.push(() => {
            resolve({ path: `/tmp/${String(args?.path).split("/").pop()}.jpg` });
          });
        }),
    );

    const requests = Array.from(
      { length: GALLERY_THUMBNAIL_MAX_CONCURRENT + 2 },
      (_, index) =>
        galleryThumbnails.request(`/photos/${index}.jpg`, 120),
    );

    expect(ipc.calls("generate_thumbnail")).toHaveLength(
      GALLERY_THUMBNAIL_MAX_CONCURRENT,
    );

    resolvers.shift()?.();
    await flushAsyncWork();

    expect(ipc.calls("generate_thumbnail")).toHaveLength(
      GALLERY_THUMBNAIL_MAX_CONCURRENT + 1,
    );

    while (resolvers.length > 0) {
      resolvers.shift()?.();
      await flushAsyncWork();
    }
    await Promise.all(requests);

    expect(ipc.calls("generate_thumbnail")).toHaveLength(
      GALLERY_THUMBNAIL_MAX_CONCURRENT + 2,
    );
  });

  it("prefetches a whole folder and drains queued work under the cap", async () => {
    const resolvers: Array<() => void> = [];

    ipc.override(
      "generate_thumbnail",
      (args) =>
        new Promise((resolve) => {
          resolvers.push(() => {
            resolve({ path: `/tmp/${String(args?.path).split("/").pop()}.jpg` });
          });
        }),
    );

    const paths = Array.from(
      { length: GALLERY_THUMBNAIL_MAX_CONCURRENT + 2 },
      (_, index) => `/photos/prefetch-${index}.jpg`,
    );

    galleryThumbnails.prefetchFolder(paths, 120);

    expect(ipc.calls("generate_thumbnail")).toHaveLength(
      GALLERY_THUMBNAIL_MAX_CONCURRENT,
    );

    while (resolvers.length > 0) {
      resolvers.shift()?.();
      await flushAsyncWork();
    }

    expect(ipc.calls("generate_thumbnail")).toHaveLength(paths.length);
    expect(galleryThumbnails.get(paths.at(-1)!, 120)).toEqual({
      status: "ready",
      url: `asset:///tmp/${paths.at(-1)!.split("/").pop()}.jpg`,
    });
  });

  it("runs priority requests ahead of queued prefetch work", async () => {
    const resolvers: Array<() => void> = [];

    ipc.override(
      "generate_thumbnail",
      (args) =>
        new Promise((resolve) => {
          resolvers.push(() => {
            resolve({ path: `/tmp/${String(args?.path).split("/").pop()}.jpg` });
          });
        }),
    );

    const inFlightRequests = Array.from(
      { length: GALLERY_THUMBNAIL_MAX_CONCURRENT },
      (_, index) => galleryThumbnails.request(`/photos/busy-${index}.jpg`, 120),
    );
    const normalQueued = galleryThumbnails.request("/photos/normal.jpg", 120);
    const priorityQueued = galleryThumbnails.request("/photos/priority.jpg", 120, {
      priority: true,
    });

    expect(ipc.calls("generate_thumbnail")).toHaveLength(
      GALLERY_THUMBNAIL_MAX_CONCURRENT,
    );

    resolvers.shift()?.();
    await flushAsyncWork();

    expect(ipc.calls("generate_thumbnail")).toContainEqual({
      path: "/photos/priority.jpg",
      size: 120,
    });
    expect(ipc.calls("generate_thumbnail")).not.toContainEqual({
      path: "/photos/normal.jpg",
      size: 120,
    });

    while (resolvers.length > 0) {
      resolvers.shift()?.();
      await flushAsyncWork();
    }

    await Promise.all([...inFlightRequests, normalQueued, priorityQueued]);

    expect(ipc.calls("generate_thumbnail")).toContainEqual({
      path: "/photos/normal.jpg",
      size: 120,
    });
  });

  it("cancelPending clears queued entries so they can be retried later", async () => {
    const resolvers: Array<() => void> = [];

    ipc.override(
      "generate_thumbnail",
      (args) =>
        new Promise((resolve) => {
          resolvers.push(() => {
            resolve({ path: `/tmp/${String(args?.path).split("/").pop()}.jpg` });
          });
        }),
    );

    const inFlightRequests = Array.from(
      { length: GALLERY_THUMBNAIL_MAX_CONCURRENT },
      (_, index) => galleryThumbnails.request(`/photos/live-${index}.jpg`, 120),
    );
    const queuedOne = galleryThumbnails.request("/photos/queued-one.jpg", 120);
    const queuedTwo = galleryThumbnails.request("/photos/queued-two.jpg", 120);

    galleryThumbnails.cancelPending();
    await Promise.all([queuedOne, queuedTwo]);

    expect(galleryThumbnails.has("/photos/queued-one.jpg", 120)).toBe(false);
    expect(galleryThumbnails.has("/photos/queued-two.jpg", 120)).toBe(false);
    expect(ipc.calls("generate_thumbnail")).not.toContainEqual({
      path: "/photos/queued-one.jpg",
      size: 120,
    });
    expect(ipc.calls("generate_thumbnail")).not.toContainEqual({
      path: "/photos/queued-two.jpg",
      size: 120,
    });

    while (resolvers.length > 0) {
      resolvers.shift()?.();
      await flushAsyncWork();
    }

    await Promise.all(inFlightRequests);

    ipc.override("generate_thumbnail", () => ({ path: "/tmp/queued-one.jpg" }));
    await galleryThumbnails.request("/photos/queued-one.jpg", 120);
    expect(ipc.calls("generate_thumbnail")).toContainEqual({
      path: "/photos/queued-one.jpg",
      size: 120,
    });
  });

  it("records an error entry on generation failure", async () => {
    ipc.override("generate_thumbnail", () => {
      throw new Error("boom");
    });

    await galleryThumbnails.request("/photos/bad.jpg", 120);

    expect(galleryThumbnails.get("/photos/bad.jpg", 120)).toEqual({
      status: "error",
      url: null,
    });
  });

  it("invalidate clears an entry so it can be retried", async () => {
    let calls = 0;
    ipc.override("generate_thumbnail", () => {
      calls += 1;
      return { path: "/tmp/a.jpg" };
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

  it("bounds resolved entries to the LRU cap and evicts the least-recently-used", async () => {
    ipc.override("generate_thumbnail", (args) => ({
      path: `/tmp/${String(args?.path).split("/").pop()}.jpg`,
    }));

    const total = GALLERY_THUMBNAIL_LRU_CAP + 25;
    for (let index = 0; index < total; index += 1) {
      await galleryThumbnails.request(`/photos/lru-${index}.jpg`, 120);
    }

    expect(galleryThumbnails.size).toBeLessThanOrEqual(GALLERY_THUMBNAIL_LRU_CAP);
    // The earliest-requested keys are the least-recently-used and evict first.
    expect(galleryThumbnails.has("/photos/lru-0.jpg", 120)).toBe(false);
    // The most-recently-requested key is retained.
    expect(galleryThumbnails.has(`/photos/lru-${total - 1}.jpg`, 120)).toBe(true);
  });

  it("touching an entry via get spares it from LRU eviction", async () => {
    ipc.override("generate_thumbnail", (args) => ({
      path: `/tmp/${String(args?.path).split("/").pop()}.jpg`,
    }));

    // Fill exactly to the cap, then re-read entry 0 to make it most-recent.
    for (let index = 0; index < GALLERY_THUMBNAIL_LRU_CAP; index += 1) {
      await galleryThumbnails.request(`/photos/keep-${index}.jpg`, 120);
    }
    galleryThumbnails.get("/photos/keep-0.jpg", 120);

    // One more insertion forces a single eviction; it should NOT be entry 0.
    await galleryThumbnails.request("/photos/keep-extra.jpg", 120);

    expect(galleryThumbnails.has("/photos/keep-0.jpg", 120)).toBe(true);
    expect(galleryThumbnails.has("/photos/keep-1.jpg", 120)).toBe(false);
    expect(galleryThumbnails.size).toBeLessThanOrEqual(GALLERY_THUMBNAIL_LRU_CAP);
  });

  it("does not evict pending/in-flight entries even past the cap", async () => {
    let release: (() => void) | null = null;
    ipc.override(
      "generate_thumbnail",
      () =>
        new Promise<{ path: string }>((resolve) => {
          release = () => resolve({ path: "/tmp/slow.jpg" });
        }),
    );

    // One never-resolving request stays pending.
    const slow = galleryThumbnails.request("/photos/slow.jpg", 120);

    // Now flood with fast-resolving requests above the cap.
    ipc.override("generate_thumbnail", (args) => ({
      path: `/tmp/${String(args?.path).split("/").pop()}.jpg`,
    }));
    for (let index = 0; index < GALLERY_THUMBNAIL_LRU_CAP + 5; index += 1) {
      await galleryThumbnails.request(`/photos/flood-${index}.jpg`, 120);
    }

    // The pending entry must survive even though the cap was exceeded.
    expect(galleryThumbnails.get("/photos/slow.jpg", 120)?.status).toBe("pending");

    (release as (() => void) | null)?.();
    await slow;
    await flushAsyncWork();
  });

  it("drops a slow prior-folder completion after a folder-change generation bump", async () => {
    let release: ((path: string) => void) | null = null;
    ipc.override(
      "generate_thumbnail",
      () =>
        new Promise<{ path: string }>((resolve) => {
          release = (path: string) => resolve({ path });
        }),
    );

    // Issue a request in the current generation, then change folders.
    const slow = galleryThumbnails.request("/old-folder/a.jpg", 120);
    expect(galleryThumbnails.get("/old-folder/a.jpg", 120)?.status).toBe("pending");

    galleryThumbnails.newGeneration();
    expect(galleryThumbnails.has("/old-folder/a.jpg", 120)).toBe(false);

    // The stale request now resolves — it must NOT repopulate the cache.
    (release as ((path: string) => void) | null)?.("/tmp/stale.jpg");
    await slow;
    await flushAsyncWork();

    expect(galleryThumbnails.has("/old-folder/a.jpg", 120)).toBe(false);
    expect(galleryThumbnails.size).toBe(0);
  });

  it("keeps a same-generation completion (generation guard does not over-drop)", async () => {
    ipc.override("generate_thumbnail", () => ({ path: "/tmp/a.jpg" }));

    const gen = galleryThumbnails.generation;
    await galleryThumbnails.request("/photos/same.jpg", 120);

    expect(galleryThumbnails.generation).toBe(gen);
    expect(galleryThumbnails.get("/photos/same.jpg", 120)?.status).toBe("ready");
  });

  it("prefetchWindow requests only the band around the current index", async () => {
    ipc.override("generate_thumbnail", (args) => ({
      path: `/tmp/${String(args?.path).split("/").pop()}.jpg`,
    }));

    const paths = Array.from({ length: 500 }, (_, i) => `/photos/w-${i}.jpg`);
    galleryThumbnails.prefetchWindow(paths, 200, 120, 50);
    await flushAsyncWork();

    const calls = ipc.calls("generate_thumbnail");
    // Band is 150..250 inclusive => 101 requests, none outside.
    expect(calls).toContainEqual({ path: "/photos/w-150.jpg", size: 120 });
    expect(calls).toContainEqual({ path: "/photos/w-250.jpg", size: 120 });
    expect(calls).not.toContainEqual({ path: "/photos/w-149.jpg", size: 120 });
    expect(calls).not.toContainEqual({ path: "/photos/w-251.jpg", size: 120 });
    expect(calls).not.toContainEqual({ path: "/photos/w-0.jpg", size: 120 });
    expect(calls).not.toContainEqual({ path: "/photos/w-499.jpg", size: 120 });
  });

  it("prefetchWindow clamps the band at folder boundaries", async () => {
    ipc.override("generate_thumbnail", (args) => ({
      path: `/tmp/${String(args?.path).split("/").pop()}.jpg`,
    }));

    const paths = Array.from({ length: 10 }, (_, i) => `/photos/b-${i}.jpg`);
    galleryThumbnails.prefetchWindow(paths, 0, 120, 50);
    await flushAsyncWork();

    expect(ipc.calls("generate_thumbnail")).toHaveLength(10);
  });

  it("prefetchWindow is a no-op for an empty folder", () => {
    expect(() => galleryThumbnails.prefetchWindow([], 0, 120, 50)).not.toThrow();
    expect(ipc.calls("generate_thumbnail")).toHaveLength(0);
  });

  it("a window move cancels out-of-band queued requests", async () => {
    const resolvers: Array<() => void> = [];
    ipc.override(
      "generate_thumbnail",
      (args) =>
        new Promise((resolve) => {
          resolvers.push(() => {
            resolve({ path: `/tmp/${String(args?.path).split("/").pop()}.jpg` });
          });
        }),
    );

    const paths = Array.from({ length: 500 }, (_, i) => `/photos/m-${i}.jpg`);

    // First window saturates the concurrency cap; the rest of the band queues.
    galleryThumbnails.prefetchWindow(paths, 100, 120, 50);
    await Promise.resolve();
    const firstWindowCalls = ipc.calls("generate_thumbnail").length;
    expect(firstWindowCalls).toBe(GALLERY_THUMBNAIL_MAX_CONCURRENT);

    // Move the window far away before the queue drains — the queued out-of-band
    // requests are cancelled and never reach the backend.
    galleryThumbnails.prefetchWindow(paths, 400, 120, 50);
    await Promise.resolve();

    // Drain everything.
    while (resolvers.length > 0) {
      resolvers.shift()?.();
      await flushAsyncWork();
    }

    const allCalls = ipc.calls("generate_thumbnail");
    // The far end of the first band (index 149) is requested last, so it is
    // still queued when the window moves; it is outside the new band (350..450)
    // and must have been cancelled before reaching the backend.
    expect(allCalls).not.toContainEqual({ path: "/photos/m-149.jpg", size: 120 });
    // The new window's center is requested.
    expect(allCalls).toContainEqual({ path: "/photos/m-400.jpg", size: 120 });
  });
});
