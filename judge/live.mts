import "./live-gate.mjs";
const { loadKey, run, callWorker, signRequest, verifyCall } = await import("../cli/src/core.ts");
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const key = loadKey();
const show = async (label: string, r: any, expect: string) => {
  const o = r.output; const code = o?.error?.code ?? (o?.ok ? "ok" : "?");
  const v = r.call_id ? await verifyCall(r.call_id) : null;
  console.log(`${code === expect ? "OK  " : "FAIL"} ${label.padEnd(22)} got=${code.padEnd(16)} call=${r.call_id} attested=${v?.attested_sha256?.slice(0, 12)} verified=${v?.ok}`);
  return code === expect;
};
let st = await run(key, "status");
if (st.output?.tier == null) { console.log("no key yet, minting a free one…"); await show("mint", await run(key, "mint"), "ok"); }
const auth = signRequest(key, "status");
const a = await show("first use", await callWorker({ op: "status", auth }), "ok");
const b = await show("replay (same request)", await callWorker({ op: "status", auth }), "replay");
const c = await show("over-cap quote ($2)", await run(key, "quote", { origin_asset: USDC, destination_asset: "nep141:wrap.near", amount: "2000000",
  deposit_type: "INTENTS", refund_to: key.accountId, refund_type: "INTENTS", recipient: key.accountId, recipient_type: "INTENTS" }), "over_cap_per_tx");
process.exit(a && b && c ? 0 : 1);
