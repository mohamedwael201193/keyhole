import { expect, test } from "@playwright/test";

const TOKEN = "k5f4750858f328940";
const BEFORE = { owner: "a.near", epoch: "0", height: 100, hash: "h100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
const AFTER = { owner: "b.near", epoch: "1", height: 101, hash: "h101bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" };
const LIEN = new Set(["nft_token", "get_control_state", "get_loan", "get_collateral_binding", "get_pledge_config"]);

function bytes(value: unknown): number[] {
  return [...new TextEncoder().encode(JSON.stringify(value))];
}

function viewResult(state: typeof BEFORE, method: string) {
  const value = method === "nft_token"
    ? { token_id: TOKEN, owner_id: state.owner }
    : method === "get_control_state"
      ? { token_id: TOKEN, owner_epoch: state.epoch, pending_value_ops: "0", listed: false, transfer_pending: false, pledged: false, value_op_nonce: "0" }
      : null;
  return { jsonrpc: "2.0", id: "lien", result: { block_height: state.height, block_hash: state.hash, result: bytes(value) } };
}

test("a sale between lien reads never renders a mixed owner and epoch", async ({ page }) => {
  const views: { method_name?: string; block_id?: unknown; finality?: unknown }[] = [];
  await page.route(/rpc\.mainnet\.fastnear\.com/, async (route) => {
    const q = route.request().postDataJSON() as { method?: string; params?: { finality?: string; method_name?: string; block_id?: unknown } } | null;
    if (q?.method === "block") {
      await route.fulfill({ json: { jsonrpc: "2.0", id: "lien-block", result: { header: { height: BEFORE.height, hash: BEFORE.hash, timestamp_nanosec: "1" } } } });
      return;
    }
    const method = q?.params?.method_name;
    if (q?.method === "query" && method && LIEN.has(method)) {
      views.push({ method_name: method, block_id: q.params?.block_id, finality: q.params?.finality });
      const state = q.params?.block_id == null
        ? (method === "get_control_state" ? AFTER : BEFORE)
        : (q.params.block_id === AFTER.hash || q.params.block_id === AFTER.height ? AFTER : BEFORE);
      await route.fulfill({ json: viewResult(state, method) });
      return;
    }
    await route.continue();
  });
  await page.goto("/verify");
  await page.getByLabel("Key id").fill(TOKEN);
  await page.getByRole("button", { name: "Read lien" }).click();
  const panel = page.getByTestId("verify-lien");
  await expect(panel.getByTestId("lien-facts")).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByTestId("lien-state")).toHaveText("Not locked");
  await expect(panel.locator("dd").nth(0)).toHaveText("a.near");
  await expect(panel.locator("dd").nth(1)).toHaveText("0");
  expect(views.length).toBeGreaterThanOrEqual(5);
  expect(views.every((v) => v.block_id === BEFORE.hash && v.finality === undefined)).toBe(true);
});

test("mixed block heights stay unread and are not shown as Not locked", async ({ page }) => {
  await page.route(/rpc\.mainnet\.fastnear\.com/, async (route) => {
    const q = route.request().postDataJSON() as { method?: string; params?: { method_name?: string } } | null;
    if (q?.method === "block") {
      await route.fulfill({ json: { jsonrpc: "2.0", id: "lien-block", result: { header: { height: BEFORE.height, hash: BEFORE.hash } } } });
      return;
    }
    const method = q?.params?.method_name;
    if (q?.method === "query" && method && LIEN.has(method)) {
      await route.fulfill({ json: viewResult(method === "get_control_state" ? AFTER : BEFORE, method) });
      return;
    }
    await route.continue();
  });
  await page.goto("/verify");
  await page.getByLabel("Key id").fill(TOKEN);
  await page.getByRole("button", { name: "Read lien" }).click();
  const panel = page.getByTestId("verify-lien");
  await expect(panel.getByTestId("lien-state")).toHaveText("Not read", { timeout: 20_000 });
  await expect(panel.getByTestId("lien-error")).toHaveAttribute("role", "alert");
  await expect(panel.getByTestId("lien-facts")).toHaveCount(0);
  await expect(panel.getByText("a.near")).toHaveCount(0);
  await expect(panel.getByText("Not locked")).toHaveCount(0);
});
