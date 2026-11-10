import {fixtureRedirect} from "./support/signed-redirect";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const PAGES = ["/", "/atlas", "/vault", "/mint", "/gallery", "/verify", "/judge", "/ask"];
const shots = process.env.SHOTS_DIR;

for (const p of PAGES) {
  test(`renders ${p} without console errors`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon|WebGL|status of 429|Too Many Requests/i.test(m.text())) errors.push(m.text()); });
    await page.goto(p, { waitUntil: "networkidle" });
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "KEYHOLE" }).first()).toBeVisible();
    // Site pages show it in the footer; app pages keep it in the sidebar, which on phones lives in the menu sheet.
    const app = /^\/(vault|mint|gallery|dashboard|swap|keys|settle|key|pnl|verify|attack)/.test(p);
    if (app && (page.viewportSize()?.width ?? 1000) <= 860) await expect(page.getByRole("link", { name: /Built on NEAR/, includeHidden: true }).first()).toBeAttached();
    else await expect(page.getByRole("link", { name: /Built on NEAR/ }).first()).toBeVisible();
    if (shots) { await page.waitForTimeout(p === "/" ? 8000 : 800); await page.screenshot({ path: `${shots}/${info.project.name}${p === "/" ? "/home" : p}.png`, fullPage: p !== "/" }); }
    expect(errors).toEqual([]);
  });
}

test("hero shows live supply from mainnet and official logos", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("supply")).toHaveText(/^\d+$/, { timeout: 15_000 });
  for (const n of ["NEAR", "USDC", "ETH", "SOL", "ARB", "BTC", "ZEC", "Base"]) await expect(page.getByAltText(n, { exact: true })).toHaveCount(1);
});

test("gallery renders every on-chain key", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/gallery");
  await expect(page.getByTestId("key-nft").first()).toBeVisible({ timeout: 45_000 });
  const n = await page.getByTestId("gallery").getByTestId("key-nft").count();
  expect(n).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("gallery").locator('[data-state="locked"]').first()).toBeVisible();
});

test("verify: a previous-build mainnet call still passes in the browser", async ({ page }) => {
  await page.goto("/verify?call=f4768da8-2e87-4622-8654-d1e67f6cd1f0");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "previous", { timeout: 30_000 });
});

test("verify: the previous-build verdict says so, and the current call links its own publish tx", async ({ page }) => {
  await page.goto("/verify?call=f4768da8-2e87-4622-8654-d1e67f6cd1f0");
  await expect(page.getByTestId("verdict")).toHaveText(/previous build/, { timeout: 30_000 });
  await page.goto("/verify");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "true", { timeout: 30_000 });
  await expect(page.locator('a[href*="BWQxEoSg3b6XHdk4iooAneoBJM7EtP83HTrvYXpdBQi5"]').first()).toBeVisible();
  await expect(page.locator('a[href*="MG7pGVSN"]')).toHaveCount(0);
  await expect(page.locator('a[href*="EA7S1TeV"]')).toHaveCount(0);
});

test("verify: the default page checks the published d337e822 info call", async ({ page }) => {
  await page.goto("/verify");
  await expect(page.locator("#cid")).toHaveValue("dc3668db-674f-4865-a2ce-272f70c41b0d");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "true", { timeout: 30_000 });
  await expect(page.locator(".ck .ok.bad")).toHaveCount(0);
  await expect(page.locator(".ck .ok.wait")).toHaveCount(0);
  await expect(page.locator(".ck .ok")).toHaveCount(6);
  await expect(page.getByText("d337e822544d31da644728ba794f444f7f3ef6c54a6ee7442ab22d07e049ae41").first()).toBeVisible();
  await expect(page.getByTestId("ck-binding")).toContainText("✓ Bound");
  await expect(page.getByRole("button", { name: "earlier · 2 USDC over the $1 cap" })).toBeVisible();
  await expect(page.getByTestId("ck-output").locator(".ok")).toHaveText("✓");
  await expect(page.getByTestId("hashes-note")).toContainText("RTMR3");
});

test("verify: rejects a non-uuid", async ({ page }) => {
  await page.goto("/verify");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "true", { timeout: 30_000 });
  await page.locator("#cid").fill("../../etc");
  const btn = page.getByTestId("verify-btn");
  await expect(btn).toBeEnabled();
  await btn.click({ force: true });
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

test("header Connect wallet opens the selector on the first click on a 6x slower CPU", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  // The site bar has no wallet control in v3; the header Connect lives in the app bar.
  await page.goto("/vault", { waitUntil: "domcontentloaded" });
  await page.getByTestId("connect").click();
  await page.getByTestId("choose-other").click();
  await expect(page.locator("#near-wallet-selector-modal .nws-modal-wrapper.open")).toBeVisible({ timeout: 20_000 });
});

test("header Connect wallet is disabled in server HTML and enabled after hydration", async ({ page, request }) => {
  const html = await (await request.get("/vault")).text();
  expect(html).toMatch(/data-testid="connect"[^>]*disabled|disabled[^>]*data-testid="connect"/);
  await page.goto("/vault");
  await expect(page.getByTestId("connect")).toHaveAttribute("data-hydrated", "1");
  await expect(page.getByTestId("connect")).toBeEnabled();
});

