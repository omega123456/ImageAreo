import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { imageInfo } from "../lib/stores/image-info.svelte";
import { ipc } from "./ipc-mock";
import type { ImageMetadata } from "../lib/ipc/commands";

function fixtureFor(path: string): ImageMetadata {
  return {
    fileName: path.split("/").pop() ?? path,
    filePath: path,
    format: "JPEG",
    fileSizeBytes: 1000,
    width: 100,
    height: 50,
    pixels: 5000,
    colorType: "RGB",
    bitDepth: 8,
    orientation: 1,
    camera: null,
  };
}

describe("ImageInfoStore", () => {
  beforeEach(() => {
    // Reset to a clean idle state between tests.
    void imageInfo.ensureLoaded(null);
  });

  afterEach(() => {
    void imageInfo.ensureLoaded(null);
  });

  it("fetches metadata for an uncached path and marks ready", async () => {
    ipc.override("read_image_metadata", (args) =>
      fixtureFor(String(args?.path)),
    );

    await imageInfo.ensureLoaded("/a.jpg");

    expect(imageInfo.status).toBe("ready");
    expect(imageInfo.error).toBeNull();
    expect(imageInfo.current?.filePath).toBe("/a.jpg");
    expect(ipc.calls("read_image_metadata")).toHaveLength(1);
  });

  it("serves a previously-loaded path from cache without a second IPC call", async () => {
    ipc.override("read_image_metadata", (args) =>
      fixtureFor(String(args?.path)),
    );

    await imageInfo.ensureLoaded("/cached.jpg");
    await imageInfo.ensureLoaded("/other.jpg");
    await imageInfo.ensureLoaded("/cached.jpg");

    expect(imageInfo.current?.filePath).toBe("/cached.jpg");
    // Two distinct fetches; the re-visit to /cached.jpg uses the cache.
    expect(ipc.calls("read_image_metadata")).toHaveLength(2);
  });

  it("resets to idle/empty for a null path", async () => {
    ipc.override("read_image_metadata", (args) =>
      fixtureFor(String(args?.path)),
    );
    await imageInfo.ensureLoaded("/a.jpg");

    await imageInfo.ensureLoaded(null);

    expect(imageInfo.status).toBe("idle");
    expect(imageInfo.current).toBeNull();
    expect(imageInfo.error).toBeNull();
  });

  it("enters the error state on a failed fetch", async () => {
    ipc.override("read_image_metadata", () => {
      throw new Error("boom");
    });

    await imageInfo.ensureLoaded("/bad.jpg");

    expect(imageInfo.status).toBe("error");
    expect(imageInfo.current).toBeNull();
    expect(imageInfo.error).toBe("boom");
  });

  it("falls back to a default error message for non-Error rejections", async () => {
    ipc.override("read_image_metadata", () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "nope";
    });

    await imageInfo.ensureLoaded("/bad2.jpg");

    expect(imageInfo.status).toBe("error");
    expect(imageInfo.error).toBe("Could not read metadata");
  });

  it("discards a late response for a superseded path (stale-guard)", async () => {
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    ipc.override("read_image_metadata", async (args) => {
      const path = String(args?.path);
      if (path === "/slow.jpg") {
        await firstGate;
        return fixtureFor(path);
      }
      return fixtureFor(path);
    });

    const slow = imageInfo.ensureLoaded("/slow.jpg");
    // Supersede with a fast resolve for a different path.
    await imageInfo.ensureLoaded("/fast.jpg");
    expect(imageInfo.current?.filePath).toBe("/fast.jpg");

    releaseFirst();
    await slow;

    // The late /slow.jpg response must NOT overwrite the current /fast.jpg.
    expect(imageInfo.current?.filePath).toBe("/fast.jpg");
    expect(imageInfo.status).toBe("ready");
  });
});
