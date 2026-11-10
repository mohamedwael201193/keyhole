"use client";
/**
 * App session per NEAR's documented backend-auth pattern:
 * https://docs.near.org/web3-apps/backend/backend#backend-auth-with-a-near-wallet
 * The wallet signs ONE NEP-413 message (op "session"); the enclave verifies it like any signed request and
 * issues a random token. Later requests carry that token instead of a new wallet signature.
 * Kept in sessionStorage (gone when the tab closes). Scope and expiry are enforced by the enclave.
 */
import { freshNonce, toB64 } from "./nep413";
import { decimalEpoch, guardedValueOp, type ContractProfile } from "./guardedRequest";
import { NEP413_RECIPIENT } from "./config";

export const SESSION_TTL_MS = 30 * 60 * 1000;
/** Default spend cap a session asks for: $5. Tier and holder caps still apply inside the enclave. */
export const SESSION_CAP_USD_MICRO = 5_000_000;
/**
 * Must match SESSION_OPS in tee/worker/src/lib.rs. Withdraw is not here: a withdraw always asks the wallet for a
 * fresh NEP-413 or EIP-191 signature, so a stolen session token cannot move funds out of the account.
 */
export const SESSION_OPS = ["status", "quote", "account", "balance", "swap", "copy", "history", "pnl", "limits", "dashboard", "level_up", "session_revoke"] as const;
export type SessionOp = (typeof SESSION_OPS)[number];
export const inSession = (op: string): op is SessionOp => (SESSION_OPS as readonly string[]).includes(op);

export type Session = { token: string; account: string; token_id: string; exp_ms: number; max_usd_micro: number; owner_epoch?: string; profile?: ContractProfile };
const KEY = "kh_session_v1";

function validGrant(s: Session): boolean {
  if (s.profile === "v2.4") return s.owner_epoch == null;
  return decimalEpoch(s.owner_epoch);
}

export function loadSession(account: string | null, now = Date.now(), store: Pick<Storage, "getItem" | "removeItem"> = sessionStorage): Session | null {
  if (!account) return null;
  try {
    const s = JSON.parse(store.getItem(KEY) || "null") as Session | null;
    if (!s || typeof s.token !== "string" || s.account !== account || !validGrant(s) || !(s.exp_ms > now + 5_000)) { if (s) store.removeItem(KEY); return null; }
    return s;
  } catch { store.removeItem(KEY); return null; }
}
export function saveSession(s: Session, store: Pick<Storage, "setItem"> = sessionStorage) { store.setItem(KEY, JSON.stringify(s)); }
export function clearSession(store: Pick<Storage, "removeItem"> = sessionStorage) { store.removeItem(KEY); }

/** A worker grant. v2.5 returns owner_epoch. Live v2.4 omits it; the caller must already have proved that profile. Epoch zero is never filled in. */
export function sessionFromGrant(output: { ok?: boolean; session_token?: unknown; account?: unknown; token_id?: unknown; exp_ms?: unknown; max_usd_micro?: unknown; owner_epoch?: unknown }, tokenId: string, profile: ContractProfile): Session | null {
  if (!output?.ok || typeof output.session_token !== "string" || typeof output.account !== "string") return null;
  const exp_ms = Number(output.exp_ms);
  const max_usd_micro = Number(output.max_usd_micro);
  if (!Number.isFinite(exp_ms) || !Number.isFinite(max_usd_micro)) return null;
  const base = { token: output.session_token, account: output.account, token_id: String(output.token_id ?? tokenId), exp_ms, max_usd_micro };
  if (decimalEpoch(output.owner_epoch)) {
    if (profile === "v2.4") return null;
    return { ...base, owner_epoch: output.owner_epoch, profile: "v2.5" };
  }
  if (profile !== "v2.4" || output.owner_epoch != null) return null;
  return { ...base, profile: "v2.4" };
}

/** Session-mode auth for one call. The enclave consumes the nonce once (replay protection). */
export function sessionAuth(s: Session, op: SessionOp, params: Record<string, unknown> = {}, now = Date.now()) {
  const legacy = s.profile === "v2.4" && !decimalEpoch(s.owner_epoch);
  if (!legacy && !decimalEpoch(s.owner_epoch)) throw new Error("session_epoch: unlock again");
  if (guardedValueOp(op, params)) {
    if (legacy) {
      if (params.owner_epoch !== undefined || (params.token_id !== undefined && params.token_id !== s.token_id)) throw new Error("session_epoch: unlock again");
      params = { ...params, token_id: s.token_id };
      delete params.owner_epoch;
    } else {
      if ((params.token_id !== undefined && params.token_id !== s.token_id) || (params.owner_epoch !== undefined && params.owner_epoch !== s.owner_epoch)) throw new Error("session_epoch: unlock again");
      params = { ...params, token_id: s.token_id, owner_epoch: s.owner_epoch };
    }
  }
  const message = JSON.stringify({ op, account_id: s.account, ts_ms: now, params });
  return { scheme: "session", token: s.token, message, nonce: toB64(freshNonce()), recipient: NEP413_RECIPIENT };
}

/** The params the wallet signs to start a session. */
export const sessionParams = (tokenId: string) => ({ token_id: tokenId, ttl_ms: SESSION_TTL_MS, max_usd_micro: SESSION_CAP_USD_MICRO });

export const minutesLeft = (s: Session | null, now = Date.now()) => (s ? Math.max(0, Math.ceil((s.exp_ms - now) / 60_000)) : 0);
