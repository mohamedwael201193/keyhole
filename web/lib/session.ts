"use client";
/**
 * App session per NEAR's documented backend-auth pattern:
 * https://docs.near.org/web3-apps/backend/backend#backend-auth-with-a-near-wallet
 * The wallet signs ONE NEP-413 message (op "session"); the enclave verifies it like any signed request and
 * issues a random token. Later requests carry that token instead of a new wallet signature.
 *
 * Shared across the browser's tabs: the token lives in localStorage (not sessionStorage), so unlocking once
 * unlocks every tab, and a BroadcastChannel + storage event tells the other tabs at once. The 30-minute expiry
 * and the scope limits are unchanged and still enforced by the enclave — a tab that opens after the token
 * expired finds nothing, and a stolen token still cannot withdraw (withdraw is not a session op: it always
 * asks the wallet for a fresh signature). The trade-off is explicit: unlike sessionStorage, the token is not
 * sealed when one tab closes; it lives until its 30-minute expiry, and locking (clearSession) removes it
 * everywhere at once.
 */
import { freshNonce, toB64 } from "./nep413";
import { decimalEpoch, guardedValueOp, type ContractProfile } from "./guardedRequest";
import { NEP413_RECIPIENT } from "./config";
import { clearVaultCache } from "./vaultCache";

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
/** The localStorage key for the shared session token (exported for the cross-tab storage listener). */
export const SESSION_KEY = "kh_session_v1";
const KEY = SESSION_KEY;

/** The shared session store: localStorage, so unlocking in one tab unlocks every tab of this browser. */
function defaultStore(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  if (typeof localStorage !== "undefined") return localStorage;
  return sessionStorage;
}

const CHANNEL_NAME = "keyhole-session-v1";
/** Tell the other tabs the session was saved or cleared (the 30 s re-read is the fallback). Never throws. */
function broadcast(action: "saved" | "cleared") {
  try {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    ch.postMessage({ action });
    ch.close();
  } catch { /* no BroadcastChannel: the storage event / 30 s re-read still picks it up */ }
}

/** Listen for a session save/clear in another tab. Returns an unsubscribe. Never throws. */
export function onSessionBroadcast(cb: (action: "saved" | "cleared") => void): () => void {
  try {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    const onMsg = (e: MessageEvent) => { if (e.data?.action === "saved" || e.data?.action === "cleared") cb(e.data.action); };
    ch.addEventListener("message", onMsg);
    return () => { ch.removeEventListener("message", onMsg); ch.close(); };
  } catch { return () => {}; }
}

function validGrant(s: Session): boolean {
  if (s.profile === "v2.4") return s.owner_epoch == null;
  return decimalEpoch(s.owner_epoch);
}

export function loadSession(account: string | null, now = Date.now(), store: Pick<Storage, "getItem" | "removeItem"> = defaultStore()): Session | null {
  if (!account) return null;
  try {
    const s = JSON.parse(store.getItem(KEY) || "null") as Session | null;
    if (!s || typeof s.token !== "string" || s.account !== account || !validGrant(s) || !(s.exp_ms > now + 5_000)) { if (s) store.removeItem(KEY); return null; }
    return s;
  } catch { store.removeItem(KEY); return null; }
}
export function saveSession(s: Session, store: Pick<Storage, "setItem"> = defaultStore()) { store.setItem(KEY, JSON.stringify(s)); broadcast("saved"); }
/** Forgetting the session also forgets the cached vault reads it scoped: a locked tab shows sealed values again. */
export function clearSession(store: Pick<Storage, "removeItem"> = defaultStore()) { store.removeItem(KEY); clearVaultCache(); broadcast("cleared"); }

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
