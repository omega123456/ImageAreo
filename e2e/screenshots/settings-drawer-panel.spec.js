import { test, expect } from "@playwright/test";
import {
  bootApp,
  DEFAULT_FILE_ASSOCIATIONS,
  FOCUSED_PATH,
  waitForViewerReady,
} from "./_support/harness.js";

for (const theme of ["dark", "light"]) {
  test(`settings drawer panel — ${theme}`, async ({ page }) => {
    await bootApp(page, {
      theme,
      frontendReadyPath: FOCUSED_PATH,
      fileAssociations: DEFAULT_FILE_ASSOCIATIONS,
    });
    await waitForViewerReady(page);

    await page.getByRole("button", { name: "Settings", exact: true }).click();

    const drawer = page.getByRole("dialog", { name: "Settings" });
    await expect(drawer).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Associate .jpg with ImageAreo" }),
    ).toBeVisible();
    await page.waitForTimeout(150);

    await expect(drawer).toHaveScreenshot(`settings-drawer-panel-${theme}.png`, {
      maxDiffPixelRatio: 0.005,
    });
  });
}
