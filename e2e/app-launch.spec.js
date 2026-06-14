import { test, expect } from "@playwright/test";

test("app launches with the correct title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/ImageAreo/);
});

test("app shows the empty state on launch", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Open an image to get started")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open File" })).toBeVisible();
});

test("the floating toolbar is visible on launch with image actions disabled", async ({
  page,
}) => {
  await page.goto("/");
  // No image on launch: the empty state provides "Open File" and the floating
  // toolbar is shown, but its image-specific actions are disabled.
  await expect(page.getByRole("button", { name: "Open File" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open image" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open image" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Fit to screen" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeDisabled();
});
