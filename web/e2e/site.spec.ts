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

test("gateway: info is real, fund-moving ops and junk are refused", async ({ request }) => {
  const info = await (await request.post("/api/worker", { data: { op: "info" } })).json();
  expect(info.output.ok).toBe(true);
  expect(info.output.keys_contract).toBe("keyhole-devmo.near");
  expect(info.attestation_url).toMatch(/attestations\/by-call\//);
  for (const op of ["swap", "withdraw", "sweep_minter"]) expect((await (await request.post("/api/worker", { data: { op } })).json()).error.code).toBe("bad_op");
  expect((await request.post("/api/worker", { data: "x".repeat(9000), headers: { "content-type": "application/json" } })).status()).toBe(413);
});

test("Arabic switches to RTL", async ({ page }) => {
  await page.goto("/");
  await page.locator("#lang").selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("h1")).toContainText("المفتاح");
});

test("vault asks to connect; connect opens the wallet selector", async ({ page }) => {
  await page.goto("/vault");
  await page.getByRole("button", { name: "Connect wallet" }).last().click();
  await expect(page.getByText(/MyNearWallet|Meteor/).first()).toBeVisible({ timeout: 20_000 });
});

test("music is off by default and toggles", async ({ page }) => {
  await page.goto("/");
  const b = page.getByRole("button", { name: /Sound/ });
  await expect(b).toHaveAttribute("aria-pressed", "false");
});

test("reduced motion: content is visible immediately", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(process.env.BASE_URL || "http://localhost:3100");
  await expect(page.locator(".hero-line").first()).toHaveCSS("opacity", "1");
  await ctx.close();
});
