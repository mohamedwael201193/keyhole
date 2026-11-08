import { NextResponse } from "next/server";
import { clientIp } from "@/lib/verifyScore";
import { depositQuoteBody } from "@/lib/oneclick";
import { createLimiter } from "@/lib/ratelimit";

// Executable 1Click quote for "fund the vault from another chain". It only names a deposit address; the holder sends from
// their own wallet and nothing moves here. Dry quotes stay on /api/oneclick.
const OC = "https://1click.chaindefuser.com/v0";
const limit = createLimiter(6, 60_000);
const no = (code: string, status: number) => NextResponse.json({ ok: false, error: { code } }, { status, headers: { "cache-control": "no-store" } });
const key = () => process.env.ONECLICK_API_KEY || process.env.KEYHOLE_ONECLICK_KEY || "";

export async function POST(req: Request) {
  if (!limit(clientIp(req.headers)).ok) return no("rate_limited", 429);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return no("bad_params", 400); }
  const body = depositQuoteBody({
    origin: String(b.origin ?? ""), originChain: String(b.originChain ?? ""), dest: b.dest === "wnear" ? "wnear" : "usdc",
    amount: String(b.amount ?? ""), recipient: String(b.recipient ?? ""), refundTo: String(b.refundTo ?? "").trim(),
  });
  if (!body) return no("bad_params", 400);
  try {
    const k = key();
    const r = await fetch(`${OC}/quote`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "keyhole/1.0", ...(k ? { authorization: `Bearer ${k}` } : {}) }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const j = (await r.json().catch(() => ({}))) as { quote?: Record<string, unknown> };
    const q = j.quote ?? {};
    if (!r.ok || typeof q.depositAddress !== "string") return NextResponse.json({ ok: false, error: { code: "quote_refused" } }, { headers: { "cache-control": "no-store" } });
    const pick = ["depositAddress", "depositMemo", "amountInFormatted", "amountInUsd", "amountOutFormatted", "minAmountIn", "timeEstimate", "deadline", "timeWhenInactive"] as const;
    return NextResponse.json({ ok: true, quote: Object.fromEntries(pick.map((x) => [x, q[x] ?? null])) }, { headers: { "cache-control": "no-store" } });
  } catch { return no("upstream", 502); }
}
