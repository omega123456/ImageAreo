import { describe, it, expect, beforeEach } from "vitest";
import { ipc } from "./ipc-mock";
import { decodeImage, revealInFileManager, scanFolder } from "../lib/ipc";
import { viewer } from "../lib/stores/viewer.svelte";

/**
 * Validates the IPC mock seam end-to-end: `ipc.override()` stubs a command, the
 * (future P8) IPC layer is simulated here by invoking through the same
 * `@tauri-apps/api/core` channel the wrappers use, and a store reacts to the
 * stubbed response. This is the contract every later phase's command relies on.
 */
describe("IPC mock seam", () => {
  beforeEach(() => {
    viewer.reset();
  });

  it("serves a default fixture when no override is set", async () => {
    const entries = await scanFolder({
      path: "/photos",
      sortOrder: "name",
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].path).toBe("/photos/img1.jpg");
  });

  it("ipc.override() stubs a command and the viewer store reacts to it", async () => {
    ipc.override("decode_image", () => ({
      dataUrl: "data:image/png;base64,OVERRIDDEN",
      width: 1234,
      height: 567,
      orientation: 1,
    }));

    // Simulate the viewer flow: decode then drive the store from the response.
    const decoded = await decodeImage({ path: "/a.heic" });
    viewer.load(decoded.dataUrl, "a.heic");
    viewer.setReady(decoded.width, decoded.height);

    expect(viewer.source).toBe("data:image/png;base64,OVERRIDDEN");
    expect(viewer.naturalWidth).toBe(1234);
    expect(viewer.naturalHeight).toBe(567);
    expect(viewer.status).toBe("ready");
  });

  it("records call payloads for assertions", async () => {
    await revealInFileManager({ path: "/a.jpg" });
    expect(ipc.calls("reveal_in_file_manager")).toEqual([{ path: "/a.jpg" }]);
  });

  it("throws on an unmocked command so missing mocks fail loudly", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await expect(invoke("does_not_exist")).rejects.toThrow(
      /Unmocked Tauri IPC command/,
    );
  });

  it("emits Tauri events to live listeners", async () => {
    const { listen } = await import("@tauri-apps/api/event");
    let received: unknown = null;
    const un = await listen("test-event", (e) => {
      received = e.payload;
    });
    await ipc.emit("test-event", { value: 42 });
    expect(received).toEqual({ value: 42 });
    un();
  });
});
