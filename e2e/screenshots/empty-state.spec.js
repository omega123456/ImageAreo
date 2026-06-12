import { test, expect } from "@playwright/test";
import { bootApp } from "./_support/harness.js";

// Launch screen: no image open, the drop affordance and Open File button.
for (const theme of ["dark", "light"]) {
  test(`empty state — ${theme}`, async ({ page }) => {
    await bootApp(page, { theme, frontendReadyPath: null });

    await expect(page.getByText("Open an image to get started")).toBeVisible();
    await expect(page).toHaveScreenshot(`empty-${theme}.png`);
  });
}
