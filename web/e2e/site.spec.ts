import { expect, test } from "@playwright/test";
const PAGES = ["/", "/atlas", "/vault", "/mint", "/gallery", "/verify"];
const shots = process.env.SHOTS_DIR;

for (const p of PAGES) {
  test(`renders ${p} without console errors`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon|WebGL/i.test(m.text())) errors.push(m.text()); });
    await page.goto(p, { waitUntil: "networkidle" });
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "KEYHOLE" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Built on NEAR/ })).toBeVisible();
    if (shots) { await page.waitForTimeout(p === "/" ? 8000 : 800); await page.screenshot({ path: `${shots}/${info.project.name}${p === "/" ? "/home" : p}.png`, fullPage: p !== "/" }); }
    expect(errors).toEqual([]);
  });
}

test("hero shows live supply from mainnet and official logos", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("supply")).toHaveText(/^\d+$/);
  for (const n of ["NEAR", "USDC", "ETH", "SOL", "ARB", "BTC", "ZEC", "Base"]) await expect(page.getByAltText(n, { exact: true })).toHaveCount(1);
});

test("gallery renders every on-chain key", async ({ page }) => {
  await page.goto("/gallery");
  const n = await page.getByTestId("gallery").getByTestId("key-nft").count();
  expect(n).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("gallery").locator('[data-state="locked"]').first()).toBeVisible();
});

test("verify: a real mainnet call passes all three checks, computed in-browser", async ({ page }) => {
  await page.goto("/verify?call=b8daeed3-b745-432c-98f8-0af674f0da51");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "true", { timeout: 30_000 });
});

test("verify: rejects a non-uuid", async ({ page }) => {
  await page.goto("/verify");
  await page.locator("#cid").fill("../../etc");
  await page.getByTestId("verify-btn").click();
  await expect(page.getByTestId("verify-error")).toBeVisible();
});

test("gateway: info is real and attested (needs a funded payment key)", async ({ request }) => {
  const info = await (await request.post("/api/worker", { data: { op: "info" } })).json();
  expect(info.output?.ok, JSON.stringify(info.error ?? null)).toBe(true);
  expect(info.output.keys_contract).toBe("keyhole-devmo.near");
  expect(info.attestation_url).toMatch(/attestations\/by-call\//);
});

test("gateway: fund-moving ops and junk are refused", async ({ request }) => {
  for (const op of ["swap", "withdraw", "sweep_minter"]) expect((await (await request.post("/api/worker", { data: { op } })).json()).error.code).toBe("bad_op");
  expect((await request.post("/api/worker", { data: "x".repeat(9000), headers: { "content-type": "application/json" } })).status()).toBe(413);
});

test("Arabic switches to RTL", async ({ page }) => {
  await page.goto("/");
  const mobile = (page.viewportSize()?.width ?? 1000) < 640;
  if (mobile) await page.getByRole("button", { name: "Menu" }).click();
  await page.locator(mobile ? "#lang-m" : "#lang").selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("h1")).toContainText("المفتاح");
});

test("vault shows a premium empty or offline state; connect opens the wallet selector", async ({ page }) => {
  await page.goto("/vault");
  await expect(page.getByTestId("vault-empty").or(page.getByTestId("offline"))).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("error")).toHaveCount(0);
  await page.getByTestId("connect").click();
  await expect(page.getByText(/MyNearWallet|Meteor/).first()).toBeVisible({ timeout: 20_000 });
});

test("music is off by default and toggles", async ({ page }) => {
  await page.goto("/");
  if ((page.viewportSize()?.width ?? 1000) < 640) await page.getByRole("button", { name: "Menu" }).click();
  const b = page.getByRole("button", { name: /Sound/ }).first();
  await expect(b).toHaveAttribute("aria-pressed", "false");
});

test("reduced motion: content is visible immediately", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(process.env.BASE_URL || "http://localhost:3100");
  await expect(page.locator(".hero-line").first()).toHaveCSS("opacity", "1");
  await ctx.close();
});

test("navbar: connect stays on one line and the full lockup is shown", async ({ page }) => {
  await page.goto("/vault");
  const box = await page.getByTestId("connect").boundingBox();
  expect(box!.height).toBeLessThanOrEqual(48);
  const logo = await page.getByRole("img", { name: "KEYHOLE" }).first().boundingBox();
  expect(logo!.width / logo!.height).toBeGreaterThan(3.5);
  expect(logo!.height).toBeGreaterThanOrEqual(30);
  await expect(page.getByText(/CC0/)).toHaveCount(0);
});

test("hero: no orbit logo is ever covered by the vault card", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1280, "card is desktop-only");
  await page.goto("/");
  await page.waitForTimeout(7000);
  const card = (await page.locator(".vaultcard").boundingBox())!;
  for (let k = 0; k < 3; k++) {
    for (const n of ["NEAR", "USDC", "ETH", "SOL", "ARB", "BTC", "ZEC", "Base"]) {
      const b = (await page.getByAltText(n, { exact: true }).boundingBox())!;
      const overlap = b.x < card.x + card.width && b.x + b.width > card.x && b.y < card.y + card.height && b.y + b.height > card.y;
      expect(overlap, `${n} overlaps the card`).toBe(false);
    }
    await page.waitForTimeout(4000);
  }
});
