import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { buildMessage, freshNonce, payloadHash, toB64, verifyAuth, NEP413_TAG } from "@/lib/nep413";

// Reference construction copied from scripts/sign-and-call.js (accepted by the TEE on mainnet).
function reference(message: string, nonce: Buffer, recipient: string) {
  const sb = (s: string) => { const b = Buffer.from(s); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2147484061);
  return createHash("sha256").update(Buffer.concat([tag, sb(message), nonce, sb(recipient), Buffer.from([0])])).digest();
}

describe("NEP-413", () => {
  it("tag is 2^31 + 413", () => expect(NEP413_TAG).toBe(2 ** 31 + 413));
  it("payload hash equals the reference used against the live worker", () => {
    for (let i = 0; i < 25; i++) {
      const nonce = freshNonce();
      const m = buildMessage("quote", "alice.near", { amount: String(i), note: "ünïcödé ✓" });
      expect(Buffer.from(payloadHash(m, nonce, "keyhole"))).toEqual(reference(m, Buffer.from(nonce), "keyhole"));
    }
  });
  it("message is exactly {op, account_id, ts_ms, params}", () => {
    expect(JSON.parse(buildMessage("status", "a.near", {}, 1))).toEqual({ op: "status", account_id: "a.near", ts_ms: 1, params: {} });
  });
  it("fresh nonces are 32 bytes and unique", () => {
    const s = new Set(Array.from({ length: 200 }, () => toB64(freshNonce())));
    expect(s.size).toBe(200);
    expect(freshNonce().length).toBe(32);
  });
  it("rejects a nonce that is not 32 bytes", () => expect(() => payloadHash("x", new Uint8Array(31))).toThrow());
  it("verifyAuth accepts a good signature and rejects tampering", () => {
    const sk = ed25519.utils.randomSecretKey(); const pk = ed25519.getPublicKey(sk);
    const nonce = freshNonce(); const message = buildMessage("mint", "bob.near");
    const a = { account_id: "bob.near", public_key: "ed25519:" + bs58.encode(pk), signature: toB64(ed25519.sign(payloadHash(message, nonce), sk)), nonce: toB64(nonce), message, recipient: "keyhole" };
    expect(verifyAuth(a)).toBe(true);
    expect(verifyAuth({ ...a, message: message.replace("mint", "quote") })).toBe(false);
    expect(verifyAuth({ ...a, recipient: "evil" })).toBe(false);
    expect(verifyAuth({ ...a, nonce: toB64(freshNonce()) })).toBe(false);
    expect(verifyAuth({ ...a, public_key: "secp256k1:abc" })).toBe(false);
  });
});

