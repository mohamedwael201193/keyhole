import { NextResponse } from "next/server";
import { clientIp } from "@/lib/verifyScore";
import { createLimiter } from "@/lib/ratelimit";
import { KEYS_CONTRACT } from "@/lib/config";
import { KEY_ID, type IndexedEvent } from "@/lib/chainEvents";
import { readKeyHistory } from "@/lib/keyEventRead";

const limit = createLimiter(30, 60_000);
const cache = new Map<string, { at: number; events: IndexedEvent[] }>();
const TTL = 120_000;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(req: Request) {
  if (!limit(clientIp(req.headers)).ok) return json({ ok: false, error: { code: "rate_limited" }, events: [], complete: false }, 429);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!KEY_ID.test(id)) return json({ ok: false, error: { code: "bad_params" }, events: [], complete: false }, 400);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return json({ ok: true, id, events: hit.events, complete: true, unavailable: false });
  const read = await readKeyHistory({ tokenId: id, contractId: KEYS_CONTRACT });
  if (read.unavailable || !read.complete) {
    return json({ ok: false, error: { code: "unavailable" }, id, events: read.events, complete: false, unavailable: true });
  }
  cache.set(id, { at: Date.now(), events: read.events });
  return json({ ok: true, id, events: read.events, complete: true, unavailable: false });
}
