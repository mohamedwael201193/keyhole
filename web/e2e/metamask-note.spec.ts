import { expect, test } from "@playwright/test";
for (const p of ["/vault", "/mint"]) test(`${p} explains the MetaMask warning and links the wallet-less path`, async ({ page }) => {
  await page.goto(p);
  const n = page.getByTestId("metamask-note");
  await expect(n).toBeVisible({ timeout: 20_000 });
  await n.locator("summary").click();
  await expect(n).toContainText("*.vercel.app");
  await expect(n.locator('a[href="/verify"]')).toBeVisible();
});
