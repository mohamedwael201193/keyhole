import { LANDING_KEYS } from "./config";
import { nftTier, nftTokens, type Token } from "./near";
import { readHolderKeys } from "./supply";
import { fetchTokenList, type Token as ListToken } from "./tokenList";

/** Public reads only, cached 60 s, each attempt capped at 4 s. The landing is cached as a whole (ISR), so these run about once a minute. */
const LANDING_READ = { shared: true, timeoutMs: 4_000 } as const;

/** The token list read for the landing's count. Past this, the page prints no number (the fallback sentence). */
const TOKEN_READ_MS = 3_000;

export interface LandingData { supply: number | null; tokens: Token[]; tiers: (number | null)[] }

/**
 * Everything the landing shows from the chain: the key supply, the first LANDING_KEYS keys and their tiers.
 * Wave 1 is the supply reads and the key list (parallel); wave 2 is one tier read per key (parallel, needs the ids).
 * Never throws: a failed read becomes an empty value and the page renders its honest empty state.
 */
export async function loadLanding(): Promise<LandingData> {
  const [supply, tokens] = await Promise.all([
    readHolderKeys(LANDING_READ),
    nftTokens(0, LANDING_KEYS, LANDING_READ).catch((): Token[] => []),
  ]);
  const shown = tokens.slice(0, LANDING_KEYS);
  const tiers = await Promise.all(shown.map((t) => nftTier(t.token_id, LANDING_READ).catch(() => null)));
  return { supply, tokens: shown, tiers };
}

/** What the landing says about reach: how many tokens and chains the 1Click list has, and the curated marks shown in the row. */
export interface TokenReach { tokens: number; chains: number; marks: ListToken[] }

/**
 * The tokens the trade row shows, in this order. Each entry is a symbol and the chains it may sit on (first chain listed wins).
 * An entry the live list does not have is left out, so the row never shows a ticker that is not on the list.
 */
export const REACH_ROW: { symbols: string[]; chains: string[] }[] = [
  { symbols: ["wNEAR"], chains: ["near"] },
  { symbols: ["USDC"], chains: ["near"] },
  { symbols: ["USDT"], chains: ["eth"] },
  { symbols: ["ETH"], chains: ["eth"] },
  { symbols: ["wBTC", "BTC"], chains: ["near", "btc"] },
  { symbols: ["SOL"], chains: ["sol"] },
  { symbols: ["ZEC"], chains: ["zec"] },
  { symbols: ["ARB"], chains: ["arb"] },
  { symbols: ["USDC"], chains: ["base"] },
];

/** The curated row from the live list: one token per REACH_ROW entry that the list has, in REACH_ROW order. Pure. */
export function curatedMarks(tokens: ListToken[]): ListToken[] {
  const out: ListToken[] = [];
  const seen = new Set<string>();
  for (const want of REACH_ROW) {
    let hit: ListToken | undefined;
    for (const chain of want.chains) {
      for (const sym of want.symbols) {
        hit = tokens.find((t) => t.blockchain.toLowerCase() === chain && t.symbol.toLowerCase() === sym.toLowerCase());
        if (hit) break;
      }
      if (hit) break;
    }
    if (hit && !seen.has(hit.assetId)) {
      seen.add(hit.assetId);
      out.push(hit);
    }
  }
  return out;
}

/**
 * The 1Click token list, counted for the trade section. Bounded by TOKEN_READ_MS; null on any failure or timeout, so the page
 * prints its fallback sentence with no number. The count is the whole list; the marks are the curated row (REACH_ROW).
 */
export async function loadTokenReach(): Promise<TokenReach | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), TOKEN_READ_MS); });
  const r = await Promise.race([fetchTokenList().catch(() => null), timeout]).finally(() => clearTimeout(timer));
  if (!r || !r.ok) return null;
  const chains = new Set(r.tokens.map((t) => t.blockchain)).size;
  return { tokens: r.tokens.length, chains, marks: curatedMarks(r.tokens) };
}
