import { test, expect } from "@playwright/test";

test("landing primary CTA goes to /start", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-cta")).toHaveAttribute("href", "/start");
});
test("/start shows the first step and progress dots without a wallet", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByTestId("start-connect")).toBeVisible();
  await expect(page.getByTestId("start-dots").locator("li")).toHaveCount(6);
  await expect(page.getByTestId("start-dots").locator("li[aria-current=step]")).toHaveText("Connect");
});
test("/start fits 390px without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/start");
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(390);
});
