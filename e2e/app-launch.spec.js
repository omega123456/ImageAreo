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

test("the floating toolbar is hidden until an image is loaded", async ({ page }) => {
  await page.goto("/");
  // No image on launch: the empty state provides "Open File"; the floating
  // toolbar (which adapts its glyphs to the image behind it) stays hidden.
  await expect(page.getByRole("button", { name: "Open File" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open image" })).toHaveCount(0);
});
