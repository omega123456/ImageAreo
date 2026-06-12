import { test, expect } from "@playwright/test";
import { bootApp, SLOW_PATH } from "./_support/harness.js";

// Decoding state: the asset request is held open, so the spinner and the
// slow-decode "Decoding…" hint (shown after 1.5s) are both on screen. Waiting
// for the hint makes the capture deterministic rather than racing the timer.
for (const theme of ["dark", "light"]) {
  test(`loading state — ${theme}`, async ({ page }) => {
    await bootApp(page, {
      theme,
      frontendReadyPath: SLOW_PATH,
      entries: [{ path: SLOW_PATH, name: "slow.png", modified: 0 }],
    });

    await expect(page.getByText("Decoding…")).toBeVisible();
    // The spinner is an infinite CSS animation; Playwright freezes it at an
    // arbitrary rotation, so mask it for a stable capture while still asserting
    // the surrounding loading layout (spinner box + "Decoding…" hint).
    await expect(page).toHaveScreenshot(`loading-${theme}.png`, {
      mask: [page.getByRole("status", { name: "Loading image" })],
    });
  });
}
