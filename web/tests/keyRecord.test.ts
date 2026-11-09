import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  RECORD_KIND, RECORD_MAX_AGE_MS, RECORD_MAX_SKEW_MS, fetchKeyRecord, parseRecordStatement, verifyKeyRecord, type KeyRecordShare, type RecordContext,
} from "@/lib/keyRecord";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const sk = new Uint8Array(32).fill(9);
const pk = hex(ed25519.getPublicKey(sk));
const TOKEN = "k5f4750858f328940";
const OWNER = "alice.near";
const SELLER = "alice.near";
const PRICE = "5000000000000000000000000";
const NOW = 1_800_000_000_000;

/** The statement bytes the enclave would sign: keys sorted, no spaces. */
function statement(over: Partial<Record<string, unknown>> = {}): string {
  const o: Record<string, unknown> = {
    cost: 30_000_000, kind: RECORD_KIND, log_head: "ab".repeat(32), outs: { "nep141:wrap.near": "1500" }, owner: OWNER, price: PRICE,
    seller: SELLER, settled_swaps: 2, since: NOW - 3_600_000, tier: 2, token_id: TOKEN, trades: 2, ts_ms: NOW, volume_usd_micro: 30_000_000,
    ...over,
  };
  return JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}

/** Signs the statement bytes the way the worker does: ed25519 over the exact string, by the minter key. */
function share(stmt: string, key = sk, minter = pk): KeyRecordShare {
  return { statement: stmt, sig: hex(ed25519.sign(new TextEncoder().encode(stmt), key)), minter, call_id: "184b6075-9e95-4dbe-b75f-3d4c9c9afdcd" };
}
const ctx = (over: Partial<RecordContext> = {}): RecordContext => ({
  tokenId: TOKEN, chainOwner: OWNER, listedSeller: SELLER, contractMinter: pk, nowMs: NOW, ...over,
});
const passOf = (r: ReturnType<typeof verifyKeyRecord>, id: string) => r.checks.find((c) => c.id === id)?.pass;

describe("record statement decoding", () => {
  it("reads every field the enclave signs", () => {
    const st = parseRecordStatement(statement());
    expect(st).toMatchObject({ kind: RECORD_KIND, token_id: TOKEN, owner: OWNER, tier: 2, price: PRICE, seller: SELLER, settled_swaps: 2, volume_usd_micro: 30_000_000, trades: 2, cost: 30_000_000, since: NOW - 3_600_000, ts_ms: NOW });
    expect(st?.outs).toEqual({ "nep141:wrap.near": "1500" });
  });
  it("accepts a holder with no trades (since 0, empty outs)", () => {
    expect(parseRecordStatement(statement({ since: 0, trades: 0, cost: 0, outs: {}, settled_swaps: 0, volume_usd_micro: 0 }))).not.toBeNull();
  });
  it("refuses another kind of statement, a missing field, or a bad value", () => {
    expect(parseRecordStatement(statement({ kind: "keyhole-pnl-v1" }))).toBeNull();
    expect(parseRecordStatement(statement({ kind: "keyhole-balance-proof-v1" }))).toBeNull();
    expect(parseRecordStatement(statement({ price: "5.0" }))).toBeNull();
    expect(parseRecordStatement(statement({ price: 5 }))).toBeNull();
    expect(parseRecordStatement(statement({ tier: -1 }))).toBeNull();
    expect(parseRecordStatement(statement({ tier: 1.5 }))).toBeNull();
    expect(parseRecordStatement(statement({ cost: 2 ** 60 }))).toBeNull();
    expect(parseRecordStatement(statement({ volume_usd_micro: "30" }))).toBeNull();
    expect(parseRecordStatement(statement({ outs: [] }))).toBeNull();
    expect(parseRecordStatement(statement({ outs: null }))).toBeNull();
    expect(parseRecordStatement(statement({ seller: undefined }))).toBeNull();
    expect(parseRecordStatement(statement({ log_head: 7 }))).toBeNull();
  });
  it("never throws on bytes that are not JSON, or not an object", () => {
    for (const s of ["", "nope", "[1,2]", "null", "42", "{"]) expect(parseRecordStatement(s), s).toBeNull();
  });
});

