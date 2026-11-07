import { clientIp } from "@/lib/verifyScore";
import { NextResponse } from "next/server";
import { createLimiter } from "@/lib/ratelimit";
import { checkCounterparty, isNearAccountId, type BlocklistEntry, type CounterpartyResult } from "@/lib/counterparty";
import blocklistFile from "@/lib/blocklist.json";

// Read-only counterparty check: GET /api/check?account=<receiver>[&agent=<agent>].
// No keys, no writes, no signing. Public chain data only (NEAR RPC, Nearblocks). A failed read is a WARN, never an ALLOW.
const limit = createLimiter(30, 60_000);
const BLOCKLIST = (blocklistFile as { entries: BlocklistEntry[] }).entries;
const TTL_MS = 60_000;
const MAX_CACHE = 500;
const cache = new Map<string, { at: number; value: CounterpartyResult }>();

const no = (code: string, status: number) => NextResponse.json({ ok: false, error: { code } }, { status, headers: { "cache-control": "no-store" } });

export async function GET(req: Request) {
  if (!limit(clientIp(req.headers)).ok) return no("rate_limited", 429);
  const sp = new URL(req.url).searchParams;
  const account = (sp.get("account") ?? "").trim().toLowerCase();
  const agent = (sp.get("agent") ?? "").trim().toLowerCase() || null;
  if (!isNearAccountId(account) || (agent !== null && !isNearAccountId(agent))) return no("bad_params", 400);

  const key = `${account}|${agent ?? ""}`;
  const hit = cache.get(key);
  let value: CounterpartyResult;
  if (hit && Date.now() - hit.at < TTL_MS) value = hit.value;
  else {
    value = await checkCounterparty(account, { blocklist: BLOCKLIST, agent, nearblocksKey: process.env.NEARBLOCKS_API_KEY || undefined });
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(key, { at: Date.now(), value });
  }
  return NextResponse.json({ ok: true, ...value, service: "keyhole-counterparty/0.1", note: "advisory; ALLOW does not mean safe" }, { headers: { "cache-control": "no-store" } });
}
