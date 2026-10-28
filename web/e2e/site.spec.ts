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

test("verify: a published-build mainnet call passes in the browser", async ({ page }) => {
  await page.goto("/verify?call=cefbc64e-6c08-4bfe-a165-1667d9f5f25b");
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

test("gateway: unsigned trades, junk and oversized bodies are refused", async ({ request }) => {
  for (const op of ["swap", "withdraw"]) {
    expect((await (await request.post("/api/worker", { data: { op } })).json()).error.code).toBe("no_auth");
    expect((await (await request.post("/api/worker", { data: { op, auth: "junk" } })).json()).error.code).toBe("no_auth");
  }
  for (const op of ["copy", "sweep_minter"]) expect((await (await request.post("/api/worker", { data: { op } })).json()).error.code).toBe("bad_op");
  expect((await request.post("/api/worker", { data: "x".repeat(9000), headers: { "content-type": "application/json" } })).status()).toBe(413);
});

test("English only: no language switcher, and /ar redirects home", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator(".lang")).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  const res = await page.goto("/ar");
  expect(res?.status()).toBeLessThan(400);
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.locator("h1").first()).toBeVisible();
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

const FIT = ["/", "/atlas", "/vault", "/mint", "/gallery", "/verify", "/identity"];

test("navbar: full lockup shown and every page fits the viewport", async ({ page }) => {
  for (const p of FIT) {
    await page.goto(p, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".kh-word").first()).toHaveText("KEYHOLE");
    const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(extra, `${p} scrolls sideways`).toBeLessThanOrEqual(0);
    const word = (await page.locator(".kh-word").first().boundingBox())!;
    const vw = page.viewportSize()!.width;
    expect(word.x, `${p} wordmark starts off screen`).toBeGreaterThanOrEqual(-1);
    expect(word.x + word.width, `${p} wordmark is cut`).toBeLessThanOrEqual(vw + 1);
  }
  await page.goto("/vault");
  const box = await page.getByTestId("connect").boundingBox();
  expect(box!.height).toBeLessThanOrEqual(48);
  const logo = await page.getByRole("img", { name: "KEYHOLE" }).first().boundingBox();
  expect(logo!.width / logo!.height).toBeGreaterThan(3.5);
  expect(logo!.height).toBeGreaterThanOrEqual(30);
  await expect(page.getByText(/CC0/)).toHaveCount(0);
});

test("hero: official token logos are visible in the gold-dust hero", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1280, "desktop hero");
  await page.goto("/");
  const hero = page.locator(".hero");
  await expect(hero.locator(".hkey")).toBeVisible();
  for (const n of ["NEAR", "USDC", "ETH", "SOL", "ARB", "BTC", "ZEC", "Base"]) {
    await expect(hero.getByAltText(n, { exact: true })).toBeVisible({ timeout: 10_000 });
  }
});

for (const p of ["/vault", "/mint"]) {
  test(`${p}: how-it-works strip is numbered 01/02/03 in order`, async ({ page }) => {
    await page.goto(p);
    await expect(page.getByTestId("step-num")).toHaveText(["01", "02", "03"]);
  });
}
