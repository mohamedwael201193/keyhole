import { describe, expect, it } from "vitest";
import { loadSession, saveSession, sessionAuth, sessionParams, inSession, minutesLeft, SESSION_TTL_MS, SESSION_OPS, type Session } from "@/lib/session";
import { startStep, popupBudget, SAFE_LIMITS } from "@/lib/start";
import { checkBody } from "@/lib/gateway";
import { readFileSync } from "node:fs";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const S: Session = { token: "A".repeat(43) + "=", account: "alice.near", token_id: "k1234", exp_ms: 2_000_000, max_usd_micro: 5_000_000 };

describe("session client", () => {
  it("stores and loads only for the same account before expiry", () => {
    const st = mem(); saveSession(S, st);
    expect(loadSession("alice.near", 1_000_000, st)).toEqual(S);
    expect(loadSession("bob.near", 1_000_000, st)).toBeNull();
    expect(st.m.size).toBe(0); // wrong account clears it
  });
  it("drops an expired session", () => {
    const st = mem(); saveSession(S, st);
    expect(loadSession("alice.near", 2_000_000, st)).toBeNull();
    expect(st.m.size).toBe(0);
  });
  it("drops garbage", () => { const st = mem(); st.setItem("kh_session_v1", "{bad"); expect(loadSession("alice.near", 0, st)).toBeNull(); });
  it("builds a fresh nonce per call (no replay) and names the op", () => {
    const a = sessionAuth(S, "swap", { x: 1 }, 5), b = sessionAuth(S, "swap", { x: 1 }, 5);
    expect(a.nonce).not.toBe(b.nonce);
    expect(Buffer.from(a.nonce, "base64").length).toBe(32);
    expect(JSON.parse(a.message)).toEqual({ op: "swap", account_id: "alice.near", ts_ms: 5, params: { x: 1 } });
    expect(a.scheme).toBe("session");
  });
  it("scope matches the worker (lock, prove, mint, session never in scope)", () => {
    for (const op of ["lock", "prove", "mint", "session", "info"]) expect(inSession(op)).toBe(false);
    for (const op of ["swap", "withdraw", "dashboard", "limits"]) expect(inSession(op)).toBe(true);
    const rs = readFileSync("../tee/worker/src/lib.rs", "utf8");
    const m = rs.match(/SESSION_OPS: &\[&str\] = &\[([^\]]+)\]/);
    if (m) expect(m[1].match(/"(\w+)"/g)!.map((x) => x.slice(1, -1))).toEqual([...SESSION_OPS]);
  });
  it("asks for 30 minutes at most", () => { expect(sessionParams("k1").ttl_ms).toBe(SESSION_TTL_MS); expect(SESSION_TTL_MS).toBe(1_800_000); });
  it("counts minutes left", () => { expect(minutesLeft(S, 2_000_000 - 61_000)).toBe(2); expect(minutesLeft(null)).toBe(0); });
});

describe("gateway relays session auth", () => {
  const body = (auth: unknown, op = "swap") => JSON.stringify({ op, auth });
  it("accepts a complete session auth", () => { expect(checkBody(body(sessionAuth(S, "swap"))).ok).toBe(true); });
  it("rejects a missing token", () => { const a = { ...sessionAuth(S, "swap"), token: "" }; expect(checkBody(body(a))).toMatchObject({ ok: false, code: "no_auth" }); });
  it("rejects an op mismatch", () => { expect(checkBody(body(sessionAuth(S, "withdraw"), "swap"))).toMatchObject({ ok: false, code: "op_mismatch" }); });
  it("allows the new ops", () => { for (const op of ["dashboard", "session", "session_revoke"]) expect(checkBody(body(sessionAuth(S, op as "dashboard"), op)).ok).toBe(true); });
});

describe("/start", () => {
  const f = { connected: true, holder: true, unlocked: true, limitsDone: true, funded: true };
  it("resumes at the first missing fact", () => {
    expect(startStep({ ...f, connected: false })).toBe("connect");
    expect(startStep({ ...f, holder: false })).toBe("mint");
    expect(startStep({ ...f, unlocked: false })).toBe("unlock");
    expect(startStep({ ...f, limitsDone: false })).toBe("limits");
    expect(startStep({ ...f, funded: false })).toBe("fund");
    expect(startStep(f)).toBe("done");
  });
  it("skips mint while key lookup is pending", () => { expect(startStep({ ...f, holder: null, unlocked: false })).toBe("unlock"); });
  it("popup budget: 3 new, 2 holder", () => { expect(popupBudget(false)).toBe(3); expect(popupBudget(true)).toBe(2); });
  it("safe limits are small", () => { expect(SAFE_LIMITS.per_tx_usd_micro).toBeLessThanOrEqual(SAFE_LIMITS.daily_usd_micro); expect(SAFE_LIMITS.daily_usd_micro).toBe(5_000_000); });
});
