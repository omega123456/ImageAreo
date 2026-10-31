import { describe, expect, it } from "vitest";

// Stands in for a `no-console` lint rule: all frontend logging must go through
// `src/lib/utils/log.ts` so it reaches the backend's daily log file.
const SOURCES = import.meta.glob<string>("../lib/**/*.{ts,svelte}", {
  query: "?raw",
  import: "default",
  eager: true,
});
const ALLOWED = new Set(["../lib/utils/log.ts"]);

describe("frontend logging policy", () => {
  it("scans the frontend sources", () => {
    expect(Object.keys(SOURCES)).toContain("../lib/utils/log.ts");
    expect(Object.keys(SOURCES)).toContain("../lib/components/ContextMenu.svelte");
  });

  it("uses console only inside the sanctioned log module", () => {
    const offenders = Object.entries(SOURCES)
      .filter(([file]) => !ALLOWED.has(file))
      .filter(([, source]) => /\bconsole\./.test(source))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });
});
