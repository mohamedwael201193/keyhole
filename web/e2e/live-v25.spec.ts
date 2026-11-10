import { test, expect } from "@playwright/test";
import { IDENTITY } from "../lib/identity.gen";

test("live v2.5: finalized public views retain their browser contract", async ({ request, page }) => {
  test.skip(process.env.KEYHOLE_LIVE_V25 !== "1", "Explicit read-only mainnet acceptance only");
  async function query(params: Record<string, unknown>) {
    const response = await request.post("https://rpc.mainnet.fastnear.com", { data: { jsonrpc: "2.0", id: "read-only-browser", method: "query", params } });
    expect(response.ok()).toBe(true);
    const json = await response.json();
    expect(json.error).toBeUndefined();
    return json.result;
  }
  const account = await query({ request_type: "view_account", account_id: IDENTITY.contract.account, finality: "final" });
  expect(account.code_hash).toBe(IDENTITY.contract.code_hash);
  async function view(method_name: string, args: Record<string, unknown> = {}) {
    const result = await query({ request_type: "call_function", account_id: IDENTITY.contract.account, block_id: account.block_hash, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
    return JSON.parse(Buffer.from(result.result).toString());
  }
  expect((await view("contract_source_metadata")).version).toBe(IDENTITY.contract.version);
  const tokens = await view("nft_tokens", { from_index: "0", limit: 100 });
  expect(tokens.length).toBeGreaterThanOrEqual(6);
  for (const token of tokens) {
    const control = await view("get_control_state", { token_id: token.token_id });
    expect(control.token_id).toBe(token.token_id);
    expect(control.owner_epoch).toMatch(/^\d+$/);
    expect(typeof control.transfer_pending).toBe("boolean");
    expect(await view("nft_token", { token_id: token.token_id })).toEqual(token);
  }
  await page.goto("/gallery");
  await expect(page.locator('a[href*="/key?id="]').first()).toBeVisible();
});
