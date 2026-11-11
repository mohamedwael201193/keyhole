import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { CHALLENGE_TTL_MS, ReplaySet, gateMessage, issueChallenge, verifyGate, type GateDeps } from "@/lib/holderGate";
import { payloadHash, toB64 } from "@/lib/nep413";

const SECRET = "test-secret-not-used-in-production";
const ACCOUNT = "holder.near";
const NOW = 1_800_000_000_000;
const seed = (n: number) => new Uint8Array(32).fill(n);
const holderSeed = seed(7);
const holderPk = "ed25519:" + bs58.encode(ed25519.getPublicKey(holderSeed));
const otherSeed = seed(9);
const otherPk = "ed25519:" + bs58.encode(ed25519.getPublicKey(otherSeed));

/** A wallet signature over the NEP-413 payload, exactly as the gate verifies it. */
function signIntent(challenge: string, opts: { account?: string; key?: Uint8Array; publicKey?: string; tsMs?: number; message?: string } = {}) {
  const account = opts.account ?? ACCOUNT;
  const message = opts.message ?? gateMessage(account, challenge, opts.tsMs ?? NOW);
  const nonce = new Uint8Array(32).fill(3);
  const sig = ed25519.sign(payloadHash(message, nonce, "keyhole"), opts.key ?? holderSeed);
  return { account_id: account, public_key: opts.publicKey ?? holderPk, signature: toB64(sig), nonce: toB64(nonce), message, recipient: "keyhole" };
}

function deps(over: Partial<{ access: unknown; supply: number; tier: number | null; tokens: string[] }> = {}): GateDeps {
  const access = "access" in over ? over.access : "FullAccess";
  return {
    viewAccessKey: async () => (access === null ? null : { permission: access }),
    nftSupply: async () => over.supply ?? 1,
    holderTier: async () => ("tier" in over ? over.tier! : 2),
    tokensForOwner: async () => over.tokens ?? ["k5f4750858f328940"],
  };
}

describe("holder gate challenge", () => {
  it("binds the challenge to the account and to an expiry", () => {
    const c = issueChallenge(ACCOUNT, NOW, SECRET, () => "id-1");
    expect(c.expires_ms).toBe(NOW + CHALLENGE_TTL_MS);
    expect(c.challenge.split(".")).toHaveLength(2);
  });
  it.each(["", "A", "Holder.near", "../x", "has space.near"])("refuses to issue for %j", (bad) => {
    expect(() => issueChallenge(bad, NOW, SECRET)).toThrow(/bad account/);
  });
});

