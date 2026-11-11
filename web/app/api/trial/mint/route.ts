import { NextRequest, NextResponse } from "next/server";
import { mintPracticeKey } from "@/lib/trialSend";
import { trialClientIp } from "@/lib/trialIp";
import { TRIAL_CONTRACT } from "@/lib/trialPublic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/** Mint one practice key to a testnet guest. The minter key stays on the server. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 4096) return json({ error: "bad_request", message: "Request is too large." }, 400);
  let body: { receiverId?: unknown; idempotencyKey?: unknown };
  try { body = JSON.parse(raw) as { receiverId?: unknown; idempotencyKey?: unknown }; }
  catch { return json({ error: "bad_request", message: "The request was not JSON." }, 400); }
  if (typeof body.receiverId !== "string" || typeof body.idempotencyKey !== "string") {
    return json({ error: "bad_request", message: "A practice key can only be minted to a testnet account." }, 400);
  }
  const result = await mintPracticeKey(body.receiverId, body.idempotencyKey, trialClientIp(req.headers));
  if (!result.ok) return json({ error: result.error, message: result.message }, result.status);
  return json({ tokenId: result.tokenId, tier: result.tier, txHash: result.txHash, replayed: result.replayed === true, receiverId: result.accountId, network: "testnet", contract: TRIAL_CONTRACT });
}
