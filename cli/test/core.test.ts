import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import bs58 from "bs58";
import { nep413Bytes, signRequest, keyFromString, fmt, explainPnl } from "../src/core.ts";

const secret = new Uint8Array(32).fill(1);
const key = keyFromString("alice.near", "ed25519:" + bs58.encode(secret));

test("nep413 layout matches the worker", () => {
  const b = nep413Bytes("hi", new Uint8Array(32).fill(7), "app");
  assert.deepEqual([...b.slice(0, 4)], [0x9d, 0x01, 0x00, 0x80]); // 2147484061 LE
  assert.equal(b.length, 50);
  assert.equal(b[49], 0);
});

test("signature verifies over sha256(payload)", () => {
  const a = signRequest(key, "status", {}, "keyhole", 1000);
  const msg = sha256(nep413Bytes(a.message, Buffer.from(a.nonce, "base64"), a.recipient));
  const pub = bs58.decode(a.public_key.slice(8));
  assert.ok(ed25519.verify(Buffer.from(a.signature, "base64"), msg, pub));
  assert.deepEqual(JSON.parse(a.message), { op: "status", account_id: "alice.near", ts_ms: 1000, params: {} });
});

test("fresh nonce every request", () => {
  assert.notEqual(signRequest(key, "status").nonce, signRequest(key, "status").nonce);
});

test("64-byte near-cli secret keys accepted", () => {
  const full = new Uint8Array([...secret, ...ed25519.getPublicKey(secret)]);
  assert.equal(keyFromString("a.near", "ed25519:" + bs58.encode(full)).publicKey, key.publicKey);
});

test("formatting and pnl", () => {
  assert.equal(fmt("nep141:wrap.near", "2163123975702494577005"), "0.002163123975702494577005 wNEAR");
  assert.equal(fmt("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "10000"), "0.01 USDC");
  const s = explainPnl([{ kind: "swap", status: "success", usd_in_micro: 10000, ts_ms: 0, token_in: "nep141:wrap.near", amount_in: "1", token_out: "x", amount_out: "2" }], []);
  assert.match(s, /\$0\.01/);
});

