import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ageLabel, decodeKeyProof, encodeKeyProof, parseKeyStatement, verifyKeyProof, type KeyProofShare } from "@/lib/keyProof";
import { cooldownFor, latestTransfer, lockFor, MAX_LOCK_MS, TRANSFER_COOLDOWN_MS } from "@/lib/buyerCheck";
import type { KeyEvent } from "@/lib/keylog";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const sk = new Uint8Array(32).fill(9);
const pk = hex(ed25519.getPublicKey(sk));
const TOKEN = "k5f4750858f328940";
const OWNER = "alice.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const LOG_HEAD = "ab".repeat(32);

/** The same bytes tee/worker/src/lib.rs proof_canonical writes (fixed field order, no spaces). */
function canonical(over: Partial<{ token_id: string; owner: string; holds: boolean; locked: number; ts: number }> = {}): string {
  const token_id = over.token_id ?? TOKEN;
  const owner = over.owner ?? OWNER;
  const holds = over.holds ?? true;
  const locked = over.locked ?? 0;
  const ts = over.ts ?? 1_800_000_000_000;
  return `{"asset":"${USDC}","holds_at_least":${holds},"kind":"keyhole-balance-proof-v1","locked_until_ms":${locked},"log_head":"${LOG_HEAD}","min":"10000000","owner":"${owner}","token_id":"${token_id}","ts_ms":${ts}}`;
}

/** Signs the statement bytes the way the worker does: ed25519 over the exact string. */
function share(statement: string, key = sk, minter = pk): KeyProofShare {
  return { statement, sig: hex(ed25519.sign(new TextEncoder().encode(statement), key)), minter, call_id: "184b6075-9e95-4dbe-b75f-3d4c9c9afdcd" };
}
const link = (s: KeyProofShare) => encodeKeyProof(s);
const ctx = (over: Partial<{ tokenId: string; chainOwner: string | null | undefined; contractMinter: string | null | undefined }> = {}) => ({
  tokenId: TOKEN, chainOwner: OWNER as string | null | undefined, contractMinter: pk as string | null | undefined, ...over,
});
const passOf = (r: ReturnType<typeof verifyKeyProof>, id: string) => r.checks.find((c) => c.id === id)?.pass;

describe("proof encode and decode", () => {
  it("round-trips through a url-safe string and keeps every field", () => {
    const s = share(canonical());
    const raw = link(s);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeKeyProof(raw)).toEqual(s);
  });
  it("keeps a null call id", () => {
    const s = { ...share(canonical()), call_id: null };
    expect(decodeKeyProof(link(s))?.call_id).toBeNull();
  });
  it("rejects malformed input without throwing", () => {
    expect(decodeKeyProof("")).toBeNull();
    expect(decodeKeyProof("not base64 !!")).toBeNull();
    expect(decodeKeyProof("abc")).toBeNull();
    expect(decodeKeyProof(btoa("[1,2]").replace(/=+$/, ""))).toBeNull();
    expect(decodeKeyProof(btoa('{"statement":"x","sig":1,"minter":"m"}').replace(/=+$/, ""))).toBeNull();
    expect(decodeKeyProof("A".repeat(9000))).toBeNull();
  });
  it("accepts a statement that is not a balance proof, so the verdict can say so", () => {
    const d = decodeKeyProof(link(share('{"kind":"keyhole-pnl-v1"}')));
    expect(d).not.toBeNull();
    expect(parseKeyStatement(d!.statement)).toBeNull();
  });
});

describe("balance proof statement", () => {
  it("parses the enclave's fields and refuses other kinds", () => {
    const st = parseKeyStatement(canonical({ holds: false, locked: 42 }));
    expect(st).toMatchObject({ token_id: TOKEN, owner: OWNER, min: "10000000", holds_at_least: false, locked_until_ms: 42 });
    expect(parseKeyStatement(canonical().replace("keyhole-balance-proof-v1", "keyhole-pnl-v1"))).toBeNull();
    expect(parseKeyStatement(canonical().replace('"min":"10000000"', '"min":"1.5"'))).toBeNull();
    expect(parseKeyStatement("nope")).toBeNull();
  });
});

