import { describe, it, expect, beforeEach, vi } from "vitest";
import { viewer } from "../lib/stores/viewer.svelte";
import { ipc } from "./ipc-mock";
import {
  MAX_DISPLAY_PIXELS,
  NATIVE_ROUTING_PIXELS,
} from "../lib/utils/format";

vi.mock("@tauri-apps/api/core", async () => {
  const actual = await vi.importActual<typeof import("@tauri-apps/api/core")>(
    "@tauri-apps/api/core",
  );
  return {
    ...actual,
    convertFileSrc: (path: string) => `asset://${path}`,
  };
});

describe("native large-image routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    viewer.reset();
  });

  it("renders a small native image directly without a backend decode", async () => {
    ipc.override("probe_image", () => ({
      width: 4000,
      height: 3000,
      pixels: 12_000_000,
      animated: false,
      exceedsLimit: false,
    }));

    await viewer.openPath("/photos/small.jpg");

    expect(ipc.calls("probe_image")).toEqual([{ path: "/photos/small.jpg" }]);
    expect(ipc.calls("decode_image")).toHaveLength(0);
    expect(viewer.source).toBe("asset:///photos/small.jpg");
    expect(viewer.samplePath).toBe("/photos/small.jpg");
    expect(viewer.status).toBe("ready");
  });

  it("routes a native image above the threshold through the backend display path", async () => {
    ipc.override("probe_image", () => ({
      width: 10000,
      height: 8000,
      pixels: NATIVE_ROUTING_PIXELS + 1,
      animated: false,
      exceedsLimit: false,
    }));
    ipc.override("decode_image", () => ({
      path: "/tmp/imageareo-images/big-native.jpg",
      width: 8192,
      height: 6554,
      orientation: 1,
    }));

    await viewer.openPath("/photos/huge.png");

    expect(ipc.calls("decode_image")).toEqual([
      {
        path: "/photos/huge.png",
        quality: "display",
        priority: "currentImage",
        generation: expect.any(Number),
      },
    ]);
    // Asset URL points at a cache derivative, not the original native file.
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/big-native.jpg");
    expect(viewer.samplePath).toBe("/tmp/imageareo-images/big-native.jpg");
    expect(viewer.naturalWidth).toBe(8192);
    expect(viewer.status).toBe("ready");
  });

  it("renders an animated native image directly even above the routing threshold", async () => {
    ipc.override("probe_image", () => ({
      width: 12000,
      height: 9000,
      pixels: NATIVE_ROUTING_PIXELS + 1_000_000,
      animated: true,
      exceedsLimit: false,
    }));

    await viewer.openPath("/photos/loop.gif");

    expect(ipc.calls("decode_image")).toHaveLength(0);
    expect(viewer.source).toBe("asset:///photos/loop.gif");
    expect(viewer.status).toBe("ready");
  });

  it("does not route exactly at the threshold (strictly greater than)", async () => {
    ipc.override("probe_image", () => ({
      width: NATIVE_ROUTING_PIXELS,
      height: 1,
      pixels: NATIVE_ROUTING_PIXELS,
      animated: false,
      exceedsLimit: false,
    }));

    await viewer.openPath("/photos/edge.webp");

    expect(ipc.calls("decode_image")).toHaveLength(0);
    expect(viewer.source).toBe("asset:///photos/edge.webp");
  });

  it("short-circuits an over-ceiling native image to the limit state", async () => {
    ipc.override("probe_image", () => ({
      width: 20000,
      height: 20000,
      pixels: MAX_DISPLAY_PIXELS + 1,
      animated: false,
      exceedsLimit: true,
    }));

    await viewer.openPath("/photos/bomb.png");

    expect(ipc.calls("decode_image")).toHaveLength(0);
    expect(viewer.status).toBe("error");
    expect(viewer.errorReason).toBe("limit");
  });

  it("ignores a stale probe result when superseded by a newer open", async () => {
    let resolveFirst: ((v: unknown) => void) | undefined;
    ipc.override("probe_image", (args) => {
      if ((args as { path: string }).path === "/photos/slow.jpg") {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return {
        width: 100,
        height: 100,
        pixels: 10_000,
        animated: false,
        exceedsLimit: false,
      };
    });

    const first = viewer.openPath("/photos/slow.jpg");
    await viewer.openPath("/photos/fast.jpg");

    // Resolve the superseded probe as over-ceiling — it must NOT flip the state.
    resolveFirst?.({
      width: 30000,
      height: 30000,
      pixels: MAX_DISPLAY_PIXELS + 1,
      animated: false,
      exceedsLimit: true,
    });
    await first;

    expect(viewer.path).toBe("/photos/fast.jpg");
    expect(viewer.status).toBe("ready");
    expect(viewer.errorReason).toBeNull();
  });
});

describe("too-large decode error mapping", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    viewer.reset();
  });

  it("maps a decode code: image_too_large to the limit error-reason", async () => {
    ipc.override("decode_image", () => {
      throw { code: "image_too_large", message: "too big" };
    });

    await viewer.openPath("/photos/huge.heic");

    expect(viewer.status).toBe("error");
    expect(viewer.errorReason).toBe("limit");
  });

  it("maps a generic decode failure to the corrupt error-reason", async () => {
    ipc.override("decode_image", () => {
      throw new Error("corrupt file");
    });

    await viewer.openPath("/photos/broken.tiff");

    expect(viewer.status).toBe("error");
    expect(viewer.errorReason).toBe("corrupt");
  });
});

describe("shared display-limit constants", () => {
  it("MAX_DISPLAY_PIXELS is 256 MP (16384 squared)", () => {
    expect(MAX_DISPLAY_PIXELS).toBe(16384 * 16384);
    expect(MAX_DISPLAY_PIXELS).toBe(268_435_456);
    // The user-facing copy uses the 1024-based megapixel so it reads "256 MP".
    expect(Math.round(MAX_DISPLAY_PIXELS / (1024 * 1024))).toBe(256);
  });

  it("NATIVE_ROUTING_PIXELS is ~50 MP", () => {
    expect(NATIVE_ROUTING_PIXELS).toBe(50_000_000);
  });
});
