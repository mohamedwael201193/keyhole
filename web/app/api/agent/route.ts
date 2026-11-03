import { NextResponse } from "next/server";
import { agentPath, drySwapBody, redact, type AgentRead } from "@/lib/agentApi";
import { createLimiter } from "@/lib/ratelimit";

// Server-side Agent API bridge. The key lives only in AGENT_API_KEY (Vercel env); reads are fixed paths and swaps are dry-only.
const limit = createLimiter(60, 60_000);
const no = (code: string, status: number) => NextResponse.json({ ok: false, error: { code } }, { status, headers: { "cache-control": "no-store" } });
const env = () => ({ base: process.env.AGENT_API_BASE_URL, key: process.env.AGENT_API_KEY, agent: process.env.AGENT_API_AGENT_ID });
const ip = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";

async function call(path: string, init?: RequestInit) {
  const { base, key } = env();
  if (!base || !key) return null;
  const r = await fetch(base + path, { ...init, headers: { "X-API-Key": key, "content-type": "application/json" }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  return { status: r.status, body: await r.json().catch(() => null) };
}

export async function GET(req: Request) {
  if (!limit(ip(req)).ok) return no("rate_limited", 429);
  const r = new URL(req.url).searchParams.get("r") ?? "";
  const p = agentPath(r, env().agent);
  if (!p) return no("bad_params", 400);
  try {
    const up = await call(p);
    if (!up) return no("config", 503);
    if (up.status !== 200) return no("upstream", 502);
    return NextResponse.json({ ok: true, r, body: redact(r as AgentRead, up.body) }, { headers: { "cache-control": "no-store" } });
  } catch { return no("upstream", 502); }
}

export async function POST(req: Request) {
  if (!limit(ip(req)).ok) return no("rate_limited", 429);
  const b = drySwapBody(await req.json().catch(() => ({})));
  const a = env().agent;
  if (!b || !a || !/^[0-9a-f]{64}$/.test(a)) return no("bad_params", 400);
  try {
    const up = await call(`/v1/agents/${a}/swap`, { method: "POST", body: JSON.stringify(b) });
    if (!up) return no("config", 503);
    if (up.status !== 200 || up.body?.dry !== true) return no("upstream", 502);
    return NextResponse.json({ ok: true, body: up.body }, { headers: { "cache-control": "no-store" } });
  } catch { return no("upstream", 502); }
}
