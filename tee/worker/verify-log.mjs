#!/usr/bin/env node
// Recompute a KEYHOLE key log and check the enclave signature.
//   node verify-log.mjs --self-test
//   node verify-log.mjs log.json
// log.json: { head, sig, minter, events: [{ i, prev, kind, token_id, owner, ts_ms, detail_hash, detail? }] }
// minter is the hex ed25519 public key (the minter's implicit account id).
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";

const zero = "0".repeat(64);
const sha = (s) => createHash("sha256").update(s).digest("hex");
export function detailHash(detail) { return sha(detail); }
export function canonical(ev) {
  return `{"detail_hash":"${ev.detail_hash}","i":${ev.i},"kind":"${ev.kind}","owner":"${ev.owner}","prev":"${ev.prev}","token_id":"${ev.token_id}","ts_ms":${ev.ts_ms}}`;
}
export function eventHash(ev) { return sha(canonical(ev)); }

export function checkLog(doc) {
  const events = doc.events || [];
  let prev = zero;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.detail != null && detailHash(ev.detail) !== ev.detail_hash) return { ok: false, reason: "detail_hash" };
    if (ev.i !== i || ev.prev !== prev) return { ok: false, reason: "chain" };
    prev = eventHash(ev);
  }
  if (doc.head && doc.head !== prev) return { ok: false, reason: "head" };
  if (doc.sig && doc.minter) {
    const pub = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(doc.minter, "hex")]);
    const good = verify(null, Buffer.from(prev), { key: pub, format: "der", type: "spki" }, Buffer.from(doc.sig, "hex"));
    if (!good) return { ok: false, reason: "signature" };
  }
  return { ok: true, head: prev };
}

function selfTest() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const detail = "mint";
  const ev = { i: 0, prev: zero, kind: "mint", token_id: "kabc", owner: "alice.near", ts_ms: 10, detail_hash: detailHash(detail), detail };
  const head = eventHash(ev);
  const sig = sign(null, Buffer.from(head), privateKey);
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const res = checkLog({ head, sig: sig.toString("hex"), minter: raw, events: [ev] });
  if (!res.ok) { console.error(res); process.exit(1); }
  const bad = checkLog({ head, sig: sig.toString("hex"), minter: raw, events: [{ ...ev, owner: "bob.near" }] });
  if (bad.ok) { console.error("tamper accepted"); process.exit(1); }
  console.log("OK   verify-log self-test", head.slice(0, 16));
}

const arg = process.argv[2];
if (arg === "--self-test") selfTest();
else if (arg) {
  const res = checkLog(JSON.parse(readFileSync(arg, "utf8")));
  console.log(res.ok ? `OK   head ${res.head}` : `FAIL ${res.reason}`);
  process.exit(res.ok ? 0 : 1);
} else {
  console.error("usage: node verify-log.mjs --self-test | log.json");
  process.exit(2);
}
