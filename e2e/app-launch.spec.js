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

test("the toolbar renders its action buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Open image" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fit to screen" })).toBeVisible();
});
