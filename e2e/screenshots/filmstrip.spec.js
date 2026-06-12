import { test, expect } from "@playwright/test";
import { bootApp, FOCUSED_PATH, waitForViewerReady } from "./_support/harness.js";

// Filmstrip thumbnail rail with a multi-image folder, the active thumb scaled
// up and centered.
for (const theme of ["dark", "light"]) {
  test(`filmstrip — ${theme}`, async ({ page }) => {
    await bootApp(page, { theme, frontendReadyPath: FOCUSED_PATH });
    await waitForViewerReady(page);

    const strip = page.getByRole("region", { name: "Filmstrip" });
    await expect(strip).toBeVisible();
    // Thumbnails generate through the mocked backend; wait for them to paint.
    await expect(strip.locator('[role="option"] img').first()).toBeVisible();
    await page.waitForTimeout(150);

    await expect(strip).toHaveScreenshot(`filmstrip-${theme}.png`);
  });
}
