import { test, expect } from "@playwright/test";
import { bootApp, FOCUSED_PATH, waitForViewerReady } from "./_support/harness.js";

// Zoom HUD pill showing a live zoom percentage after zooming in from fit.
for (const theme of ["dark", "light"]) {
  test(`zoom hud — ${theme}`, async ({ page }) => {
    await bootApp(page, { theme, frontendReadyPath: FOCUSED_PATH });
    await waitForViewerReady(page);

    // Zoom in twice so the HUD reads a percentage rather than "Fit".
    await page.keyboard.press("=");
    await page.keyboard.press("=");
    const hud = page.getByRole("button", {
      name: "Toggle between actual size and fit to screen",
    });
    await expect(hud).not.toHaveText("Fit");
    await page.waitForTimeout(150);

    await expect(page).toHaveScreenshot(`zoom-hud-${theme}.png`);
  });
}
