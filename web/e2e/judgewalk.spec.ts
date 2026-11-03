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

test("every explorer link on /judge has a second explorer beside it", async ({ page }) => {
  await page.goto("/judge");
  const rows = page.locator(".uprow").filter({ has: page.locator('a[href^="https://nearblocks.io/"]') });
  expect(await rows.count()).toBeGreaterThan(3);
  for (const r of await rows.all()) await expect(r.locator("a.alt")).toHaveAttribute("href", /^https:\/\/pikespeak\.ai\//);
});

test("judge: stepper, in-browser build check, current calls first, previous collapsed", async ({ page }) => {
  await page.goto("/judge");
  await expect(page.getByTestId("judge-steps").locator("> li, > div > li")).toHaveCount(7);
  await expect(page.getByTestId("judge-step-1")).toContainText("a55ebb14");
  const prev = page.getByTestId("judge-previous");
  await expect(prev).not.toHaveAttribute("open", "");
  const run = page.getByTestId("run-build");
  await run.getByRole("button").click();
  await expect(run).toHaveAttribute("data-state", "pass", { timeout: 20_000 });
  await expect(page.getByTestId("storybar")).toBeVisible();
});