describe("verifying a record in the browser", () => {
  it("PASS for a good signature, the contract's minter, this key, the current owner, the listing seller and a fresh stamp", () => {
    const r = verifyKeyRecord(share(statement()), ctx());
    expect(r.verdict).toBe("pass");
    expect(r.statement?.token_id).toBe(TOKEN);
    for (const c of r.checks) expect(c.pass, c.id).toBe(true);
  });

  it("FAIL on a bad signature: an edited statement", () => {
    const s = share(statement());
    const r = verifyKeyRecord({ ...s, statement: s.statement.replace('"tier":2', '"tier":3') }, ctx());
    expect(r.verdict).toBe("fail");
    expect(passOf(r, "signature")).toBe(false);
  });

  it("FAIL on a bad signature: a signature from another key", () => {
    const other = new Uint8Array(32).fill(3);
    const r = verifyKeyRecord(share(statement(), other), ctx());
    expect(r.verdict).toBe("fail");
    expect(passOf(r, "signature")).toBe(false);
  });

  it("FAIL when the signer is not the contract's minter", () => {
    const r = verifyKeyRecord(share(statement()), ctx({ contractMinter: "00".repeat(32) }));
    expect(r.verdict).toBe("fail");
    expect(passOf(r, "minter")).toBe(false);
  });

  it("is not PASS and never claims a signer it did not check when the minter cannot be read", () => {
    const r = verifyKeyRecord(share(statement()), ctx({ contractMinter: null }));
    expect(r.verdict).toBe("unverified");
    expect(passOf(r, "minter")).toBeNull();
    expect(passOf(r, "signature")).toBe(true);
  });

  it("FAIL for a record of another key", () => {
    const r = verifyKeyRecord(share(statement({ token_id: "kdeadbeefdeadbeef" })), ctx());
    expect(r.verdict).toBe("fail");
    expect(passOf(r, "token")).toBe(false);
    expect(r.checks.find((c) => c.id === "token")?.detail).toContain("kdeadbeefdeadbeef");
  });

  it("FAIL with 'Owner changed since this record' after a transfer", () => {
    const r = verifyKeyRecord(share(statement()), ctx({ chainOwner: "bob.near" }));
    expect(r.verdict).toBe("fail");
    const owner = r.checks.find((c) => c.id === "owner");
    expect(owner?.pass).toBe(false);
    expect(owner?.label).toBe("Owner changed since this record");
  });

  it("is pending while the holder is still loading, and not PASS", () => {
    const r = verifyKeyRecord(share(statement()), ctx({ chainOwner: undefined }));
    expect(r.verdict).toBe("pending");
    expect(passOf(r, "owner")).toBeNull();
  });

  it("is unverified when the holder cannot be read, never PASS", () => {
    const r = verifyKeyRecord(share(statement()), ctx({ chainOwner: null }));
    expect(r.verdict).toBe("unverified");
    expect(passOf(r, "owner")).toBeNull();
  });

  it("FAIL when the record names another seller than the listing", () => {
    const r = verifyKeyRecord(share(statement({ seller: "mallory.near" })), ctx());
    expect(r.verdict).toBe("fail");
    expect(passOf(r, "seller")).toBe(false);
  });

  it("FAIL when the record is more than a day old, and says to reload", () => {
    const r = verifyKeyRecord(share(statement({ ts_ms: NOW - RECORD_MAX_AGE_MS - 1 })), ctx());
    expect(r.verdict).toBe("fail");
    expect(passOf(r, "age")).toBe(false);
    expect(r.checks.find((c) => c.id === "age")?.detail).toContain("Reload");
  });

  it("PASS for a record exactly one day old, and FAIL for a stamp ahead of this clock by more than the skew", () => {
    expect(passOf(verifyKeyRecord(share(statement({ ts_ms: NOW - RECORD_MAX_AGE_MS })), ctx()), "age")).toBe(true);
    expect(passOf(verifyKeyRecord(share(statement({ ts_ms: NOW + RECORD_MAX_SKEW_MS })), ctx()), "age")).toBe(true);
    const future = verifyKeyRecord(share(statement({ ts_ms: NOW + RECORD_MAX_SKEW_MS + 1 })), ctx());
    expect(passOf(future, "age")).toBe(false);
    expect(future.checks.find((c) => c.id === "age")?.detail).toContain("future");
  });

  it("FAIL on a record that is not a listed-key record, with every later check left unrun", () => {
    const r = verifyKeyRecord(share('{"kind":"keyhole-pnl-v1","token_id":"k1"}'), ctx());
    expect(r.verdict).toBe("fail");
    expect(r.statement).toBeNull();
    expect(passOf(r, "statement")).toBe(false);
    expect(passOf(r, "token")).toBeNull();
    expect(passOf(r, "seller")).toBeNull();
    expect(passOf(r, "age")).toBeNull();
    expect(passOf(r, "signature")).toBe(true);
  });
});

describe("fetching the record from the gateway", () => {
  const reply = (body: unknown, status = 200) => (async (_u: RequestInfo | URL, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body))).toEqual({ op: "record", token_id: TOKEN });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;

  it("returns the signed statement from a good output, with no wallet", async () => {
    const s = share(statement());
    const r = await fetchKeyRecord(TOKEN, reply({ call_id: s.call_id, output: { ok: true, op: "record", statement: s.statement, sig: s.sig, minter: s.minter, token_id: TOKEN } }));
    expect(r).toEqual({ kind: "ok", share: s });
  });

  it("says the record opens with the next release when the worker has no such op", async () => {
    expect(await fetchKeyRecord(TOKEN, reply({ call_id: "x", output: { ok: false, error: { code: "unknown_op" } } }))).toEqual({ kind: "unavailable" });
  });

  it("reports the worker's own error code for a listed key that fails, and gateway errors", async () => {
    expect(await fetchKeyRecord(TOKEN, reply({ output: { ok: false, error: { code: "not_listed" } } }))).toEqual({ kind: "error", code: "not_listed" });
    expect(await fetchKeyRecord(TOKEN, reply({ error: { code: "rate_limited" } }, 429))).toEqual({ kind: "error", code: "rate_limited" });
    expect(await fetchKeyRecord(TOKEN, reply("not json"))).toEqual({ kind: "error", code: "gateway" });
    expect(await fetchKeyRecord(TOKEN, reply({ output: { ok: false } }))).toEqual({ kind: "error", code: "gateway" });
  });

  it("reports a network failure without throwing", async () => {
    const boom = (async () => { throw new TypeError("offline"); }) as typeof fetch;
    expect(await fetchKeyRecord(TOKEN, boom)).toEqual({ kind: "error", code: "network" });
  });
});
