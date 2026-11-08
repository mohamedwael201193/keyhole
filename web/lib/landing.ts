import { LANDING_KEYS } from "./config";
import { nftTier, nftTokens, type Token } from "./near";
import { readHolderKeys } from "./supply";
import { fetchTokenList, type Token as ListToken } from "./tokenList";
import { tokenIcon } from "./tokenIcons";

/** Public reads only, cached 60 s, each attempt capped at 4 s. The landing is cached as a whole (ISR), so these run about once a minute. */
const LANDING_READ = { shared: true, timeoutMs: 4_000 } as const;

/** The token list read for the landing's count. Past this, the page prints no number (the fallback sentence). */
const TOKEN_READ_MS = 3_000;

export interface LandingData { supply: number | null; tokens: Token[]; tiers: (number | null)[] }

/**
 * Everything the landing shows from the chain: the holder count, the first LANDING_KEYS keys and their tiers.
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

/** What the landing says about reach: how many tokens and chains the 1Click list has, and one real mark per icon we ship. */
export interface TokenReach { tokens: number; chains: number; marks: ListToken[] }

/**
 * The 1Click token list, counted for the trade section. Bounded by TOKEN_READ_MS; null on any failure or timeout, so the page
 * prints its fallback sentence with no number. Marks are the first token of each icon the site ships (public/tokens).
 */
export async function loadTokenReach(): Promise<TokenReach | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), TOKEN_READ_MS); });
  const r = await Promise.race([fetchTokenList().catch(() => null), timeout]).finally(() => clearTimeout(timer));
  if (!r || !r.ok) return null;
  const chains = new Set(r.tokens.map((t) => t.blockchain)).size;
  const seen = new Set<string>();
  const marks: ListToken[] = [];
  for (const t of r.tokens) {
    const icon = tokenIcon({ assetId: t.assetId, symbol: t.symbol, chain: t.blockchain });
    if (!icon || seen.has(icon.key)) continue;
    seen.add(icon.key);
    marks.push(t);
  }
  return { tokens: r.tokens.length, chains, marks: marks.slice(0, 9) };
}
