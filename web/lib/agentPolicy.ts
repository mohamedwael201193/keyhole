// Maps KEYHOLE holder caps onto an Agent API (agentsonintents) Policy. Pure; unit-tested in tests/agentPolicy.test.ts.
import { OC_ASSETS } from "./oneclick";

/** Same numbers as the enclave's `limits_for_tier` (tee/worker/src/lib.rs). */
export const TIER_CAPS = {
  1: { per_tx_usd_micro: 1_000_000, daily_usd_micro: 5_000_000, per_minute_calls: 6 },
  2: { per_tx_usd_micro: 10_000_000, daily_usd_micro: 50_000_000, per_minute_calls: 12 },
  3: { per_tx_usd_micro: 100_000_000, daily_usd_micro: 500_000_000, per_minute_calls: 30 },
} as const;
export type Tier = keyof typeof TIER_CAPS;

export type Destination = { chain: string; address: string; memo?: string | null };
export type HolderInput = {
  tier: number;
  /** Holder's own limits (USD micro); a value above the tier cap is clamped down, never up. */
  per_tx_usd_micro?: number;
  daily_usd_micro?: number;
  /** Withdraw targets the agent may use. Empty means no withdrawals at all. */
  destinations?: Destination[];
  /** Assets the agent may hold or trade; defaults to the 1Click list KEYHOLE already supports. */
  assets?: string[];
};

/** USD stablecoins with 6 decimals, where 1 base unit = 1 USD micro, so per-asset limits are exact. */
export const USD6 = OC_ASSETS.filter((a) => a.label.startsWith("USDC") && a.decimals === 6).map((a) => a.id);

const CHAIN = /^[a-z][a-z0-9_-]{0,63}$/;
/** USD micro -> "D.CC", rounded down to the cent (a budget never rounds up). */
export function usdString(micro: number): string {
  const cents = Math.floor(micro / 10_000);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function buildPolicy(h: HolderInput) {
  const caps = TIER_CAPS[h.tier as Tier];
  if (!caps) throw new Error("unknown tier");
  const pos = (v: number | undefined, cap: number) => {
    if (v === undefined) return cap;
    if (!Number.isSafeInteger(v) || v <= 0) throw new Error("limits must be positive integers (USD micro)");
    return Math.min(v, cap);
  };
  const perTx = pos(h.per_tx_usd_micro, caps.per_tx_usd_micro);
  const daily = pos(h.daily_usd_micro, caps.daily_usd_micro);
  if (perTx > daily) throw new Error("per-transaction limit above the daily limit");
  const assets = [...new Set(h.assets ?? OC_ASSETS.map((a) => a.id))];
  if (!assets.length || assets.length > 128 || assets.some((a) => !a || a.length > 256)) throw new Error("bad asset list");
  const dests = h.destinations ?? [];
  if (dests.length > 256) throw new Error("too many destinations");
  for (const d of dests) if (!CHAIN.test(d.chain) || !d.address || d.address.length > 256) throw new Error(`bad destination ${d.chain}`);
  const stable = USD6.filter((a) => assets.includes(a));
  const per = (n: number) => Object.fromEntries(stable.map((a) => [a, String(n)]));
  return {
    frozen: false,
    actions: dests.length ? ["swap", "withdraw"] : ["swap"],
    confidential: false,
    owner_approval: false,
    assets,
    limits: { per_transaction: per(perTx), daily: per(daily) },
    max_actions_per_hour: caps.per_minute_calls * 60,
    destinations: { mode: "only" as const, list: dests.map((d) => ({ action: "withdraw" as const, chain: d.chain, address: d.address, memo: d.memo ?? null })) },
    budget: { daily_usd: usdString(daily), weekly_usd: null, monthly_usd: null },
    timelock_ms: 0,
  };
}
export type AgentPolicy = ReturnType<typeof buildPolicy>;
