import { test, expect } from "@playwright/test";
import {
  bootApp,
  FOCUSED_PATH,
  RAW_PATH,
  waitForViewerReady,
} from "./_support/harness.js";

const FOCUSED_METADATA = {
  [FOCUSED_PATH]: {
    fileName: "c.png",
    filePath: FOCUSED_PATH,
    format: "PNG",
    fileSizeBytes: 245_120,
    width: 600,
    height: 400,
    pixels: 240_000,
    colorType: "RGB",
    bitDepth: 8,
    orientation: 1,
    camera: {
      make: "Canon",
      model: "Canon EOS R6",
      lens: "RF24-105mm F4 L IS USM",
      iso: 400,
      aperture: 4.0,
      shutterSpeed: "1/250",
      focalLength: 50,
      dateTaken: "2026:06:10 14:32:00",
    },
  },
};

for (const theme of ["dark", "light"]) {
  test(`image info card — ${theme}`, async ({ page }) => {
    await bootApp(page, {
      theme,
      frontendReadyPath: FOCUSED_PATH,
      imageMetadata: FOCUSED_METADATA,
    });
    await waitForViewerReady(page);

    const card = page.getByTestId("image-info-card");
    await expect(card).toHaveCount(0);

    // Open via the toolbar Info button.
    const infoButton = page.getByRole("button", { name: "Image info" });
    await expect(infoButton).toHaveAttribute("aria-pressed", "false");
    await infoButton.click();
    await expect(card).toBeVisible();
    await expect(infoButton).toHaveAttribute("aria-pressed", "true");

    // All three metadata groups render, plus a representative row label.
    await expect(page.getByTestId("image-info-file")).toBeVisible();
    await expect(page.getByTestId("image-info-image")).toBeVisible();
    await expect(page.getByTestId("image-info-camera")).toBeVisible();
    await expect(card.getByText("Dimensions", { exact: true })).toBeVisible();

    // Capture the card element itself so its full box — including the rounded
    // bottom — is the snapshot target regardless of how tall the EXIF content is.
    await expect(card).toHaveScreenshot(`image-info-card-${theme}.png`);

    // The `I` key toggles the card closed again.
    await page.keyboard.press("i");
    await expect(card).toHaveCount(0);
    await expect(infoButton).toHaveAttribute("aria-pressed", "false");
  });
}

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

// The info card and the enhance control share the top-left flex-column stack
// (enhance first, card second). They must stack, never overlap.
test("info card and enhance control coexist without overlapping", async ({
  page,
}) => {
  await bootApp(page, {
    theme: "dark",
    frontendReadyPath: RAW_PATH,
    entries: [RAW_ENTRY],
    decodedImages: RAW_DECODED_IMAGES,
    sampledImages: { [RAW_PATH]: "/fixtures/c.png" },
  });
  await waitForViewerReady(page);

  // The enhance control auto-shows for a ready RAW.
  const enhanceButton = page.getByRole("button", {
    name: "Enhance this RAW to full sensor resolution",
  });
  await expect(enhanceButton).toBeVisible();

  // Open the info card; both now live in the top-left stack.
  await page.getByRole("button", { name: "Image info" }).click();
  const card = page.getByTestId("image-info-card");
  await expect(card).toBeVisible();

  const enhanceBox = await enhanceButton.boundingBox();
  const cardBox = await card.boundingBox();
  expect(enhanceBox).not.toBeNull();
  expect(cardBox).not.toBeNull();

  // The card (second child) starts at or below the enhance control's bottom.
  expect(cardBox.y).toBeGreaterThanOrEqual(
    enhanceBox.y + enhanceBox.height - 1,
  );
  // No vertical overlap between the two boxes.
  const overlap =
    Math.min(enhanceBox.y + enhanceBox.height, cardBox.y + cardBox.height) -
    Math.max(enhanceBox.y, cardBox.y);
  expect(overlap).toBeLessThanOrEqual(1);

  await expect(page).toHaveScreenshot("image-info-card-with-enhance.png");
});
