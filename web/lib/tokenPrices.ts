import "server-only";
import { priceToMicro, type PriceBook } from "./amount";

const URL = "https://1click.chaindefuser.com/v0/tokens";
const TTL = 60_000;
let cache: { at: number; book: PriceBook } | null = null;
let inflight: Promise<PriceBook> | null = null;

function parse(body: unknown): PriceBook {
  const book: PriceBook = {};
  if (!Array.isArray(body)) return book;
  for (const row of body) {
    if (!row || typeof row !== "object") continue;
    const assetId = (row as { assetId?: unknown }).assetId;
    const price = (row as { price?: unknown }).price;
    if (typeof assetId !== "string" || (typeof price !== "string" && typeof price !== "number")) continue;
    const priceMicro = priceToMicro(price);
    if (priceMicro == null) continue;
    const decimals = (row as { decimals?: unknown }).decimals;
    const symbol = (row as { symbol?: unknown }).symbol;
    book[assetId.toLowerCase()] = {
      priceMicro,
      ...(typeof decimals === "number" ? { decimals } : {}),
      ...(typeof symbol === "string" ? { symbol } : {}),
    };
  }
  return book;
}

async function load(): Promise<PriceBook> {
  const r = await fetch(URL, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(String(r.status));
  return parse(await r.json());
}

/** USD prices from the 1Click token list. One fetch is shared, then reused for a minute. */
export async function tokenPrices(): Promise<PriceBook> {
  if (cache && Date.now() - cache.at < TTL) return cache.book;
  if (inflight) return inflight;
  inflight = load().then((book) => {
    cache = { at: Date.now(), book };
    return book;
  }).catch(() => cache?.book ?? {}).finally(() => { inflight = null; });
  return inflight;
}
