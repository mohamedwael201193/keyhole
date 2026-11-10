import { NextResponse } from "next/server";
import { getHealth, probeHealth } from "@/lib/health";
import { createLimiter } from "@/lib/ratelimit";
import { clientIp } from "@/lib/verifyScore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const limit = createLimiter(30, 60_000);
/** Body token required in addition to the server flag. The flag alone is not approval. */
const PROBE_APPROVAL = "spend-one-info-call";

export async function GET(req: Request) {
  const r = limit(clientIp(req.headers));
  if (!r.ok) return NextResponse.json({ ok: false, error: { code: "rate_limited" } }, { status: 429, headers: { "retry-after": String(r.retryAfter) } });
  return NextResponse.json(await getHealth(), { headers: { "cache-control": "no-store" } });
}

/** Opt-in probe. Off unless KEYHOLE_HEALTH_PROBE=1 and the body carries the approval token. */
export async function POST(req: Request) {
  const r = limit(clientIp(req.headers));
  if (!r.ok) return NextResponse.json({ ok: false, error: { code: "rate_limited" } }, { status: 429, headers: { "retry-after": String(r.retryAfter) } });
  const refused = NextResponse.json({
    ok: false,
    error: { code: "probe_not_approved", message: "An active health probe spends one info execution from the server OutLayer payment key. It is off until KEYHOLE_HEALTH_PROBE=1 and the approval token are both present." },
  }, { status: 403, headers: { "cache-control": "no-store" } });
  if (process.env.KEYHOLE_HEALTH_PROBE !== "1") return refused;
  const body = await req.json().catch(() => null) as { approve?: unknown } | null;
  if (body?.approve !== PROBE_APPROVAL) return refused;
  const health = await probeHealth();
  return NextResponse.json({
    ...health,
    budget: "one info execution on the server OutLayer payment key",
  }, { headers: { "cache-control": "no-store" } });
}
