import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ipc } from "./ipc-mock";
import { session } from "../lib/stores/session.svelte";

describe("session store", () => {
  beforeEach(() => {
    session.resetForTests();
  });

  afterEach(() => {
    session.resetForTests();
  });

  it("defaults to no remembered image", async () => {
    await session.initialize();
    expect(session.lastImagePath).toBeNull();
  });

  it("loads a persisted last image path on initialize", async () => {
    ipc.override("plugin:store|get", (args) => {
      const key = String(args?.key ?? "");
      return key === "lastImagePath" ? ["/photos/last.jpg", true] : [undefined, false];
    });

    await session.initialize();

    expect(session.lastImagePath).toBe("/photos/last.jpg");
  });

  it("ignores a non-string persisted value", async () => {
    ipc.override("plugin:store|get", () => [42, true]);

    await session.initialize();

    expect(session.lastImagePath).toBeNull();
  });

  it("persists the last image path through the store plugin", async () => {
    await session.initialize();

    await session.setLastImagePath("/photos/a.jpg");

    expect(session.lastImagePath).toBe("/photos/a.jpg");
    expect(ipc.calls("plugin:store|set")).toEqual([
      { rid: 1, key: "lastImagePath", value: "/photos/a.jpg" },
    ]);
    expect(ipc.calls("plugin:store|save")).toHaveLength(1);
  });

  it("skips a redundant write when the path is unchanged", async () => {
    await session.initialize();

    await session.setLastImagePath("/photos/a.jpg");
    await session.setLastImagePath("/photos/a.jpg");

    expect(ipc.calls("plugin:store|set")).toHaveLength(1);
  });

  it("ignores an empty path", async () => {
    await session.initialize();

    await session.setLastImagePath("");

    expect(session.lastImagePath).toBeNull();
    expect(ipc.calls("plugin:store|set")).toHaveLength(0);
  });

  it("round-trips a written path back through a fresh initialize", async () => {
    await session.setLastImagePath("/photos/round.jpg");

    session.resetForTests();
    await session.initialize();

    expect(session.lastImagePath).toBe("/photos/round.jpg");
  });
});