test("header Connect wallet opens the selector on the first click", async ({ page }) => {
  await page.goto("/vault", { waitUntil: "domcontentloaded" });
  const btn = page.getByTestId("connect");
  await expect(btn).toHaveText("Connect wallet");
  await btn.click();
  await expect(page.getByTestId("wallet-chooser")).toBeVisible();
  await expect(page.getByTestId("choose-near")).toContainText("one popup");
  await page.getByTestId("choose-other").click();
  const modal = page.locator("#near-wallet-selector-modal .nws-modal-wrapper.open");
  await expect(modal).toBeVisible({ timeout: 20_000 });
  const box = await modal.boundingBox();
  const vp = page.viewportSize();
  expect(box).toBeTruthy();
  expect(vp).toBeTruthy();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp!.height + 1);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp!.width + 1);
  await expect(modal.getByText("Connect your wallet")).toBeVisible();
  const row = modal.getByText("MetaMask / Ethereum wallet");
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible();
  const rowBox = await row.boundingBox();
  expect(rowBox).toBeTruthy();
  expect(rowBox!.y).toBeGreaterThanOrEqual(0);
  expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual((vp?.height ?? 0) + 1);
  if ((vp?.width ?? 1000) <= 700) await expect(page.locator("#near-wallet-selector-modal .modal-right")).toBeHidden();
  await expect(modal.getByText("Connecting and minting ask only for a signature. A deposit is a normal transfer you approve in your wallet.")).toBeVisible();
});

test("sealed vault names MetaMask and a gas-free signature", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({ json: { online: true, reason: null } }));
  await page.goto("/vault");
  const empty = page.getByTestId("vault-empty");
  await expect(empty).toBeVisible({ timeout: 30_000 });
  await expect(empty).toContainText("Connect a NEAR wallet or MetaMask");
  await expect(empty).toContainText("one gas-free signature that only the enclave can check");
});

test("a cold health check stays on checking until the retry settles", async ({ page }) => {
  let hits = 0;
  await page.route("**/api/health", async (route) => {
    hits += 1;
    await new Promise((r) => setTimeout(r, 700));
    await route.fulfill({ json: { online: false, reason: "gateway" } });
  });
  await page.goto("/vault", { waitUntil: "domcontentloaded" });
  const offline = page.getByTestId("offline");
  const live = page.getByText("Enclave live", { exact: false });
  if (await live.isVisible().catch(() => false)) {
    await page.waitForTimeout(250);
    await expect(offline).toHaveCount(0);
    return;
  }
  await expect(page.getByTestId("enclave-checking")).toBeVisible();
  await expect(offline).toHaveCount(0);
  await expect(offline).toBeVisible({ timeout: 15_000 });
  expect(hits).toBeGreaterThanOrEqual(2);
});

async function holdAccount(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("signedAccountId", "holder.keyhole.test");
    localStorage.setItem("near-wallet-selector:selectedWalletId", JSON.stringify("my-near-wallet"));
  });
  await page.route("**/api/health", (route) => route.fulfill({ json: { online: true, reason: null } }));
  // The key store reads the holder's keys through the server route first; it cannot see this page's RPC mock.
  await page.route("**/api/keys?**", (route) => route.fulfill({ json: {
    keys: [{ token_id: "4", owner_id: "holder.keyhole.test", metadata: { title: "Key", description: null, expires_at: null, issued_at: null } }], tier: 1,
  } }));
  await page.route("https://rpc.mainnet.fastnear.com/**", async (route) => {
    let method = "";
    try { method = (route.request().postDataJSON() as { params?: { method_name?: string } })?.params?.method_name || ""; } catch { /* not a view call */ }
    const payload = method === "nft_tokens_for_owner"
      ? [{ token_id: "4", owner_id: "holder.keyhole.test", metadata: { title: "Key", description: null, expires_at: null, issued_at: null } }]
      : method === "nft_tier" ? 1 : null;
    if (payload == null) return route.continue();
    const bytes = [...new TextEncoder().encode(JSON.stringify(payload))];
    await route.fulfill({ json: { jsonrpc: "2.0", id: "kh", result: { result: bytes } } });
  });
}

