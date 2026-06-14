import { beforeEach, describe, expect, it, vi } from "vitest";

import { ipc } from "./ipc-mock";
import { AUTO_SCAN_INTERVAL_MS, folder } from "../lib/stores/folder.svelte";
import { settings } from "../lib/stores/settings.svelte";

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
}

describe("folder store", () => {
  beforeEach(() => {
    folder.stopAutoScan();
    folder.reset();
    settings.resetForTests();
    settings.sortOrder = "name";
    setVisibility("visible");
  });

  it("populates from scan_folder and derives navigation state", async () => {
    ipc.override("scan_folder", () => [
      { path: "/photos/a.jpg", name: "a.jpg", modified: 1 },
      { path: "/photos/b.jpg", name: "b.jpg", modified: 2 },
      { path: "/photos/c.jpg", name: "c.jpg", modified: 3 },
    ]);

    const current = await folder.open("/photos/b.jpg");

    expect(current?.path).toBe("/photos/b.jpg");
    expect(folder.path).toBe("/photos");
    expect(folder.currentIndex).toBe(1);
    expect(folder.hasPrev).toBe(true);
    expect(folder.hasNext).toBe(true);
    expect(ipc.calls("scan_folder")).toEqual([
      { path: "/photos/b.jpg", sortOrder: "name" },
    ]);
  });

  it("moves through the folder entries without running extra scans", async () => {
    ipc.override("scan_folder", () => [
      { path: "/photos/a.jpg", name: "a.jpg", modified: 1 },
      { path: "/photos/b.jpg", name: "b.jpg", modified: 2 },
    ]);

    await folder.open("/photos/a.jpg");
    expect(folder.next()?.path).toBe("/photos/b.jpg");
    expect(folder.hasNext).toBe(false);
    expect(folder.prev()?.path).toBe("/photos/a.jpg");
    expect(ipc.calls("scan_folder")).toHaveLength(1);
  });

  it("captures scan errors cleanly", async () => {
    ipc.override("scan_folder", () => {
      throw new Error("scan failed");
    });

    const current = await folder.open("/photos/missing.jpg");

    expect(current).toBeNull();
    expect(folder.error).toBe("scan failed");
    expect(folder.images).toEqual([]);
    expect(folder.currentIndex).toBe(-1);
  });

  it("reapplies the current selection when the sort order changes live", async () => {
    let sortOrder = "name";
    ipc.override("scan_folder", () => {
      if (sortOrder === "name") {
        return [
          { path: "/photos/a.jpg", name: "a.jpg", modified: 1 },
          { path: "/photos/b.jpg", name: "b.jpg", modified: 2 },
        ];
      }
      return [
        { path: "/photos/b.jpg", name: "b.jpg", modified: 2 },
        { path: "/photos/a.jpg", name: "a.jpg", modified: 1 },
      ];
    });

    await folder.open("/photos/a.jpg");
    sortOrder = "date";

    const current = await folder.reloadForSortOrder("date");

    expect(current?.path).toBe("/photos/a.jpg");
    expect(folder.currentIndex).toBe(1);
    expect(ipc.calls("scan_folder")).toEqual([
      { path: "/photos/a.jpg", sortOrder: "name" },
      { path: "/photos/a.jpg", sortOrder: "date" },
    ]);
  });

  describe("auto-scan", () => {
    function seedFolder(images: { path: string; name: string }[]) {
      ipc.override("scan_folder", () =>
        images.map((entry, index) => ({ ...entry, modified: index + 1 })),
      );
    }

    it("baselines the signature on the first poll without rescanning", async () => {
      seedFolder([
        { path: "/photos/a.jpg", name: "a.jpg" },
        { path: "/photos/b.jpg", name: "b.jpg" },
      ]);
      ipc.override("folder_signature", () => 100);

      await folder.open("/photos/a.jpg");
      expect(ipc.calls("scan_folder")).toHaveLength(1);

      await folder.pollOnce();

      expect(ipc.calls("folder_signature")).toHaveLength(1);
      expect(ipc.calls("scan_folder")).toHaveLength(1);
    });

    it("does not rescan while the signature is unchanged", async () => {
      seedFolder([{ path: "/photos/a.jpg", name: "a.jpg" }]);
      ipc.override("folder_signature", () => 100);

      await folder.open("/photos/a.jpg");
      await folder.pollOnce(); // baseline
      await folder.pollOnce(); // unchanged
      await folder.pollOnce(); // unchanged

      expect(ipc.calls("scan_folder")).toHaveLength(1);
    });

    it("rescans and merges newly added files, preserving the selection", async () => {
      let listing = [
        { path: "/photos/a.jpg", name: "a.jpg" },
        { path: "/photos/b.jpg", name: "b.jpg" },
      ];
      ipc.override("scan_folder", () =>
        listing.map((entry, index) => ({ ...entry, modified: index + 1 })),
      );
      let signature = 100;
      ipc.override("folder_signature", () => signature);

      await folder.open("/photos/b.jpg");
      await folder.pollOnce(); // baseline
      expect(folder.currentIndex).toBe(1);

      listing = [...listing, { path: "/photos/c.jpg", name: "c.jpg" }];
      signature = 200;
      await folder.pollOnce();

      expect(folder.images.map((entry) => entry.path)).toEqual([
        "/photos/a.jpg",
        "/photos/b.jpg",
        "/photos/c.jpg",
      ]);
      expect(folder.current?.path).toBe("/photos/b.jpg");
      expect(folder.currentIndex).toBe(1);
    });

    it("drops removed files on rescan", async () => {
      let listing = [
        { path: "/photos/a.jpg", name: "a.jpg" },
        { path: "/photos/b.jpg", name: "b.jpg" },
        { path: "/photos/c.jpg", name: "c.jpg" },
      ];
      ipc.override("scan_folder", () =>
        listing.map((entry, index) => ({ ...entry, modified: index + 1 })),
      );
      let signature = 100;
      ipc.override("folder_signature", () => signature);

      await folder.open("/photos/a.jpg");
      await folder.pollOnce(); // baseline

      listing = listing.filter((entry) => entry.path !== "/photos/c.jpg");
      signature = 200;
      await folder.pollOnce();

      expect(folder.images.map((entry) => entry.path)).toEqual([
        "/photos/a.jpg",
        "/photos/b.jpg",
      ]);
      expect(folder.current?.path).toBe("/photos/a.jpg");
    });

    it("keeps the currently-viewed image visible when it is deleted on disk", async () => {
      let listing = [
        { path: "/photos/a.jpg", name: "a.jpg" },
        { path: "/photos/b.jpg", name: "b.jpg" },
        { path: "/photos/c.jpg", name: "c.jpg" },
      ];
      ipc.override("scan_folder", () =>
        listing.map((entry, index) => ({ ...entry, modified: index + 1 })),
      );
      let signature = 100;
      ipc.override("folder_signature", () => signature);

      await folder.open("/photos/b.jpg");
      await folder.pollOnce(); // baseline

      listing = listing.filter((entry) => entry.path !== "/photos/b.jpg");
      signature = 200;
      await folder.pollOnce();

      // b.jpg is gone from disk but still shown so the viewer doesn't jump.
      expect(folder.current?.path).toBe("/photos/b.jpg");
      expect(folder.images.map((entry) => entry.path)).toContain("/photos/b.jpg");
    });

    it("pauses polling while the document is hidden", async () => {
      seedFolder([{ path: "/photos/a.jpg", name: "a.jpg" }]);
      ipc.override("folder_signature", () => 100);

      await folder.open("/photos/a.jpg");
      setVisibility("hidden");

      await folder.pollOnce();

      expect(ipc.calls("folder_signature")).toHaveLength(0);
    });

    it("does nothing when no folder is open", async () => {
      ipc.override("folder_signature", () => 100);

      await folder.pollOnce();

      expect(ipc.calls("folder_signature")).toHaveLength(0);
    });

    it("selects the first image when an empty folder gains files", async () => {
      let listing: { path: string; name: string }[] = [];
      ipc.override("scan_folder", () =>
        listing.map((entry, index) => ({ ...entry, modified: index + 1 })),
      );
      let signature = 100;
      ipc.override("folder_signature", () => signature);

      await folder.open("/photos");
      expect(folder.currentIndex).toBe(-1);
      await folder.pollOnce(); // baseline

      listing = [{ path: "/photos/a.jpg", name: "a.jpg" }];
      signature = 200;
      await folder.pollOnce();

      expect(folder.current?.path).toBe("/photos/a.jpg");
      expect(folder.currentIndex).toBe(0);
    });

    it("leaves the listing untouched when a mid-poll rescan fails", async () => {
      let signature = 100;
      ipc.override("folder_signature", () => signature);
      ipc.override("scan_folder", () => [
        { path: "/photos/a.jpg", name: "a.jpg", modified: 1 },
        { path: "/photos/b.jpg", name: "b.jpg", modified: 2 },
      ]);

      await folder.open("/photos/a.jpg");
      await folder.pollOnce(); // baseline

      ipc.override("scan_folder", () => {
        throw new Error("scan failed mid-poll");
      });
      signature = 200;
      await folder.pollOnce();

      expect(folder.images.map((entry) => entry.path)).toEqual([
        "/photos/a.jpg",
        "/photos/b.jpg",
      ]);
      expect(folder.error).toBeNull();
    });

    it("scans immediately when the document becomes visible again", async () => {
      seedFolder([{ path: "/photos/a.jpg", name: "a.jpg" }]);
      ipc.override("folder_signature", () => 100);
      await folder.open("/photos/a.jpg");

      folder.startAutoScan();
      try {
        const before = ipc.calls("folder_signature").length;
        setVisibility("visible");
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
        await Promise.resolve();

        expect(ipc.calls("folder_signature").length).toBeGreaterThan(before);
      } finally {
        folder.stopAutoScan();
      }
    });

    it("does not clobber a concurrent open() that lands mid-poll", async () => {
      ipc.override("folder_signature", () => 100);
      ipc.override("scan_folder", () => [
        { path: "/photos/a.jpg", name: "a.jpg", modified: 1 },
        { path: "/photos/b.jpg", name: "b.jpg", modified: 2 },
      ]);
      await folder.open("/photos/a.jpg");
      await folder.pollOnce(); // baseline at sig 100

      // Signature moves, but hold the poll's rescan open so an open() can race it.
      let resolvePollScan: (value: { path: string; name: string; modified: number }[]) => void = () => {};
      let scanCall = 0;
      ipc.override("folder_signature", () => 200);
      ipc.override("scan_folder", () => {
        scanCall += 1;
        if (scanCall === 1) {
          return new Promise((resolve) => {
            resolvePollScan = resolve;
          });
        }
        return [{ path: "/photos/z.jpg", name: "z.jpg", modified: 9 }];
      });

      const poll = folder.pollOnce();
      await new Promise((resolve) => setTimeout(resolve, 0)); // reach the deferred scan

      // User opens a different image in the same folder while the poll is parked.
      await folder.open("/photos/z.jpg");
      expect(folder.current?.path).toBe("/photos/z.jpg");

      // The stale poll resolves last; its result must be discarded.
      resolvePollScan([
        { path: "/photos/a.jpg", name: "a.jpg", modified: 1 },
        { path: "/photos/b.jpg", name: "b.jpg", modified: 2 },
      ]);
      await poll;

      expect(folder.images.map((entry) => entry.path)).toEqual(["/photos/z.jpg"]);
      expect(folder.current?.path).toBe("/photos/z.jpg");
    });

    it("drives polling on an interval and stops cleanly", async () => {
      seedFolder([{ path: "/photos/a.jpg", name: "a.jpg" }]);
      ipc.override("folder_signature", () => 100);
      await folder.open("/photos/a.jpg");

      vi.useFakeTimers();
      try {
        folder.startAutoScan();
        await vi.advanceTimersByTimeAsync(AUTO_SCAN_INTERVAL_MS);
        const afterFirstTick = ipc.calls("folder_signature").length;
        expect(afterFirstTick).toBeGreaterThan(0);

        folder.stopAutoScan();
        await vi.advanceTimersByTimeAsync(AUTO_SCAN_INTERVAL_MS * 3);
        expect(ipc.calls("folder_signature")).toHaveLength(afterFirstTick);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
