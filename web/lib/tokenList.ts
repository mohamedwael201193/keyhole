/**
 * The 1Click token list (NEAR Intents), trimmed and validated. Pure apart from the injected fetch, so it is unit-tested with a mock.
 * Served by app/api/tokens/route.ts. Every assetId is taken exactly as 1Click returns it; nothing here builds one.
 */
export const TOKENS_URL = "https://1click.chaindefuser.com/v0/tokens";

export type Token = {
  assetId: string;
  symbol: string;
  /** 1Click chain id, for example "near", "eth", "sol", "base", "arb". */
  blockchain: string;
  decimals: number;
  /** USD price of one whole token, or null when 1Click has none. */
  price: number | null;
  contractAddress: string | null;
};

export type TokenListResult = { ok: true; tokens: Token[] } | { ok: false; error: "upstream" | "bad_shape" | "no_valid_tokens" };

const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,139}$/;
const CHAIN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SYMBOL_MAX = 32;

/** One raw entry to a Token, or null when it is not usable. A bad entry is dropped, never repaired. */
export function trimToken(raw: unknown): Token | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const assetId = typeof r.assetId === "string" ? r.assetId.trim() : "";
  const symbol = typeof r.symbol === "string" ? r.symbol.trim() : "";
  const blockchain = typeof r.blockchain === "string" ? r.blockchain.trim().toLowerCase() : "";
  const decimals = r.decimals;
  if (!ASSET_ID.test(assetId) || symbol === "" || symbol.length > SYMBOL_MAX || !CHAIN.test(blockchain)) return null;
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const price = typeof r.price === "number" && Number.isFinite(r.price) && r.price >= 0 ? r.price : null;
  const contractAddress = typeof r.contractAddress === "string" && r.contractAddress.trim() !== "" ? r.contractAddress.trim() : null;
  return { assetId, symbol, blockchain, decimals, price, contractAddress };
}

/** The usable tokens from a raw 1Click array, first occurrence of each assetId kept. Null when the body is not an array. */
export function trimTokens(raw: unknown): Token[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: Token[] = [];
  for (const item of raw) {
    const t = trimToken(item);
    if (!t || seen.has(t.assetId)) continue;
    seen.add(t.assetId);
    out.push(t);
  }
  return out;
}

/** Fetch and trim the list. Any network error, non-2xx status, bad body or empty result is a failure; the caller shows it, never fake tokens. */
export async function fetchTokenList(fetchFn: typeof fetch = fetch): Promise<TokenListResult> {
  let res: Response;
  try {
    res = await fetchFn(TOKENS_URL, { headers: { accept: "application/json", "user-agent": "keyhole/1.0" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch {
    return { ok: false, error: "upstream" };
  }
  if (!res.ok) return { ok: false, error: "upstream" };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "bad_shape" };
  }
  const tokens = trimTokens(body);
  if (tokens === null) return { ok: false, error: "bad_shape" };
  if (tokens.length === 0) return { ok: false, error: "no_valid_tokens" };
  return { ok: true, tokens };
}