test("holder-only withdrawal shows an immutable NEAR receiver", async ({ page }) => {
  await holdAccount(page);
  await page.goto("/vault");
  await expect(page.getByTestId("account")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("open-withdraw").click();
  const sheet = page.getByTestId("withdraw-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("w-chain")).toHaveText("NEAR");
  await expect(sheet.getByTestId("w-dest")).toHaveText("holder.keyhole.test");
  await expect(sheet.locator("input#w-dest")).toHaveCount(0);
  await expect(sheet.getByTestId("w-dest").locator("input, textarea, select")).toHaveCount(0);
});

test("connected account opens a menu instead of disconnecting", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await holdAccount(page);
  if (info.project.name === "desktop") await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/vault");
  const pill = page.getByTestId("account");
  await expect(pill).toBeVisible({ timeout: 20_000 });
  // /vault is inside the app shell now: its top bar (components/app/AppShell.tsx) holds the brand and the pill.
  const brand = await page.locator(".app-top .brand .kh-logo").first().boundingBox();
  const pb = await pill.boundingBox();
  expect(brand!.x + brand!.width, "logo overlaps the account pill").toBeLessThanOrEqual(pb!.x);
  await pill.click();
  await expect(pill).toBeVisible();
  const menu = page.getByTestId("account-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("account-id")).toHaveText("holder.keyhole.test");
  await menu.getByRole("menuitem", { name: "Copy address" }).click();
  await expect(menu.getByRole("menuitem", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("holder.keyhole.test");
  await expect(menu.getByRole("menuitem", { name: "View on explorer" })).toHaveAttribute("href", "https://nearblocks.io/address/holder.keyhole.test");
  await expect(page.getByTestId("vault-account")).toHaveText("holder.keyhole.test");
  const box = await menu.boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
});

for (const kind of ["swap", "withdraw"] as const) {
  test(`a redirect return restores the ${kind} card`, async ({ page }) => {
    test.setTimeout(60_000);
    await holdAccount(page);
    await page.route("**/api/worker", async (route) => {
      const output = kind === "withdraw"
        ? { ok: true, op: "withdraw", request_id: "b5ea", status: "success" }
        : { ok: true, op: "swap", amount_out: "4484263051703687050358", intent_hash: "4qAnExample", request_id: "fb7e", status: "success", usd_in_micro: 20000 };
      await route.fulfill({ json: { call_id: "c1", status: "ok", output, attestation_url: null, time_ms: 12 } });
    });
    const redirect=fixtureRedirect(kind,kind==="withdraw"?{op:kind,amount:"0.01 USDC",to:"holder.keyhole.test"}:{op:kind,give:"0.02 USDC",decimals:24,symbol:"wNEAR"});
    await page.addInitScript(saved=>sessionStorage.setItem("kh_pending_sign",saved),redirect.saved);
    // A swap is started and resumed on /swap; a withdrawal on /vault (its sheet reopens).
    await page.goto((kind==="swap"?"/swap":"/vault")+redirect.hash);
    if (kind === "swap") {
      await expect(page.getByTestId("trade-out")).toContainText("Traded 0.02 USDC → 0.004484 wNEAR", { timeout: 20_000 });
      await expect(page.getByTestId("trade-out")).toContainText("success");
      // The redesigned swap result labels its pill "Intents explorer" (sentence case).
      await expect(page.getByRole("link", { name: /intents explorer/i })).toHaveAttribute("href", "https://explorer.near-intents.org/transactions/4qAnExample");
      await expect(page.getByTestId("error")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("withdraw-out")).toContainText("Withdrawn 0.01 USDC to holder.keyhole.test", { timeout: 20_000 });
      await expect(page.getByTestId("withdraw-out")).toContainText("b5ea");
      await expect(page.getByTestId("withdraw-out")).toContainText("success");
      await expect(page.getByTestId("error")).toHaveCount(0);
    }
  });
}

test("a decline is gone after a later trade success", async ({ page }) => {
  test.setTimeout(60_000);
  await holdAccount(page);
  await page.route("**/api/worker", async (route) => {
    const body = route.request().postDataJSON() as { op?: string } | null;
    const output = body?.op === "withdraw"
      ? { ok: true, op: "withdraw", request_id: "b5ea", status: "success" }
      : { ok: true, op: "swap", amount_out: "4484263051703687050358", intent_hash: "4qAnExample", request_id: "fb7e", status: "success" };
    await route.fulfill({ json: { call_id: "c1", status: "ok", output, attestation_url: null, time_ms: 12 } });
  });
  await page.goto("/vault");
  const balanceCard = page.getByTestId("balance-card");
  await expect(page.getByTestId("balance-btn")).toBeVisible({ timeout: 20_000 });
  // The wallet window opens (MyNearWallet signs in a popup); closing it unsigned is the decline.
  await page.context().route("https://app.mynearwallet.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>wallet</title>" }));
  const popup = page.waitForEvent("popup", { timeout: 20_000 });
  await page.getByTestId("balance-btn").click();
  await (await popup).close();
  await expect(balanceCard.getByTestId("error")).toHaveAttribute("data-code", "wallet_rejected", { timeout: 20_000 });
  await expect(balanceCard.getByText("You declined the signature.")).toBeVisible();
  const redirect=fixtureRedirect("swap",{op:"swap",give:"0.02 USDC",decimals:24,symbol:"wNEAR"});
  await page.evaluate(saved=>sessionStorage.setItem("kh_pending_sign",saved),redirect.saved);
  await page.goto("/swap?back=1"+redirect.hash);
  await expect(page.getByTestId("trade-out")).toContainText("Traded 0.02 USDC → 0.004484 wNEAR", { timeout: 20_000 });
  await expect(page.getByTestId("trade-out")).toContainText("success");
  await expect(page.getByTestId("error")).toHaveCount(0);
});

test("the session popover stays visible at 390 and Revoke is clickable", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await holdAccount(page);
  await page.addInitScript(() => {
    sessionStorage.setItem("kh_session_v1", JSON.stringify({
      token: "sess-test", account: "holder.keyhole.test", token_id: "4", exp_ms: Date.now() + 25 * 60 * 1000, max_usd_micro: 5_000_000,
    }));
  });
  let revoked = 0;
  await page.route("**/api/worker", async (route) => {
    const body = route.request().postDataJSON() as { op?: string } | null;
    if (body?.op === "session_revoke") revoked += 1;
    await route.fulfill({ json: { call_id: "c1", status: "ok", output: { ok: true }, attestation_url: null, time_ms: 1 } });
  });
  await page.goto("/vault");
  const pill = page.getByTestId("session-pill");
  await expect(pill).toHaveAttribute("data-state", "unlocked", { timeout: 20_000 });
  await pill.click();
  const pop = page.getByTestId("session-pop");
  const revoke = page.getByTestId("session-revoke");
  await expect(revoke).toBeVisible();
  const hit = await revoke.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const dialog = document.querySelector("[data-testid='session-pop']")!.getBoundingClientRect();
    const vp = { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
    return {
      hit: top === el || el.contains(top),
      inside: r.x >= 0 && r.y >= 0 && r.right <= vp.w + 1 && r.bottom <= vp.h + 1 && dialog.x >= -1 && dialog.right <= vp.w + 1 && dialog.bottom <= vp.h + 1,
      extra: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflow: getComputedStyle(document.querySelector(".app-top-end")!).overflow,
    };
  });
  expect(hit.hit, "Revoke is covered").toBe(true);
  expect(hit.inside, "session popover is clipped or off-screen").toBe(true);
  expect(hit.extra, "390 horizontal overflow").toBeLessThanOrEqual(0);
  expect(hit.overflow).not.toBe("hidden");
  await pill.focus();
  await page.keyboard.press("Tab");
  await expect(revoke).toBeFocused();
  await revoke.click();
  await expect(pill).toHaveAttribute("data-state", "locked");
  await expect(pop).toHaveCount(0);
  await expect.poll(() => revoked).toBe(1);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("kh_session_v1"))).toBeNull();
  await page.context().route("https://app.mynearwallet.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>wallet</title>" }));
  const popup = page.waitForEvent("popup", { timeout: 20_000 });
  await pill.click();
  await (await popup).close();
  const retry = page.getByTestId("session-retry");
  const dismiss = pop.getByRole("button", { name: "Dismiss" });
  await expect(retry).toBeVisible();
  await expect(dismiss).toBeVisible();
  const errorHit = await retry.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
  });
  expect(errorHit, "Try again is covered").toBe(true);
  await dismiss.click();
  await expect(pop).toHaveCount(0);
});

