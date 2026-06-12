/**
 * Shared harness for the visual-regression (screenshot) suite.
 *
 * Playwright drives the Vite dev build in a real browser with no Tauri backend,
 * so this module fakes the backend at two seams:
 *
 *  1. `window.__TAURI_INTERNALS__` — a minimal in-page mock of the Tauri core so
 *     `invoke()` / `convertFileSrc()` resolve deterministically (the same seam
 *     the Vitest suite mocks, but installed via `addInitScript` for the browser).
 *  2. `page.route` — serves the committed PNG fixtures for every asset URL the
 *     mock hands back, and deliberately stalls/aborts the `slow`/`broken` paths
 *     so the loading and error states can be captured without races.
 *
 * It also pins the floating chrome (toolbar + zoom HUD) visible: the app hides
 * it after 2.5s of pointer inactivity, which would otherwise make every capture
 * a timing race. A tiny init-script interval re-dispatches `pointermove` so the
 * idle timer never fires.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../_fixtures",
);

/** The folder the mocked `scan_folder` returns — five distinct gradients. */
export const FIXTURE_ENTRIES = ["a", "b", "c", "d", "e"].map((id, index) => ({
  path: `/fixtures/${id}.png`,
  name: `${id}.png`,
  modified: 1_700_000_000 + index,
}));

/** Index of the entry the viewer opens by default (the blue gradient, c.png). */
export const FOCUSED_INDEX = 2;
export const FOCUSED_PATH = FIXTURE_ENTRIES[FOCUSED_INDEX].path;

/** A path the asset route never fulfills, freezing the viewer in `loading`. */
export const SLOW_PATH = "/fixtures/slow.png";
/** A path the asset route aborts, driving the viewer to `error`. */
export const BROKEN_PATH = "/fixtures/broken.png";

/**
 * Install the in-page Tauri mock. `config` is serialized to the browser and
 * controls the handshake path (auto-open on launch) and the folder listing.
 */
function installTauriMock(page, config) {
  return page.addInitScript((cfg) => {
    let callbackId = 0;
    let eventId = 0;

    const basename = (p) => String(p).split(/[\\/]/).pop();

    const invoke = (cmd, args) => {
      switch (cmd) {
        case "frontend_ready":
          return Promise.resolve(cfg.frontendReadyPath ?? null);
        case "scan_folder":
          return Promise.resolve(cfg.entries ?? []);
        case "generate_thumbnail":
          return Promise.resolve({ path: args.path });
        case "decode_image":
          return Promise.reject(new Error("decode_image not mocked"));
        case "plugin:event|listen":
          return Promise.resolve(++eventId);
        default:
          // Store/window/app/clipboard plugin calls: resolve empty so the app
          // falls back to its defaults exactly as it does on a cold launch.
          return Promise.resolve(undefined);
      }
    };

    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: (_cb, _once) => ++callbackId,
      unregisterCallback: () => {},
      invoke,
      convertFileSrc: (filePath) =>
        `${location.origin}/__e2e_asset__/${basename(filePath)}`,
    };

    // The event plugin's unlisten path reaches for this separate global on
    // teardown; stub it so component unmounts don't throw between navigations.
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };

    // Keep the floating chrome awake: re-assert pointer activity well within the
    // app's 2.5s idle window so the toolbar/HUD never fade mid-capture.
    setInterval(() => {
      window.dispatchEvent(new Event("pointermove"));
    }, 700);
  }, config);
}

/** Serve the committed PNG fixtures for every mocked asset URL. */
function serveFixtures(page) {
  return page.route("**/__e2e_asset__/**", async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname)
      .split("/")
      .pop();

    if (name === "slow.png") {
      // Never settle: holds the viewer in its loading state for the capture.
      return;
    }
    if (name === "broken.png") {
      return route.abort("failed");
    }

    try {
      const body = readFileSync(path.join(FIXTURE_DIR, name));
      await route.fulfill({ contentType: "image/png", body });
    } catch {
      await route.abort("failed");
    }
  });
}

/**
 * Boot the app in the given theme and backend scenario.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {"dark"|"light"} opts.theme
 * @param {string|null} [opts.frontendReadyPath] path auto-opened on launch
 * @param {Array} [opts.entries] folder listing `scan_folder` returns
 */
export async function bootApp(page, opts) {
  const { theme, frontendReadyPath = null, entries = FIXTURE_ENTRIES } = opts;

  await page.emulateMedia({ colorScheme: theme });
  await serveFixtures(page);
  await installTauriMock(page, { frontendReadyPath, entries });

  // Wait for DOM ready, not full `load`: the loading-state scenario holds an
  // asset request open forever, which would otherwise stall the `load` event.
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Theme is applied asynchronously after settings.initialize() resolves.
  await page.waitForFunction(
    (t) => document.documentElement.dataset.appearance === t,
    theme,
  );
  await page.evaluate(() => document.fonts.ready);
}

/** Wait until the viewer has a ready image (the zoom HUD only shows then). */
export async function waitForViewerReady(page) {
  await page
    .getByLabel("Toggle between actual size and fit to screen")
    .waitFor({ state: "visible" });
  // Settle the post-load fit (applied on the next animation frame).
  await page.waitForTimeout(150);
}
