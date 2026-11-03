// P2: Agent API gateway edge cases — paths, dry-swap bodies, redaction, policy warnings. Each must fail closed.
import { describe, expect, it } from "vitest";
import { agentPath, balanceWarnings, drySwapBody, redact, policyWarnings, canon } from "@/lib/agentApi";
import { OC_ASSETS } from "@/lib/oneclick";

const ID = "a".repeat(64);
const [A, B] = OC_ASSETS.map((a) => a.id);

describe("agentPath allowlist", () => {
  it.each(["network", "whoami", "quotas"])("%s maps to /v1/%s", (r) => { expect(agentPath(r, undefined)).toBe(`/v1/${r}`); });
  it("policy needs a 64-hex agent id from env", () => { expect(agentPath("policy", ID)).toBe(`/v1/agents/${ID}/policy`); });
  it.each([undefined, "", "A".repeat(64), "a".repeat(63), "a".repeat(65), "../x", `${"a".repeat(63)}/`])("policy with agent id %j is refused", (id) => { expect(agentPath("policy", id)).toBeNull(); });
  it.each(["swap", "agents", "v1/network", "../network", "network/", "NETWORK", "", "withdraw", "policy/../whoami", "__proto__", "toString"])("read %j is refused", (r) => { expect(agentPath(r, ID)).toBeNull(); });
});

describe("drySwapBody fails closed", () => {
  it("valid pair is dry", () => { expect(drySwapBody({ origin: A, dest: B, amount: "1000" })).toEqual({ origin_asset: A, destination_asset: B, amount: "1000", dry: true }); });
  it("dry cannot be turned off by the caller", () => { expect(drySwapBody({ origin: A, dest: B, amount: "1", dry: false } as never)?.dry).toBe(true); });
  it.each([["same asset", A, A, "1"], ["unknown origin", "nep141:evil.near", B, "1"], ["unknown dest", A, "nep141:evil.near", "1"], ["missing origin", undefined, B, "1"], ["number amount", A, B, 1], ["zero", A, B, "0"], ["zeros", A, B, "000"], ["negative", A, B, "-1"], ["decimal", A, B, "1.5"], ["exponent", A, B, "1e6"], ["hex", A, B, "0x10"], ["spaces", A, B, " 1"], ["31 digits", A, B, "1".repeat(31)], ["empty", A, B, ""], ["object origin", { id: A }, B, "1"]] as const)("%s is refused", (_n, o, d, amt) => { expect(drySwapBody({ origin: o, dest: d, amount: amt })).toBeNull(); });
  it("30 digits is the maximum", () => { expect(drySwapBody({ origin: A, dest: B, amount: "9".repeat(30) })).not.toBeNull(); });
  it("leading zeros with a value pass as given", () => { expect(drySwapBody({ origin: A, dest: B, amount: "0010" })?.amount).toBe("0010"); });
});

describe("redact", () => {
  it("whoami keeps only shortened ids", () => { expect(redact("whoami", { api_key_id: "abcdef123456", tenant_id: "tttttt999", email: "x@y" })).toEqual({ api_key_id: "abcdef…", tenant_id: "tttttt…" }); });
  it("whoami with non-string ids gives nulls", () => { expect(redact("whoami", { api_key_id: 5 })).toEqual({ api_key_id: null, tenant_id: null }); });
  it("policy drops wallet_id", () => { expect(redact("policy", { wallet_id: "w", frozen: false })).toEqual({ frozen: false }); });
  it.each(["network", "quotas", "swap"] as const)("%s passes through", (r) => { expect(redact(r, { a: 1 })).toEqual({ a: 1 }); });
  it.each([null, undefined, "s", 3])("non-object %j passes through", (b) => { expect(redact("whoami", b)).toBe(b); });
});

describe("policyWarnings", () => {
  it("keeps policy_ and budget codes only", () => { expect(policyWarnings({ warnings: [{ code: "policy_transaction_limit_exceeded" }, { code: "insufficient_balance" }, { code: "budget_daily_exceeded" }] })).toEqual(["policy_transaction_limit_exceeded", "budget_daily_exceeded"]); });
  it.each([undefined, null, {}, { warnings: "x" }, { warnings: [null, {}, { code: 5 }] }])("malformed %j gives none", (q) => { expect(policyWarnings(q)).toEqual([]); });
});

describe("canon", () => {
  it("is key-order independent", () => { expect(canon({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(canon({ a: [2, { c: 4, d: 3 }], b: 1 })); });
  it("distinguishes array order", () => { expect(canon([1, 2])).not.toBe(canon([2, 1])); });
  it("distinguishes types", () => { expect(canon({ a: "1" })).not.toBe(canon({ a: 1 })); });
});

describe("balanceWarnings", () => {
  it("keeps insufficient_balance that policyWarnings drops", () => { expect(balanceWarnings({ warnings: [{ code: "policy_transaction_limit_exceeded" }, { code: "insufficient_balance" }] })).toEqual(["insufficient_balance"]); });
  it.each([undefined, null, {}, { warnings: [{ code: "budget_daily_exceeded" }] }])("%j gives none", (q) => { expect(balanceWarnings(q)).toEqual([]); });
});
