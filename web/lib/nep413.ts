import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { NEP413_RECIPIENT } from "./config";

export type Op = "info" | "status" | "quote" | "mint" | "account" | "balance" | "history" | "swap" | "withdraw" | "limits";
export const NEP413_TAG = 2147484061; // 2^31 + 413

export interface SignedAuth {
  account_id: string;
  public_key: string;
  signature: string; // base64 for NEP-413, 0x hex for eip191
  nonce: string; // base64, 32 bytes
  message: string;
  recipient: string;
  scheme?: "eip191";
  address?: string;
}

/** The published enclave 38bd67b9 verifies scheme eip191. */
export const EIP191_ENCLAVE_LIVE: boolean = true;

/** Intent JSON signed by personal_sign. Same fields the worker parses for scheme eip191. */
export function intentMessage(op: Op, accountId: string, params: Record<string, unknown>, nonceB64: string, recipient: string, ts: number): string {
  return JSON.stringify({ op, account_id: accountId, ts_ms: ts, params, nonce: nonceB64, recipient });
}

/** UTF-8 message as 0x hex, the form personal_sign expects. */
export function utf8ToHex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** The exact message the worker re-parses: JSON {op, account_id, ts_ms, params}. */
export function buildMessage(op: Op, accountId: string, params: Record<string, unknown> = {}, now = Date.now()): string {
  return JSON.stringify({ op, account_id: accountId, ts_ms: now, params });
}

/** Fresh 32-byte nonce for every request; never reused. */
export function freshNonce(): Uint8Array {
  const n = new Uint8Array(32);
  crypto.getRandomValues(n);
  return n;
}

const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const borshString = (s: string) => { const e = new TextEncoder().encode(s); return concat(u32(e.length), e); };
function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** NEP-413 payload hash: sha256(borsh(tag u32) ++ borsh(Payload{message, nonce[32], recipient, callbackUrl: None})). */
export function payloadHash(message: string, nonce: Uint8Array, recipient = NEP413_RECIPIENT): Uint8Array {
  if (nonce.length !== 32) throw new Error("nonce must be 32 bytes");
  return sha256(concat(u32(NEP413_TAG), borshString(message), nonce, borshString(recipient), new Uint8Array([0])));
}

export const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Local pre-flight: the same check the TEE runs (minus the on-chain key lookup). */
export function verifyAuth(a: SignedAuth): boolean {
  if (!a.public_key.startsWith("ed25519:")) return false;
  const pk = bs58.decode(a.public_key.slice(8));
  try { return ed25519.verify(fromB64(a.signature), payloadHash(a.message, fromB64(a.nonce), a.recipient), pk); }
  catch { return false; }
}
