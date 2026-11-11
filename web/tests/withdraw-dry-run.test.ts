import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { withdrawDryRunDecision } from "@/lib/withdrawDryRun";
import { checkBody, ALLOWED_OPS } from "@/lib/gateway";
import { guardedValueOp } from "@/lib/guardedRequest";

const good = { ok: true, op: "withdraw_dry_run", to: "a.near", amount: "1000", token: "usdc", chain: "near", amount_out: "990000", min_amount_out: "985000", broadcast: false };

describe("withdraw dry-run decision (exit preflight)", () => {
  it("allows the signed withdrawal only with positive amount_out and min_amount_out", () => {
    expect(withdrawDryRunDecision(good)).toEqual({ ok: true, amount_out: "990000", min_amount_out: "985000" });
    expect(withdrawDryRunDecision({ ...good, amount_out: 990000, min_amount_out: 985000 })).toMatchObject({ ok: true });
  });
  it.each([
    ["missing output", undefined],
    ["worker refused", { ok: false, error: { code: "exit_quote_unavailable" } }],
    ["other op", { ...good, op: "withdraw" }],
    ["zero amount_out", { ...good, amount_out: "0" }],
    ["zero min_amount_out", { ...good, min_amount_out: "0" }],
    ["missing min_amount_out", { ...good, min_amount_out: undefined }],
    ["non-numeric", { ...good, amount_out: "1e6" }],
    ["negative", { ...good, min_amount_out: "-5" }],
    ["claims broadcast", { ...good, broadcast: true }],
  ])("refuses when %s", (_, out) => {
    const d = withdrawDryRunDecision(out);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/No withdrawal was signed/);
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
  it("is treated as a guarded value op, so it binds the current epoch like withdraw", () => {
    expect(guardedValueOp("withdraw_dry_run", {})).toBe(true);
  });
});

describe("exit preflight wiring", () => {
  it("signs withdraw only after the preview decision, in LivePledge", () => {
    const src = readFileSync(new URL("../app/pledge/LivePledge.tsx", import.meta.url), "utf8");
    const preview = src.indexOf('wallet.sign("withdraw_dry_run"');
    const gate = src.indexOf("if(!preview.ok)throw Error(preview.reason)");
    const signWithdraw = src.indexOf('wallet.sign("withdraw",exitParams)');
    expect(preview).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(preview);
    expect(signWithdraw).toBeGreaterThan(gate);
    expect(src.slice(src.indexOf("const preview="), signWithdraw)).toContain("withdrawDryRunDecision(");
  });
});
