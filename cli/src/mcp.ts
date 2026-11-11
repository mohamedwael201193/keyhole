#!/usr/bin/env node
// KEYHOLE MCP server (stdio). Tools: verify, explain_pnl, quote_buy, pledge_status (read-only), copy (guarded; operator confirms on their own terminal).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadKey, run, verifyCall, explainPnl, guardedRun, GuardError, type Key, type GuardDeps } from "./core.js";
import { pledgeStatus } from "./pledge.js";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const text = (x: unknown) => ({ content: [{ type: "text" as const, text: typeof x === "string" ? x : JSON.stringify(x, null, 2) }] });

/**
 * copy: a preview quote, then the counterparty guard, then the operator's terminal code (always, for a copy).
 * The confirmation code is shown on the operator's terminal only. It is never part of this result, so the model cannot confirm for itself.
 * With no operator terminal the copy is refused (fail closed).
 */
export async function copyTrade(key: Key, a: { amount?: string; token_in: string; token_out: string; source?: string }, deps?: GuardDeps): Promise<string> {
  if (!a.amount) return "amount is required";
  const q = await run(key, "quote", { origin_asset: a.token_in, destination_asset: a.token_out, amount: a.amount, deposit_type: "INTENTS", refund_to: key.accountId,
    refund_type: "INTENTS", recipient: key.accountId, recipient_type: "INTENTS", confidentiality: "basic" });
  if (!q.output?.ok) return JSON.stringify(q.output, null, 2);
  // The quote's own floor (minAmountOut at the default slippage) is sent explicitly, so the enclave bounds the fill by it.
  const floor = q.output.quote?.minAmountOut;
  const minOut = typeof floor === "string" && /^[1-9]\d*$/.test(floor) ? { min_amount_out: floor } : {};
  const params = { token_in: a.token_in, token_out: a.token_out, amount_in: a.amount, source: a.source ?? "mcp", ...minOut };
  const summary = `copy ${a.amount} from ${a.token_in} to ${a.token_out}; about ${(q.output.usd_micro / 1e6).toFixed(2)} USD; expected out ${q.output.quote?.amountOutFormatted ?? "?"}`;
  try {
    const r = await guardedRun(key, "copy", params, { receiver: key.accountId, foreign: false, alwaysConfirm: true, summary }, deps);
    return JSON.stringify(r.output, null, 2);
  } catch (e) {
    if (e instanceof GuardError) return `not executed (${e.code}): ${e.message}. The operator has to confirm copies on their own terminal.`;
    throw e;
  }
}

export function buildServer() {
  const s = new McpServer({ name: "keyhole", version: "0.1.0" });
  s.tool("reconcile_value_op", "Reconcile the SAME original pending custody journal. Holder-only, never creates a replacement payment.",
    { token_id: z.string().min(1).max(64), value_op_id: z.string().regex(/^[1-9]\d{0,19}:[0-9a-f]{64}$/),
      exit_continue:z.object({step:z.enum(["unshield","storage","withdraw"]),value_op_id:z.string(),action_hash:z.string(),original_provider_id:z.string().nullable(),deadline_ms:z.number().int()}).optional(),
      original_delivery_locator:z.object({tx_hash:z.string(),signer_id:z.string()}).optional() },
    async (params) => text((await run(loadKey(), "reconcile_value_op", params)).output));
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
  // Read-only: contract views only. An agent calls this before any buy, transfer or action on a key.
  s.tool("pledge_status", "Read-only lien status of a key: whether it is pledged, the loan terms (lender, due, grace), and the actions the contract and enclave refuse while the lien is open. Views only; signs nothing.",
    { token_id: z.string().min(1).max(64) },
    async ({ token_id }) => text(await pledgeStatus(token_id)));
  s.tool("copy", "Copy a trade into the holder's confidential account. The operator must confirm on their own terminal (a code shown there, not in this result). Refused if the counterparty check blocks, or when there is no operator terminal.",
    { amount: z.string().regex(/^\d+$/).optional(), token_in: z.string().default(USDC), token_out: z.string().default("nep141:wrap.near"),
      source: z.string().optional() },
    async ({ amount, token_in, token_out, source }) => text(await copyTrade(loadKey(), { amount, token_in, token_out, source })));
  return s;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("mcp.ts") || process.argv[1]?.endsWith("mcp.js")) {
  buildServer().connect(new StdioServerTransport());
}
