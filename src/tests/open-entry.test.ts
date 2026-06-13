import { describe, expect, it, vi, beforeEach } from "vitest";

import { ipc } from "./ipc-mock";
import {
  dispatchMenuAction,
  goNext,
  goPrev,
  goToIndex,
  openPath,
  pathFromDropPayload,
  registerEntryPoints,
} from "../lib/utils/open-entry";
import { IPC_EVENTS, MENU_ACTIONS } from "../lib/ipc/commands";
import { folder } from "../lib/stores/folder.svelte";
import { viewer } from "../lib/stores/viewer.svelte";

beforeEach(() => {
  folder.reset();
  viewer.reset();
});

describe("openPath", () => {
  it("scans the folder and loads the resolved current entry into the viewer", async () => {
    ipc.override("scan_folder", () => [
      { path: "/photos/a.jpg", name: "a.jpg", modified: 1 },
      { path: "/photos/b.jpg", name: "b.jpg", modified: 2 },
    ]);

    await openPath("/photos/b.jpg");

    expect(ipc.calls("scan_folder")).toHaveLength(1);
    expect(folder.images).toHaveLength(2);
    expect(folder.current?.path).toBe("/photos/b.jpg");
    // Native jpg routes through convertFileSrc — no decode_image round-trip.
    expect(viewer.path).toBe("/photos/b.jpg");
    expect(viewer.source).toContain("/photos/b.jpg");
  });

  it("opens the first scanned image when given a folder path (drop case)", async () => {
    ipc.override("scan_folder", () => [
      { path: "/album/first.png", name: "first.png", modified: 1 },
    ]);

    await openPath("/album");

    expect(folder.current?.path).toBe("/album/first.png");
    expect(viewer.path).toBe("/album/first.png");
  });

  it("resets the viewer instead of decoding an empty folder path", async () => {
    ipc.override("scan_folder", () => []);

    viewer.openPath("/photos/existing.jpg");
    viewer.setReady(100, 100);

    await openPath("/photos/empty");

    expect(folder.current).toBeNull();
    expect(viewer.path).toBeNull();
    expect(viewer.status).toBe("idle");
    expect(ipc.calls("decode_image")).toHaveLength(0);
  });

  it("ignores a stale slower open after a newer request has already won", async () => {
    let releaseSlowScan: (() => void) | undefined;
    ipc.override("scan_folder", async (args) => {
      if (args?.path === "/photos/slow-folder") {
        await new Promise<void>((resolve) => {
          releaseSlowScan = resolve;
        });
        return [{ path: "/photos/slow-folder/slow.heic", name: "slow.heic", modified: 1 }];
      }

      return [{ path: "/photos/fast-folder/fast.jpg", name: "fast.jpg", modified: 2 }];
    });

    ipc.override("decode_image", async () => ({
      path: "/tmp/imageareo-images/slow.jpg",
      width: 10,
      height: 10,
      orientation: 1,
    }));

    const first = openPath("/photos/slow-folder");
    await Promise.resolve();

    await openPath("/photos/fast-folder");
    releaseSlowScan?.();
    await first;

    expect(folder.current?.path).toBe("/photos/fast-folder/fast.jpg");
    expect(viewer.path).toBe("/photos/fast-folder/fast.jpg");
    expect(ipc.calls("decode_image")).toHaveLength(0);
  });
});

