import { expect, test, type Page, type Route } from "@playwright/test";

const HASH = "11111111111111111111111111111111";
const MINT_TX = "938J7HUP5VfusqSNJMEhrquxSE3FjMgzdnM6TPSpo9Dg";
const MOVE_TX = "B8LE23HckLuPG4vJHou5dVR4mch5DdPic19SGq39amAt";
const REFUSE_TX = "CynvPi5tpB577ctcA4Bx7h1csXDEzAUPq8x12Uscxcgf";
const HOLDER = "khab12cd34ef56.testnet";
const RECEIVER = "khcd56ab78ef90.testnet";
const TOKEN = "kab12cd34ef567890";

function bytes(value: unknown): number[] {
  return Array.from(Buffer.from(JSON.stringify(value)));
}

async function fulfill(route: Route, result: unknown) {
  const body = route.request().postDataJSON() as { id?: string };
  await route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? "trial", result }),
  });
}

async function mockTrial(page: Page) {
  let guests = 0;
  let sends = 0;
  let owner = HOLDER;
  await page.route("**/api/mainnet-stats", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      live: true, contract: "keyhole-devmo.near", network: "mainnet", fetchedAt: new Date().toISOString(),
      totalKeys: { ok: true, value: 8 }, holders: { ok: true, value: 6 }, activeLiens: { ok: true, value: 1 },
      latestEvent: { ok: true, value: { hash: "89vSYY4tbeNPuNuhHB8YmkkAWAcjW5VdniQm3ePHuPYz", method: "nft_transfer", at: "2026-11-08T00:00:00.000Z" } },
    }),
  }));
  await page.route("**/api/trial/guest", async (route) => {
    guests += 1;
    const accountId = guests === 1 ? HOLDER : RECEIVER;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accountId, txHash: MINT_TX, network: "testnet", contract: "keyhole-trial-mwcjsmqw.testnet" }) });
  });
  await page.route("**/api/trial/mint", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tokenId: TOKEN, tier: 1, txHash: MINT_TX, receiverId: HOLDER, network: "testnet" }) });
  });
  const rpc = async (route: Route) => {
    const body = route.request().postDataJSON() as { method?: string; params?: { request_type?: string; method_name?: string } };
    if (body.method === "query" && body.params?.request_type === "call_function") {
      const method = body.params.method_name;
      if (method === "nft_token") return fulfill(route, { result: bytes({ token_id: TOKEN, owner_id: owner, metadata: { title: "KEYHOLE practice key" } }) });
      if (method === "nft_tier") return fulfill(route, { result: bytes(1) });
      if (method === "nft_supply_for_owner") return fulfill(route, { result: bytes(owner === HOLDER ? "1" : "0") });
      return fulfill(route, { result: bytes(null) });
    }
    if (body.method === "query" && body.params?.request_type === "view_access_key") {
      return fulfill(route, { nonce: 1, permission: "FullAccess", block_height: 1, block_hash: HASH });
    }
    if (body.method === "block") return fulfill(route, { header: { hash: HASH, height: 1 } });
    if (body.method === "status") return fulfill(route, { chain_id: "testnet" });
    if (body.method === "send_tx") {
      sends += 1;
      const hash = sends === 1 ? MOVE_TX : REFUSE_TX;
      if (sends === 1) owner = RECEIVER;
      return fulfill(route, { status: { SuccessValue: "" }, transaction: { hash }, transaction_outcome: { id: hash } });
    }
    if (body.method === "tx") {
      const hash = (body.params as { tx_hash?: string } | undefined)?.tx_hash;
      const ok = hash === MOVE_TX;
      const receiver = ok ? RECEIVER : "kh000000000000.testnet";
      const execution = "Smart contract panicked: Sender not approved";
      const failure = { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: execution } } } } };
      const call = { FunctionCall: { method_name: "nft_transfer", args: Buffer.from(JSON.stringify({ receiver_id: receiver, token_id: TOKEN, memo: "practice handover" })).toString("base64") } };
      return fulfill(route, {
        final_execution_status: "FINAL",
        status: ok ? { SuccessValue: "" } : failure,
        transaction: { signer_id: HOLDER, receiver_id: "keyhole-trial-mwcjsmqw.testnet", actions: [call] },
        receipts_outcome: ok ? [] : [{ outcome: { executor_id: "keyhole-trial-mwcjsmqw.testnet", status: failure } }],
      });
    }
    return fulfill(route, {});
  };
  await page.route("https://rpc.testnet.near.org/**", rpc);
  await page.route("https://test.rpc.fastnear.com/**", rpc);
}

