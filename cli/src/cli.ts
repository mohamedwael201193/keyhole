#!/usr/bin/env node
// keyhole CLI. Usage: keyhole <command> [--account a.near] [--key-file f.json] [--json '{"..."}']
import { payout } from "./payout.js";
import { loadKey, run, verifyCall, explainPnl, guardedRun, GuardError, DEFAULTS } from "./core.js";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const HELP = `keyhole: private trading account behind a NEAR NFT key (TEE-attested)

  keyhole info                                   worker version, limits, minter
  keyhole mint                                   mint your free Bronze key (one per account)
  keyhole status                                 your tier, limits, today's spend
  keyhole quote --amount 50000 [--from USDC_ID --to nep141:wrap.near] [--execute]
  keyhole account [--chain base --amount 1000000] your confidential id (+ optional deposit address)
  keyhole balance                                confidential balances
  keyhole swap --amount 10000 [--from .. --to ..] confidential swap within your caps
  keyhole history | pnl                          your private trade log / summary
  keyhole withdraw --chain near --to you.near --token <id> --amount <base units>
  keyhole payout [--register --accept-storage-yocto <exact cost> | --claim]\n  keyhole reconcile --key <token_id> --value-op-id <original operation ID>
  keyhole verify <call_id> [--wasm path]         check attestation vs FastFS (and your build)

Auth: KEYHOLE_ACCOUNT + KEYHOLE_PRIVATE_KEY, or --key-file, or near-cli credentials.
Route: KEYHOLE_GATEWAY (hosted) or OUTLAYER_PAYMENT_KEY (your own). Project: ${DEFAULTS.project}`;

function args(argv: string[]) {
  const o: Record<string, string | boolean> = {}; const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const n = argv[i + 1]; if (n === undefined || n.startsWith("--")) o[a.slice(2)] = true; else { o[a.slice(2)] = n; i++; } }
    else pos.push(a);
  }
  return { o, pos };
}

async function main() {
  const { o, pos } = args(process.argv.slice(2));
  const cmd = pos[0];
  if (!cmd || cmd === "help" || o.help) { console.log(HELP); return; }
  const out = (x: unknown) => console.log(JSON.stringify(x, null, 2));
  if (cmd === "verify") {
    if (!pos[1]) throw new Error("usage: keyhole verify <call_id> [--wasm path]");
    const v = await verifyCall(pos[1], o.wasm as string | undefined);
    out(v); process.exitCode = v.ok ? 0 : 1; return;
  }
  if (cmd === "info") return out(await run(null, "info"));
  const key = loadKey({ account: o.account as string, keyFile: o["key-file"] as string });
  const extra = o.json ? JSON.parse(o.json as string) : {};
  const from = (o.from as string) ?? USDC, to = (o.to as string) ?? "nep141:wrap.near";
  switch (cmd) {
    case "payout": return out(await payout(key,o.register ? "register" : o.claim ? "claim" : "status",o["accept-storage-yocto"] as string | undefined));
    case "mint": case "status": case "balance": case "history":
      return out(await run(key, cmd, extra));
    case "quote": {
      const params = { origin_asset: from, destination_asset: to, amount: String(o.amount ?? "50000"), deposit_type: "INTENTS",
        refund_to: key.accountId, refund_type: "INTENTS", recipient: key.accountId, recipient_type: "INTENTS", confidentiality: (o.mode as string) ?? "basic",
        execute: !!o.execute, ...extra };
      return out(o.execute ? await guardedRun(key, "quote", params) : await run(key, "quote", params));
    }
    case "account":
      return out(await run(key, "account", o.chain ? { chain: o.chain, token: o.token ?? "USDC", amount: String(o.amount) } : {}));
    case "swap":
      return out(await run(key, "swap", { token_in: from, token_out: to, amount_in: String(o.amount), ...extra }));
    case "withdraw":
      return out(await guardedRun(key, "withdraw", { chain: o.chain, to: o.to, token: o.token, amount: String(o.amount), ...extra }));
    case "reconcile":
      if (typeof o.key !== "string" || typeof o["value-op-id"] !== "string" || !/^[1-9]\d{0,19}:[0-9a-f]{64}$/.test(o["value-op-id"])) throw new Error("reconcile requires --key and --value-op-id from the original call");
      return out(await run(key, "reconcile_value_op", { token_id: o.key, value_op_id: o["value-op-id"] }));
    case "pnl": {
      const h = await run(key, "history"); const b = await run(key, "balance");
      if (!h.output?.ok) return out(h);
      console.log(explainPnl(h.output.entries ?? [], b.output?.balances ?? [])); return;
    }
    default: throw new Error(`unknown command '${cmd}'. Run: keyhole help`);
  }
}
main().catch((e) => {
  // Exit 2: the counterparty check blocked the receiver, nothing was signed. Exit 3: the operator did not confirm a warn.
  if (e instanceof GuardError) { console.error(`refused: ${e.message}`); process.exitCode = e.code === "blocked" ? 2 : 3; return; }
  console.error("error:", e.message); process.exitCode = 1;
});
