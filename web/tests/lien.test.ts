import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_PATH_RULES, LIEN_REFUSALS, defaultClaimableAtNs, formatNs, lienState, lendingText } from "@/lib/lien";
import { nearFromYocto } from "@/components/lien/LienPanel";
import type { Loan } from "@/lib/pledgeClient";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const contract = ["../../contracts/keys/src/pledge.rs", "../../contracts/keys/src/lib.rs", "../../contracts/keys/src/sale.rs"].map(src).join("\n");
const enclave = ["../../tee/worker/src/guarded.rs", "../../tee/worker/src/guarded_host.rs"].map(src).join("\n");

const loan = (over: Partial<Loan> = {}): Loan => ({
  token_id: "k5f4750858f328940", nonce: "1", borrower: "b.near", owner_epoch: "3",
  terms: { lender: "lender.near", principal: "10000000000000000000000", repayment: "10100000000000000000000", duration_sec: "7200", grace_sec: "900", floor_raw: "500000", funding_deadline_ns: "1" },
  state: "Active", due_ns: "1000000000000000", storage_bond: "1", policy_sequence: "1", policy_busy: false, policy_call_complete: true, resolution: null, ...over,
});
const control = (over: Partial<{ pledged: boolean; listed: boolean; transfer_pending: boolean; pending_value_ops: string }> = {}) =>
  ({ owner_epoch: "3", pending_value_ops: "0", listed: false, transfer_pending: false, pledged: false, ...over });
const mainnet = { network: "mainnet", lending_enabled: false, next_loan_nonce: "1" } as never;

describe("refusal table matches the code it cites", () => {
  it("every contract string is in the contract source", () => {
    for (const r of LIEN_REFUSALS) if (r.refused_by === "contract") expect(contract.includes(r.code)).toBe(true);
  });
  it("every enclave code is returned by the enclave source", () => {
    for (const r of LIEN_REFUSALS) if (r.refused_by === "enclave") expect(enclave.includes(`"${r.code}"`) && enclave.includes("message" in r ? r.message : "")).toBe(true);
  });
  it("default-path refusals are the contract's own strings", () => {
    for (const r of DEFAULT_PATH_RULES) expect(contract.includes(r.code)).toBe(true);
  });
  it("the owner-side lock is enforced through assert_token_idle, which owns the string", () => {
    expect(contract).toContain("fn assert_token_idle");
    expect(contract).toContain("pledged: ownership and value operations locked");
  });
  it("cites the exact lines the rows name", () => {
    const at = (rel: string, n: number) => src(rel).split("\n")[n - 1] ?? "";
    expect(at("../../tee/worker/src/guarded.rs", 35)).toMatch(/fn admit\(/);
    expect(at("../../contracts/keys/src/sale.rs", 49)).toMatch(/assert_can_change_owner/);
    expect(at("../../contracts/keys/src/lib.rs", 511)).toMatch(/assert_can_change_owner/);
    expect(at("../../contracts/keys/src/lib.rs", 738)).toMatch(/assert_can_change_owner/);
  });
});

describe("lien state", () => {
  it("no lien: read, not locked, no refusal rows", () => {
    const s = lienState(control(), null, mainnet);
    expect(s.controlRead).toBe(true);
    expect(s.locked).toBe(false);
    expect(s.refusalsApply).toBe(false);
    expect(s.lendingLine).toBe("Lending is off on mainnet. No loan can be opened or funded from this site; anything shown here is what the contract holds.");
  });
  it("control not read: not claimed as unlocked, and the loan is still reported", () => {
    const s = lienState(null, loan(), mainnet);
    expect(s.controlRead).toBe(false);
    expect(s.locked).toBe(false);
    expect(s.activeLoan).toBe(true);
    expect(s.refusalsApply).toBe(true);
  });
  it("active loan: locked, refusal rows apply, default claimable after due + grace", () => {
    const s = lienState(control({ pledged: true }), loan(), mainnet);
    expect(s.locked).toBe(true);
    expect(s.refusalsApply).toBe(true);
    expect(s.activeLoan).toBe(true);
    expect(s.defaultClaimableAtNs).toBe(1_000_000_000_000_000n + 900n * 1_000_000_000n);
  });
  it("offered loan: locked but no default path", () => {
    const s = lienState(control({ pledged: true }), loan({ state: "Offered", due_ns: "0" }), mainnet);
    expect(s.activeLoan).toBe(false);
    expect(s.defaultClaimableAtNs).toBeNull();
  });
  it("a listed or transfer-pending key is locked without refusal rows", () => {
    expect(lienState(control({ listed: true }), null, null).locked).toBe(true);
    expect(lienState(control({ listed: true }), null, null).refusalsApply).toBe(false);
  });
  it("missing pledge config is null, not guessed", () => {
    expect(lienState(control(), null, null).lendingEnabled).toBeNull();
  });
});

describe("lending text uses the network the contract names", () => {
  it("says the configured network, not a fixed word", () => {
    expect(lendingText({ network: "testnet", lending_enabled: false, next_loan_nonce: "1" } as never)).toMatch(/^Lending is off on testnet\./);
    expect(lendingText({ network: "mainnet", lending_enabled: false, next_loan_nonce: "1" } as never)).toMatch(/^Lending is off on mainnet\./);
    expect(lendingText({ network: "mainnet", lending_enabled: true, next_loan_nonce: "1" } as never)).toBe("Lending is enabled on mainnet.");
  });
  it("says so when the config is absent", () => {
    expect(lendingText(null)).toMatch(/not present/);
  });
});

describe("formatNs", () => {
  it("prints Africa/Cairo with seconds, and unknown for a missing or overflowing instant", () => {
    const ns = 1_700_000_000_000_000_000n;
    const formatted = new Date(Number(ns / 1_000_000n)).toLocaleString("en-GB", {
      timeZone: "Africa/Cairo", day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    expect(formatNs(ns)).toBe(`${formatted} Africa/Cairo`);
    expect(formatNs(ns)).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(formatNs(null)).toBe("unknown");
    expect(formatNs((BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 1_000_000n)).toBe("unknown");
  });
});

describe("helpers", () => {
  it("defaultClaimableAtNs rejects malformed numbers", () => {
    expect(defaultClaimableAtNs({ due_ns: "x", terms: { grace_sec: "1" } } as never)).toBeNull();
  });
  it.each([
    ["0", "0"],
    ["1000000000000000000000000", "1"],
    ["10100000000000000000000", "0.0101"],
    ["3200000000000000000000", "0.0032"],
  ])("nearFromYocto(%s) = %s", (y, want) => expect(nearFromYocto(y)).toBe(want));
  it("nearFromYocto leaves non-integers alone", () => expect(nearFromYocto("1.5")).toBe("1.5"));
});
