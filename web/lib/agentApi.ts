// Server-side Agent API (agentsonintents) helpers. Reads only; swaps are always dry. Pure parts are unit-tested.
import { assetById } from "./oneclick";

export const AGENT_READS = ["network", "whoami", "quotas", "policy"] as const;
export type AgentRead = (typeof AGENT_READS)[number];

/** Fixed upstream paths only; the agent id comes from server env, never from the caller. */
export function agentPath(r: string, agentId: string | undefined): string | null {
  if (!(AGENT_READS as readonly string[]).includes(r)) return null;
  if (r === "policy") return agentId && /^[0-9a-f]{64}$/.test(agentId) ? `/v1/agents/${agentId}/policy` : null;
  return `/v1/${r}`;
}

/** Build a dry swap body; refuses anything off the KEYHOLE asset list, and `dry` cannot be turned off. */
export function drySwapBody(b: { origin?: unknown; dest?: unknown; amount?: unknown }) {
  const o = typeof b.origin === "string" ? assetById(b.origin) : undefined;
  const d = typeof b.dest === "string" ? assetById(b.dest) : undefined;
  if (!o || !d || o.id === d.id || typeof b.amount !== "string" || !/^(?!0+$)[0-9]{1,30}$/.test(b.amount)) return null;
  return { origin_asset: o.id, destination_asset: d.id, amount: b.amount, dry: true as const };
}

const short = (h: unknown) => (typeof h === "string" ? `${h.slice(0, 6)}…` : null);
/** Strip identifiers before anything reaches the browser: ids are shortened, wallet ids dropped. */
export function redact(r: AgentRead | "swap", body: any): unknown {
  if (!body || typeof body !== "object") return body;
  if (r === "whoami") return { api_key_id: short(body.api_key_id), tenant_id: short(body.tenant_id) };
  if (r === "policy") { const { wallet_id: _w, ...rest } = body; return rest; }
  return body;
}

/** Policy codes a live swap would hit, from a dry quote's warnings (balance warnings are expected: nothing is funded). */
export const policyWarnings = (q: any): string[] =>
  (Array.isArray(q?.warnings) ? q.warnings : []).map((w: any) => String(w?.code ?? "")).filter((c: string) => c.startsWith("policy_") || c.startsWith("budget"));

/** Balance codes from a dry quote (e.g. insufficient_balance). Shown, never hidden: the demo agent is unfunded. */
export const balanceWarnings = (q: any): string[] =>
  (Array.isArray(q?.warnings) ? q.warnings : []).map((w: any) => String(w?.code ?? "")).filter((c: string) => /balance|insufficient|fund/i.test(c) && !c.startsWith("policy_") && !c.startsWith("budget"));

/** Env names the Agent API bridge needs. Values stay on the server. */
export function missingAgentEnv(env: { base?: string; key?: string; agent?: string }, read: string): string[] {
  const missing: string[] = [];
  if (!env.base) missing.push("AGENT_API_BASE_URL");
  if (!env.key) missing.push("AGENT_API_KEY");
  if (read === "policy" && !/^[0-9a-f]{64}$/.test(env.agent ?? "")) missing.push("AGENT_API_AGENT_ID");
  return missing;
}

const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numMap = (v: unknown): v is Record<string, number> => rec(v) && Object.values(v).every(num);

/** A network body the panel can render. Anything else is unavailable. */
export function networkBody(v: unknown): { network: string; status: { overall: string } } | null {
  if (!rec(v) || typeof v.network !== "string" || !rec(v.status) || typeof v.status.overall !== "string") return null;
  return { network: v.network, status: { overall: v.status.overall } };
}

/** Quota counters the panel prints. A 200 with a different shape is not a quota. */
export function quotasBody(v: unknown): { limits: Record<string, number>; usage: Record<string, number> } | null {
  if (!rec(v) || !numMap(v.limits) || !numMap(v.usage)) return null;
  const limits = v.limits as Record<string, number>;
  const usage = v.usage as Record<string, number>;
  if (!num(limits.daily_agents) || !num(limits.requests_per_minute) || !num(usage.agents_last_24_hours) || !num(usage.requests_this_minute)) return null;
  return { limits, usage };
}

export type PolicyView = {
  revision: number;
  status: string;
  policy_hash?: string;
  transaction_hash?: string;
  policy: {
    limits: { per_transaction: Record<string, number>; daily: Record<string, number> };
    budget: { daily_usd: string | number };
    actions: string[];
    destinations: { mode: string; list: unknown[] };
  };
};

/** A policy body with the fields the table reads. A bare `{ policy: {} }` is refused. */
export function policyBody(v: unknown): PolicyView | null {
  if (!rec(v) || !num(v.revision) || typeof v.status !== "string" || !rec(v.policy)) return null;
  const p = v.policy;
  if (!rec(p.limits) || !numMap(p.limits.per_transaction) || !numMap(p.limits.daily)) return null;
  if (!rec(p.budget) || (typeof p.budget.daily_usd !== "string" && !num(p.budget.daily_usd))) return null;
  if (!Array.isArray(p.actions) || !p.actions.every((a) => typeof a === "string")) return null;
  if (!rec(p.destinations) || typeof p.destinations.mode !== "string" || !Array.isArray(p.destinations.list)) return null;
  return {
    revision: v.revision,
    status: v.status,
    policy_hash: typeof v.policy_hash === "string" ? v.policy_hash : undefined,
    transaction_hash: typeof v.transaction_hash === "string" ? v.transaction_hash : undefined,
    policy: {
      limits: { per_transaction: p.limits.per_transaction as Record<string, number>, daily: p.limits.daily as Record<string, number> },
      budget: { daily_usd: p.budget.daily_usd as string | number },
      actions: p.actions,
      destinations: { mode: p.destinations.mode, list: p.destinations.list },
    },
  };
}

/** A read the upstream refused. HTTP stays 200 so the page can show the state without a failed-request console error. */
export function agentUnavailable(kind: "upstream" | "timeout" | "config", extra?: { upstream_status?: number; missing?: string[] }) {
  const error: { code: string; upstream_status?: number; missing?: string[] } = { code: kind };
  if (extra?.upstream_status !== undefined) error.upstream_status = extra.upstream_status;
  if (extra?.missing?.length) error.missing = extra.missing;
  return { ok: false as const, error };
}

/** Key-order-independent JSON, so a live policy can be compared with the builder's output. */
export const canon = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as any)[k])}`).join(",")}}` : JSON.stringify(v);