test("the app font and sidebar render at 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/vault");
  await page.evaluate(() => document.fonts.ready);
  const aside = page.locator("aside.app-side");
  await expect(aside).toBeVisible();
  await expect(page.getByRole("link", { name: "Vault", exact: true })).toBeVisible();
  const font = await page.evaluate(() => {
    const declared = getComputedStyle(document.documentElement).getPropertyValue("--font-inter");
    const family = declared.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    const used = getComputedStyle(document.querySelector(".app")!).fontFamily;
    const loaded = [...document.fonts].some((face) => face.status === "loaded" && face.family.replace(/['"]/g, "") === family);
    return { family, used, loaded, aside: getComputedStyle(document.querySelector("aside.app-side")!).display };
  });
  expect(font.family.toLowerCase()).toContain("inter");
  expect(font.used).toContain(font.family);
  expect(font.loaded).toBe(true);
  expect(font.aside).not.toBe("none");
});

test("asset rows stay one line at desktop and 390", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "sets 1280 and 390 itself");
  test.setTimeout(60_000);
  await holdAccount(page);
  await page.route("**/api/prices", (route) => route.fulfill({
    json: {
      prices: {
        "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": { priceMicro: 999_500, decimals: 6, symbol: "USDC" },
        "nep141:wrap.near": { priceMicro: 4_420_000, decimals: 24, symbol: "wNEAR" },
      },
    },
  }));
  await page.route("**/api/worker", (route) => route.fulfill({
    json: {
      call_id: "c1", status: "ok", attestation_url: null, time_ms: 12,
      output: {
        ok: true, op: "balance",
        balances: [
          { token: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", amount: "20000" },
          { token: "nep141:wrap.near", amount: "4484263051703687050358" },
        ],
      },
    },
  }));
  const redirect=fixtureRedirect("balance");
  await page.addInitScript(saved=>sessionStorage.setItem("kh_pending_sign",saved),redirect.saved);
  for (const [w, h] of [[1280, 800], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/vault"+redirect.hash);
    const list = page.getByTestId("asset-list");
    await expect(list).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("vault-total")).toHaveText("$0.04", { timeout: 15_000 });
    await expect(list.getByText("0.02 USDC", { exact: true })).toBeVisible();
    await expect(list.getByText("0.004484 wNEAR", { exact: true })).toBeVisible();
    await expect(list.getByText("$0.02")).toHaveCount(2);
    const metrics = await list.evaluate((el) => {
      const rows = [...el.querySelectorAll(".vlt-asset")];
      const lines = (sel: string) => [...el.querySelectorAll(sel)].map((b) => ({ text: b.textContent || "", n: b.getClientRects().length }));
      const listW = Math.round(el.getBoundingClientRect().width);
      return {
        listW,
        rowWidths: rows.map((r) => Math.round(r.getBoundingClientRect().width)),
        amounts: lines(".vlt-asset-amt b"),
        names: lines(".vlt-asset-who small"),
        extra: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(metrics.extra, `${w} scrolls sideways`).toBeLessThanOrEqual(0);
    expect(metrics.rowWidths).toEqual([metrics.listW, metrics.listW]);
    for (const a of metrics.amounts) expect(a.n, `${w} ${a.text}`).toBe(1);
    for (const n of metrics.names) expect(n.n, `${w} ${n.text}`).toBe(1);
    // The redesigned signed-in vault no longer repeats the sign-once explainer (it lives on Mint and Overview), so the test
    // checks the vault's own sections instead.
    await expect(page.getByTestId("vault-total")).toBeVisible();
  }
});

test("MetaMask connect copy names the side panel and the network switch is cream", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-kh-tune]");
  await page.evaluate(() => {
    const msg = document.createElement("div");
    msg.className = "connecting-message";
    msg.innerHTML = "<span>Confirm the connection in the extension window</span>";
    const modal = document.createElement("div");
    modal.className = "ethereum-wallet-modal";
    modal.innerHTML = `<div class="ethereum-wallet-modal-content"><h2>Switch Network</h2><button class="ethereum-wallet-btn ethereum-wallet-btn-sm ethereum-wallet-btn-cancel">Close</button></div>`;
    document.body.append(msg, modal);
  });
  await expect(page.getByText("It may open in the MetaMask side panel or the toolbar icon.")).toBeVisible();
  await expect(page.getByText("MetaMask will ask to add the NEAR Protocol network — approve it to continue.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toHaveCSS("color", "rgb(31, 75, 79)");
  await expect(page.locator(".ethereum-wallet-modal-content")).toHaveCSS("background-color", "rgb(246, 241, 231)");
});

test("vault shows a premium empty or offline state; connect opens the wallet selector", async ({ page }) => {
  await page.goto("/vault");
  await expect(page.getByTestId("vault-empty").or(page.getByTestId("offline"))).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("error")).toHaveCount(0);
  await page.getByTestId("connect").click();
  await expect(page.getByText("Connecting and minting ask only for a signature. A deposit is a normal transfer you approve in your wallet.")).toBeVisible({ timeout: 20_000 });
});

test("a connected wallet with no key cannot open the vault", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("signedAccountId", "visitor.keyhole.test");
    localStorage.setItem("near-wallet-selector:selectedWalletId", JSON.stringify("my-near-wallet"));
  });
  await page.route("**/api/health", (route) => route.fulfill({ json: { online: true, reason: null } }));
  await page.route("https://rpc.mainnet.fastnear.com/**", async (route) => {
    let method = "";
    try { method = (route.request().postDataJSON() as { params?: { method_name?: string } })?.params?.method_name || ""; } catch { /* not a view */ }
    if (method !== "nft_tokens_for_owner") return route.continue();
    const bytes = [...new TextEncoder().encode("[]")];
    await route.fulfill({ json: { jsonrpc: "2.0", id: "kh", result: { result: bytes } } });
  });
  await page.goto("/vault");
  const gate = page.getByTestId("holder-only");
  await expect(gate).toBeVisible({ timeout: 20_000 });
  await expect(gate).toContainText("Only the key holder can open this");
  await expect(page.getByTestId("trade-btn")).toHaveCount(0);
  await expect(page.getByTestId("balance-btn")).toHaveCount(0);
  await expect(page.getByTestId("fund-btn")).toHaveCount(0);
});

