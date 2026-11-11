import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { withdrawDryRunDecision, exitConfirmText } from "@/lib/withdrawDryRun";
import { checkBody, ALLOWED_OPS } from "@/lib/gateway";
import { guardedValueOp } from "@/lib/guardedRequest";

const intent = { account: "a.near", token: "nep141:usdc", amount: "1000", chain: "near" };
const good = { ok: true, op: "withdraw_dry_run", to: "a.near", amount: "1000", token: "nep141:usdc", chain: "near", amount_out: "990000", min_amount_out: "985000", broadcast: false };

describe("withdraw dry-run decision (exit preflight)", () => {
  it("never authorizes an unbound execution even with a positive matching preview", () => {
    expect(withdrawDryRunDecision(good, intent)).toMatchObject({ ok: false, reason: expect.stringMatching(/advisory only/) });
    expect(withdrawDryRunDecision({ ...good, amount_out: 990000, min_amount_out: 985000 }, intent)).toMatchObject({ ok: false });
  });
  it.each([
    ["missing output", undefined, /Route preview unavailable/],
    ["worker refused", { ok: false, error: { code: "exit_quote_unavailable" } }, /unavailable/],
    ["other op", { ...good, op: "withdraw" }, /unavailable/],
    ["zero amount_out", { ...good, amount_out: "0" }, /amount_out/],
    ["zero min_amount_out", { ...good, min_amount_out: "0" }, /min_amount_out/],
    ["missing min_amount_out", { ...good, min_amount_out: undefined }, /min_amount_out/],
    ["non-numeric", { ...good, amount_out: "1e6" }, /amount_out/],
    ["negative", { ...good, min_amount_out: "-5" }, /min_amount_out/],
    ["claims broadcast", { ...good, broadcast: true }, /broadcast/],
    ["another destination", { ...good, to: "mallory.near" }, /destination/],
    ["another amount", { ...good, amount: "999999" }, /amount/],
    ["another token", { ...good, token: "nep141:other" }, /token/],
    ["another chain", { ...good, chain: "base" }, /chain/],
  ])("refuses when %s", (_, out, why) => {
    const d = withdrawDryRunDecision(out, intent);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toMatch(why);
      expect(d.reason).toMatch(/No withdrawal was signed\./);
    }
  });
  it("the confirm text shows both preview numbers", () => {
    const text = exitConfirmText({ amount_out: "990000", min_amount_out: "985000" }, "1000");
    expect(text).toContain("amount_out 990000");
    expect(text).toContain("advisory minimum 985000");
  });
});

describe("withdraw_dry_run in the gateway", () => {
  it("is on the allowlist and needs a signed auth for the same op", () => {
    expect(ALLOWED_OPS as readonly string[]).toContain("withdraw_dry_run");
    expect(checkBody(JSON.stringify({ op: "withdraw_dry_run" }))).toMatchObject({ ok: false, code: "no_auth" });
    const message = JSON.stringify({ op: "withdraw", account_id: "a.near", ts_ms: 1, params: {} });
    expect(checkBody(JSON.stringify({ op: "withdraw_dry_run", auth: { account_id: "a.near", public_key: "ed25519:x", signature: "s", nonce: "n", recipient: "keyhole", message } }))).toMatchObject({ ok: false, code: "op_mismatch" });
    const ok = JSON.stringify({ op: "withdraw_dry_run", account_id: "a.near", ts_ms: 1, params: {} });
    expect(checkBody(JSON.stringify({ op: "withdraw_dry_run", auth: { account_id: "a.near", public_key: "ed25519:x", signature: "s", nonce: "n", recipient: "keyhole", message: ok } }))).toMatchObject({ ok: true, op: "withdraw_dry_run" });
  });
  it("refuses the session scheme for withdraw_dry_run, as it does for withdraw", () => {
    const message = JSON.stringify({ op: "withdraw_dry_run", account_id: "a.near", ts_ms: 1, params: {} });
    const sess = { scheme: "session", token: "t", nonce: "n", message, recipient: "keyhole", account_id: "a.near", public_key: "ed25519:x", signature: "s" };
    expect(checkBody(JSON.stringify({ op: "withdraw_dry_run", auth: sess }))).toMatchObject({ ok: false, status: 403, code: "session_scope" });
    const wmsg = JSON.stringify({ op: "withdraw", account_id: "a.near", ts_ms: 1, params: {} });
    expect(checkBody(JSON.stringify({ op: "withdraw", auth: { ...sess, message: wmsg } }))).toMatchObject({ ok: false, code: "session_scope" });
  });
  it("is treated as a guarded value op, so it binds the current epoch like withdraw", () => {
    expect(guardedValueOp("withdraw_dry_run", {})).toBe(true);
  });
});

describe("exit preflight wiring", () => {
  it("previews, decides, confirms, and only then signs withdraw, in LivePledge", () => {
    const src = readFileSync(new URL("../app/pledge/LivePledge.tsx", import.meta.url), "utf8");
    const fnStart = src.indexOf("async function continueExit");
    const fnEnd = src.indexOf("async function ordinaryExit");
    const fn = src.slice(fnStart, fnEnd);
    const decided = fn.indexOf("const preview=withdrawDryRunDecision(");
    const gate = fn.indexOf("if(!preview.ok)throw Error(preview.reason)");
    const confirm = fn.indexOf("window.confirm(exitConfirmText(preview,pending.amount))");
    const signWithdraw = fn.indexOf('wallet.sign("withdraw",exitParams)');
    expect(decided).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(decided);
    expect(confirm).toBeGreaterThan(gate);
    expect(signWithdraw).toBeGreaterThan(confirm);
    expect(fn.slice(decided, gate)).toContain("{account,token:USDC,amount:pending.amount,chain:\"near\"}");
    const ordinary = src.slice(fnEnd);
    const dry = ordinary.indexOf('wallet.sign("withdraw_dry_run"');
    expect(dry).toBeGreaterThan(-1);
    expect(ordinary.indexOf("continueExit(")).toBeGreaterThan(dry);
    expect(src).toContain("planExitReturn(");
    expect(src).not.toContain("was discarded");
  });
});
