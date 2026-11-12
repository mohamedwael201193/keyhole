import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ALLOWED_OPS, checkBody } from "@/lib/gateway";
import { buildOpenLoan, buildRegisterCollateral, createPledgeClient } from "@/lib/pledgeClient";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const auth = (op: string, params: Record<string, unknown> = {}) => ({ account_id: "alice.near", public_key: "test", signature: "test", nonce: "test", recipient: "keyhole", message: JSON.stringify({ op, params }) });
describe("two-sided Pledge + integrated recovery invariants", () => {
  it("retains both authenticated ops without relaxing certificate canonicalization", () => {
    expect(ALLOWED_OPS).toContain("pledge_inventory"); expect(ALLOWED_OPS).toContain("reconcile_value_op");
    expect(checkBody(JSON.stringify({ op: "pledge_inventory" }))).toMatchObject({ ok: false, code: "no_auth" });
    expect(checkBody(JSON.stringify({ op: "pledge_inventory", auth: auth("pledge_inventory") }))).toMatchObject({ ok: true });
    for (const loan_nonce of ["01", "-1", "18446744073709551616"]) expect(checkBody(JSON.stringify({ op: "loan_certificate", params: { token_id: "k1234", loan_nonce } }))).toMatchObject({ ok: false });
    expect(checkBody(JSON.stringify({ op: "loan_certificate", params: { token_id: "k1234", loan_nonce: "1", floor: "0" } }))).toMatchObject({ ok: false });
    expect(checkBody(JSON.stringify({ op: "reconcile_value_op", auth: { ...auth("reconcile_value_op", {token_id:"k1234", value_op_id:"1:"+"a".repeat(64)}), scheme: "session", token: "test" } }))).toMatchObject({ ok: false, code: "session_scope" });
  });
  it("requires live bond and binding quotes and fits first-action registration below the gas ceiling", async () => {
    const terms = { lender: "lender.near", principal: "10", repayment: "11", duration_sec: "7200", grace_sec: "900", floor_raw: "500000", funding_deadline_ns: "999" };
    expect(() => buildOpenLoan({ token_id: "k1234", terms }, undefined as never)).toThrow();
    const c = createPledgeClient({ live: true, view: (async (method: string) => method === "payout_account_registered" ? false : "3200000000000000000000") as never });
    const plan = await c.prepareAction("alice.near", buildOpenLoan({ token_id: "k1234", terms }, "9000000000000000000000"));
    expect(plan.calls.map(c => c.method)).toEqual(["register_payout_account", "open_loan"]);
    expect(plan.calls.reduce((n, c) => n + BigInt(c.gas), 0n)).toBe(220000000000000n);
    expect(() => buildRegisterCollateral({} as never, "0")).toThrow();
  });
  it("retains both complete worker functions and final inventory rechecks", () => {
    const host = source("../../tee/worker/src/guarded_host.rs");
    expect(host).toContain("fn pending_value_identity("); expect(host).toContain("fn op_pledge_inventory(");
    expect(host).toContain('authenticate(input,"pledge_inventory",true)');
    expect(host).toContain('guard_control(&token)?!=control'); expect(host).toContain('inventory_changed');
  });
  it("keeps recovery + ordinary onboarding and exactly one claim owner per route", () => {
    const shell = source("../components/app/AppShell.tsx"), credit = source("../components/PayoutCredit.tsx"), panel = source("../components/PayoutPanel.tsx");
    expect(shell).not.toContain("ValueRecovery"); expect(shell).toContain("<PayoutCredit"); expect(shell).toContain("{vaultOpen && <PayoutPanel />}"); expect(shell).toContain('pathname === "/vault" || (pathname === "/dashboard"');
    expect(credit).toContain('pathname==="/vault"'); expect(credit).toContain('pathname?.startsWith("/pledge")');
    for (const guard of ["dispatchMoneyBatch", "expectedSigner: accountId", "finalMoneyReceipt", "clearVerifiedMoneyOperation", "verifyPayoutReceipt"]) expect(panel).toContain(guard);
    expect(panel).toContain("!!operation"); expect(panel).toContain("value.pending");
  });
});
