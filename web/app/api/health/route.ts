import { NextResponse } from "next/server";
import { getHealth } from "@/lib/health";
import { createLimiter } from "@/lib/ratelimit";
import { clientIp } from "@/lib/verifyScore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const limit = createLimiter(30, 60_000);

export async function GET(req: Request) {
  const r = limit(clientIp(req.headers));
  if (!r.ok) return NextResponse.json({ ok: false, error: { code: "rate_limited" } }, { status: 429, headers: { "retry-after": String(r.retryAfter) } });
  return NextResponse.json(await getHealth(), { headers: { "cache-control": "no-store" } });
}

/** There is no HTTP paid-probe capability: the public route has a permanent zero budget.
 * Even an old deployment flag/body cannot authorize a provider execution. */
export async function POST() {
  return NextResponse.json({
    ok: false,
    error: { code: "probe_disabled", message: "Health is passive. Paid probes are not available over HTTP." },
  }, { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
}
