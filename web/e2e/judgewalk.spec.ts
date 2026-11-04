import { expect, test } from "@playwright/test";
import { IDENTITY } from "../lib/identity.gen";

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
  await expect(page.getByTestId("judge-step-1")).toContainText(IDENTITY.worker.wasm_sha256.slice(0, 8));
  const prev = page.getByTestId("judge-previous");
  await expect(prev).not.toHaveAttribute("open", "");
  const run = page.getByTestId("run-build");
  await run.getByRole("button").click();
  await expect(run).toHaveAttribute("data-state", "pass", { timeout: 20_000 });
  await expect(page.getByTestId("storybar")).toBeVisible();
});

test("settle: order cards show route, a 4-step progress and collapsed proof", async ({ page }) => {
  await page.goto("/settle");
  const ok = page.locator('[data-deposit="6pvcZZ2xMUhDpQmySGaVR2Cm9e3Aixx5QUQUPS7RAcha"]');
  await expect(ok.getByTestId("funds-path").locator("li")).toHaveCount(4, { timeout: 30_000 });
  await expect(ok.getByTestId("funds-path")).toHaveAttribute("data-step", "3");
  await expect(ok.getByTestId("proof")).not.toHaveAttribute("open", "");
  await expect(ok.getByTestId("st-updated")).toContainText("(UTC+2)");
  const rf = page.locator('[data-deposit="5sESFfrM4Tk6L5euDCTjjMxVAs5xmbZpj4i3V29s3KJ"]');
  await expect(rf.getByTestId("funds-path")).toContainText("Refunded to sender", { timeout: 30_000 });
  await expect(rf).toContainText("network fees");
});

test("settle: a refused quote reads as a sentence, not a code", async ({ page }) => {
  await page.route("**/api/oneclick", (r) => r.request().method() === "POST" ? r.fulfill({ json: { ok: false, error: { code: "policy_transaction_limit_exceeded" } } }) : r.fallback());
  await page.goto("/settle");
  await page.getByTestId("dry-btn").click();
  await expect(page.getByTestId("dry-msg")).toContainText("above this key's per-trade limit");
  await expect(page.getByTestId("dry-msg")).not.toContainText("policy_transaction_limit_exceeded");
});
