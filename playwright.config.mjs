import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { defineConfig, devices } from "@playwright/test";
import { DEV_SERVER_HOST } from "./scripts/pick-dev-port.mjs";

// The Vite dev server loads vite.config.ts through Node's module.register(),
// which Node 26 deprecates (DEP0205). Until Vite moves to module.registerHooks()
// we silence just that one code for the spawned webServer (inherited via env so
// it stays cross-platform). The Playwright runner/workers are handled separately
// by PW_DISABLE_TS_ESM in the test:e2e script.
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, "--disable-warning=DEP0205"]
  .filter(Boolean)
  .join(" ");

const root = path.dirname(fileURLToPath(import.meta.url));
const portFile = path.join(root, ".playwright-dev-port");

const portText =
  process.env.PLAYWRIGHT_DEV_PORT ??
  (existsSync(portFile) ? readFileSync(portFile, "utf8") : null);

if (portText === null) {
  throw new Error(
    "Missing .playwright-dev-port. Run Playwright via `pnpm test:e2e`, set " +
      "PLAYWRIGHT_DEV_PORT, or first run: node scripts/ensure-playwright-port.mjs",
  );
}

const port = parseInt(portText.trim(), 10);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid Playwright dev server port: ${portText.trim()}`);
}

const baseURL = `http://${DEV_SERVER_HOST}:${port}`;
const availableCpus = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : Math.min(2, availableCpus),
  reporter: "line",
  timeout: 15_000,
  // Visual-regression baselines live in-repo under e2e/snapshots/, one folder
  // per spec file. Platform is part of the path because pixel output differs
  // across OSes (font hinting, AA), so each platform owns its own baselines.
  snapshotPathTemplate:
    "{testDir}/snapshots/{testFileName}/{platform}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 50,
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm --silent exec vite --host ${DEV_SERVER_HOST} --port ${port} --strictPort --logLevel error`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