describe("goNext / goPrev", () => {
  async function loadTwoImageFolder(): Promise<void> {
    ipc.override("scan_folder", () => [
      { path: "/photos/a.jpg", name: "a.jpg", modified: 1 },
      { path: "/photos/b.jpg", name: "b.jpg", modified: 2 },
    ]);
    await openPath("/photos/a.jpg");
  }

  it("advances the folder index and loads the next image", async () => {
    await loadTwoImageFolder();
    expect(folder.currentIndex).toBe(0);

    await goNext();

    expect(folder.currentIndex).toBe(1);
    expect(viewer.path).toBe("/photos/b.jpg");
  });

  it("steps back to the previous image", async () => {
    await loadTwoImageFolder();
    await goNext();
    expect(folder.currentIndex).toBe(1);

    await goPrev();

    expect(folder.currentIndex).toBe(0);
    expect(viewer.path).toBe("/photos/a.jpg");
  });

  it("resets the zoom transform to fit when navigating", async () => {
    await loadTwoImageFolder();
    viewer.zoom = 4;
    viewer.pan = { x: 80, y: 80 };

    await goNext();

    expect(viewer.zoom).toBe(1);
    expect(viewer.pan).toEqual({ x: 0, y: 0 });
    expect(viewer.fitMode).toBe("fit");
  });

  it("is a no-op at the folder boundary (does not reload)", async () => {
    await loadTwoImageFolder();
    expect(folder.currentIndex).toBe(0);

    await goPrev();

    expect(folder.currentIndex).toBe(0);
    expect(viewer.path).toBe("/photos/a.jpg");
  });

  it("loads a clicked gallery index and resets the zoom to fit", async () => {
    await loadTwoImageFolder();
    viewer.zoom = 4;
    viewer.pan = { x: 80, y: 80 };

    await goToIndex(1);

    expect(folder.currentIndex).toBe(1);
    expect(viewer.path).toBe("/photos/b.jpg");
    expect(viewer.zoom).toBe(1);
    expect(viewer.pan).toEqual({ x: 0, y: 0 });
    expect(viewer.fitMode).toBe("fit");
  });

  it("does not reload a native image when clicking the already-selected thumbnail", async () => {
    await loadTwoImageFolder();
    viewer.setReady(640, 480);

    await goToIndex(0);

    expect(folder.currentIndex).toBe(0);
    expect(viewer.path).toBe("/photos/a.jpg");
    expect(viewer.status).toBe("ready");
  });

  // AC #5 (end-to-end, real navigation callers): start a heavy enhance on a RAW,
  // navigate AWAY via goNext, then navigate BACK via goPrev while the enhance is
  // still in flight. The `enhancing` indicator must re-show, and the backend
  // single-flight must not be asked for a second enhance decode.
  it("re-attaches an in-flight enhance after navigating away and back, and applies it", async () => {
    ipc.override("scan_folder", () => [
      { path: "/photos/raw.dng", name: "raw.dng", modified: 1 },
      { path: "/photos/b.jpg", name: "b.jpg", modified: 2 },
    ]);
    // RAW preview/display return concrete decodes; the enhance decode is a single
    // shared pending promise — simulating the backend single-flight, so a
    // re-issued enhance request joins the same running job.
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
      return {
        path: "/tmp/imageareo-images/raw-display.jpg",
        width: 6000,
        height: 4000,
        orientation: 1,
      };
    });
    ipc.override("peek_decoded_image", () => null);

    await openPath("/photos/raw.dng");
    await vi.waitFor(() => expect(viewer.enhanceAvailable).toBe(true));

    const pending = viewer.requestEnhance();
    expect(viewer.enhancing).toBe(true);
    expect(viewer.isInFlight("/photos/raw.dng")).toBe(true);
    expect(enhanceCalls).toBe(1);

    // Navigate AWAY (b.jpg is native, so openPath resets enhance state).
    await goNext();
    expect(viewer.path).toBe("/photos/b.jpg");
    expect(viewer.enhancing).toBe(false);

    // Navigate BACK while the enhance for raw.dng is still running: the RAW
    // upgrade re-attaches to it under the new open id, re-showing the spinner.
    await goPrev();
    expect(viewer.path).toBe("/photos/raw.dng");
    await vi.waitFor(() => expect(viewer.enhancing).toBe(true));

    // The frontend re-issued the request; the backend single-flight joins the
    // same decode (here the same shared promise) — no duplicate heavy demosaic.
    expect(enhanceCalls).toBe(2);

    // Completing the shared job applies the enhanced image and clears the spinner.
    resolveEnhance?.({
      path: "/tmp/imageareo-images/raw-enhanced.jpg",
      width: 6000,
      height: 4000,
      orientation: 1,
    });
    await pending;
    await vi.waitFor(() => expect(viewer.enhanced).toBe(true));
    expect(viewer.source).toBe("asset:///tmp/imageareo-images/raw-enhanced.jpg");
    expect(viewer.enhancing).toBe(false);
  });
});

describe("pathFromDropPayload", () => {
  it("extracts the first path from a Tauri drop payload", () => {
    expect(
      pathFromDropPayload({ type: "drop", paths: ["/x/a.jpg", "/x/b.jpg"] }),
    ).toBe("/x/a.jpg");
  });

  it("ignores non-drop drag-drop event types (enter/over/leave)", () => {
    expect(pathFromDropPayload({ type: "enter", paths: ["/x/a.jpg"] })).toBeNull();
    expect(pathFromDropPayload({ type: "leave" })).toBeNull();
  });

  it("returns null for malformed payloads", () => {
    expect(pathFromDropPayload(null)).toBeNull();
    expect(pathFromDropPayload("nope")).toBeNull();
    expect(pathFromDropPayload({ type: "drop", paths: [] })).toBeNull();
    expect(pathFromDropPayload({ type: "drop", paths: [123] })).toBeNull();
    expect(pathFromDropPayload({ type: "drop" })).toBeNull();
  });
});

