import { expect, test } from "@playwright/test";

test("key: numeric id 0 explains itself instead of erroring", async ({ page }) => {
  await page.goto("/key?id=0");
  await expect(page.getByTestId("key-legacy")).toContainText("KEYHOLE Key #0");
  await expect(page.getByTestId("key-error")).toHaveCount(0);
});

test("key: a bad id gets a plain hint", async ({ page }) => {
  await page.goto("/key?id=zz");
  await expect(page.getByTestId("key-error")).toContainText("That is not a key id");
});

test("gallery titles use the same short id as the vault", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/gallery");
  const card = page.getByTestId("gallery").getByTestId("key-nft").first();
  await expect(card).toBeVisible({ timeout: 45_000 });
  const tid = (await card.getByTestId("key-tid").innerText()).replace(/^Token\s+/, "").trim();
  const core = tid.replace(/^k/, "");
  await expect(card.getByTestId("key-link")).toHaveText(`KEYHOLE Key #${core.length > 6 ? core.slice(0, 4) : core}`);
  await expect(card.getByTestId("mint-no")).toContainText(/No\. \d+/);
});

test("every nearblocks tx link on /judge has a second explorer beside it", async ({ page }) => {
  await page.goto("/judge");
  const links = page.getByTestId("txlink");
  expect(await links.count()).toBeGreaterThan(2);
  await expect(links.first().getByTestId("txlink-alt")).toHaveAttribute("href", /^https:\/\/pikespeak\.ai\//);
});
