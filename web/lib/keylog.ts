// Public key history: the TEE's hash-chained event log for one NFT, re-verified in the browser.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

export type KeyEvent = { i: number; hash: string; kind: string; owner: string; prev: string; ts_ms: number; detail_hash: string; v?: number; contract?: string; owner_epoch?: number; detail?: string; blinding_nonce?: string };
export type KeyLogBody = { token_id: string; head: string; sig: string; minter: string; events: KeyEvent[] };
export type Holder = { owner: string; from_ms: number; to_ms: number | null; deposits: number; withdraws: number; trades: number; other: number };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/** Same bytes as the worker's event_canonical (fixed field order). */
export function eventCanonical(e: KeyEvent, tokenId: string): string {
  if(e.v===2) return JSON.stringify({contract:e.contract,detail_hash:e.detail_hash,i:e.i,kind:e.kind,owner:e.owner,owner_epoch:e.owner_epoch,prev:e.prev,token_id:tokenId,ts_ms:e.ts_ms,v:2});
  return `{"detail_hash":"${e.detail_hash}","i":${e.i},"kind":"${e.kind}","owner":"${e.owner}","prev":"${e.prev}","token_id":"${tokenId}","ts_ms":${e.ts_ms}}`;
}
export const eventHash = (e: KeyEvent, tokenId: string) => hex(sha256(new TextEncoder().encode(eventCanonical(e, tokenId))));

/** An authorized opening verifies exact UTF-8 bytes; public logs need neither secret field. */
export function checkOpening(e: KeyEvent, tokenId: string): boolean {
  if (e.detail == null) return false;
  if ((e.v ?? 1) === 1) return hex(sha256(new TextEncoder().encode(e.detail))) === e.detail_hash;
  if (e.v !== 2 || !/^[0-9a-f]{64}$/.test(e.blinding_nonce ?? "") || !e.contract || !Number.isSafeInteger(e.owner_epoch)) return false;
  try {
    const text=(s:string)=>new TextEncoder().encode(s);
    const num=(n:number)=>{if(!Number.isSafeInteger(n)||n<0)throw Error("u64"); const b=new Uint8Array(8);new DataView(b.buffer).setBigUint64(0,BigInt(n),true);return b;};
    const lp=(s:string)=>{const b=text(s);return [num(b.length),b];};
    const chunks=[text("KEYHOLE_EVENT_DETAIL_V2\0"),...lp(e.contract),...lp(tokenId),num(e.i),num(e.owner_epoch!),...lp(e.kind),...lp(e.owner),num(e.ts_ms),...lp(e.prev),fromHex(e.blinding_nonce!),...lp(e.detail)];
    const bytes=new Uint8Array(chunks.reduce((n,b)=>n+b.length,0));let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}
    return hex(sha256(bytes))===e.detail_hash;
  } catch { return false; }
}

export type ChainCheck = { chain: boolean; head: boolean; sig: boolean; minter: boolean; badAt: number | null };
export function checkLog(b: KeyLogBody, expectedMinter: string): ChainCheck {
  let prev = "0".repeat(64); let badAt: number | null = null;
  b.events.forEach((e, idx) => {
    if (badAt !== null) return;
    if (e.v != null && e.v !== 1 && e.v !== 2) { badAt=idx; return; }
    if (e.detail != null && !checkOpening(e, b.token_id)) { badAt=idx; return; }
    const h = eventHash(e, b.token_id);
    if (e.i !== idx || e.prev !== prev || e.hash !== h) badAt = idx; else prev = h;
  });
  const head = badAt === null && prev === b.head;
  let sig = false;
  try { sig = ed25519.verify(fromHex(b.sig), new TextEncoder().encode(b.head), fromHex(b.minter)); } catch { sig = false; }
  return { chain: badAt === null, head, sig, minter: b.minter.toLowerCase() === expectedMinter.toLowerCase(), badAt };
}

const TRADE = new Set(["swap", "copy", "trade"]);
/** Holder periods in order. A holder's period ends when the next owner's first event appears. */
export function holders(events: KeyEvent[]): Holder[] {
  const out: Holder[] = [];
  for (const e of events) {
    let cur = out[out.length - 1];
    if (!cur || cur.owner !== e.owner) {
      if (cur) cur.to_ms = e.ts_ms;
      cur = { owner: e.owner, from_ms: e.ts_ms, to_ms: null, deposits: 0, withdraws: 0, trades: 0, other: 0 };
      out.push(cur);
    }
    if (e.kind === "deposit") cur.deposits++;
    else if (e.kind === "withdraw") cur.withdraws++;
    else if (TRADE.has(e.kind)) cur.trades++;
    else cur.other++;
  }
  return out;
}
export const short = (a: string) => (a.length > 20 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