test("music is off by default and toggles", async ({ page }) => {
  await page.goto("/");
  // The sound toggle lives in the footer on every viewport.
  const b = page.locator("footer").getByRole("button", { name: /Sound/ }).first();
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
  // /vault is in the app shell: measure the top-bar connect button, not the page's own call to action.
  const box = await page.locator(".app-top").getByTestId("connect").first().boundingBox();
  expect(box!.height).toBeLessThanOrEqual(48);
  const logo = await page.getByRole("img", { name: "KEYHOLE" }).first().boundingBox();
  expect(logo!.width / logo!.height).toBeGreaterThan(3.5);
  // Phones use a 1.6rem lockup (app-shell.css) so the signed-in top bar fits at 375; the lockup must still be legible.
  expect(logo!.height).toBeGreaterThanOrEqual(24);
  await expect(page.getByText(/CC0/)).toHaveCount(0);
});

test("home scroll stays inside the viewport", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "this test sets 1280 and 390 itself");
  for (const [w, h] of [[1280, 800], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.scrollTo(0, 12));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    const worst = await page.evaluate(async () => {
      const doc = document.documentElement;
      const max = Math.max(0, doc.scrollHeight - window.innerHeight);
      const start = performance.now();
      const duration = 8000;
      let extra = 0;
      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          const p = Math.min(1, (now - start) / duration);
          window.scrollTo(0, max * p);
          extra = Math.max(extra, doc.scrollWidth - doc.clientWidth);
          if (p < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      return extra;
    });
    expect(worst, `${w}px home widened while scrolling`).toBeLessThanOrEqual(0);
  }
});

test("pages stay inside the viewport after content loads", async ({ page }, info) => {
  test.setTimeout(180_000);
  test.skip(info.project.name !== "desktop", "this test sets 1280 and 390 itself");
  const routes = ["/", "/vault", "/mint", "/verify", "/gallery", "/atlas", "/identity"] as const;
  for (const [w, h] of [[1280, 800], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const p of routes) {
      await page.goto(p, { waitUntil: "domcontentloaded" });
      if (p === "/verify") {
        await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "true", { timeout: 30_000 });
      } else if (p === "/gallery") {
        await expect(page.getByTestId("key-nft").first()).toBeVisible({ timeout: 45_000 });
      } else if (p === "/") {
        await expect(page.getByTestId("supply")).toHaveText(/^\d+$/, { timeout: 15_000 });
      } else {
        await expect(page.locator("h1").first()).toBeVisible();
      }
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(extra, `${p} at ${w}px scrolls sideways`).toBeLessThanOrEqual(0);
    }
  }
});

