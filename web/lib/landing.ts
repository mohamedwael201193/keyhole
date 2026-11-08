import { LANDING_KEYS } from "./config";
import { nftTier, nftTokens, type Token } from "./near";
import { readHolderKeys } from "./supply";

/** Public reads only, cached 60 s, each attempt capped at 4 s. The landing is cached as a whole (ISR), so these run about once a minute. */
const LANDING_READ = { shared: true, timeoutMs: 4_000 } as const;

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
