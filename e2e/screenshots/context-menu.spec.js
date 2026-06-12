import { test, expect } from "@playwright/test";
import { bootApp, FOCUSED_PATH, waitForViewerReady } from "./_support/harness.js";

// Right-click context menu over the canvas: rotate / copy / reveal actions.
for (const theme of ["dark", "light"]) {
  test(`context menu — ${theme}`, async ({ page }) => {
    await bootApp(page, { theme, frontendReadyPath: FOCUSED_PATH });
    await waitForViewerReady(page);

    await page
      .getByTestId("viewer-canvas")
      .click({ button: "right", position: { x: 400, y: 300 } });
    await expect(page.getByRole("menu", { name: "Image actions" })).toBeVisible();

    await expect(page).toHaveScreenshot(`context-menu-${theme}.png`);
  });
}