test("technical lists are left-aligned; vault traits keep the body face", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop alignment");
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto("/verify");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "true", { timeout: 30_000 });
  const hash = page.locator(".ver .kv dd[data-kind=hash]").first();
  await expect(hash).toBeVisible();
  await expect(hash).toHaveCSS("text-align", "start");
  expect((await hash.evaluate((el) => getComputedStyle(el).fontFamily)).toLowerCase()).toContain("dm mono");
  for (const dd of await page.locator(".ver .kv dd").all()) await expect(dd).toHaveCSS("text-align", "start");
  const stamp = page.locator(".ver .kv dd").last();
  await expect(stamp).toHaveCSS("font-weight", "600");
  await expect(stamp).toHaveText(/(?:AM|PM|a\.m\.|p\.m\.)\s+\S+$|\d{1,2}:\d{2}:\d{2}\s+[A-Za-z]/);

  await page.addInitScript(() => {
    localStorage.setItem("signedAccountId", "holder.keyhole.test");
    localStorage.setItem("near-wallet-selector:selectedWalletId", JSON.stringify("my-near-wallet"));
  });
  await page.route("**/api/health", (route) => route.fulfill({ json: { online: true, reason: null } }));
  await page.route("**/api/keys?**", (route) => route.fulfill({ json: {
    keys: [{ token_id: "4", owner_id: "holder.keyhole.test", metadata: { title: "Key", description: null, expires_at: null, issued_at: null } }], tier: 1,
  } }));
  await page.route("https://rpc.mainnet.fastnear.com/**", async (route) => {
    let method = "";
    try { method = (route.request().postDataJSON() as { params?: { method_name?: string } })?.params?.method_name || ""; } catch { /* not a view call */ }
    const payload = method === "nft_tokens_for_owner"
      ? [{ token_id: "4", owner_id: "holder.keyhole.test", metadata: { title: "Key", description: null, expires_at: null, issued_at: null } }]
      : method === "nft_tier" ? 1 : null;
    if (payload == null) return route.continue();
    const bytes = [...new TextEncoder().encode(JSON.stringify(payload))];
    await route.fulfill({ json: { jsonrpc: "2.0", id: "kh", result: { result: bytes } } });
  });
  await page.goto("/vault");
  // The redesigned vault keeps the traits behind a "Key traits and log" disclosure, closed by default.
  await page.locator("details.vlt-details > summary").click({ timeout: 30_000 });
  const kv = page.getByTestId("vault-traits");
  await expect(kv).toBeVisible({ timeout: 30_000 });
  const head = kv.locator("dd").nth(0);
  await expect(head).toHaveCSS("font-weight", "600");
  await expect(head).toHaveCSS("text-align", "end");
  expect((await head.evaluate((el) => getComputedStyle(el).fontFamily)).toLowerCase()).not.toContain("dm mono");
  const contract = kv.locator("dd").last();
  await expect(contract).toHaveText("keyhole-devmo.near");
  await expect(contract).toHaveCSS("font-weight", "500");
  await expect(contract).toHaveCSS("text-align", "end");
  expect((await contract.evaluate((el) => getComputedStyle(el).fontFamily)).toLowerCase()).toContain("dm mono");
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(extra, "connected vault scrolls sideways").toBeLessThanOrEqual(0);
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

test("judge path links every evidence call to /verify and is reachable from the top bar", async ({ page }) => {
  await page.goto("/");
  // Desktop: a top-bar link. Phones: the same link in the burger list.
  if ((page.viewportSize()?.width ?? 1000) <= 860) {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.locator("#mnav").getByRole("link", { name: "For judges" }).click();
  } else {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "For judges" }).click();
  }
  await expect(page.getByTestId("judge-page")).toBeVisible();
  const links = page.locator('a[href^="/verify?call="]');
  expect(await links.count()).toBeGreaterThanOrEqual(12);
  // The earlier-build list holds its own Proof disclosure too, so open the list's own summary only.
  const prev = page.getByTestId("judge-previous");
  await prev.locator(":scope > summary").click();
  await expect(prev.getByText("Refused: not_owner.")).toBeVisible();
  await expect(prev.getByText("Refused: cooldown (10 minutes).")).toBeVisible();
});

test("verify: an old-build refusal shows the binding, the previous version and the attested output", async ({ page }) => {
  await page.goto("/verify?call=e805f050-d416-4a04-9b12-270adbe02068");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "previous", { timeout: 30_000 });
  await expect(page.getByTestId("build-note")).toContainText("previous published version 38bd67b9");
  await expect(page.getByTestId("output-verdict")).toHaveText("refused · not_owner");
});

test("pnl: a tampered share link fails the signature check", async ({ page }) => {
  const statement = '{"cost_usd_micro":30000,"kind":"keyhole-pnl-v1","log_head":"00","method":"m","owner":"bob.near","pnl_usd_micro":5000,"since_ms":1,"token_id":"kabc","trades":2,"ts_ms":9,"value_now_usd_micro":35000}';
  const share = Buffer.from(JSON.stringify({ statement, sig: "0".repeat(128), minter: "a".repeat(64), call_id: null })).toString("base64url");
  await page.goto(`/pnl#${share}`);
  await expect(page.getByTestId("pnl-sig")).toHaveAttribute("data-pass", "false");
  await expect(page.getByTestId("pnl-verdict")).toHaveAttribute("data-ok", "false", { timeout: 15_000 });
});

test("ask: a reply whose quote does not carry this browser's nonce is not marked verified", async ({ page }) => {
  const fx = JSON.parse(readFileSync(`${process.cwd()}/tests/fixtures/ai_reply.json`, "utf8"));
  await page.route("**/api/ai", (route) => route.fulfill({ json: fx }));
  await page.goto("/ask");
  await page.getByTestId("ask-input").fill("What is a holder limit?");
  await page.getByTestId("ask-btn").click();
  await expect(page.getByTestId("ask-answer")).toContainText("10-minute");
  await expect(page.getByTestId("ask-verdict")).toHaveAttribute("data-ok", "false");
  await expect(page.locator('[data-pass="false"]').first()).toBeVisible();
  await expect(page.getByTestId("ask-dcap")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("ask-dcap-count")).toHaveText("19/19 checks passed");
});

test("verify: Intel DCAP passes in the browser and a signed answer shows its key and request binding", async ({ page }) => {
  await page.goto("/verify?call=dda27438-67e6-4c8a-8f32-888d3ff17760");
  await expect(page.getByTestId("dcap")).toHaveAttribute("data-ok", "true", { timeout: 30_000 });
  await expect(page.getByTestId("dcap-count")).toHaveText("19/19 checks passed");
  await expect(page.getByTestId("dcap-bind")).toContainText("k5f4750858f328940");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "previous");
  await expect(page.getByTestId("tally")).toHaveAttribute("data-n", "37");
});

