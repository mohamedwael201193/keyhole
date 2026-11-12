import { NextResponse } from "next/server";
import { fetchLiveRegistry } from "@/lib/liveRegistry";
import { createLimiter } from "@/lib/ratelimit";
import { clientIp } from "@/lib/verifyScore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const limit = createLimiter(30, 60_000);

const no = (code: string, status: number) =>
  NextResponse.json({ ok: false, error: { code } }, { status, headers: { "cache-control": "no-store" } });

/**
 * Live OutLayer registry row for this project: the active worker wasm sha256.
 * Public chain data only. Used by the dashboard to verify a call against what is published now,
 * so a worker republish does not require a web pin update.
 */
export async function GET(req: Request) {
  if (!limit(clientIp(req.headers)).ok) return no("rate_limited", 429);
  try {
    const row = await fetchLiveRegistry();
    return NextResponse.json(
      { ok: true, ...row },
      { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=30" } },
    );
  } catch {
    return no("registry", 503);
  }
}
