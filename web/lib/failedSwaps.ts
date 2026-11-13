"use client";
import type { HistEntry } from "./dashboard";

/**
 * Failed swap attempts, recorded in this browser so they are not invisible. The enclave's signed history only lists
 * operations the enclave recorded; a swap refused before sending (or one whose outcome is unknown) has no entry
 * there, so the swap page and the Activity page showed no trace of it at all. A recorded attempt is shown as a
 * Failed row in both places, with its own call id linking to /verify?call=.
 *
 * Scoped per account in sessionStorage (gone when the tab closes, like the session). The entry is the same shape as
 * a signed history row (kind "swap", status "failed", base-unit amounts), so the existing rows render it. The
 * amount out is null: nothing was received. At most 10 attempts are kept per account; recording the same call id
 * twice is a no-op.
 */

export type FailedSwap = {
  /**
   * The failed attempt's own call id: the proof link, and the dedupe key. When the gateway never returned one
   * (a timeout before the worker answered, so the web has no call to verify), this is a local id
   * (`local:<time>:<random>`, see localFailedId) and `local` is true: the row is shown as Failed with no proof
   * link, because there is no call to verify — the attempt is traceable by its amount and time, not by a call.
   */
  callId: string;
  entry: HistEntry;
  /** The worker error code of the attempt (native_unknown for a refusal, or the real code). */
  code: string;
  /** True when `callId` is a local id, not an enclave call: no /verify link exists for this attempt. */
  local?: boolean;
};

/** A local id for a failed attempt the gateway never gave a call id for. Not an enclave call. */
export function localFailedId(now = Date.now()): string {
  return `local:${now.toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

/** Whether an id is a local failed-attempt id (no enclave call behind it), not a real call id. */
export function isLocalFailedId(id: string | null | undefined): boolean {
  return !!id && id.startsWith("local:");
}

const PREFIX = "kh_failed_swaps_v1:";
const MAX_KEPT = 10;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function sessionStore(): Store | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

function keyFor(accountId: string): string {
  return `${PREFIX}${accountId}`;
}

function validEntry(j: unknown): j is FailedSwap {
  if (!j || typeof j !== "object") return false;
  const f = j as Partial<FailedSwap>;
  return typeof f.callId === "string" && f.callId.length > 0
    && !!f.entry && typeof f.entry === "object"
    && (f.entry as HistEntry).kind === "swap"
    && (f.entry as HistEntry).status === "failed"
    && typeof f.code === "string";
}

/** The failed swaps recorded for one account, newest first. Never throws. */
export function listFailedSwaps(accountId: string | null | undefined, store: Store | null = sessionStore()): FailedSwap[] {
  if (!accountId || !store) return [];
  try {
    const raw = store.getItem(keyFor(accountId));
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter(validEntry);
  } catch {
    return [];
  }
}

/** Record one failed attempt. A repeat of the same call id is ignored. */
export function recordFailedSwap(accountId: string | null | undefined, f: FailedSwap, store: Store | null = sessionStore()): void {
  if (!accountId || !store || !validEntry(f)) return;
  const list = listFailedSwaps(accountId, store);
  if (list.some((x) => x.callId === f.callId)) return;
  const next = [f, ...list].slice(0, MAX_KEPT);
  try { store.setItem(keyFor(accountId), JSON.stringify(next)); } catch { /* blocked storage: the card still shows the failure */ }
}

/** Drop the recorded failures for one account (used when the account signs out). */
export function clearFailedSwaps(accountId: string | null | undefined, store: Store | null = sessionStore()): void {
  if (!accountId || !store) return;
  try { store.removeItem(keyFor(accountId)); } catch { /* blocked storage */ }
}
