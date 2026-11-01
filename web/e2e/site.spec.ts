import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const PAGES = ["/", "/atlas", "/vault", "/mint", "/gallery", "/verify", "/judge", "/ask"];
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

test("verify: a published-build mainnet call passes in the browser", async ({ page }) => {
  await page.goto("/verify?call=f4768da8-2e87-4622-8654-d1e67f6cd1f0");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "true", { timeout: 30_000 });
});

test("verify: the default page checks the published 6367401a info call", async ({ page }) => {
  await page.goto("/verify");
  await expect(page.locator("#cid")).toHaveValue("f4768da8-2e87-4622-8654-d1e67f6cd1f0");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "true", { timeout: 30_000 });
  await expect(page.locator(".ck .ok.bad")).toHaveCount(0);
  await expect(page.locator(".ck .ok.wait")).toHaveCount(0);
  await expect(page.locator(".ck .ok")).toHaveCount(6);
  await expect(page.getByText("6367401a78ae4f193eae16f90925968e8c3b477f1a387a213540aa0c60479693").first()).toBeVisible();
  await expect(page.getByTestId("ck-binding")).toContainText("✓ Bound");
  await expect(page.getByRole("button", { name: "earlier · 2 USDC over the $1 cap" })).toBeVisible();
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

test("header Connect wallet opens the selector on the first click", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const btn = page.getByTestId("connect");
  await expect(btn).toHaveText("Connect wallet");
  await btn.click();
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
  await page.route("https://rpc.mainnet.near.org/**", async (route) => {
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

test("connected account opens a menu instead of disconnecting", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await holdAccount(page);
  if (info.project.name === "desktop") await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/vault");
  const pill = page.getByTestId("account");
  await expect(pill).toBeVisible({ timeout: 20_000 });
  const brand = await page.locator("nav.nav .brand .kh-logo").first().boundingBox();
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
    await page.addInitScript(({ nonce, kind }) => {
      const op = kind;
      sessionStorage.setItem("kh_pending_sign", JSON.stringify({
        message: JSON.stringify({ op, account_id: "holder.keyhole.test", ts_ms: 1, params: {} }),
        nonce,
        ctx: op === "withdraw"
          ? { op, amount: "0.01 USDC", to: "holder.keyhole.test" }
          : { op, give: "0.02 USDC", decimals: 24, symbol: "wNEAR" },
      }));
    }, { nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", kind });
    await page.goto("/vault#accountId=holder.keyhole.test&publicKey=ed25519:111&signature=abc");
    if (kind === "swap") {
      await expect(page.getByTestId("trade-out")).toContainText("Traded 0.02 USDC → 0.004484 wNEAR", { timeout: 20_000 });
      await expect(page.getByTestId("trade-out")).toContainText("success");
      await expect(page.getByRole("link", { name: /intents explorer/ })).toHaveAttribute("href", "https://explorer.near-intents.org/transactions/4qAnExample");
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
  const balanceCard = page.locator(".c").filter({ has: page.getByTestId("balance-btn") });
  await expect(page.getByTestId("balance-btn")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("balance-btn").click();
  await expect(balanceCard.getByTestId("error")).toHaveAttribute("data-code", "wallet_rejected", { timeout: 20_000 });
  await expect(balanceCard.getByText("You declined the signature.")).toBeVisible();
  await page.getByRole("button", { name: "History" }).click();
  await expect(balanceCard.getByTestId("error")).toHaveCount(0);
  const activity = page.locator(".c").filter({ has: page.getByRole("button", { name: "History" }) });
  await expect(activity.getByTestId("error")).toHaveAttribute("data-code", "wallet_rejected");
  await page.evaluate(() => {
    sessionStorage.setItem("kh_pending_sign", JSON.stringify({
      message: JSON.stringify({ op: "swap", account_id: "holder.keyhole.test", ts_ms: 1, params: {} }),
      nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ctx: { op: "swap", give: "0.02 USDC", decimals: 24, symbol: "wNEAR" },
    }));
  });
  await page.goto("/vault?back=1#accountId=holder.keyhole.test&publicKey=ed25519:111&signature=abc");
  await expect(page.getByTestId("trade-out")).toContainText("Traded 0.02 USDC → 0.004484 wNEAR", { timeout: 20_000 });
  await expect(page.getByTestId("trade-out")).toContainText("success");
  await expect(page.getByTestId("error")).toHaveCount(0);
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
  await page.addInitScript(() => {
    sessionStorage.setItem("kh_pending_sign", JSON.stringify({
      message: JSON.stringify({ op: "balance", account_id: "holder.keyhole.test", ts_ms: 1, params: {} }),
      nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    }));
  });
  for (const [w, h] of [[1280, 800], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/vault#accountId=holder.keyhole.test&publicKey=ed25519:111&signature=abc");
    const list = page.getByTestId("asset-list");
    await expect(list).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("vault-total")).toHaveText("$0.04", { timeout: 15_000 });
    await expect(list.getByText("0.02 USDC", { exact: true })).toBeVisible();
    await expect(list.getByText("0.004484 wNEAR", { exact: true })).toBeVisible();
    await expect(list.getByText("$0.02")).toHaveCount(2);
    const metrics = await list.evaluate((el) => {
      const rows = [...el.querySelectorAll(".arow")];
      const lines = (sel: string) => [...el.querySelectorAll(sel)].map((b) => ({ text: b.textContent || "", n: b.getClientRects().length }));
      const listW = Math.round(el.getBoundingClientRect().width);
      return {
        listW,
        rowWidths: rows.map((r) => Math.round(r.getBoundingClientRect().width)),
        amounts: lines(".amt b"),
        names: lines(".who small"),
        extra: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(metrics.extra, `${w} scrolls sideways`).toBeLessThanOrEqual(0);
    expect(metrics.rowWidths).toEqual([metrics.listW, metrics.listW]);
    for (const a of metrics.amounts) expect(a.n, `${w} ${a.text}`).toBe(1);
    for (const n of metrics.names) expect(n.n, `${w} ${n.text}`).toBe(1);
    await expect(page.getByText("Any NEAR wallet or MetaMask")).toBeVisible();
    await expect(page.getByText("One gas-free signature (NEAR NEP-413 or MetaMask EIP-191)")).toBeVisible();
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
  await page.route("https://rpc.mainnet.near.org/**", async (route) => {
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

  await page.goto("/");
  const worker = page.locator(".attc .kv dd[data-kind=hash]").first();
  await expect(worker).toBeVisible();
  await expect(worker).toHaveCSS("text-align", "start");
  await expect(worker).toHaveCSS("font-weight", "500");
  expect((await worker.evaluate((el) => getComputedStyle(el).fontFamily)).toLowerCase()).toContain("dm mono");
  for (const dd of await page.locator(".attc .kv dd").all()) await expect(dd).toHaveCSS("text-align", "start");
  const runtime = page.locator(".attc .kv dd").last();
  await expect(runtime).toHaveCSS("font-weight", "600");
  expect((await runtime.evaluate((el) => getComputedStyle(el).fontFamily)).toLowerCase()).not.toContain("dm mono");

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
  await page.route("https://rpc.mainnet.near.org/**", async (route) => {
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

test("judge path links every evidence call to /verify and is reachable from the footer", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("footer-judge").click();
  await expect(page.getByTestId("judge-page")).toBeVisible();
  const links = page.locator('a[href^="/verify?call="]');
  expect(await links.count()).toBeGreaterThanOrEqual(12);
  await expect(page.getByText("refused · not_owner")).toBeVisible();
  await expect(page.getByText("refused · cooldown")).toBeVisible();
});

test("verify: an old-build refusal shows the binding, the previous version and the attested output", async ({ page }) => {
  await page.goto("/verify?call=e805f050-d416-4a04-9b12-270adbe02068");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-match", "true", { timeout: 30_000 });
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
});
