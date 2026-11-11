import { NextRequest, NextResponse } from "next/server";
import { createGuest } from "@/lib/trialSend";
import { trialClientIp } from "@/lib/trialIp";
import { TRIAL_CONTRACT } from "@/lib/trialPublic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** One guest testnet account. The body carries a public key and an idempotency key. The secret stays in the browser. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 4096) return json({ error: "bad_request", message: "Request is too large." }, 400);
  let body: { publicKey?: unknown; idempotencyKey?: unknown };
  try { body = JSON.parse(raw) as { publicKey?: unknown; idempotencyKey?: unknown }; }
  catch { return json({ error: "bad_request", message: "The request was not JSON." }, 400); }
  if (typeof body.publicKey !== "string" || typeof body.idempotencyKey !== "string") {
    return json({ error: "bad_request", message: "Send the guest's ed25519 public key and an idempotency key. The secret stays in the browser." }, 400);
  }
  const result = await createGuest(body.publicKey, body.idempotencyKey, trialClientIp(req.headers));
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status);
  return json({ accountId: result.accountId, txHash: result.txHash, replayed: result.replayed === true, network: "testnet", contract: TRIAL_CONTRACT });
}
