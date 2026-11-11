#!/usr/bin/env node
// Recompute a KEYHOLE key log and check the enclave signature.
//   node verify-log.mjs --self-test
//   node verify-log.mjs log.json
//   node verify-log.mjs --proof proof.json   (output of the holder-signed `prove` op)
// log.json: { head, sig, minter, events: [{ i, prev, kind, token_id, owner, ts_ms, detail_hash, detail? }] }
// minter is the hex ed25519 public key (the minter's implicit account id).
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const zero = "0".repeat(64);
const sha = (s) => createHash("sha256").update(s).digest("hex");
export function detailHash(detail) { return sha(detail); }
const lp = (s) => { const b=Buffer.from(s,"utf8"); const n=Buffer.alloc(8); n.writeBigUInt64LE(BigInt(b.length)); return Buffer.concat([n,b]); };
const u64 = (n) => { const b=Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
export function blindedDetailHash(ev) {
  if (!/^[0-9a-f]{64}$/.test(ev.blinding_nonce||"")) throw Error("invalid event opening");
  return sha(Buffer.concat([Buffer.from("KEYHOLE_EVENT_DETAIL_V2\0"),lp(ev.contract),lp(ev.token_id),u64(ev.i),u64(ev.owner_epoch),lp(ev.kind),lp(ev.owner),u64(ev.ts_ms),lp(ev.prev),Buffer.from(ev.blinding_nonce,"hex"),lp(ev.detail)]));
}
export function canonical(ev) {
  if (ev.v === 2) return JSON.stringify({contract:ev.contract,detail_hash:ev.detail_hash,i:ev.i,kind:ev.kind,owner:ev.owner,owner_epoch:ev.owner_epoch,prev:ev.prev,token_id:ev.token_id,ts_ms:ev.ts_ms,v:2});
  return `{"detail_hash":"${ev.detail_hash}","i":${ev.i},"kind":"${ev.kind}","owner":"${ev.owner}","prev":"${ev.prev}","token_id":"${ev.token_id}","ts_ms":${ev.ts_ms}}`;
}
export function eventHash(ev) { return sha(canonical(ev)); }

export function checkLog(doc) {
  const events = doc.events || [];
  let prev = zero;
  for (let i = 0; i < events.length; i++) {
    const row = events[i];
    if (doc.token_id != null && row.token_id != null && row.token_id !== doc.token_id) return {ok:false,reason:"token_id"};
    const ev = {...row, token_id: row.token_id ?? doc.token_id};
    if (typeof ev.token_id !== "string") return {ok:false,reason:"token_id"};
    if (![1,2].includes(ev.v ?? 1)) return {ok:false,reason:"version"};
    try {
      if (ev.detail != null && (ev.v===2 ? blindedDetailHash(ev) : detailHash(ev.detail)) !== ev.detail_hash) return { ok: false, reason: "detail_hash" };
    } catch { return {ok:false,reason:"opening"}; }
    if (ev.i !== i || ev.prev !== prev) return { ok: false, reason: "chain" };
    prev = eventHash(ev);
    if (ev.hash != null && ev.hash !== prev) return {ok:false,reason:"event_hash"};
  }
  if (doc.head && doc.head !== prev) return { ok: false, reason: "head" };
  if (doc.sig && doc.minter) {
    const pub = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(doc.minter, "hex")]);
    const good = verify(null, Buffer.from(prev), { key: pub, format: "der", type: "spki" }, Buffer.from(doc.sig, "hex"));
    if (!good) return { ok: false, reason: "signature" };
  }
  return { ok: true, head: prev };
}

export function checkProof(doc) {
  const pub = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(doc.minter, "hex")]);
  const good = verify(null, Buffer.from(doc.statement), { key: pub, format: "der", type: "spki" }, Buffer.from(doc.sig, "hex"));
  if (!good) return { ok: false, reason: "signature" };
  const st = JSON.parse(doc.statement);
  if (st.kind !== "keyhole-balance-proof-v1") return { ok: false, reason: "kind" };
  return { ok: true, statement: st };
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
  const statement = JSON.stringify({ asset: "nep141:usdc", holds_at_least: true, kind: "keyhole-balance-proof-v1", locked_until_ms: 0, log_head: head, min: "1", owner: "alice.near", token_id: "kabc", ts_ms: 1 });
  const psig = sign(null, Buffer.from(statement), privateKey).toString("hex");
  if (!checkProof({ statement, sig: psig, minter: raw }).ok) { console.error("proof rejected"); process.exit(1); }
  if (checkProof({ statement: statement.replace("true", "false"), sig: psig, minter: raw }).ok) { console.error("tampered proof accepted"); process.exit(1); }
  const v2={i:0,prev:zero,kind:"withdraw",token_id:"k1",owner:"alice.near",ts_ms:10,v:2,contract:"keys.near",owner_epoch:7,blinding_nonce:"05".repeat(32),detail:"x"};
  v2.detail_hash=blindedDetailHash(v2);
  if (v2.detail_hash !== "41c6674c0053cd4edcc933ab251914fbf00b5a0dd72e57343f654d9bcf99a8e9") throw Error("v2 cross-language vector mismatch");
  const mixed={events:[v2],head:eventHash(v2)};
  if (!checkLog(mixed).ok || checkLog({events:[{...v2,detail:"y"}],head:mixed.head}).ok) throw Error("opening verification");
  const {token_id, ...projection}=v2;
  if (!checkLog({token_id,events:[projection],head:mixed.head}).ok) throw Error("worker projection rejected");
  if (checkLog({token_id:"k2",events:[v2]}).ok) throw Error("cross-token accepted");
  if (checkLog({events:[{...v2,blinding_nonce:"bad"}]}).ok) throw Error("malformed opening accepted");
  console.log("OK   verify-log self-test", head.slice(0, 16));
}

const arg = process.argv[2];
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!isMain) {
  // imported by the mutation verifier
} else if (arg === "--self-test") selfTest();
else if (arg === "--proof") {
  const res = checkProof(JSON.parse(readFileSync(process.argv[3], "utf8")));
  console.log(res.ok ? `OK   ${res.statement.owner} holds_at_least ${res.statement.min} ${res.statement.asset}: ${res.statement.holds_at_least} (locked_until_ms ${res.statement.locked_until_ms})` : `FAIL ${res.reason}`);
  process.exit(res.ok ? 0 : 1);
}
else if (arg) {
  const res = checkLog(JSON.parse(readFileSync(arg, "utf8")));
  console.log(res.ok ? `OK   head ${res.head}` : `FAIL ${res.reason}`);
  process.exit(res.ok ? 0 : 1);
} else {
  console.error("usage: node verify-log.mjs --self-test | log.json");
  process.exit(2);
}