test("verify: an edited input hash fails the binding and the verdict, and Undo restores it", async ({ page }) => {
  await page.goto("/verify");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "true", { timeout: 30_000 });
  await page.getByTestId("tamper-input_hash").click();
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "false");
  await expect(page.getByTestId("verdict")).toHaveText("Rejected. This copy was changed.");
  await expect(page.getByTestId("ck-binding")).not.toContainText("✓ Bound");
  await expect(page.getByTestId("tally")).toHaveAttribute("data-n", "35");
  await page.getByTestId("tamper-reset").click();
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "true");
  await expect(page.getByTestId("tally")).toHaveAttribute("data-n", "37");
});

test("verify: one flipped byte of the TD report fails Intel DCAP while the binding still holds", async ({ page }) => {
  await page.goto("/verify");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "true", { timeout: 30_000 });
  await page.getByTestId("tamper-quote").click();
  await expect(page.getByTestId("dcap")).toHaveAttribute("data-ok", "false");
  await expect(page.getByTestId("ck-binding")).toContainText("✓ Bound");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "false");
});

test("landing: the handover shows the real withdraw, transfer and refused call, each with its proof", async ({ page }) => {
  await page.goto("/?static");
  await expect(page.getByTestId("handover-step-3")).toContainText("not_owner");
  await expect(page.getByTestId("handover-link-1")).toHaveAttribute("href", "/verify?call=440c2378-6c27-49fd-8b6b-d74054f331ae");
  await expect(page.getByTestId("handover-link-2")).toHaveAttribute("href", "https://nearblocks.io/txns/G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD");
  await expect(page.getByTestId("handover-link-3")).toHaveAttribute("href", "/verify?call=e805f050-d416-4a04-9b12-270adbe02068");
});

test("verify: Intel revocation lists, TCB Info and QE identity are checked live and the status is shown as Intel reports it", async ({ page }) => {
  await page.goto("/verify");
  const p = page.getByTestId("pcs");
  await expect(p).toHaveAttribute("data-ok", "true", { timeout: 30_000 });
  await expect(p).toHaveAttribute("data-tcb", "UpToDate");
  await expect(page.getByTestId("pcs-status")).toHaveText("TCB UpToDate · QE UpToDate · 12/12");
});

test("api/pcs only forwards the fixed Intel endpoints", async ({ request }) => {
  expect((await request.get("/api/pcs?r=tcb&fmspc=../x")).status()).toBe(400);
  expect((await request.get("/api/pcs?r=https://evil.example")).status()).toBe(400);
  const j = await (await request.get("/api/pcs?r=pckcrl")).json();
  expect(j.ok).toBe(true);
  expect(j.body).toContain("-----BEGIN X509 CRL-----");
  expect(decodeURIComponent(j.chain)).toContain("-----BEGIN CERTIFICATE-----");
});

test("landing: the 37 browser checks stat links to /verify", async ({ page }) => {
  await page.goto("/?static");
  const s = page.getByTestId("checks-stat");
  await expect(s).toHaveText("37");
  await expect(s).toHaveAttribute("href", "/verify");
});

test("key history: a real log re-verifies and an edited row fails", async ({ page }) => {
  const body = JSON.parse(readFileSync(`${process.cwd()}/tests/fixtures/keylog_k5f47.json`, "utf8"));
  await page.route("**/api/worker", (route) => route.fulfill({ json: { call_id: "184b6075-9e95-4dbe-b75f-3d4c9c9afdcd", output: { ok: true, op: "provenance", ...body } } }));
  await page.goto("/key?id=k5f4750858f328940");
  await expect(page.getByTestId("key-verdict")).toHaveAttribute("data-ok", "true");
  expect(await page.getByTestId("holder-row").count()).toBeGreaterThanOrEqual(3);
  const bad = structuredClone(body); bad.events[1].kind = "deposit";
  await page.unroute("**/api/worker");
  await page.route("**/api/worker", (route) => route.fulfill({ json: { output: { ok: true, ...bad } } }));
  await page.getByTestId("key-load").click();
  await expect(page.getByTestId("key-verdict")).toHaveAttribute("data-ok", "false");
  await expect(page.getByTestId("k-chain")).toHaveAttribute("data-pass", "false");
});

test("settle: the real SOL→NEAR order reads SUCCESS live from 1Click and the NO_LIQUIDITY one reads REFUNDED", async ({ page }) => {
  await page.goto("/settle");
  const ok = page.locator('[data-deposit="6pvcZZ2xMUhDpQmySGaVR2Cm9e3Aixx5QUQUPS7RAcha"]');
  await expect(ok.locator('[data-status="SUCCESS"]')).toBeVisible({ timeout: 30_000 });
  // The list row selects the order; its details panel carries the status, the proof and the update time.
  await ok.getByTestId("act-row").click();
  const details = page.getByTestId("order-details");
  await expect(details.locator('[data-status="SUCCESS"]')).toBeVisible();
  await details.getByTestId("proof").locator("summary").click();
  await expect(details.locator('a[href="https://nearblocks.io/txns/8BQznSfbQUecDqCcEFwQj4vzr5x1X4rzLSLpszktf8fh"]').first()).toBeVisible();
  await expect(details.getByTestId("st-updated")).toContainText("2026");
  await page.getByTestId("act-filters-refunded").click();
  const rf = page.locator('[data-deposit="5sESFfrM4Tk6L5euDCTjjMxVAs5xmbZpj4i3V29s3KJ"]');
  await expect(rf.locator('[data-status="REFUNDED"]')).toBeVisible({ timeout: 30_000 });
});

