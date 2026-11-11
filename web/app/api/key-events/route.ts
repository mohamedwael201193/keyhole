import { NextResponse } from "next/server";
import { clientIp } from "@/lib/verifyScore";
import { createLimiter } from "@/lib/ratelimit";
import { KEYS_CONTRACT } from "@/lib/config";
import {
  INDEXED_METHODS,
  KEY_ID,
  collectLogs,
  eventsForToken,
  receiptToken,
  type IndexedEvent,
} from "@/lib/chainEvents";

const limit = createLimiter(30, 60_000);
const NEARBLOCKS = "https://api.nearblocks.io";
const ARCHIVAL = "https://archival-rpc.mainnet.near.org";
const cache = new Map<string, { at: number; events: IndexedEvent[] }>();
const TTL = 120_000;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`index ${r.status}`);
  return r.json();
}

type Hit = { tx: string; signer: string; atMs: number | null };

/** Receipts whose function-call args name this token. */
async function receiptsFor(tokenId: string): Promise<Hit[]> {
  const pages = await Promise.all(INDEXED_METHODS.map(async (method) => {
    const j = await getJson(`${NEARBLOCKS}/v1/account/${KEYS_CONTRACT}/receipts?method=${method}&per_page=25`) as { txns?: unknown[] };
    return Array.isArray(j.txns) ? j.txns : [];
  }));
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const txns of pages) {
    for (const raw of txns) {
      if (!raw || typeof raw !== "object") continue;
      const t = raw as { transaction_hash?: unknown; predecessor_account_id?: unknown; block_timestamp?: unknown; actions?: { args?: unknown }[] };
      const tx = typeof t.transaction_hash === "string" ? t.transaction_hash : "";
      if (!tx || seen.has(tx)) continue;
      const args = (t.actions ?? []).map((a) => a?.args);
      if (!args.some((a) => receiptToken(a) === tokenId)) continue;
      seen.add(tx);
      const ns = typeof t.block_timestamp === "string" && /^\d+$/.test(t.block_timestamp) ? BigInt(t.block_timestamp) : null;
      const signer = typeof t.predecessor_account_id === "string" ? t.predecessor_account_id : "";
      hits.push({ tx, signer, atMs: ns === null ? null : Number(ns / 1_000_000n) });
    }
  }
  return hits;
}

async function signerOf(hit: Hit): Promise<string> {
  if (hit.signer && hit.signer !== KEYS_CONTRACT) return hit.signer;
  const j = await getJson(`${NEARBLOCKS}/v1/txns/${hit.tx}`) as { txns?: { signer_account_id?: string }[] };
  return j.txns?.[0]?.signer_account_id ?? hit.signer;
}

async function logsOf(tx: string, signer: string): Promise<string[]> {
  const r = await fetch(ARCHIVAL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: "kh-events", method: "EXPERIMENTAL_tx_status", params: [tx, signer] }),
  });
  const j = await r.json() as { result?: unknown; error?: unknown };
  if (j.error || !j.result) return [];
  return collectLogs(j.result);
}

export async function GET(req: Request) {
  if (!limit(clientIp(req.headers)).ok) return json({ ok: false, error: { code: "rate_limited" } }, 429);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!KEY_ID.test(id)) return json({ ok: false, error: { code: "bad_params" } }, 400);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return json({ ok: true, id, events: hit.events });
  try {
    const receipts = await receiptsFor(id);
    const rows = await Promise.all(receipts.map(async (h) => {
      try {
        const signer = await signerOf(h);
        return { tx: h.tx, atMs: h.atMs, logs: signer ? await logsOf(h.tx, signer) : [] };
      } catch {
        return { tx: h.tx, atMs: h.atMs, logs: [] as string[] };
      }
    }));
    const events = eventsForToken(rows, id);
    cache.set(id, { at: Date.now(), events });
    return json({ ok: true, id, events });
  } catch {
    return json({ ok: false, error: { code: "indexer" } });
  }
}
