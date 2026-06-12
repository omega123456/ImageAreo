import { test, expect } from "@playwright/test";
import { bootApp, FOCUSED_PATH, waitForViewerReady } from "./_support/harness.js";

// Single image loaded in the viewer. The filmstrip is toggled off so the
// canvas + toolbar are the subject; zoom levels are captured as separate
// baselines (fit vs. actual size).
for (const theme of ["dark", "light"]) {
  test(`image viewer — ${theme}`, async ({ page }) => {
    await bootApp(page, { theme, frontendReadyPath: FOCUSED_PATH });
    await waitForViewerReady(page);

    // Hide the filmstrip to isolate the canvas (filmstrip has its own spec).
    await page.getByRole("button", { name: "Toggle filmstrip" }).click();
    await expect(page.getByRole("region", { name: "Filmstrip" })).toBeHidden();

    await expect(page).toHaveScreenshot(`viewer-fit-${theme}.png`);

    // Actual size (100%) — the image overflows and the HUD reads a percentage.
    await page.keyboard.press("1");
    await page.waitForTimeout(150);
    await expect(page).toHaveScreenshot(`viewer-actual-${theme}.png`);
  });
}
