import { describe, it, expect, beforeEach, vi } from "vitest";
import { viewer } from "../lib/stores/viewer.svelte";
import { ipc } from "./ipc-mock";

vi.mock("@tauri-apps/api/core", async () => {
  const actual = await vi.importActual<typeof import("@tauri-apps/api/core")>(
    "@tauri-apps/api/core",
  );
  return {
    ...actual,
    convertFileSrc: (path: string) => `asset://${path}`,
  };
});

describe("viewer store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    viewer.reset();
  });

  it("starts idle and empty", () => {
    expect(viewer.status).toBe("idle");
    expect(viewer.path).toBeNull();
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
    expect(viewer.path).toBeNull();
    expect(viewer.source).toBe("");
    expect(viewer.name).toBeNull();
    expect(viewer.naturalWidth).toBe(0);
    expect(viewer.naturalHeight).toBe(0);
  });

  it("openPath() resets zoom state before loading a native image", async () => {
    viewer.zoom = 4;
    viewer.pan = { x: 25, y: 15 };

    await viewer.openPath("/photos/photo.jpg");

    expect(viewer.path).toBe("/photos/photo.jpg");
    expect(viewer.status).toBe("ready");
    expect(viewer.name).toBe("photo.jpg");
    expect(viewer.zoom).toBe(1);
    expect(viewer.pan).toEqual({ x: 0, y: 0 });
    expect(viewer.source).toContain("asset://");
  });

  it("openPath() does NOT invoke decode_image for native formats", async () => {
    await viewer.openPath("/photos/photo.png");
    expect(ipc.calls("decode_image")).toHaveLength(0);
    expect(viewer.source).toContain("asset://");
    expect(viewer.status).toBe("ready");
  });

  it("openPath() flips to loading synchronously and keeps the old source until native decode resolves", async () => {
    let resolveDecode: (() => void) | undefined;
    vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveDecode = resolve;
      });
    });
    viewer.source = "asset://current.jpg";
    viewer.name = "current.jpg";
    viewer.status = "ready";
    viewer.zoom = 4;
    viewer.pan = { x: 25, y: 15 };

    const openPromise = viewer.openPath("/photos/next.jpg");

    expect(viewer.path).toBe("/photos/next.jpg");
    expect(viewer.name).toBe("next.jpg");
    expect(viewer.status).toBe("loading");
    expect(viewer.source).toBe("asset://current.jpg");
    expect(viewer.zoom).toBe(4);
    expect(viewer.pan).toEqual({ x: 25, y: 15 });

    resolveDecode?.();
    await openPromise;

    expect(viewer.status).toBe("ready");
    expect(viewer.source).toContain("/photos/next.jpg");
    expect(viewer.zoom).toBe(1);
    expect(viewer.pan).toEqual({ x: 0, y: 0 });
  });

  it("openPath() sets error status when native decode fails", async () => {
    vi.spyOn(HTMLImageElement.prototype, "decode").mockRejectedValue(
      new Error("broken image"),
    );

    await viewer.openPath("/photos/broken.jpg");

    expect(viewer.status).toBe("error");
    expect(viewer.path).toBe("/photos/broken.jpg");
  });

  it("openPath() routes exotic formats through decode_image", async () => {
    ipc.override("decode_image", () => ({
      dataUrl: "data:image/png;base64,AAAA",
      width: 1920,
      height: 1080,
      orientation: 6,
    }));

    await viewer.openPath("/photos/shot.heic");

    expect(ipc.calls("decode_image")).toEqual([{ path: "/photos/shot.heic" }]);
    expect(viewer.source).toBe("data:image/png;base64,AAAA");
    expect(viewer.naturalWidth).toBe(1920);
    expect(viewer.naturalHeight).toBe(1080);
    expect(viewer.orientation).toBe(6);
    expect(viewer.name).toBe("shot.heic");
    expect(viewer.status).toBe("ready");
  });

  it("openPath() routes RAW and JXL through decode_image", async () => {
    await viewer.openPath("/photos/raw.cr2");
    await viewer.openPath("/photos/img.jxl");
    expect(ipc.calls("decode_image")).toEqual([
      { path: "/photos/raw.cr2" },
      { path: "/photos/img.jxl" },
    ]);
  });

  it("openPath() sets error status when decode fails", async () => {
    ipc.override("decode_image", () => {
      throw new Error("corrupt file");
    });

    await viewer.openPath("/photos/broken.tiff");

    expect(viewer.status).toBe("error");
    expect(viewer.path).toBe("/photos/broken.tiff");
  });

  it("openPath() ignores a stale decode result when superseded", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    ipc.override("decode_image", (args) => {
      if ((args as { path: string }).path === "/photos/slow.heic") {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return {
        dataUrl: "data:image/png;base64,SECOND",
        width: 2,
        height: 2,
        orientation: 1,
      };
    });

    const first = viewer.openPath("/photos/slow.heic");
    await viewer.openPath("/photos/fast.heic");

    // Resolve the superseded first load after the second has finished.
    resolveFirst({
      dataUrl: "data:image/png;base64,FIRST",
      width: 99,
      height: 99,
      orientation: 8,
    });
    await first;

    expect(viewer.source).toBe("data:image/png;base64,SECOND");
    expect(viewer.naturalWidth).toBe(2);
    expect(viewer.orientation).toBe(1);
  });

  it("openPath() ignores a stale decode failure when superseded", async () => {
    let rejectFirst: (e: unknown) => void = () => {};
    ipc.override("decode_image", (args) => {
      if ((args as { path: string }).path === "/photos/slow.heic") {
        return new Promise((_resolve, reject) => {
          rejectFirst = reject;
        });
      }
      return {
        dataUrl: "data:image/png;base64,OK",
        width: 2,
        height: 2,
        orientation: 1,
      };
    });

    const first = viewer.openPath("/photos/slow.heic");
    await viewer.openPath("/photos/fast.heic");
    rejectFirst(new Error("late failure"));
    await first;

    // The fast load succeeded; the stale failure must not flip us to error.
    expect(viewer.status).toBe("ready");
    expect(viewer.source).toBe("data:image/png;base64,OK");
  });

  it("openPath() ignores a stale native decode result when superseded", async () => {
    let resolveFirst: (() => void) | undefined;
    const decodeSpy = vi
      .spyOn(HTMLImageElement.prototype, "decode")
      .mockImplementation(function (this: HTMLImageElement) {
        const currentSrc = this.getAttribute("src") ?? "";
        if (currentSrc.includes("slow.jpg")) {
          return new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve();
      });

    const first = viewer.openPath("/photos/slow.jpg");
    const firstImage = decodeSpy.mock.instances[0] as HTMLImageElement | undefined;

    await viewer.openPath("/photos/fast.jpg");
    resolveFirst?.();
    await first;

    expect(viewer.path).toBe("/photos/fast.jpg");
    expect(viewer.source).toContain("/photos/fast.jpg");
    expect(viewer.status).toBe("ready");
    expect(firstImage?.getAttribute("src") ?? "").toBe("");
  });

  it("reset() restores orientation to the identity value", async () => {
    ipc.override("decode_image", () => ({
      dataUrl: "data:image/png;base64,AAAA",
      width: 4,
      height: 4,
      orientation: 7,
    }));
    await viewer.openPath("/photos/shot.heic");
    expect(viewer.orientation).toBe(7);
    viewer.reset();
    expect(viewer.orientation).toBe(1);
  });

  it("rotateRight() cycles clockwise and wraps 270 → 0", () => {
    expect(viewer.rotation).toBe(0);
    viewer.rotateRight();
    expect(viewer.rotation).toBe(90);
    viewer.rotateRight();
    expect(viewer.rotation).toBe(180);
    viewer.rotateRight();
    expect(viewer.rotation).toBe(270);
    viewer.rotateRight();
    expect(viewer.rotation).toBe(0);
  });

  it("rotateLeft() cycles counter-clockwise and wraps 0 → 270", () => {
    expect(viewer.rotation).toBe(0);
    viewer.rotateLeft();
    expect(viewer.rotation).toBe(270);
    viewer.rotateLeft();
    expect(viewer.rotation).toBe(180);
    viewer.rotateLeft();
    expect(viewer.rotation).toBe(90);
    viewer.rotateLeft();
    expect(viewer.rotation).toBe(0);
  });

  it("load() resets a non-zero rotation back to 0", () => {
    viewer.rotateRight();
    expect(viewer.rotation).toBe(90);
    viewer.load("asset://next.jpg", "next.jpg");
    expect(viewer.rotation).toBe(0);
  });
});
