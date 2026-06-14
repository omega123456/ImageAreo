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

    // The native path now probes dimensions before decoding, so wait until the
    // (hanging) decode has actually been invoked before resolving it.
    await vi.waitFor(() => expect(resolveDecode).toBeDefined());
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
      path: "/tmp/imageareo-images/heic.jpg",
      width: 1920,
      height: 1080,
      orientation: 6,
    }));

    await viewer.openPath("/photos/shot.heic");

    expect(ipc.calls("decode_image")).toEqual([
      {
        path: "/photos/shot.heic",
        quality: "display",
        priority: "currentImage",
        generation: expect.any(Number),
      },
    ]);
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/heic.jpg");
    expect(viewer.naturalWidth).toBe(1920);
    expect(viewer.naturalHeight).toBe(1080);
    expect(viewer.orientation).toBe(6);
    expect(viewer.name).toBe("shot.heic");
    expect(viewer.status).toBe("ready");
    expect(viewer.enhanceAvailable).toBe(false);
  });

  it("openPath() routes JXL through a single display decode_image request", async () => {
    await viewer.openPath("/photos/img.jxl");
    expect(ipc.calls("decode_image")).toEqual([
      {
        path: "/photos/img.jxl",
        quality: "display",
        priority: "currentImage",
        generation: expect.any(Number),
      },
    ]);
  });

  it("openPath() routes RAW through preview then display decode_image requests", async () => {
    ipc.override("decode_image", (args) => {
      if ((args as { quality?: string }).quality === "preview") {
        return {
          path: "/tmp/imageareo-images/raw-preview.jpg",
          width: 800,
          height: 600,
          orientation: 1,
        };
      }

      return {
        path: "/tmp/imageareo-images/raw-display.jpg",
        width: 4000,
        height: 3000,
        orientation: 1,
      };
    });

    await viewer.openPath("/photos/raw.cr2");

    await vi.waitFor(() => {
      expect(viewer.source).toBe("asset:///tmp/imageareo-images/raw-display.jpg");
    });
    expect(ipc.calls("decode_image")).toEqual([
      { path: "/photos/raw.cr2", quality: "preview" },
      { path: "/photos/raw.cr2", quality: "display" },
    ]);
    expect(ipc.calls("peek_decoded_image")).toEqual([
      { path: "/photos/raw.cr2", quality: "enhance" },
    ]);
    expect(viewer.naturalWidth).toBe(4000);
    expect(viewer.naturalHeight).toBe(3000);
    expect(viewer.status).toBe("ready");
    expect(viewer.enhanceAvailable).toBe(true);
  });

  it("openPath() resolves RAW after the preview loads even if display decode is still pending", async () => {
    let resolveDisplay: ((value: unknown) => void) | undefined;
    ipc.override("decode_image", (args) => {
      if ((args as { quality?: string }).quality === "preview") {
        return {
          path: "/tmp/imageareo-images/raw-preview.jpg",
          width: 640,
          height: 480,
          orientation: 1,
        };
      }

      return new Promise((resolve) => {
        resolveDisplay = resolve;
      });
    });

    await viewer.openPath("/photos/raw.dng");

    expect(viewer.status).toBe("ready");
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/raw-preview.jpg");
    expect(viewer.naturalWidth).toBe(640);
    expect(viewer.enhanceAvailable).toBe(false);
    // The display decode is initiated only after the (cache-miss) enhance peek.
    await vi.waitFor(() => {
      expect(ipc.calls("decode_image")).toEqual([
        { path: "/photos/raw.dng", quality: "preview" },
        { path: "/photos/raw.dng", quality: "display" },
      ]);
    });
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/raw-preview.jpg");

    resolveDisplay?.({
      path: "/tmp/imageareo-images/raw-display.jpg",
      width: 3200,
      height: 2400,
      orientation: 1,
    });

    await vi.waitFor(() => {
      expect(viewer.source).toBe("asset:///tmp/imageareo-images/raw-display.jpg");
    });
    expect(viewer.naturalWidth).toBe(3200);
    expect(viewer.naturalHeight).toBe(2400);
    expect(viewer.enhanceAvailable).toBe(true);
  });

  it("keeps the RAW preview visible when the background display decode fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    ipc.override("decode_image", (args) => {
      if ((args as { quality?: string }).quality === "preview") {
        return {
          path: "/tmp/imageareo-images/raw-preview.jpg",
          width: 640,
          height: 480,
          orientation: 1,
        };
      }

      throw new Error("display decode failed");
    });

    await viewer.openPath("/photos/raw.dng");

    expect(viewer.status).toBe("ready");
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/raw-preview.jpg");
    expect(viewer.naturalWidth).toBe(640);
    expect(viewer.naturalHeight).toBe(480);
    expect(viewer.enhanceAvailable).toBe(false);
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
  });

  it("flags upgrading while the display RAW decode runs and clears it when it resolves", async () => {
    let resolveDisplay: ((value: unknown) => void) | undefined;
    ipc.override("decode_image", (args) => {
      if ((args as { quality?: string }).quality === "preview") {
        return {
          path: "/tmp/imageareo-images/raw-preview.jpg",
          width: 640,
          height: 480,
          orientation: 1,
        };
      }

      return new Promise((resolve) => {
        resolveDisplay = resolve;
      });
    });

    await viewer.openPath("/photos/raw.dng");

    expect(viewer.upgrading).toBe(true);

    // Wait until the display decode has actually been invoked (after the enhance
    // peek) so `resolveDisplay` is wired up.
    await vi.waitFor(() => expect(resolveDisplay).toBeDefined());
    resolveDisplay?.({
      path: "/tmp/imageareo-images/raw-display.jpg",
      width: 3200,
      height: 2400,
      orientation: 1,
    });

    await vi.waitFor(() => {
      expect(viewer.upgrading).toBe(false);
    });
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/raw-display.jpg");
  });

  it("openPath() prefers a cached enhanced image over the display decode", async () => {
    ipc.override("decode_image", (args) => {
      if ((args as { quality?: string }).quality === "preview") {
        return {
          path: "/tmp/imageareo-images/raw-preview.jpg",
          width: 640,
          height: 480,
          orientation: 1,
        };
      }
      return {
        path: "/tmp/imageareo-images/raw-display.jpg",
        width: 4000,
        height: 3000,
        orientation: 1,
      };
    });
    // A previously-enhanced cache file exists on disk.
    ipc.override("peek_decoded_image", () => ({
      path: "/tmp/imageareo-images/raw-enhanced.jpg",
      width: 6000,
      height: 4000,
      orientation: 1,
    }));

    await viewer.openPath("/photos/raw.dng");

    await vi.waitFor(() => {
      expect(viewer.source).toBe(
        "asset:///tmp/imageareo-images/raw-enhanced.jpg",
      );
    });
    expect(viewer.enhanced).toBe(true);
    expect(viewer.enhanceAvailable).toBe(true);
    expect(viewer.samplePath).toBe("/tmp/imageareo-images/raw-enhanced.jpg");
    expect(viewer.naturalWidth).toBe(6000);
    // The display decode must be skipped when an enhanced image is cached.
    expect(
      ipc.calls("decode_image").filter(
        (c) => (c as { quality?: string }).quality === "display",
      ),
    ).toHaveLength(0);
  });

  it("clears the upgrading flag when the background display decode fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    ipc.override("decode_image", (args) => {
      if ((args as { quality?: string }).quality === "preview") {
        return {
          path: "/tmp/imageareo-images/raw-preview.jpg",
          width: 640,
          height: 480,
          orientation: 1,
        };
      }

      throw new Error("display decode failed");
    });

    await viewer.openPath("/photos/raw.dng");

    await vi.waitFor(() => {
      expect(viewer.upgrading).toBe(false);
    });
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/raw-preview.jpg");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("never flags upgrading or full-availability for a non-RAW backend format", async () => {
    ipc.override("decode_image", () => ({
      path: "/tmp/imageareo-images/tiff.png",
      width: 2,
      height: 2,
      orientation: 1,
    }));

    await viewer.openPath("/photos/image.tiff");

    expect(viewer.upgrading).toBe(false);
    expect(viewer.enhanceAvailable).toBe(false);
    expect(viewer.status).toBe("ready");
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
        path: "/tmp/imageareo-images/second.jpg",
        width: 2,
        height: 2,
        orientation: 1,
      };
    });

    const first = viewer.openPath("/photos/slow.heic");
    await viewer.openPath("/photos/fast.heic");

    // Resolve the superseded first load after the second has finished.
    resolveFirst({
      path: "/tmp/imageareo-images/first.jpg",
      width: 99,
      height: 99,
      orientation: 8,
    });
    await first;

    expect(viewer.source).toBe("asset:///tmp/imageareo-images/second.jpg");
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
        path: "/tmp/imageareo-images/ok.jpg",
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
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/ok.jpg");
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
      path: "/tmp/imageareo-images/orient.jpg",
      width: 4,
      height: 4,
      orientation: 7,
    }));
    await viewer.openPath("/photos/shot.heic");
    expect(viewer.orientation).toBe(7);
    viewer.reset();
    expect(viewer.orientation).toBe(1);
  });

  async function openRawToDisplay(): Promise<void> {
    ipc.override("decode_image", (args) => {
      const quality = (args as { quality?: string }).quality;
      if (quality === "preview") {
        return {
          path: "/tmp/imageareo-images/raw-preview.jpg",
          width: 640,
          height: 480,
          orientation: 1,
        };
      }
      if (quality === "display") {
        return {
          path: "/tmp/imageareo-images/raw-display.jpg",
          width: 4000,
          height: 3000,
          orientation: 1,
        };
      }
      return {
        path: "/tmp/imageareo-images/raw-enhanced.jpg",
        width: 6000,
        height: 4000,
        orientation: 1,
      };
    });

    await viewer.openPath("/photos/raw.dng");
    await vi.waitFor(() => expect(viewer.enhanceAvailable).toBe(true));
  }

  it("requestEnhance() loads the enhanced image and sets enhanced", async () => {
    await openRawToDisplay();

    await viewer.requestEnhance();

    expect(ipc.calls("decode_image")).toContainEqual({
      path: "/photos/raw.dng",
      quality: "enhance",
      priority: "currentImage",
      generation: expect.any(Number),
    });
    expect(viewer.enhanced).toBe(true);
    expect(viewer.enhancing).toBe(false);
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/raw-enhanced.jpg");
    expect(viewer.samplePath).toBe("/tmp/imageareo-images/raw-enhanced.jpg");
    expect(viewer.naturalWidth).toBe(6000);
  });

  it("requestEnhance() flags enhancing while the decode is in flight", async () => {
    await openRawToDisplay();
    let resolveEnhance: ((value: unknown) => void) | undefined;
    ipc.override("decode_image", () => {
      return new Promise((resolve) => {
        resolveEnhance = resolve;
      });
    });

    const pending = viewer.requestEnhance();
    expect(viewer.enhancing).toBe(true);
    expect(viewer.enhanced).toBe(false);

    resolveEnhance?.({
      path: "/tmp/imageareo-images/raw-enhanced.jpg",
      width: 6000,
      height: 4000,
      orientation: 1,
    });
    await pending;

    expect(viewer.enhancing).toBe(false);
    expect(viewer.enhanced).toBe(true);
  });

  it("requestEnhance() is a no-op once already enhanced", async () => {
    await openRawToDisplay();
    await viewer.requestEnhance();
    const callsBefore = ipc.calls("decode_image").length;

    await viewer.requestEnhance();

    expect(ipc.calls("decode_image")).toHaveLength(callsBefore);
    expect(viewer.enhanced).toBe(true);
  });

  it("requestEnhance() surfaces an error and keeps the display image on failure", async () => {
    await openRawToDisplay();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    ipc.override("decode_image", () => {
      throw new Error("enhance decode failed");
    });

    await viewer.requestEnhance();

    expect(viewer.enhanceError).toBe(true);
    expect(viewer.enhanced).toBe(false);
    expect(viewer.enhancing).toBe(false);
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/raw-display.jpg");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("requestEnhance() does nothing when enhance is not available", async () => {
    ipc.override("decode_image", () => ({
      path: "/tmp/imageareo-images/tiff.png",
      width: 2,
      height: 2,
      orientation: 1,
    }));
    await viewer.openPath("/photos/image.tiff");

    await viewer.requestEnhance();

    expect(viewer.enhanced).toBe(false);
    expect(
      ipc.calls("decode_image").filter(
        (c) => (c as { quality?: string }).quality === "enhance",
      ),
    ).toHaveLength(0);
  });

  it("navigating away mid-enhance cancels it and applies no superseded result", async () => {
    await openRawToDisplay();
    let resolveEnhance: ((value: unknown) => void) | undefined;
    ipc.override("decode_image", (args) => {
      if ((args as { quality?: string }).quality === "enhance") {
        return new Promise((resolve) => {
          resolveEnhance = resolve;
        });
      }
      return {
        path: "/tmp/imageareo-images/next.jpg",
        width: 100,
        height: 100,
        orientation: 1,
      };
    });

    const pending = viewer.requestEnhance();
    expect(viewer.enhancing).toBe(true);

    await viewer.openPath("/photos/next.tiff");

    resolveEnhance?.({
      path: "/tmp/imageareo-images/raw-enhanced.jpg",
      width: 6000,
      height: 4000,
      orientation: 1,
    });
    await pending;

    expect(viewer.path).toBe("/photos/next.tiff");
    expect(viewer.enhanced).toBe(false);
    expect(viewer.enhanceAvailable).toBe(false);
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/next.jpg");
  });

  it("reset() clears all enhance state", async () => {
    await openRawToDisplay();
    await viewer.requestEnhance();
    expect(viewer.enhanced).toBe(true);

    viewer.reset();

    expect(viewer.enhanceAvailable).toBe(false);
    expect(viewer.enhanced).toBe(false);
    expect(viewer.enhancing).toBe(false);
    expect(viewer.enhanceError).toBe(false);
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

  // ---- Phase 6: viewport tier + on-zoom sharpening upgrade ----------------

  function displayDecode(path: string, w: number, h: number) {
    return { path, width: w, height: h, orientation: 1 };
  }

  it("openPath() carries the viewport hint on a backend display decode", async () => {
    viewer.setViewportLongEdge(1000); // request ~1000 → bucket 1024
    ipc.override("decode_image", () =>
      displayDecode("/tmp/imageareo-images/disp.jpg", 4000, 3000),
    );

    await viewer.openPath("/photos/shot.heic");

    expect(ipc.calls("decode_image")).toEqual([
      {
        path: "/photos/shot.heic",
        quality: "display",
        priority: "currentImage",
        generation: expect.any(Number),
        viewport: { longEdgePx: 1000 },
      },
    ]);
    expect(viewer.status).toBe("ready");
  });

  it("openPath() omits the viewport hint when no viewport size is known", async () => {
    viewer.setViewportLongEdge(0);
    ipc.override("decode_image", () =>
      displayDecode("/tmp/imageareo-images/disp.jpg", 100, 100),
    );

    await viewer.openPath("/photos/shot.heic");

    const call = ipc.calls("decode_image")[0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("viewport");
  });

  it("zooming past the viewport tier fetches the 8192 tier and swaps it in", async () => {
    viewer.setViewportLongEdge(1000); // viewport tier caps at bucket 1024
    let displayCalls = 0;
    ipc.override("decode_image", (args) => {
      const vp = (args as { viewport?: { longEdgePx: number } }).viewport;
      displayCalls += 1;
      if (vp && vp.longEdgePx >= 8192) {
        return displayDecode("/tmp/imageareo-images/sharp.jpg", 8192, 6144);
      }
      return displayDecode("/tmp/imageareo-images/disp.jpg", 4000, 3000);
    });

    await viewer.openPath("/photos/shot.heic");
    expect(displayCalls).toBe(1);

    // Displayed long edge now far exceeds the 1024 tier cap → upgrade.
    await viewer.maybeUpgradeTier(5000);

    expect(displayCalls).toBe(2);
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/sharp.jpg");
    expect(viewer.sharpening).toBe(false);
  });

  it("preserves (rescales) zoom across the seamless tier swap instead of re-fitting", async () => {
    viewer.setViewportLongEdge(1000); // viewport tier caps at bucket 1024
    ipc.override("decode_image", (args) => {
      const vp = (args as { viewport?: { longEdgePx: number } }).viewport;
      if (vp && vp.longEdgePx >= 8192) {
        return displayDecode("/tmp/imageareo-images/sharp.jpg", 8192, 6144);
      }
      return displayDecode("/tmp/imageareo-images/disp.jpg", 4000, 3000);
    });

    await viewer.openPath("/photos/shot.heic");
    // The user zooms in on the viewport tier (long edge 4000).
    viewer.zoom = 2;

    await viewer.maybeUpgradeTier(5000);

    // The 8192-tier (long edge 8192) is swapped in; zoom is rescaled by
    // 4000/8192 so the on-screen size is unchanged, and the next <img> load is
    // flagged to preserve the transform (the host must not re-fit).
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/sharp.jpg");
    expect(viewer.zoom).toBeCloseTo((2 * 4000) / 8192, 5);
    expect(viewer.consumePreserveTransform()).toBe(true);
    // The flag is consumed exactly once.
    expect(viewer.consumePreserveTransform()).toBe(false);
  });

  it("clears the preserve-transform flag when a new image is opened", async () => {
    viewer.setViewportLongEdge(1000);
    ipc.override("decode_image", (args) => {
      const vp = (args as { viewport?: { longEdgePx: number } }).viewport;
      if (vp && vp.longEdgePx >= 8192) {
        return displayDecode("/tmp/imageareo-images/sharp.jpg", 8192, 6144);
      }
      return displayDecode("/tmp/imageareo-images/disp.jpg", 4000, 3000);
    });

    await viewer.openPath("/photos/shot.heic");
    viewer.zoom = 2;
    await viewer.maybeUpgradeTier(5000);

    // A fresh open (e.g. navigation) must drop any pending preserve flag so the
    // new image fits normally.
    await viewer.openPath("/photos/other.heic");
    expect(viewer.consumePreserveTransform()).toBe(false);
  });

  it("a zoom-out (displayed edge within the tier) does not trigger an upgrade", async () => {
    viewer.setViewportLongEdge(4000); // bucket 4096
    let displayCalls = 0;
    ipc.override("decode_image", () => {
      displayCalls += 1;
      return displayDecode("/tmp/imageareo-images/disp.jpg", 4000, 3000);
    });

    await viewer.openPath("/photos/shot.heic");
    expect(displayCalls).toBe(1);

    await viewer.maybeUpgradeTier(1000); // below the 4096 tier cap

    expect(displayCalls).toBe(1);
    expect(viewer.sharpening).toBe(false);
  });

  it("does not upgrade again once the max (8192) tier is reached", async () => {
    viewer.setViewportLongEdge(9000); // clamps to bucket 8192 on open
    let displayCalls = 0;
    ipc.override("decode_image", () => {
      displayCalls += 1;
      return displayDecode("/tmp/imageareo-images/disp.jpg", 8192, 6144);
    });

    await viewer.openPath("/photos/shot.heic");
    expect(displayCalls).toBe(1);

    await viewer.maybeUpgradeTier(20000);

    expect(displayCalls).toBe(1);
  });

  it("does not upgrade when the derivative is already source-limited", async () => {
    // The viewport tier caps at 4096, but the source is smaller than the cap so
    // the display decode comes back at its full 1400px long edge. Zooming in must
    // not request a sharper tier, since the 8192 decode would reproduce the same
    // (source-limited) pixels under a different cache key.
    viewer.setViewportLongEdge(4000); // bucket 4096
    let displayCalls = 0;
    ipc.override("decode_image", () => {
      displayCalls += 1;
      return displayDecode("/tmp/imageareo-images/small.jpg", 1400, 1400);
    });

    await viewer.openPath("/photos/small.heic");
    expect(displayCalls).toBe(1);

    // Displayed long edge far exceeds the 4096 tier cap, but there is no sharper
    // tier to fetch for this source.
    await viewer.maybeUpgradeTier(9000);

    expect(displayCalls).toBe(1);
    expect(viewer.sharpening).toBe(false);
  });

  it("does not upgrade a native direct image (no current tier)", async () => {
    // Small native image renders directly (no backend decode, tier = 0).
    await viewer.openPath("/photos/photo.jpg");
    const before = ipc.calls("decode_image").length;

    await viewer.maybeUpgradeTier(10000);

    expect(ipc.calls("decode_image")).toHaveLength(before);
    expect(viewer.sharpening).toBe(false);
  });

  it("re-attaches to an in-flight enhance on navigate-back and applies its result", async () => {
    await openRawToDisplay();

    // The enhance decode returns a single shared pending promise, simulating the
    // backend single-flight: a re-issued request joins the same running job.
    let resolveEnhance: ((v: unknown) => void) | undefined;
    const enhanceJob = new Promise((resolve) => {
      resolveEnhance = resolve;
    });
    let enhanceCalls = 0;
    ipc.override("decode_image", (args) => {
      const quality = (args as { quality?: string }).quality;
      if (quality === "enhance") {
        enhanceCalls += 1;
        return enhanceJob;
      }
      if (quality === "preview") {
        return displayDecode("/tmp/imageareo-images/raw-preview.jpg", 640, 480);
      }
      return displayDecode("/tmp/imageareo-images/raw-display.jpg", 4000, 3000);
    });

    const pending = viewer.requestEnhance();
    expect(viewer.isInFlight("/photos/raw.dng")).toBe(true);
    expect(viewer.enhancing).toBe(true);

    // Navigate away (bumps the open id); the enhance keeps running in background.
    await viewer.openPath("/photos/other.tiff");
    expect(viewer.enhancing).toBe(false);

    // Navigate back while the enhance is still running: the RAW upgrade re-attaches
    // to it under the new open id, so the spinner re-shows.
    await viewer.openPath("/photos/raw.dng");
    await vi.waitFor(() => expect(viewer.enhancing).toBe(true));

    // The frontend re-issued the request, but the backend single-flight joins the
    // same decode (here: the same shared promise) — no duplicate heavy demosaic.
    expect(enhanceCalls).toBe(2);

    // Completing the shared job applies the enhanced image and clears the spinner.
    resolveEnhance?.(displayDecode("/tmp/imageareo-images/enh.jpg", 6000, 4000));
    await pending;
    await vi.waitFor(() => expect(viewer.enhanced).toBe(true));
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/enh.jpg");
    expect(viewer.enhancing).toBe(false);
  });

  it("reset() clears the sharpening flag", async () => {
    viewer.setViewportLongEdge(1000);
    ipc.override("decode_image", () =>
      displayDecode("/tmp/imageareo-images/disp.jpg", 4000, 3000),
    );
    await viewer.openPath("/photos/shot.heic");
    viewer.sharpening = true;

    viewer.reset();

    expect(viewer.sharpening).toBe(false);
  });
});
