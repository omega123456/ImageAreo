import { beforeEach, describe, expect, it } from "vitest";

import { ipc } from "./ipc-mock";
import { folder } from "../lib/stores/folder.svelte";
import { settings } from "../lib/stores/settings.svelte";

describe("folder store", () => {
  beforeEach(() => {
    folder.reset();
    settings.resetForTests();
    settings.sortOrder = "name";
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
});
