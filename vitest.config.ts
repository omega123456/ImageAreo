import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

// =============================================================================
// Coverage gate & exclusion policy (project-wide, established in P3)
// -----------------------------------------------------------------------------
// The 90% line/function/statement gate is enforced below and fails the run if
// coverage drops. The Rust side enforces the same gate (see src-tauri).
//
// Coverage-exclusion policy: OS-side-effect code that cannot be asserted
// headlessly is excluded from the coverage denominator. On the FRONTEND the
// only such code is the thin IPC seam wrappers in `src/lib/ipc/` (created in
// P8) that do nothing but forward to Tauri `invoke()` — their pure logic lives
// elsewhere and IS tested via the IPC mock seam. The OS write/integration steps
// that live in Rust are excluded on the Rust side, specifically:
//   - `reveal_in_file_manager`           (Finder/Explorer reveal — OS call)
//   - the clipboard WRITE step of `copy_image_to_clipboard` (OS clipboard)
//   - fullscreen window calls            (window manager side effect)
//   - updater install / relaunch         (process side effect)
//   - the launch-path OS event hookup    (macOS "Opened" / argv wiring)
// Their PURE logic (decode, path parsing, sorting, classification) is NOT
// excluded and must be tested. Type-only modules, CSS, the bootstrap entry
// (`main.ts`), and the test harness itself are excluded as non-logic.
// =============================================================================

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: "jsdom",
    setupFiles: ["src/tests/setup.ts"],
    globals: true,
    include: ["src/tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json", "html", "lcov"],
      include: ["src/**"],
      exclude: [
        "src/main.ts",
        "src/tests/**",
        "src/vite-env.d.ts",
        "src/**/*.css",
        "src/lib/types/**",
        // Thin IPC forwarding wrappers (created in P8) — OS-boundary seam, no
        // pure logic. Tested via the IPC mock; excluded from the denominator
        // per the coverage-exclusion policy documented above.
        "src/lib/ipc/**",
        // Top-level app shell wires Tauri dialog/asset-protocol side effects.
        "src/App.svelte",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
