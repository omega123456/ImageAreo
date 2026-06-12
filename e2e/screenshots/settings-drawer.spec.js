import { test, expect } from "@playwright/test";
import { bootApp, FOCUSED_PATH, waitForViewerReady } from "./_support/harness.js";

// Settings drawer open over a loaded image: theme, gallery density, and sort
// controls in the focus-trapped panel.
for (const theme of ["dark", "light"]) {
  test(`settings drawer — ${theme}`, async ({ page }) => {
    await bootApp(page, { theme, frontendReadyPath: FOCUSED_PATH });
    await waitForViewerReady(page);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.waitForTimeout(150);

    await expect(page).toHaveScreenshot(`settings-${theme}.png`);
  });
}
