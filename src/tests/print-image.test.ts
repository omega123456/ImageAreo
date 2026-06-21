import { afterEach, describe, expect, it, vi } from "vitest";

import { toPrintableDataUrl } from "../lib/utils/print-image";

describe("toPrintableDataUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves the source to a base64 data URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        blob: async () => new Blob(["pixels"], { type: "image/png" }),
      })),
    );

    const url = await toPrintableDataUrl("asset://poster.png");
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("propagates a fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("nope");
      }),
    );

    await expect(toPrintableDataUrl("asset://x.png")).rejects.toThrow("nope");
  });

  it("rejects with the reader error when reading fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["x"]) })));
    class FailingReader {
      error = new Error("read boom");
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      readAsDataURL(): void {
        this.onerror?.();
      }
    }
    vi.stubGlobal("FileReader", FailingReader);

    await expect(toPrintableDataUrl("asset://x.png")).rejects.toThrow("read boom");
  });

  it("rejects with a generic error when the reader has no error object", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["x"]) })));
    class NullErrorReader {
      error = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      readAsDataURL(): void {
        this.onerror?.();
      }
    }
    vi.stubGlobal("FileReader", NullErrorReader);

    await expect(toPrintableDataUrl("asset://x.png")).rejects.toThrow(
      "failed to read image bytes",
    );
  });
});
