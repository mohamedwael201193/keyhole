import {PLEDGE_SANDBOX} from "@/lib/config";
import {sandboxProxy} from "@/lib/sandboxProxy";
import { clientIp, safeAttPath } from "@/lib/verifyScore";
import { NextRequest, NextResponse } from "next/server";
import { checkBody } from "@/lib/gateway";
import { createLimiter } from "@/lib/ratelimit";
import { OUTLAYER_API, OUTLAYER_OWNER, OUTLAYER_PROJECT } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const perIp = createLimiter(20, 60_000);
// info is public and identical for everyone: cache it so anonymous traffic cannot burn TEE compute.
let infoCache: { at: number; body: unknown } | null = null;

/**
 * Thin gateway to the KEYHOLE TEE worker. It adds the OutLayer payment key (server-only env secret)
 * and forwards {op, auth}. It never logs request bodies, amounts or accounts. All auth, caps and
 * replay checks happen inside the TEE.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const rl = perIp(ip);
  if (!rl.ok) return NextResponse.json({ ok: false, error: { code: "rate_limited", retry_after: rl.retryAfter } }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  const len = Number(req.headers.get("content-length") || 0);
  if (len > 8192) return NextResponse.json({ ok: false, error: { code: "too_large" } }, { status: 413 });
  const raw = await req.text();
  const c = checkBody(raw);
  if (!c.ok) return NextResponse.json({ ok: false, error: { code: c.code } }, { status: c.status });
  if (c.op === "info" && infoCache && Date.now() - infoCache.at < 300_000) return NextResponse.json(infoCache.body, { headers: { "cache-control": "public, s-maxage=300" } });
  if(PLEDGE_SANDBOX)return sandboxProxy(req,"worker",JSON.parse(raw));
  const key = process.env.OUTLAYER_PAYMENT_KEY;
  if (!key) return NextResponse.json({ ok: false, error: { code: "gateway" } }, { status: 503 });
  try {
    const r = await fetch(`${OUTLAYER_API}/call/${OUTLAYER_OWNER}/${OUTLAYER_PROJECT}`, {
      method: "POST",
      headers: { "X-Payment-Key": key, "content-type": "application/json" },
      // record: the client sends the key id at the top level (validated in checkBody); the enclave reads params.token_id.
      body: JSON.stringify({ input: c.op === "info" ? { op: "info" } : c.op === "provenance" ? { op: "provenance", token_id: (JSON.parse(raw) as { token_id?: string }).token_id }
        : c.op === "loan_certificate" ? {op:c.op,params:c.params} : c.op === "record" ? { op: "record", params: { token_id: (JSON.parse(raw) as { token_id?: string }).token_id } } : { op: c.op, auth: c.auth }, async: false,
        secrets_ref: { profile: "default", account_id: OUTLAYER_OWNER } }),
      signal: AbortSignal.timeout(55_000),
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    if (!j) return NextResponse.json({ ok: false, error: { code: "gateway" } }, { status: 502 });
    if (!j.call_id && (j.reason || j.error)) {
      const code = j.reason === "insufficient_balance" ? "service_unfunded" : "gateway";
      return NextResponse.json({ ok: false, error: { code } }, { status: 503 });
    }
    const body = {
      call_id: j.call_id ?? null, status: j.status ?? null, output: j.output ?? null,
      attestation_url: safeAttPath(j.attestation_url) ? `${OUTLAYER_API}${j.attestation_url}` : null, time_ms: j.time_ms ?? null,
    };
    if (c.op === "info" && j.output?.ok) infoCache = { at: Date.now(), body };
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: { code: "network" } }, { status: 504 });
  }
}
export const maxDuration = 60;
