import { test, expect } from "@playwright/test";
import { bootApp, FOCUSED_PATH, waitForViewerReady } from "./_support/harness.js";

// In-app Print window over a loaded image: the focus-trapped dialog with its
// WYSIWYG preview, template picker, and controls. The Tauri backend is mocked,
// so `print_current_view` is a no-op default-case resolve — we never press
// Print for a capture (that would close the dialog and fire the no-op IPC).

/** Open the print dialog via the real Ctrl/Cmd+P keybinding and settle it. */
async function openPrintDialog(page) {
  await page.keyboard.press("ControlOrMeta+p");
  await expect(page.getByRole("dialog", { name: "Print" })).toBeVisible();
  await page.waitForTimeout(150);
}

/**
 * Guard against the blank-preview regression: the WYSIWYG page card must
 * render with a non-trivial size. Previously it collapsed to zero height
 * inside a zero-height grid cell, baking empty screenshots.
 */
async function assertPreviewCardHasSize(page) {
  const card = page.getByTestId("print-page-card");
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box.width).toBeGreaterThan(50);
  expect(box.height).toBeGreaterThan(50);

  // Wait until every preview <img> inside the card has actually decoded, so the
  // capture is deterministic (the image paints on its own load cycle, separate
  // from the card layout) and the screenshot shows the image, not a blank page.
  await expect
    .poll(() =>
      card.evaluate((el) => {
        const imgs = [...el.querySelectorAll("img")];
        return (
          imgs.length > 0 &&
          imgs.every((img) => img.complete && img.naturalWidth > 0)
        );
      }),
    )
    .toBe(true);

  // `img.complete` means decoded, not yet composited. Give the browser a couple
  // of frames to actually paint the decoded bitmap before any capture, so the
  // baseline and verify runs both see the image rather than a blank page.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

// Default dialog (Full page template): dark + light.
for (const theme of ["dark", "light"]) {
  test(`print dialog — default — ${theme}`, async ({ page }) => {
    await bootApp(page, { theme, frontendReadyPath: FOCUSED_PATH });
    await waitForViewerReady(page);

    await openPrintDialog(page);
    await assertPreviewCardHasSize(page);

    await expect(page).toHaveScreenshot(`print-default-${theme}.png`);
  });
}

// A multi-cell template (4-up): the image is placed once in the top-left cell
// at that cell's size; the rest of the grid stays empty.
test("print dialog — 4-up template — dark", async ({ page }) => {
  await bootApp(page, { theme: "dark", frontendReadyPath: FOCUSED_PATH });
  await waitForViewerReady(page);

  await openPrintDialog(page);
  await page.getByRole("radio", { name: "4-up" }).click();
  await page.waitForTimeout(150);
  await assertPreviewCardHasSize(page);

  await expect(page).toHaveScreenshot("print-fourup-dark.png");
});

// Landscape orientation flips the preview page card.
test("print dialog — landscape — dark", async ({ page }) => {
  await bootApp(page, { theme: "dark", frontendReadyPath: FOCUSED_PATH });
  await waitForViewerReady(page);

  await openPrintDialog(page);
  await page.getByRole("button", { name: "Landscape" }).click();
  await page.waitForTimeout(150);
  await assertPreviewCardHasSize(page);

  await expect(page).toHaveScreenshot("print-landscape-dark.png");
});

// Fill mode on a multi-cell template: the single top-left image crops to fill
// its cell, and the "Fill crops to fit cell" helper appears.
test("print dialog — fill on 4-up — dark", async ({ page }) => {
  await bootApp(page, { theme: "dark", frontendReadyPath: FOCUSED_PATH });
  await waitForViewerReady(page);

  await openPrintDialog(page);
  await page.getByRole("radio", { name: "4-up" }).click();
  await page.getByRole("button", { name: "Fill", exact: true }).click();
  await page.waitForTimeout(150);
  await assertPreviewCardHasSize(page);

  await expect(page).toHaveScreenshot("print-fill-fourup-dark.png");
});
