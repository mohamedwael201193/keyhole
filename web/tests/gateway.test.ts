import { describe, expect, it } from "vitest";
import { checkBody, MAX_BODY, ALLOWED_OPS } from "@/lib/gateway";
import { createLimiter } from "@/lib/ratelimit";
const auth = (op: string) => ({ account_id: "a.near", public_key: "ed25519:x", signature: "s", nonce: "n", recipient: "keyhole", message: JSON.stringify({ op, account_id: "a.near", ts_ms: 1, params: {} }) });

describe("gateway body checks", () => {
  it("allows info without auth", () => expect(checkBody('{"op":"info"}')).toMatchObject({ ok: true, op: "info" }));
  it.each(["copy", "sweep_minter", "", "INFO"])("blocks op %s even with an auth object", (op) => expect(checkBody(JSON.stringify({ op, auth: auth(op || "swap") }))).toMatchObject({ ok: false, code: "bad_op" }));
  it("refuses unsigned or incomplete swap and withdraw", () => {
    for (const op of ["swap", "withdraw"]) {
      expect(checkBody(JSON.stringify({ op }))).toMatchObject({ ok: false, code: "no_auth" });
      expect(checkBody(JSON.stringify({ op, auth: { account_id: "a.near" } }))).toMatchObject({ ok: false, code: "no_auth" });
      expect(checkBody(JSON.stringify({ op, auth: "junk" }))).toMatchObject({ ok: false, code: "no_auth" });
    }
  });
  it("refuses a fund op whose signed message names a different op", () => {
    expect(checkBody(JSON.stringify({ op: "swap", auth: auth("withdraw") }))).toMatchObject({ code: "op_mismatch" });
    expect(checkBody(JSON.stringify({ op: "withdraw", auth: auth("swap") }))).toMatchObject({ code: "op_mismatch" });
  });
  it("relays swap and withdraw only with a complete NEP-413 auth for that op", () => {
    for (const op of ["swap", "withdraw"] as const) expect(checkBody(JSON.stringify({ op, auth: auth(op) }))).toMatchObject({ ok: true, op });
    expect(ALLOWED_OPS).toEqual(expect.arrayContaining(["swap", "withdraw"]));
    expect(ALLOWED_OPS as readonly string[]).not.toContain("copy");
    expect(ALLOWED_OPS as readonly string[]).not.toContain("sweep_minter");
  });
  it("requires all auth fields", () => expect(checkBody('{"op":"status","auth":{"account_id":"a"}}')).toMatchObject({ code: "no_auth" }));
  it("rejects op/message mismatch", () => expect(checkBody(JSON.stringify({ op: "mint", auth: auth("status") }))).toMatchObject({ code: "op_mismatch" }));
  it("rejects bad JSON", () => expect(checkBody("{")).toMatchObject({ code: "bad_params" }));
  it("rejects > 8 KB", () => expect(checkBody("x".repeat(MAX_BODY + 1))).toMatchObject({ status: 413, code: "too_large" }));
  it("accepts a well-formed signed request", () => expect(checkBody(JSON.stringify({ op: "quote", auth: auth("quote") }))).toMatchObject({ ok: true }));
});
describe("rate limiter", () => {
  it("limits per key and resets after the window", () => {
    const l = createLimiter(3, 1000);
    expect([1, 2, 3].map(() => l("ip", 0).ok)).toEqual([true, true, true]);
    expect(l("ip", 10)).toEqual({ ok: false, retryAfter: 1 });
    expect(l("other", 10).ok).toBe(true);
    expect(l("ip", 1001).ok).toBe(true);
  });
});