describe("verifying a proof in the browser", () => {
  it("PASS for a good signature, the contract's minter, this key and the current owner", () => {
    const r = verifyKeyProof(link(share(canonical())), ctx());
    expect(r.verdict).toBe("pass");
    for (const c of r.checks) expect(c.pass, c.id).toBe(true);
  });

  it("FAIL on a bad signature: an edited statement", () => {
    const s = share(canonical());
    const edited = { ...s, statement: s.statement.replace('"holds_at_least":true', '"holds_at_least":false') };
    const r = verifyKeyProof(link(edited), ctx());
    expect(r.verdict).toBe("fail");
    expect(passOf(r, "signature")).toBe(false);
  });

  it("FAIL on a bad signature: a signature from another key", () => {
    const other = new Uint8Array(32).fill(3);
    const r = verifyKeyProof(link(share(canonical(), other)), ctx());
    expect(r.verdict).toBe("fail");
    expect(passOf(r, "signature")).toBe(false);
  });

  it("FAIL when the signer is not the contract's minter", () => {
    const r = verifyKeyProof(link(share(canonical())), ctx({ contractMinter: "00".repeat(32) }));
    expect(r.verdict).toBe("fail");
    expect(passOf(r, "minter")).toBe(false);
  });

  it("FAIL for a proof of another key", () => {
    const r = verifyKeyProof(link(share(canonical({ token_id: "kdeadbeefdeadbeef" }))), ctx());
    expect(r.verdict).toBe("fail");
    expect(passOf(r, "token")).toBe(false);
    expect(r.checks.find((c) => c.id === "token")?.detail).toContain("kdeadbeefdeadbeef");
  });

  it("FAIL with 'Owner changed since this proof' after a transfer", () => {
    const r = verifyKeyProof(link(share(canonical({ owner: "alice.near" }))), ctx({ chainOwner: "bob.near" }));
    expect(r.verdict).toBe("fail");
    const owner = r.checks.find((c) => c.id === "owner");
    expect(owner?.pass).toBe(false);
    expect(owner?.label).toBe("Owner changed since this proof");
  });

  it("is not PASS while the chain owner is still loading, and says so", () => {
    const r = verifyKeyProof(link(share(canonical())), ctx({ chainOwner: undefined }));
    expect(r.verdict).toBe("pending");
    expect(passOf(r, "owner")).toBeNull();
  });

  it("is not PASS when the chain cannot be read, and never claims a signer it did not check", () => {
    const r = verifyKeyProof(link(share(canonical())), ctx({ chainOwner: null, contractMinter: null }));
    expect(r.verdict).toBe("unverified");
    expect(passOf(r, "owner")).toBeNull();
    expect(passOf(r, "minter")).toBeNull();
    expect(passOf(r, "signature")).toBe(true);
  });

  it("FAIL on malformed links, with every later check left unrun", () => {
    for (const raw of ["", "%%%", "abc", btoa("{}").replace(/=+$/, "")]) {
      const r = verifyKeyProof(raw, ctx());
      expect(r.verdict, raw).toBe("fail");
      expect(passOf(r, "decoded"), raw).toBe(false);
      expect(passOf(r, "signature"), raw).toBeNull();
    }
  });

  it("FAIL when the signed bytes are not a balance proof", () => {
    const r = verifyKeyProof(link(share('{"kind":"keyhole-pnl-v1","token_id":"k1"}')), ctx());
    expect(r.verdict).toBe("fail");
    expect(passOf(r, "statement")).toBe(false);
  });
});

describe("cooldown and seller lock from the enclave log", () => {
  const ev = (i: number, kind: string, owner: string, ts: number): KeyEvent => ({ i, hash: "h" + i, kind, owner, prev: "p", ts_ms: ts, detail_hash: "d" });
  const t0 = 1_800_000_000_000;

  it("cooldown is active for 10 minutes after the transfer row, then over", () => {
    const evs = [ev(0, "mint", "alice.near", t0 - 9e6), ev(1, "transfer", "bob.near", t0)];
    expect(cooldownFor(evs, "bob.near", t0 + TRANSFER_COOLDOWN_MS - 1)).toEqual({ state: "active", until: t0 + TRANSFER_COOLDOWN_MS });
    expect(cooldownFor(evs, "bob.near", t0 + TRANSFER_COOLDOWN_MS).state).toBe("over");
    expect(latestTransfer(evs)?.owner).toBe("bob.near");
  });

  it("no cooldown when the key was never transferred", () => {
    expect(cooldownFor([ev(0, "mint", "alice.near", t0)], "alice.near", t0 + 1).state).toBe("none");
  });

  it("unknown while the log has not recorded the current holder yet", () => {
    expect(cooldownFor([ev(0, "mint", "alice.near", t0)], "bob.near", t0).state).toBe("unknown");
    expect(cooldownFor([ev(0, "mint", "alice.near", t0)], null, t0).state).toBe("unknown");
  });

  it("a seller lock set by the current holder can run until 168 h after its row", () => {
    const evs = [ev(0, "mint", "alice.near", t0 - 1e6), ev(1, "lock", "alice.near", t0)];
    expect(lockFor(evs, "alice.near", t0 + 1)).toEqual({ state: "possible", endsBy: t0 + MAX_LOCK_MS });
    expect(lockFor(evs, "alice.near", t0 + MAX_LOCK_MS).state).toBe("ended");
  });

  it("a lock set by a previous holder does not bind the current one", () => {
    const evs = [ev(0, "mint", "alice.near", t0 - 1e6), ev(1, "lock", "alice.near", t0), ev(2, "transfer", "bob.near", t0 + 5)];
    expect(lockFor(evs, "bob.near", t0 + 6).state).toBe("none");
  });

  it("no lock when none was logged", () => {
    expect(lockFor([ev(0, "mint", "alice.near", t0)], "alice.near", t0).state).toBe("none");
  });
});

describe("age label", () => {
  const t = 1_800_000_000_000;
  it("reads plain ages and treats future times as just now", () => {
    expect(ageLabel(t, t + 30_000)).toBe("just now");
    expect(ageLabel(t, t + 5 * 60_000)).toBe("5 min ago");
    expect(ageLabel(t, t + 3 * 3_600_000)).toBe("3 h ago");
    expect(ageLabel(t, t + 3 * 86_400_000)).toBe("3 days ago");
    expect(ageLabel(t, t - 60_000)).toBe("just now");
  });
});
