import { test, expect } from "@playwright/test";

test("landing primary CTA goes to /start", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-cta")).toHaveAttribute("href", "/start");
});
test("/start shows the first step and progress dots without a wallet", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByTestId("start-connect")).toBeVisible();
  await expect(page.getByTestId("start-dots").locator("li")).toHaveCount(6);
  await expect(page.getByTestId("start-dots").locator("li[aria-current=step]")).toContainText("Connect");
});
test("/start fits 390px without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/start");
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(390);
});
test("P1: landing hash and more links, verify label, key help, gallery traits", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hash-stat")).toHaveAttribute("href", "/judge");
  await expect(page.getByTestId("more-links").getByRole("link")).toHaveCount(3);
  await page.goto("/key");
  await expect(page.getByTestId("key-help")).toBeVisible();
  await page.goto("/gallery");
  await page.getByTestId("traits-explain").locator("summary").click();
  await expect(page.getByTestId("traits-explain")).toContainText("Bit cipher");
});
