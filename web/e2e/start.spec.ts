import { test, expect } from "@playwright/test";

test("landing primary CTA goes to /start", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-cta")).toHaveAttribute("href", "/start");
});
test("/start shows the first step and progress dots without a wallet", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByTestId("start-connect")).toBeVisible();
  await expect(page.getByTestId("start-dots").locator("li")).toHaveCount(6);
  await expect(page.getByTestId("start-dots").locator("li[aria-current=step]")).toContainText("Get started");
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
test("/start step 1: Google / email first, All wallets second (when the Privy app is configured)", async ({ page }) => {
  await page.goto("/start");
  const all = page.getByTestId("start-connect");
  await expect(all).toBeVisible();
  const social = page.getByTestId("start-social");
  if (await social.count()) {
    await expect(social).toHaveText("Continue with Google / email");
    await expect(all).toContainText("All wallets");
    const [a, b] = await Promise.all([social.boundingBox(), all.boundingBox()]);
    expect(a!.y).toBeLessThan(b!.y);
    // Click again until hydrated; the Privy modal (Google + email) must open.
    await expect(async () => { await social.click(); await expect(page.locator("#privy-modal-content")).toBeVisible({ timeout: 5_000 }); }).toPass({ timeout: 30_000 });
  }
});
