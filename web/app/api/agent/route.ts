import { clientIp } from "@/lib/verifyScore";
import { NextResponse } from "next/server";
import { agentPath, agentUnavailable, drySwapBody, missingAgentEnv, redact, type AgentRead } from "@/lib/agentApi";
import { createLimiter } from "@/lib/ratelimit";

// Server-side Agent API bridge. The key lives only in AGENT_API_KEY (Vercel env); reads are fixed paths and swaps are dry-only.
// A refused upstream read is HTTP 200 with ok:false, so the page can show a clean state. The browser console does not record a 502.
const limit = createLimiter(60, 60_000);
const no = (code: string, status: number) => NextResponse.json({ ok: false, error: { code } }, { status, headers: { "cache-control": "no-store" } });
const okBody = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
const env = () => ({ base: process.env.AGENT_API_BASE_URL, key: process.env.AGENT_API_KEY, agent: process.env.AGENT_API_AGENT_ID });
const ip = (req: Request) => clientIp(req.headers);

async function call(path: string, init?: RequestInit) {
  const { base, key } = env();
  if (!base || !key) return null;
  const r = await fetch(base + path, { ...init, headers: { "X-API-Key": key, "content-type": "application/json" }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  return { status: r.status, body: await r.json().catch(() => null) as { dry?: boolean } | null };
}

function unavailable(kind: "upstream" | "timeout" | "config", extra?: { upstream_status?: number; missing?: string[] }) {
  return okBody(agentUnavailable(kind, extra));
}

export async function GET(req: Request) {
  if (!limit(ip(req)).ok) return no("rate_limited", 429);
  const r = new URL(req.url).searchParams.get("r") ?? "";
  const missing = missingAgentEnv(env(), r);
  if (missing.length) return unavailable("config", { missing });
  const p = agentPath(r, env().agent);
  if (!p) return no("bad_params", 400);
  try {
    const up = await call(p);
    if (!up) return unavailable("config", { missing: missingAgentEnv(env(), r) });
    if (up.status !== 200) return unavailable("upstream", { upstream_status: up.status });
    return okBody({ ok: true, r, body: redact(r as AgentRead, up.body) });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return unavailable(name === "TimeoutError" || name === "AbortError" ? "timeout" : "upstream");
  }
}

export async function POST(req: Request) {
  if (!limit(ip(req)).ok) return no("rate_limited", 429);
  const b = drySwapBody(await req.json().catch(() => ({})));
  const a = env().agent;
  const missing = missingAgentEnv(env(), "policy");
  if (!b) return no("bad_params", 400);
  if (missing.length || !a) return unavailable("config", { missing: missing.length ? missing : ["AGENT_API_AGENT_ID"] });
  try {
    const up = await call(`/v1/agents/${a}/swap`, { method: "POST", body: JSON.stringify(b) });
    if (!up) return unavailable("config", { missing: missingAgentEnv(env(), "policy") });
    if (up.status !== 200 || up.body?.dry !== true) return unavailable("upstream", { upstream_status: up.status });
    return okBody({ ok: true, body: up.body });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return unavailable(name === "TimeoutError" || name === "AbortError" ? "timeout" : "upstream");
  }
}
