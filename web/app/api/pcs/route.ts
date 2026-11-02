import { NextResponse } from "next/server";
import { pcsUpstream } from "@/lib/pcs";
import { createLimiter } from "@/lib/ratelimit";

// Same-origin pass-through to Intel PCS (Intel sends no CORS headers). Fixed upstream URLs only;
// the browser verifies every signature against the pinned Intel root, so this route cannot change a result.
// Upstream fetches are cached for an hour (revalidate), so a generous per-IP window costs Intel nothing; each /verify load makes 4 reads.
const limit = createLimiter(240, 60_000);
const no = (code: string, status: number) => NextResponse.json({ ok: false, error: { code } }, { status, headers: { "cache-control": "no-store" } });

export async function GET(req: Request) {
  if (!limit(req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon").ok) return no("rate_limited", 429);
  const u = new URL(req.url);
  const up = pcsUpstream(u.searchParams.get("r") ?? "", u.searchParams.get("fmspc"));
  if (!up) return no("bad_params", 400);
  try {
    const r = await fetch(up.url, { headers: { "user-agent": "keyhole/1.0" }, signal: AbortSignal.timeout(15_000), next: { revalidate: 3600 } });
    if (!r.ok) return no("upstream", 502);
    const buf = new Uint8Array(await r.arrayBuffer());
    const body = up.binary ? Buffer.from(buf).toString("base64") : new TextDecoder().decode(buf);
    const chain = up.chainHeader ? r.headers.get(up.chainHeader) ?? "" : "";
    return NextResponse.json({ ok: true, body, chain }, { headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch { return no("upstream", 502); }
}
