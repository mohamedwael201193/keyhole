#!/usr/bin/env node
// KEYHOLE MCP server (stdio). Tools: verify, explain_pnl, quote_buy, copy (two-step confirm).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { loadKey, run, verifyCall, explainPnl } from "./core.js";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const text = (x: unknown) => ({ content: [{ type: "text" as const, text: typeof x === "string" ? x : JSON.stringify(x, null, 2) }] });

/** Pending copy trades awaiting the user's second confirmation (5-minute TTL, single use). */
const pending = new Map<string, { params: Record<string, string>; exp: number }>();
export function makeConfirm(params: Record<string, string>, now = Date.now()) {
  const code = randomBytes(4).toString("hex");
  pending.set(code, { params, exp: now + 5 * 60_000 });
  return code;
}
export function takeConfirm(code: string, now = Date.now()) {
  const p = pending.get(code); pending.delete(code);
  if (!p || p.exp < now) return null;
  return p.params;
}

export function buildServer() {
  const s = new McpServer({ name: "keyhole", version: "0.1.0" });
  s.tool("verify", "Verify a KEYHOLE TEE call: attestation hash vs the published FastFS wasm (and an optional local build).",
    { call_id: z.string(), wasm_path: z.string().optional() }, async ({ call_id, wasm_path }) => text(await verifyCall(call_id, wasm_path)));
  s.tool("explain_pnl", "Explain the holder's private trades and confidential balances in plain language.", {}, async () => {
    const key = loadKey(); const h = await run(key, "history"); const b = await run(key, "balance");
    if (!h.output?.ok) return text(h.output);
    return text(explainPnl(h.output.entries ?? [], b.output?.balances ?? []));
  });
  s.tool("quote_buy", "Get a confidential quote to buy token_out with amount (base units) of token_in. No funds move.",
    { amount: z.string().regex(/^\d+$/), token_in: z.string().default(USDC), token_out: z.string().default("nep141:wrap.near") },
    async ({ amount, token_in, token_out }) => {
      const key = loadKey();
      return text((await run(key, "quote", { origin_asset: token_in, destination_asset: token_out, amount, deposit_type: "INTENTS", refund_to: key.accountId,
        refund_type: "INTENTS", recipient: key.accountId, recipient_type: "INTENTS", confidentiality: "basic" })).output);
    });
  s.tool("copy", "Copy a trade into the holder's confidential account. Step 1 (no confirm_code) returns a preview and a code; step 2 with confirm_code executes. Always show the preview to the user and get an explicit yes before step 2.",
    { amount: z.string().regex(/^\d+$/).optional(), token_in: z.string().default(USDC), token_out: z.string().default("nep141:wrap.near"),
      source: z.string().optional(), confirm_code: z.string().optional() },
    async ({ amount, token_in, token_out, source, confirm_code }) => {
      const key = loadKey();
      if (!confirm_code) {
        if (!amount) return text("amount is required");
        const params = { token_in, token_out, amount_in: amount, source: source ?? "mcp" };
        const q = await run(key, "quote", { origin_asset: token_in, destination_asset: token_out, amount, deposit_type: "INTENTS", refund_to: key.accountId,
          refund_type: "INTENTS", recipient: key.accountId, recipient_type: "INTENTS", confidentiality: "basic" });
        if (!q.output?.ok) return text(q.output);
        return text({ preview: { ...params, usd: (q.output.usd_micro / 1e6).toFixed(2), expected_out: q.output.quote?.amountOutFormatted }, confirm_code: makeConfirm(params),
          next: "Ask the user to confirm. Then call copy again with confirm_code within 5 minutes." });
      }
      const params = takeConfirm(confirm_code);
      if (!params) return text("confirm_code is invalid or expired; start again without confirm_code");
      return text((await run(key, "copy", params)).output);
    });
  return s;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("mcp.ts") || process.argv[1]?.endsWith("mcp.js")) {
  buildServer().connect(new StdioServerTransport());
}
