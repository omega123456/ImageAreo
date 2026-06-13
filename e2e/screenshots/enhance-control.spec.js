import { test, expect } from "@playwright/test";
import { bootApp, RAW_PATH, waitForViewerReady } from "./_support/harness.js";

const RAW_ENTRY = {
  path: RAW_PATH,
  name: "raw.dng",
  modified: 1_700_000_100,
};

const RAW_DECODED_IMAGES = {
  [`${RAW_PATH}::preview`]: {
    path: "/cache/c.png",
    width: 1600,
    height: 1067,
    orientation: 1,
  },
  [`${RAW_PATH}::display`]: {
    path: "/cache/c.png",
    width: 2400,
    height: 1600,
    orientation: 1,
  },
};

for (const theme of ["dark", "light"]) {
  test(`enhance control — ${theme}`, async ({ page }) => {
    await bootApp(page, {
      theme,
      frontendReadyPath: RAW_PATH,
      entries: [RAW_ENTRY],
      decodedImages: RAW_DECODED_IMAGES,
      sampledImages: {
        [RAW_PATH]: "/fixtures/c.png",
      },
    });
    await waitForViewerReady(page);

    const enhanceButton = page.getByRole("button", { name: "Enhance this RAW to full sensor resolution" });
    await expect(enhanceButton).toBeVisible();
    await expect(page).toHaveScreenshot(`enhance-control-${theme}.png`);
  });
}