test("home links the free trial and shows live mainnet stats", async ({ page }) => {
  await mockTrial(page);
  await page.goto("/");
  await expect(page.getByTestId("try-free-cta")).toHaveAttribute("href", "/try?start=1");
  await expect(page.getByTestId("mainnet-badge")).toContainText("Live on mainnet");
  await expect(page.getByTestId("stat-holders")).toHaveText("6");
  await expect(page.getByTestId("stat-liens")).toHaveText("1");
  await expect(page.getByTestId("stat-event")).toContainText("nft_transfer");
});

test("home says unavailable when the stats read fails", async ({ page }) => {
  await page.route("**/api/mainnet-stats", (route) => route.fulfill({ status: 503, body: "no" }));
  await page.goto("/");
  await expect(page.getByTestId("mainnet-badge")).toBeVisible();
  await expect(page.getByTestId("stat-holders")).toHaveText("—");
  await expect(page.getByTestId("stat-liens")).toHaveText("—");
  await expect(page.getByTestId("stat-event")).toHaveText("—");
});

test("the free trial mints, transfers and refuses the old holder", async ({ page }) => {
  await mockTrial(page);
  await page.goto("/try");
  await expect(page.getByTestId("trial-banner")).toContainText("Testnet · free · not real money");
  await expect(page.getByTestId("net-testnet")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("net-mainnet")).toHaveAttribute("href", "/dashboard");
  await page.getByTestId("trial-create").click();
  await expect(page.getByTestId("trial-account")).toContainText(HOLDER);
  await page.getByTestId("trial-mint").click();
  await expect(page.getByTestId("trial-token")).toContainText(TOKEN);
  await expect(page.getByTestId("trial-tier")).toContainText("Bronze");
  await expect(page.getByTestId("trial-history")).toContainText("Minted on testnet");
  await page.getByTestId("trial-transfer").click();
  await expect(page.getByTestId("trial-owner")).toContainText(RECEIVER);
  await expect(page.getByTestId("trial-refused")).toContainText("Old holder refused");
  await expect(page.getByTestId("trial-refused")).toContainText("Sender not approved");
  await expect(page.getByTestId("trial-recorded")).toContainText("recorded on mainnet");
  await expect(page.getByTestId("trial-recorded").locator("a")).toHaveAttribute("href", /09d58c09-c1e9-48b6-bebb-485f5ae79539/);
});

test("/start and /judge link the free trial", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByTestId("start-try-free")).toHaveAttribute("href", "/try?start=1");
  await page.goto("/judge");
  await expect(page.getByTestId("judge-try-free")).toHaveAttribute("href", "/try?start=1");
});

test("trial page fits a phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/try");
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(390);
  await expect(page.getByTestId("trial-banner")).toBeVisible();
});

test.describe("live testnet", () => {
  test.skip(!process.env.KEYHOLE_TRIAL_LIVE, "set KEYHOLE_TRIAL_LIVE=1 to run one real testnet trial");
  test("one real guest mints and transfers on testnet", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/try");
    await page.getByTestId("trial-create").click();
    await expect(page.getByTestId("trial-account")).toContainText(".testnet", { timeout: 60_000 });
    await page.getByTestId("trial-mint").click();
    await expect(page.getByTestId("trial-tier")).toContainText("Bronze", { timeout: 60_000 });
    await page.getByTestId("trial-transfer").click();
    await expect(page.getByTestId("trial-owner")).toContainText("The key moved.", { timeout: 90_000 });
    await expect(page.getByTestId("trial-refused")).toContainText("refused");
    await expect(page.getByTestId("trial-refused")).toContainText("Sender not approved");
    await expect(page.getByTestId("trial-recorded")).toContainText("recorded on mainnet");
    if (process.env.ARTIFACT_DIR) await page.screenshot({ path: `${process.env.ARTIFACT_DIR}/trial-handover.png`, fullPage: true });
  });
});
