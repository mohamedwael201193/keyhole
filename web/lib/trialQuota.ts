import {
  GLOBAL_PER_DAY, GLOBAL_PER_HOUR, GUEST_PER_IP_HOUR, LIFETIME_GUESTS, LIFETIME_TX, MIN_LIQUID_YOCTO, TRIAL_DAY_MS, TRIAL_HOUR_MS,
} from "./trialPolicy";
import { SPONSOR_NONCE_BASE } from "./trialPublic";

export type IndexedCreate = { atMs: number; ok: boolean };

/**
 * Shared trial budget. `ipCreatesLastHour` is null when the per-IP store did not answer.
 * `ipStore: "chain"` means there is no Upstash: the hourly ceiling collapses to the per-IP cap
 * so several server instances cannot multiply it. An incomplete indexer read is not a count.
 */
export type QuotaFacts = {
  liquidYocto: bigint;
  nonce: bigint;
  createsLastHour: number;
  createsLastDay: number;
  lifetimeCreates: number;
  ipCreatesLastHour: number | null;
  ipStore: "upstash" | "chain";
  indexerComplete: boolean;
  /** Upstash INCR already includes this request. Indexer counts do not. */
  countsIncludeThis: boolean;
};

export type QuotaDecision = { ok: true } | { ok: false; status: 429 | 503; message: string; retryAfter?: number };

const FALLBACK = " Verify a recorded call at /verify, or use the KEYHOLE CLI.";
/** Both must be set for per-address limits. Neither set uses the on-chain ceiling. One without the other is refused. */
export const QUOTA_STORE_VARS = "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN";

function over(n: number, cap: number, includeThis: boolean): boolean {
  return includeThis ? n > cap : n >= cap;
}

/** Transactions this key has signed since it was created. A nonce below the pinned base is not this key. */
export function sponsorNonceSpent(nonce: bigint, base = SPONSOR_NONCE_BASE): bigint | null {
  if (nonce < base) return null;
  return nonce - base;
}

export function judgeQuota(facts: QuotaFacts): QuotaDecision {
  if (facts.liquidYocto < MIN_LIQUID_YOCTO) {
    return { ok: false, status: 503, message: "The sponsor balance is below the trial floor." };
  }
  const spent = sponsorNonceSpent(facts.nonce);
  if (spent == null) {
    return { ok: false, status: 503, message: "The sponsor key nonce is not the recorded trial key." };
  }
  if (spent >= BigInt(LIFETIME_TX) || over(facts.lifetimeCreates, LIFETIME_GUESTS, facts.countsIncludeThis)) {
    return { ok: false, status: 429, message: `The trial lifetime ceiling is spent.${FALLBACK}` };
  }
  if (over(facts.createsLastDay, GLOBAL_PER_DAY, facts.countsIncludeThis)) {
    return { ok: false, status: 429, message: `The trial daily ceiling is spent. Try again in about 24 hours.${FALLBACK}`, retryAfter: 86_400 };
  }
  if (over(facts.createsLastHour, GLOBAL_PER_HOUR, facts.countsIncludeThis)) {
    return { ok: false, status: 429, message: `The trial hourly ceiling is spent. Try again in about 60 minutes.${FALLBACK}`, retryAfter: 3_600 };
  }
  if (facts.ipStore === "upstash") {
    if (facts.ipCreatesLastHour == null) {
      return { ok: false, status: 503, message: "The shared trial quota is unavailable." };
    }
    if (facts.ipCreatesLastHour > GUEST_PER_IP_HOUR) {
      return { ok: false, status: 429, message: `Too many testnet trials from this network. Try again in about 60 minutes.${FALLBACK}`, retryAfter: 3_600 };
    }
  }
  if (!facts.indexerComplete && facts.ipStore === "chain") {
    return { ok: false, status: 503, message: "The shared trial quota is unavailable." };
  }
  return { ok: true };
}

/** Counts only successful creates. A page that stops inside the window is incomplete. */
export function countCreates(rows: IndexedCreate[], now: number, complete: boolean): { hour: number; day: number; life: number; complete: boolean } {
  let hour = 0;
  let day = 0;
  let life = 0;
  for (const row of rows) {
    if (!row.ok) continue;
    life += 1;
    if (now - row.atMs <= TRIAL_DAY_MS) day += 1;
    if (now - row.atMs <= TRIAL_HOUR_MS) hour += 1;
  }
  return { hour, day, life, complete };
}

type UpstashReply = { result?: number | string | null; error?: string }[];

/** Atomic INCR + EXPIRE NX. A transport error is unavailable, never a local counter. */
export async function upstashIncr(url: string, token: string, key: string, ttlSec: number, fetchImpl: typeof fetch): Promise<number> {
  const r = await fetchImpl(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify([["INCR", key], ["EXPIRE", key, String(ttlSec), "NX"]]),
    cache: "no-store",
    signal: AbortSignal.timeout(4_000),
  });
  if (!r.ok) throw new Error("quota store");
  const body = await r.json() as UpstashReply;
  const n = Number(body?.[0]?.result);
  if (!Number.isInteger(n) || n < 1 || body?.[0]?.error) throw new Error("quota store");
  return n;
}

export type QuotaStore = { url: string; token: string } | null | "invalid";

/** `null` means both vars are unset (on-chain ceiling). `"invalid"` means a partial or bad pair, which fails closed. */
export function upstashConfig(env: Record<string, string | undefined>): QuotaStore {
  const url = env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "";
  if (!url && !token) return null;
  if (!url || !token || !/^https:\/\/[a-z0-9.-]+$/i.test(url)) return "invalid";
  return { url, token };
}

/** Read a counter without incrementing it. A missing key is zero. */
export async function upstashGet(url: string, token: string, key: string, fetchImpl: typeof fetch): Promise<number> {
  const r = await fetchImpl(`${url.replace(/\/$/, "")}/get/${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(4_000),
  });
  if (!r.ok) throw new Error("quota store");
  const body = await r.json() as { result?: unknown; error?: string };
  if (body.error) throw new Error("quota store");
  if (body.result == null) return 0;
  const n = Number(body.result);
  if (!Number.isInteger(n) || n < 0) throw new Error("quota store");
  return n;
}
