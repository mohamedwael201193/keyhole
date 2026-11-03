"use client";
/**
 * App session per NEAR's documented backend-auth pattern:
 * https://docs.near.org/web3-apps/backend/backend#backend-auth-with-a-near-wallet
 * The wallet signs ONE NEP-413 message (op "session"); the enclave verifies it like any signed request and
 * issues a random token. Later requests carry that token instead of a new wallet signature.
 * Kept in sessionStorage (gone when the tab closes). Scope and expiry are enforced by the enclave.
 */
import { freshNonce, toB64 } from "./nep413";
import { NEP413_RECIPIENT } from "./config";

export const SESSION_TTL_MS = 30 * 60 * 1000;
/** Default spend cap a session asks for: $5. Tier and holder caps still apply inside the enclave. */
export const SESSION_CAP_USD_MICRO = 5_000_000;
/** Must match SESSION_OPS in tee/worker/src/lib.rs. */
export const SESSION_OPS = ["status", "quote", "account", "balance", "swap", "copy", "withdraw", "history", "pnl", "limits", "dashboard", "session_revoke"] as const;
export type SessionOp = (typeof SESSION_OPS)[number];
export const inSession = (op: string): op is SessionOp => (SESSION_OPS as readonly string[]).includes(op);

export type Session = { token: string; account: string; token_id: string; exp_ms: number; max_usd_micro: number };
const KEY = "kh_session_v1";

export function loadSession(account: string | null, now = Date.now(), store: Pick<Storage, "getItem" | "removeItem"> = sessionStorage): Session | null {
  if (!account) return null;
  try {
    const s = JSON.parse(store.getItem(KEY) || "null") as Session | null;
    if (!s || typeof s.token !== "string" || s.account !== account || !(s.exp_ms > now + 5_000)) { if (s) store.removeItem(KEY); return null; }
    return s;
  } catch { store.removeItem(KEY); return null; }
}
export function saveSession(s: Session, store: Pick<Storage, "setItem"> = sessionStorage) { store.setItem(KEY, JSON.stringify(s)); }
export function clearSession(store: Pick<Storage, "removeItem"> = sessionStorage) { store.removeItem(KEY); }

/** Session-mode auth for one call. The enclave consumes the nonce once (replay protection). */
export function sessionAuth(s: Session, op: SessionOp, params: Record<string, unknown> = {}, now = Date.now()) {
  const message = JSON.stringify({ op, account_id: s.account, ts_ms: now, params });
  return { scheme: "session", token: s.token, message, nonce: toB64(freshNonce()), recipient: NEP413_RECIPIENT };
}

/** The params the wallet signs to start a session. */
export const sessionParams = (tokenId: string) => ({ token_id: tokenId, ttl_ms: SESSION_TTL_MS, max_usd_micro: SESSION_CAP_USD_MICRO });

export const minutesLeft = (s: Session | null, now = Date.now()) => (s ? Math.max(0, Math.ceil((s.exp_ms - now) / 60_000)) : 0);
