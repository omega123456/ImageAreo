import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ipc } from "./ipc-mock";
import { associations } from "../lib/stores/associations.svelte";

describe("associations store", () => {
  beforeEach(() => {
    associations.resetForTests();
  });

  afterEach(() => {
    associations.resetForTests();
  });

  it("loads the current file-association state from IPC", async () => {
    ipc.override("query_file_associations", () => [
      { ext: "jpg", isDefault: true },
      { ext: "png", isDefault: false },
    ]);

    await associations.load(true);

    expect(associations.entries).toEqual([
      { ext: "jpg", isDefault: true },
      { ext: "png", isDefault: false },
    ]);
    expect(associations.isSelected("jpg")).toBe(true);
    expect(associations.isSelected("png")).toBe(false);
    expect(associations.canApply).toBe(false);
  });

  it("applies the selected extensions in entry order and reloads the live state", async () => {
    let queryCount = 0;
    ipc.override("query_file_associations", () => {
      queryCount += 1;

      if (queryCount === 1) {
        return [
          { ext: "jpg", isDefault: true },
          { ext: "png", isDefault: false },
          { ext: "webp", isDefault: false },
        ];
      }

      return [
        { ext: "jpg", isDefault: true },
        { ext: "png", isDefault: true },
        { ext: "webp", isDefault: false },
      ];
    });

    await associations.load(true);
    associations.toggle("png");

    expect(associations.canApply).toBe(true);

    await associations.apply();

    expect(ipc.calls("set_default_associations")).toEqual([
      { exts: ["jpg", "png"] },
    ]);
    expect(associations.isSelected("png")).toBe(true);
    expect(associations.entries[1]).toEqual({ ext: "png", isDefault: true });
    expect(associations.canApply).toBe(false);
  });

  it("surfaces a load failure", async () => {
    ipc.override("query_file_associations", () => {
      throw new Error("query failed");
    });

    await associations.load(true);

    expect(associations.entries).toEqual([]);
    expect(associations.error).toBe("query failed");
  });

  it("surfaces an apply failure without clearing the current selection", async () => {
    ipc.override("query_file_associations", () => [
      { ext: "jpg", isDefault: true },
      { ext: "png", isDefault: false },
    ]);
    ipc.override("set_default_associations", () => {
      throw new Error("apply failed");
    });

    await associations.load(true);
    associations.toggle("png");
    await associations.apply();

    expect(associations.error).toBe("apply failed");
    expect(associations.isSelected("png")).toBe(true);
  });
});
