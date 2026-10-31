import { afterEach, describe, expect, it, vi } from "vitest";

import { ipc } from "./ipc-mock";
import { log, serializeContext } from "../lib/utils/log";

describe("frontend logger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("forwards each level to the backend with serialized context", async () => {
    log.info("opened", { path: "/photos/a.jpg" });
    log.warn("upgrade failed");
    log.error("action failed", { action: "copy" });
    log.debug("verbose");

    await vi.waitFor(() => expect(ipc.calls("log_frontend")).toHaveLength(4));
    expect(ipc.calls("log_frontend")).toEqual([
      { level: "info", message: "opened", details: '{"path":"/photos/a.jpg"}' },
      { level: "warn", message: "upgrade failed" },
      { level: "error", message: "action failed", details: '{"action":"copy"}' },
      { level: "debug", message: "verbose" },
    ]);
  });

  it("drops debug lines outside dev builds", async () => {
    vi.stubEnv("DEV", false);
    log.debug("verbose");
    log.info("kept");

    await vi.waitFor(() => expect(ipc.calls("log_frontend")).toHaveLength(1));
    expect(ipc.calls("log_frontend")).toEqual([{ level: "info", message: "kept" }]);
  });

  it("falls back to the console when the backend command rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    ipc.override("log_frontend", () => {
      throw new Error("ipc down");
    });

    log.warn("no context");
    log.error("with context", { path: "/a.jpg" });

    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(warn).toHaveBeenCalledWith("[imageareo:warn] no context", expect.anything());
    expect(error).toHaveBeenCalledWith(
      "[imageareo:error] with context",
      { path: "/a.jpg" },
      expect.anything(),
    );
  });

  it("serializes Error values and survives unserializable contexts", () => {
    expect(serializeContext(undefined)).toBeUndefined();
    expect(serializeContext({ error: new TypeError("bad path") })).toBe(
      '{"error":"TypeError: bad path"}',
    );

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeContext(circular)).toBe("[object Object]");
  });
});
