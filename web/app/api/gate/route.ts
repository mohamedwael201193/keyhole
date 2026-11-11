import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/verifyScore";
import { createLimiter } from "@/lib/ratelimit";
import { KEYS_CONTRACT, RPC_URL } from "@/lib/config";
import { ACCOUNT_RE, ReplaySet, issueChallenge, randomHex, verifyGate, type GateDeps } from "@/lib/holderGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const perIp = createLimiter(30, 60_000);
const production = () => process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
/** Development only: a random per-process key. Production refuses to run without HOLDER_GATE_SECRET (503). */
const devSecret = `${randomHex()}${randomHex()}`;
/** Single-use replay set, per process. Across instances a replayed challenge can be accepted once per instance within its 2-minute TTL; a shared store is needed for strict single use. */
const replay = new ReplaySet();

/** The HMAC key, or null when production has none configured. */
function gateSecret(): string | null {
  const s = process.env.HOLDER_GATE_SECRET;
  if (s) return s;
  return production() ? null : devSecret;
}

async function rpc<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "gate", ...body }), cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.cause?.name || j.error?.message || "rpc");
  return j.result as T;
}
async function contractView<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const res = await rpc<{ result: number[] }>({ method: "query", params: { request_type: "call_function", finality: "final", account_id: KEYS_CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } });
  return JSON.parse(Buffer.from(res.result).toString("utf8")) as T;
}

/**
 * The same chain facts the enclave reads (tee/worker: view_access_key, holder_tier, nft_supply_for_owner).
 * Only UNKNOWN_ACCESS_KEY means "not on this account". Any other RPC failure throws, so the route answers 503.
 */
const deps: GateDeps = {
  viewAccessKey: async (account, publicKey) => {
    try { return await rpc<{ permission: unknown }>({ method: "query", params: { request_type: "view_access_key", finality: "final", account_id: account, public_key: publicKey } }); }
    catch (e) { if ((e as Error).message === "UNKNOWN_ACCESS_KEY") return null; throw e; }
  },
  nftSupply: async (account) => Number(await contractView<string>("nft_supply_for_owner", { account_id: account })),
  holderTier: async (account) => {
    const t = await contractView<number | null>("holder_tier", { account_id: account });
    return typeof t === "number" ? t : null;
  },
  tokensForOwner: async (account) => {
    const list = await contractView<{ token_id: string }[]>("nft_tokens_for_owner", { account_id: account, from_index: "0", limit: 10 });
    return list.map((t) => t.token_id);
  },
};

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
const unavailable = () => json({ granted: false, reason: "unavailable" }, 503);

/** GET ?account_id=A issues a single-use challenge for that account. */
export async function GET(req: NextRequest) {
  const rl = perIp(clientIp(req.headers));
  if (!rl.ok) return json({ error: "rate_limited" }, 429);
  const secret = gateSecret();
  if (!secret) return json({ error: "unavailable" }, 503);
  const account = req.nextUrl.searchParams.get("account_id") ?? "";
  if (!ACCOUNT_RE.test(account)) return json({ error: "bad_account" }, 400);
  return json(issueChallenge(account, Date.now(), secret));
}

/** POST { challenge, auth } proves a live FullAccess holder and returns { granted, tier } (plus the key ids). */
export async function POST(req: NextRequest) {
  const rl = perIp(clientIp(req.headers));
  if (!rl.ok) return json({ granted: false, reason: "rate_limited" }, 429);
  const secret = gateSecret();
  if (!secret) return unavailable();
  const raw = await req.text();
  if (raw.length > 8192) return json({ granted: false, reason: "bad_intent" }, 413);
  let body: { challenge?: unknown; auth?: unknown };
  try { body = JSON.parse(raw); } catch { return json({ granted: false, reason: "bad_intent" }, 400); }
  let result;
  try {
    result = await verifyGate({ challenge: body.challenge, auth: body.auth }, deps, secret, replay, Date.now());
  } catch {
    return unavailable();
  }
  return json(result, result.granted ? 200 : 403);
}