describe("holder gate verification", () => {
  it("grants a live FullAccess holder and returns tier and key ids", async () => {
    const { challenge } = issueChallenge(ACCOUNT, NOW, SECRET, () => "grant-1");
    const r = await verifyGate({ challenge, auth: signIntent(challenge) }, deps(), SECRET, new ReplaySet(), NOW + 1000);
    expect(r).toEqual({ granted: true, tier: 2, account_id: ACCOUNT, token_ids: ["k5f4750858f328940"] });
  });

  it("refuses a replay of the same signed challenge (single use)", async () => {
    const replay = new ReplaySet();
    const { challenge } = issueChallenge(ACCOUNT, NOW, SECRET, () => "rep-1");
    const auth = signIntent(challenge);
    expect(await verifyGate({ challenge, auth }, deps(), SECRET, replay, NOW + 1000)).toMatchObject({ granted: true });
    expect(await verifyGate({ challenge, auth }, deps(), SECRET, replay, NOW + 2000)).toEqual({ granted: false, reason: "replayed" });
  });

  it("refuses an expired challenge", async () => {
    const { challenge, expires_ms } = issueChallenge(ACCOUNT, NOW, SECRET, () => "exp-1");
    const r = await verifyGate({ challenge, auth: signIntent(challenge, { tsMs: NOW }) }, deps(), SECRET, new ReplaySet(), expires_ms + 1);
    expect(r).toEqual({ granted: false, reason: "expired" });
  });

  it("refuses a signature from a different key than the one named", async () => {
    const { challenge } = issueChallenge(ACCOUNT, NOW, SECRET, () => "wk-1");
    // The auth names the holder key but was signed by another key.
    const auth = signIntent(challenge, { key: otherSeed, publicKey: holderPk });
    expect(await verifyGate({ challenge, auth }, deps(), SECRET, new ReplaySet(), NOW + 1000)).toEqual({ granted: false, reason: "bad_signature" });
  });

  it("refuses a real signature by a key that is not FullAccess on the account", async () => {
    const { challenge } = issueChallenge(ACCOUNT, NOW, SECRET, () => "fa-1");
    const auth = signIntent(challenge, { key: otherSeed, publicKey: otherPk });
    const r = await verifyGate({ challenge, auth }, deps({ access: { FunctionCall: { receiver_id: "x.near", method_names: [] } } }), SECRET, new ReplaySet(), NOW + 1000);
    expect(r).toEqual({ granted: false, reason: "not_full_access" });
  });

  it("refuses a key that is not on the account at all", async () => {
    const { challenge } = issueChallenge(ACCOUNT, NOW, SECRET, () => "nk-1");
    const r = await verifyGate({ challenge, auth: signIntent(challenge) }, deps({ access: null }), SECRET, new ReplaySet(), NOW + 1000);
    expect(r).toEqual({ granted: false, reason: "not_full_access" });
  });

  it("refuses an account that holds no key", async () => {
    const { challenge } = issueChallenge(ACCOUNT, NOW, SECRET, () => "nh-1");
    expect(await verifyGate({ challenge, auth: signIntent(challenge) }, deps({ supply: 0, tier: null }), SECRET, new ReplaySet(), NOW + 1000)).toEqual({ granted: false, reason: "not_holder" });
  });

  it("refuses when the key count is positive but holder_tier is missing", async () => {
    const { challenge } = issueChallenge(ACCOUNT, NOW, SECRET, () => "nt-1");
    expect(await verifyGate({ challenge, auth: signIntent(challenge) }, deps({ tier: null }), SECRET, new ReplaySet(), NOW + 1000)).toEqual({ granted: false, reason: "not_holder" });
  });

  it("refuses a signed intent for another account than the challenge", async () => {
    const { challenge } = issueChallenge(ACCOUNT, NOW, SECRET, () => "wa-1");
    const auth = signIntent(challenge, { account: "other.near" });
    expect(await verifyGate({ challenge, auth }, deps(), SECRET, new ReplaySet(), NOW + 1000)).toEqual({ granted: false, reason: "wrong_account" });
  });

  it("refuses a challenge that was not issued with this secret", async () => {
    const { challenge } = issueChallenge(ACCOUNT, NOW, "another-secret", () => "fs-1");
    expect(await verifyGate({ challenge, auth: signIntent(challenge) }, deps(), SECRET, new ReplaySet(), NOW + 1000)).toEqual({ granted: false, reason: "bad_challenge" });
  });

  it("refuses an intent whose message names a different challenge", async () => {
    const { challenge } = issueChallenge(ACCOUNT, NOW, SECRET, () => "mc-1");
    const other = issueChallenge(ACCOUNT, NOW, SECRET, () => "mc-2").challenge;
    const auth = signIntent(challenge, { message: gateMessage(ACCOUNT, other, NOW) });
    expect(await verifyGate({ challenge, auth }, deps(), SECRET, new ReplaySet(), NOW + 1000)).toEqual({ granted: false, reason: "bad_intent" });
  });

  it("refuses a missing or malformed auth object", async () => {
    const { challenge } = issueChallenge(ACCOUNT, NOW, SECRET, () => "ma-1");
    for (const auth of [null, "x", {}, { account_id: ACCOUNT }]) {
      expect(await verifyGate({ challenge, auth }, deps(), SECRET, new ReplaySet(), NOW + 1000)).toEqual({ granted: false, reason: "bad_intent" });
    }
  });

  it("does not spend the challenge on a bad auth shape, so the holder can retry", async () => {
    const replay = new ReplaySet();
    const { challenge } = issueChallenge(ACCOUNT, NOW, SECRET, () => "rt-1");
    expect(await verifyGate({ challenge, auth: {} }, deps(), SECRET, replay, NOW + 1000)).toMatchObject({ reason: "bad_intent" });
    expect(await verifyGate({ challenge, auth: signIntent(challenge) }, deps(), SECRET, replay, NOW + 1000)).toMatchObject({ granted: true });
  });
});

describe("replay set", () => {
  it("forgets entries after their expiry and keeps live ones", () => {
    const s = new ReplaySet();
    expect(s.take("a", 100, 0)).toBe(true);
    expect(s.take("a", 100, 50)).toBe(false);
    expect(s.take("b", 300, 200)).toBe(true);
    expect(s.size).toBe(1);
  });
});
