import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { JsonRpcProvider } from "near-api-js";
import { PrivySigner } from "@/lib/privySigner";

/** NEP-413 payload hash: sha256(borsh(tag=2^31+413, message, nonce[32], recipient, callbackUrl=None)). */
function nep413Hash(message: string, nonce: Uint8Array, recipient: string) {
  const enc = new TextEncoder();
  const str = (s: string) => { const b = enc.encode(s); const l = new Uint8Array(4); new DataView(l.buffer).setUint32(0, b.length, true); return [l, b]; };
  const tag = new Uint8Array(4); new DataView(tag.buffer).setUint32(0, 2 ** 31 + 413, true);
  const parts = [tag, ...str(message), nonce, ...str(recipient), new Uint8Array([0])];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return sha256(all);
}

describe("Privy signer (hello-privy pattern) produces a standard NEP-413 signature", () => {
  it("signature verifies against the implicit account's ed25519 key over the NEP-413 hash", async () => {
    const sk = ed25519.utils.randomSecretKey();
    const pk = ed25519.getPublicKey(sk);
    const implicit = bytesToHex(pk);
    // Stand-in for Privy signRawHash: ed25519 over the hash it is handed.
    const signRawHash = async ({ hash }: { hash: `0x${string}` }) => ({ signature: "0x" + bytesToHex(ed25519.sign(Uint8Array.from(Buffer.from(hash.slice(2), "hex")), sk)) });
    const s = new PrivySigner(signRawHash as never, implicit, new JsonRpcProvider({ url: "http://127.0.0.1:1" }));
    const nonce = new Uint8Array(32).fill(7);
    const message = JSON.stringify({ op: "session", account_id: implicit, ts_ms: 1 });
    const r = await s.signNep413Message(implicit, { message, recipient: "keyhole", nonce });
    expect(r.publicKey.toString()).toBe((await s.getPublicKey()).toString());
    expect(r.signature.length).toBe(64);
    expect(ed25519.verify(r.signature, nep413Hash(message, nonce, "keyhole"), pk)).toBe(true);
  });
});
