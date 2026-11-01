// Public key history: the TEE's hash-chained event log for one NFT, re-verified in the browser.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

export type KeyEvent = { i: number; hash: string; kind: string; owner: string; prev: string; ts_ms: number; detail_hash: string };
export type KeyLogBody = { token_id: string; head: string; sig: string; minter: string; events: KeyEvent[] };
export type Holder = { owner: string; from_ms: number; to_ms: number | null; deposits: number; withdraws: number; trades: number; other: number };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/** Same bytes as the worker's event_canonical (fixed field order). */
export function eventCanonical(e: KeyEvent, tokenId: string): string {
  return `{"detail_hash":"${e.detail_hash}","i":${e.i},"kind":"${e.kind}","owner":"${e.owner}","prev":"${e.prev}","token_id":"${tokenId}","ts_ms":${e.ts_ms}}`;
}
export const eventHash = (e: KeyEvent, tokenId: string) => hex(sha256(new TextEncoder().encode(eventCanonical(e, tokenId))));

export type ChainCheck = { chain: boolean; head: boolean; sig: boolean; minter: boolean; badAt: number | null };
export function checkLog(b: KeyLogBody, expectedMinter: string): ChainCheck {
  let prev = "0".repeat(64); let badAt: number | null = null;
  b.events.forEach((e, idx) => {
    if (badAt !== null) return;
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
