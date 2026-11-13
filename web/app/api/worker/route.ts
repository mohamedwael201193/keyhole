import {PLEDGE_SANDBOX} from "@/lib/config";
import {sandboxProxy} from "@/lib/sandboxProxy";
import { clientIp, safeAttPath } from "@/lib/verifyScore";
import { NextRequest, NextResponse } from "next/server";
import { checkBody } from "@/lib/gateway";
import { createLimiter } from "@/lib/ratelimit";
import { OUTLAYER_API, OUTLAYER_OWNER, OUTLAYER_PROJECT } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const certificates = createLimiter(6, 60_000);
const perIp = createLimiter(20, 60_000);
// info is public and identical for everyone: cache it so anonymous traffic cannot burn TEE compute.
let infoCache: { at: number; body: unknown } | null = null;

// The OutLayer /call resource limits. The worker runs up to 180 s (the platform
// maximum); the default is 60 s, which kills a slow swap mid-RPC and can leave an
// UNKNOWN minter ticket. The gateway never waits synchronously for the call: it
// starts the call (async) and polls /calls/{id} inside a ~48 s window, then
// returns the call id so the client can resume polling (GET ?call_id=...).
const RESOURCE_LIMITS = { max_execution_seconds: 180, max_instructions: 50000000000 } as const;
// Wall-clock budget for one gateway request's internal poll, in ms. Must stay
// under Vercel's 60 s maxDuration with margin for the response.
const POLL_BUDGET_MS = 48_000;
const POLL_INTERVAL_MS = 3_000;
const POLL_FETCH_TIMEOUT_MS = 10_000;
const CALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Thin gateway to the KEYHOLE TEE worker. It adds the OutLayer payment key (server-only env secret)
 * and forwards {op, auth}. It never logs request bodies, amounts or accounts. All auth, caps and
 * replay checks happen inside the TEE.
 */
export async function POST(req: NextRequest) {
  // Admission barrier covers both /api/worker and its /api/keyhole alias, even
  // cached info. Deploy and exercise it BEFORE an approved cutover starts.
  if (process.env.KEYHOLE_MAINTENANCE === "1") return NextResponse.json(
    { ok: false, error: { code: "maintenance" } },
    { status: 503, headers: { "cache-control": "no-store", "retry-after": "60" } },
  );
  const ip = clientIp(req.headers);
  const rl = perIp(ip);
  if (!rl.ok) return NextResponse.json({ ok: false, error: { code: "rate_limited", retry_after: rl.retryAfter } }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  const len = Number(req.headers.get("content-length") || 0);
  if (len > 8192) return NextResponse.json({ ok: false, error: { code: "too_large" } }, { status: 413 });
  const raw = await req.text();
  const c = checkBody(raw);
  if (!c.ok) return NextResponse.json({ ok: false, error: { code: c.code } }, { status: c.status });
  if (c.op === "loan_certificate" && !certificates(ip).ok) return NextResponse.json({ error: { code: "rate_limited" } }, { status: 429 });
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
        : c.op === "loan_certificate" ? { op: c.op, params: c.params } : c.op === "record" ? { op: "record", params: { token_id: (JSON.parse(raw) as { token_id?: string }).token_id } } : { op: c.op, auth: c.auth }, async: true,
        resource_limits: RESOURCE_LIMITS,
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
    // The call was accepted (async). Poll /calls/{id} inside this request's
    // budget; the OutLayer call keeps running to completion (up to 180 s) even
    // if this request returns "processing" — Vercel's 60 s limit can no longer
    // kill it. The client resumes with GET ?call_id=....
    const deadline = Date.now() + POLL_BUDGET_MS;
    const rec = await pollCall(j.call_id, key, deadline);
    if (rec === "not_found") return NextResponse.json({ ok: false, error: { code: "gateway" } }, { status: 502 });
    if (!rec) return NextResponse.json({ call_id: j.call_id ?? null, status: "processing", output: null, attestation_url: safeAttPath(j.attestation_url) ? `${OUTLAYER_API}${j.attestation_url}` : null, time_ms: null }, { headers: { "cache-control": "no-store" } });
    const body = callBody(rec);
    if (c.op === "info" && (body.output as { ok?: unknown } | null)?.ok) infoCache = { at: Date.now(), body };
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: { code: "network" } }, { status: 504 });
  }
}

/**
 * Resume-poll an in-flight worker call: GET /api/worker?call_id=<uuid>.
 * Polls /calls/{id} inside this request's budget and returns the same shape as
 * POST (output when terminal, "processing" with the call id when still in
 * flight). Each request stays well under Vercel's 60 s limit, so a slow call
 * (up to the 180 s worker budget) is retrieved across several short polls.
 */
export async function GET(req: NextRequest) {
  const ip = clientIp(req.headers);
  const rl = perIp(ip);
  if (!rl.ok) return NextResponse.json({ ok: false, error: { code: "rate_limited", retry_after: rl.retryAfter } }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  const callId = req.nextUrl.searchParams.get("call_id") ?? "";
  if (!CALL_ID_RE.test(callId)) return NextResponse.json({ ok: false, error: { code: "bad_params" } }, { status: 400 });
  const key = process.env.OUTLAYER_PAYMENT_KEY;
  if (!key) return NextResponse.json({ ok: false, error: { code: "gateway" } }, { status: 503 });
  const deadline = Date.now() + POLL_BUDGET_MS;
  try {
    const rec = await pollCall(callId, key, deadline);
    if (rec === "not_found") return NextResponse.json({ ok: false, error: { code: "gateway" } }, { status: 502 });
    if (!rec) return NextResponse.json({ call_id: callId, status: "processing", output: null, attestation_url: null, time_ms: null }, { headers: { "cache-control": "no-store" } });
    return NextResponse.json(callBody(rec), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: { code: "network" } }, { status: 504 });
  }
}
export const maxDuration = 60;

function callBody(j: unknown) {
  return {
    call_id: (j as { call_id?: string | null })?.call_id ?? null, status: (j as { status?: string | null })?.status ?? null, output: (j as { output?: unknown })?.output ?? null,
    attestation_url: safeAttPath((j as { attestation_url?: string })?.attestation_url) ? `${OUTLAYER_API}${(j as { attestation_url?: string }).attestation_url}` : null, time_ms: (j as { time_ms?: number | null })?.time_ms ?? null,
  };
}

async function fetchCallRecord(callId: string, key: string): Promise<Record<string, unknown> | null | "not_found"> {
  const r = await fetch(`${OUTLAYER_API}/calls/${callId}`, {
    headers: { "X-Payment-Key": key },
    signal: AbortSignal.timeout(POLL_FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (r.status === 404) return "not_found";
  if (r.status !== 200) return null;
  return r.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

async function pollCall(callId: string, key: string, deadlineMs: number): Promise<Record<string, unknown> | null | "not_found"> {
  // Poll /calls/{id} until the call is terminal (completed/failed) or the
  // deadline passes. Returns the record when terminal, "not_found" when the
  // call id is unknown, or null when still in flight at the deadline.
  while (Date.now() < deadlineMs) {
    let rec: Record<string, unknown> | null | "not_found" = null;
    try { rec = await fetchCallRecord(callId, key); } catch { rec = null; }
    if (rec === "not_found") return "not_found";
    if (rec && (rec.status === "completed" || rec.status === "failed")) return rec;
    if (Date.now() >= deadlineMs) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}