test("settle: dry-run quote and every 1Click status, including REFUNDED and FAILED", async ({ page }) => {
  await page.route("**/api/oneclick", (route) => route.request().method() === "POST"
    ? route.fulfill({ json: { ok: true, dry: true, quote: { amountInFormatted: "0.05", amountInUsd: "0.05", amountOutFormatted: "0.049988", amountOutUsd: "0.0499", timeEstimate: 20 } } })
    : route.fallback());
  await page.route("**/api/oneclick?depositAddress=*", (route) => route.fulfill({ json: { ok: true, status: route.request().url().includes("8ce897") ? "SUCCESS" : "REFUNDED", details: { depositedAmountFormatted: "0.02", amountOutFormatted: null, refundedAmountFormatted: "0.02", nearTxHashes: [], intentHashes: [] } } }));
  await page.goto("/settle");
  await page.getByTestId("dry-btn").click();
  await expect(page.getByTestId("dry-out")).toContainText("dry run");
  await expect(page.locator('[data-testid="settlement"] [data-status="SUCCESS"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="settlement"] [data-status="REFUNDED"]').first()).toBeVisible();
  await expect(page.getByTestId("act-row").filter({ hasText: "0.6 USDC on Base → SOL on Solana (MetaMask)" })).toBeVisible();
  await expect(page.getByTestId("act-row").filter({ hasText: "0.004 SOL on Solana → USDC on NEAR (MetaMask)" })).toBeVisible();
  await page.getByTestId("act-filters-refunded").click();
  await expect(page.getByTestId("act-row").filter({ hasText: "Refund path: 0.001 SOL on Solana → USDC on NEAR, refunded for NO_LIQUIDITY" })).toBeVisible();
  await expect(page.getByTestId("recorded-failed").locator('[data-status="FAILED"]')).toBeVisible();
});

test("gallery: every live card shows its token id and links to its history", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/gallery");
  const card = page.getByTestId("gallery").getByTestId("key-nft").first();
  await expect(card).toBeVisible({ timeout: 45_000 });
  const tid = (await card.getByTestId("key-tid").innerText()).replace(/^Token\s+/, "").trim();
  expect(tid.length).toBeGreaterThan(0);
  await expect(card.getByTestId("key-link")).toHaveAttribute("href", `/key?id=${encodeURIComponent(tid)}`);
});

test("home: the final band leads to the app and to the proof", async ({ page }) => {
  await page.goto("/?static");
  await expect(page.getByTestId("cta-get-key")).toHaveAttribute("href", "/dashboard");
  await expect(page.getByTestId("cta-proof")).toHaveAttribute("href", "/judge");
  await expect(page.getByText("Eight assets.")).toHaveCount(0);
});

test("judge: who sees what, and the Chain Signatures step verifies a published output", async ({ page }) => {
  await page.goto("/judge");
  await expect(page.getByTestId("who-sees-what").locator("tbody tr")).toHaveCount(7);
  await expect(page.getByTestId("judge-chainsig").locator('a[href="/verify?call=0cd1c3bd-21be-44dc-bc60-e792a42344e6"]')).toBeVisible();
  await page.goto("/verify?call=0cd1c3bd-21be-44dc-bc60-e792a42344e6");
  await expect(page.getByTestId("ck-output").locator(".ok")).toHaveText("✓", { timeout: 30_000 });
});

test("settle: a vault trade is shown end to end with its attested call and intent hash", async ({ page }) => {
  await page.goto("/settle");
  const v = page.getByTestId("vault-trade");
  await expect(v).toContainText("Xr4TM3tEwfpwF9Hg2BcGJTH3uzZ7LroqBk9wgUnN1so");
  await expect(v.locator('a[href="/verify?call=09d58c09-c1e9-48b6-bebb-485f5ae79539"]').first()).toBeVisible();
  await expect(page.getByText(/due at the deadline/)).toHaveCount(0);
});

test("verify: when Intel PCS does not answer, the page says so and counts what did pass", async ({ page }) => {
  await page.route("**/api/pcs**", (route) => route.abort());
  await page.goto("/verify");
  await expect(page.getByTestId("tally-head")).toContainText("Intel PCS did not answer", { timeout: 30_000 });
  await expect(page.getByTestId("tally-head")).toContainText("25 of 25");
  await expect(page.getByTestId("verdict")).toHaveText("Intel PCS unreachable. Run again.");
});

test("production redirect parsing does not consume an overwritten challenge on an older signature",async({page})=>{
 await holdAccount(page);let withdrawals=0;await page.route("**/api/worker",async route=>{if(route.request().postDataJSON()?.op==="withdraw")withdrawals++;await route.fulfill({json:{output:{ok:true,op:"withdraw",request_id:"binding-proof",status:"success"}}});});
 const ctx={op:"withdraw",amount:"0.01 USDC",to:"holder.keyhole.test"},x=fixtureRedirect("withdraw",ctx,1),y=fixtureRedirect("withdraw",ctx,2);
 await page.addInitScript(saved=>{if(!sessionStorage.getItem("kh_pending_sign"))sessionStorage.setItem("kh_pending_sign",saved);},y.saved);
 await page.goto("/vault"+x.hash);await expect.poll(()=>page.evaluate(()=>location.hash)).toBe("");expect(await page.evaluate(()=>sessionStorage.getItem("kh_pending_sign"))).toBe(y.saved);expect(withdrawals).toBe(0);await expect(page.getByTestId("withdraw-out")).toHaveCount(0);
 await page.goto("/vault?callback=valid"+y.hash);await expect(page.getByTestId("withdraw-out")).toContainText("binding-proof",{timeout:20000});expect(withdrawals).toBe(1);
});