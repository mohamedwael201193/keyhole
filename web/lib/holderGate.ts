/**
 * Holder gate: proves that the caller holds a key right now, with a fresh wallet signature.
 *
 * Flow (server-issued, single-use challenge):
 *  1. GET  /api/gate?account_id=A  -> { challenge, expires_ms }. The challenge is an HMAC-signed token that names A,
 *     a random id and an expiry (CHALLENGE_TTL_MS). Nothing is stored for issuing.
 *  2. The wallet signs (NEP-413, recipient "keyhole") the intent {op:"holder_gate", account_id, ts_ms, params:{challenge}}.
 *  3. POST /api/gate { challenge, auth } -> verify:
 *       token HMAC and expiry; account matches; the id has not been used (single use, in-process replay set);
 *       the NEP-413 signature verifies for the public key the auth names;
 *       that key is a FullAccess key of A (view_access_key, final), the same rule tee/worker main.rs authenticate uses;
 *       nft_supply_for_owner(A) > 0 and holder_tier(A) is a tier.
 *
 * Every dependency is injected so the rules are unit-tested without the network (web/tests/holder-gate.test.ts).
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { verifyAuth, type SignedAuth } from "./nep413";
import { NEP413_RECIPIENT } from "./config";

export const CHALLENGE_TTL_MS = 120_000;
export const GATE_OP = "holder_gate";

export type GateDeps = {
  viewAccessKey: (account: string, publicKey: string) => Promise<{ permission: unknown } | null>;
  nftSupply: (account: string) => Promise<number>;
  holderTier: (account: string) => Promise<number | null>;
  tokensForOwner: (account: string) => Promise<string[]>;
};

export type GateResult =
  | { granted: true; tier: number; account_id: string; token_ids: string[] }
  | { granted: false; reason: GateReason };

export type GateReason = "bad_challenge" | "wrong_account" | "expired" | "replayed" | "bad_intent" | "bad_signature" | "not_full_access" | "not_holder";

const enc = new TextEncoder();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/** Valid NEAR account ids: named (lowercase, digits, . - _) or implicit (64 hex). */
export const ACCOUNT_RE = /^(?=.{2,64}$)([a-z0-9]+[-_.])*[a-z0-9]+$|^[0-9a-f]{64}$/;

function mac(secret: string, payload: string): string {
  return hex(hmac(sha256, enc.encode(secret), enc.encode(payload)));
}

/** Issues a challenge for one account. Stateless: the HMAC binds it to the account and expiry. */
export function issueChallenge(account: string, nowMs: number, secret: string, rand: () => string = randomHex): { challenge: string; expires_ms: number } {
  if (!ACCOUNT_RE.test(account)) throw new Error("bad account");
  const expires = nowMs + CHALLENGE_TTL_MS;
  const payload = b64u(JSON.stringify({ a: account, i: rand(), e: expires }));
  return { challenge: `${payload}.${mac(secret, payload)}`, expires_ms: expires };
}

export function randomHex(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return hex(b);
}

/** Single-use replay set. Entries are kept until their challenge would have expired anyway. */
export class ReplaySet {
  private seen = new Map<string, number>();
  /** Returns true when the id is fresh and records it; false when it was already used. */
  take(id: string, expiresMs: number, nowMs: number): boolean {
    for (const [k, exp] of this.seen) if (exp < nowMs) this.seen.delete(k);
    if (this.seen.has(id)) return false;
    this.seen.set(id, expiresMs);
    return true;
  }
  get size(): number { return this.seen.size; }
}

/** The intent the wallet must sign. Built from the challenge, so a signature cannot be reused for another request. */
export function gateMessage(account: string, challenge: string, tsMs: number): string {
  return JSON.stringify({ op: GATE_OP, account_id: account, ts_ms: tsMs, params: { challenge } });
}

export async function verifyGate(input: { challenge: unknown; auth: unknown }, deps: GateDeps, secret: string, replay: ReplaySet, nowMs: number): Promise<GateResult> {
  const deny = (reason: GateReason): GateResult => ({ granted: false, reason });
  const ch = typeof input.challenge === "string" ? input.challenge : "";
  const [payload, tag] = ch.split(".");
  if (!payload || !tag || mac(secret, payload) !== tag) return deny("bad_challenge");
  let c: { a: string; i: string; e: number };
  try { c = JSON.parse(unb64u(payload)); } catch { return deny("bad_challenge"); }
  if (!c || typeof c.a !== "string" || typeof c.i !== "string" || typeof c.e !== "number") return deny("bad_challenge");

  const a = input.auth as Partial<SignedAuth> | null;
  if (!a || typeof a !== "object" || typeof a.account_id !== "string" || typeof a.public_key !== "string" || typeof a.signature !== "string" ||
      typeof a.nonce !== "string" || typeof a.message !== "string" || typeof a.recipient !== "string") return deny("bad_intent");
  if (a.account_id !== c.a) return deny("wrong_account");
  if (nowMs > c.e) return deny("expired");
  if (!replay.take(c.i, c.e, nowMs)) return deny("replayed");

  let intent: { op?: unknown; account_id?: unknown; ts_ms?: unknown; params?: { challenge?: unknown } };
  try { intent = JSON.parse(a.message); } catch { return deny("bad_intent"); }
  if (intent.op !== GATE_OP || intent.account_id !== c.a || intent.params?.challenge !== ch) return deny("bad_intent");
  if (typeof intent.ts_ms !== "number" || intent.ts_ms > nowMs + 60_000 || intent.ts_ms < c.e - CHALLENGE_TTL_MS) return deny("bad_intent");
  if (a.recipient !== NEP413_RECIPIENT) return deny("bad_intent");
  if (a.message !== gateMessage(c.a, ch, intent.ts_ms)) return deny("bad_intent");

  let signed = false;
  try { signed = verifyAuth(a as SignedAuth); } catch { signed = false; }
  if (!signed) return deny("bad_signature");

  const ak = await deps.viewAccessKey(c.a, a.public_key);
  if (!ak || ak.permission !== "FullAccess") return deny("not_full_access");

  const supply = await deps.nftSupply(c.a);
  if (!(supply > 0)) return deny("not_holder");
  const tier = await deps.holderTier(c.a);
  if (tier === null || tier === undefined) return deny("not_holder");
  return { granted: true, tier, account_id: c.a, token_ids: await deps.tokensForOwner(c.a) };
}