describe("dispatchMenuAction", () => {
  it("routes each known action to its handler", () => {
    const handlers = {
      openDialog: vi.fn(),
      openFolderDialog: vi.fn(),
      fit: vi.fn(),
      actualSize: vi.fn(),
      toggleGallery: vi.fn(),
      toggleFullscreen: vi.fn(),
      openSettings: vi.fn(),
    };

    dispatchMenuAction(MENU_ACTIONS.open, handlers);
    dispatchMenuAction(MENU_ACTIONS.openFolder, handlers);
    dispatchMenuAction(MENU_ACTIONS.fit, handlers);
    dispatchMenuAction(MENU_ACTIONS.actualSize, handlers);
    dispatchMenuAction(MENU_ACTIONS.toggleGallery, handlers);
    dispatchMenuAction(MENU_ACTIONS.toggleFullscreen, handlers);
    dispatchMenuAction(MENU_ACTIONS.settings, handlers);

    expect(handlers.openDialog).toHaveBeenCalledOnce();
    expect(handlers.openFolderDialog).toHaveBeenCalledOnce();
    expect(handlers.fit).toHaveBeenCalledOnce();
    expect(handlers.actualSize).toHaveBeenCalledOnce();
    expect(handlers.toggleGallery).toHaveBeenCalledOnce();
    expect(handlers.toggleFullscreen).toHaveBeenCalledOnce();
    expect(handlers.openSettings).toHaveBeenCalledOnce();
  });

  it("is a no-op for unknown keys and missing handlers", () => {
    expect(() => dispatchMenuAction("predefined.quit", {})).not.toThrow();
    expect(() => dispatchMenuAction(MENU_ACTIONS.fit, {})).not.toThrow();
  });
});

describe("registerEntryPoints", () => {
  it("flushes a buffered launch path returned by the ready handshake", async () => {
    ipc.override("frontend_ready", () => "/photos/cold.jpg");
    ipc.override("scan_folder", () => [
      { path: "/photos/cold.jpg", name: "cold.jpg", modified: 1 },
    ]);

    const unlisten = await registerEntryPoints({});

    expect(ipc.calls("frontend_ready")).toHaveLength(1);
    expect(folder.current?.path).toBe("/photos/cold.jpg");
    unlisten();
  });

  it("does not open anything when no path is buffered", async () => {
    ipc.override("frontend_ready", () => null);
    const unlisten = await registerEntryPoints({});
    expect(folder.current).toBeNull();
    unlisten();
  });

  it("opens a path delivered via the open-path event", async () => {
    ipc.override("frontend_ready", () => null);
    ipc.override("scan_folder", () => [
      { path: "/photos/event.jpg", name: "event.jpg", modified: 1 },
    ]);

    const unlisten = await registerEntryPoints({});
    await ipc.emit(IPC_EVENTS.openPath, "/photos/event.jpg");
    // Let the async open() settle.
    await vi.waitFor(() => expect(folder.current?.path).toBe("/photos/event.jpg"));
    unlisten();
  });

  it("routes a menu event to the supplied handler", async () => {
    ipc.override("frontend_ready", () => null);
    const fit = vi.fn();

    const unlisten = await registerEntryPoints({ fit });
    await ipc.emit(IPC_EVENTS.menu, MENU_ACTIONS.fit);
    await vi.waitFor(() => expect(fit).toHaveBeenCalledOnce());
    unlisten();
  });

  it("opens a path from a native webview drag-drop event", async () => {
    ipc.override("frontend_ready", () => null);
    ipc.override("scan_folder", () => [
      { path: "/dropped/x.jpg", name: "x.jpg", modified: 1 },
    ]);

    const unlisten = await registerEntryPoints({});
    await ipc.emit("tauri://drag-drop", {
      paths: ["/dropped/x.jpg"],
      position: { x: 0, y: 0 },
    });
    await vi.waitFor(() => expect(folder.current?.path).toBe("/dropped/x.jpg"));
    unlisten();
  });

  it("ignores an empty open-path event payload", async () => {
    ipc.override("frontend_ready", () => null);
    const unlisten = await registerEntryPoints({});
    await ipc.emit(IPC_EVENTS.openPath, "");
    expect(folder.current).toBeNull();
    unlisten();
  });
});
