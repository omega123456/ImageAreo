import { beforeEach, describe, expect, it } from "vitest";

import { ipc } from "./ipc-mock";
import {
  galleryThumbnails,
  GALLERY_THUMBNAIL_MAX_CONCURRENT,
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
});
