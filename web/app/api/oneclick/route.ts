import { NextResponse } from "next/server";
import { dryBody, isAddr, QUOTE_PER_MIN, STATUS_PER_MIN } from "@/lib/oneclick";
import { createLimiter } from "@/lib/ratelimit";

// Dry-run quotes and status reads only. This route never creates an executable quote.
const OC = "https://1click.chaindefuser.com/v0";
const limit = createLimiter(QUOTE_PER_MIN, 60_000);
const statusLimit = createLimiter(STATUS_PER_MIN, 60_000);
const no = (code: string, status: number) => NextResponse.json({ ok: false, error: { code } }, { status, headers: { "cache-control": "no-store" } });
const ip = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
const headers = () => ({ "content-type": "application/json", "user-agent": "keyhole/1.0", ...(process.env.ONECLICK_API_KEY ? { authorization: `Bearer ${process.env.ONECLICK_API_KEY}` } : {}) });

export async function POST(req: Request) {
  if (!limit(ip(req)).ok) return no("rate_limited", 429);
  let b: { origin?: string; dest?: string; amount?: string };
  try { b = await req.json(); } catch { return no("bad_params", 400); }
  const body = dryBody({ origin: String(b.origin ?? ""), dest: String(b.dest ?? ""), amount: String(b.amount ?? "") });
  if (!body || body.dry !== true) return no("bad_params", 400);
  try {
    const r = await fetch(`${OC}/quote`, { method: "POST", headers: headers(), body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return NextResponse.json({ ok: false, error: { code: "quote_refused", message: String((j as { message?: string }).message ?? r.status).slice(0, 200) } }, { status: 200 });
    const q = (j as { quote?: Record<string, unknown> }).quote ?? {};
    const pick = ["amountInFormatted", "amountInUsd", "amountOutFormatted", "amountOutUsd", "minAmountOut", "timeEstimate"] as const;
    return NextResponse.json({ ok: true, dry: true, quote: Object.fromEntries(pick.map((k) => [k, q[k] ?? null])) }, { headers: { "cache-control": "no-store" } });
  } catch { return no("upstream", 502); }
}

export async function GET(req: Request) {
  if (!statusLimit(ip(req)).ok) return no("rate_limited", 429);
  const a = new URL(req.url).searchParams.get("depositAddress") ?? "";
  if (!isAddr(a)) return no("bad_params", 400);
  try {
    const r = await fetch(`${OC}/status?depositAddress=${encodeURIComponent(a)}`, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return no("not_found", 404);
    const j = (await r.json()) as { status?: string; updatedAt?: string; swapDetails?: Record<string, unknown> };
    const s = j.swapDetails ?? {};
    return NextResponse.json({ ok: true, status: j.status, updatedAt: j.updatedAt, details: {
      depositedAmountFormatted: s.depositedAmountFormatted ?? null, amountOutFormatted: s.amountOutFormatted ?? null, refundedAmountFormatted: s.refundedAmountFormatted ?? null,
      nearTxHashes: s.nearTxHashes ?? [], intentHashes: s.intentHashes ?? [], destinationChainTxHashes: s.destinationChainTxHashes ?? [], originChainTxHashes: s.originChainTxHashes ?? [],
    } }, { headers: { "cache-control": "no-store" } });
  } catch { return no("upstream", 502); }
}
