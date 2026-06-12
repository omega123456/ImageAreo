import { test, expect } from "@playwright/test";
import { bootApp, BROKEN_PATH } from "./_support/harness.js";

// Load failure: the asset request is aborted, so the viewer falls to its error
// state with the Try Again / Open Another actions.
for (const theme of ["dark", "light"]) {
  test(`error state — ${theme}`, async ({ page }) => {
    await bootApp(page, {
      theme,
      frontendReadyPath: BROKEN_PATH,
      entries: [{ path: BROKEN_PATH, name: "broken.png", modified: 0 }],
    });

    await expect(page.getByText("Could not open this image")).toBeVisible();
    await expect(page).toHaveScreenshot(`error-${theme}.png`);
  });
}
