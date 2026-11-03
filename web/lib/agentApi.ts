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

/** Key-order-independent JSON, so a live policy can be compared with the builder's output. */
export const canon = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as any)[k])}`).join(",")}}` : JSON.stringify(v);
