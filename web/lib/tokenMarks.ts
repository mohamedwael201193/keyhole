import { tokenIcon } from "./tokenIcons";

/**
 * Token and chain marks, as pure functions (no React, no DOM) so the candidate order and the chain map are unit-tested.
 * components/TokenMark.tsx draws them. Rules: the web3icon skill (token-mark.md). A monogram shows first; a URL replaces it only
 * after the browser has loaded it (probeImage, off the DOM). A miss is cached as "" for the session, never a guessed logo.
 */

export const WEB3ICONS_CDN = "https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@main/raw-svgs";

/**
 * 1Click blockchain id to the web3icons network file (raw-svgs/networks/branded/{file}.svg). Each file was checked against
 * @web3icons/common 0.11.53 metadata and the CDN. A 1Click chain not listed here (miden, hypercore, aleo, fogo, zec, qtc, prl, doge,
 * bch, dash, adi) gets a monogram badge: web3icons has no network file for it.
 */
export const NETWORK_MARK_FILES: Readonly<Record<string, string>> = {
  near: "near-protocol", eth: "ethereum", sol: "solana", base: "base", aptos: "aptos", bsc: "binance-smart-chain",
  gnosis: "gnosis", arb: "arbitrum-one", op: "optimism", hood: "robinhood", pol: "polygon", starknet: "starknet",
  plasma: "plasma", monad: "monad", xlayer: "x-layer", avax: "avalanche", sui: "sui", btc: "bitcoin", bera: "berachain",
  tron: "tron", ton: "ton", stellar: "stellar", scroll: "scroll", movement: "movement", abs: "abstract", xrp: "xrp",
  cardano: "cardano", ltc: "litecoin",
};

/** DexScreener chain slugs for the 1Click chains it covers (ethereum, base, bsc, solana). */
const DEX_CHAIN: Readonly<Record<string, string>> = { eth: "ethereum", base: "base", bsc: "bsc", sol: "solana" };

const LATIN = /^[A-Za-z0-9]{2,12}$/;
const CJK = /[　-鿿가-힯]/;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The network mark for a 1Click chain id, or null when web3icons has none. */
export function networkMarkUrl(chain?: string | null): string | null {
  const k = (chain ?? "").trim().toLowerCase();
  if (!k || !Object.hasOwn(NETWORK_MARK_FILES, k)) return null;
  return `${WEB3ICONS_CDN}/networks/branded/${NETWORK_MARK_FILES[k]}.svg`;
}

/** The shape of one entry in @web3icons/common `tokens` that the index reads. */
export type MetaToken = { filePath: string; symbol: string; marketCapRank?: number | null; addresses?: Record<string, string | undefined>; variants?: readonly string[] };

/** File names in raw-svgs/tokens/branded, by symbol and by contract address. Built once from the metadata. */
export type TokenMarkIndex = { bySymbol: Map<string, string>; byAddress: Map<string, string> };

/**
 * Index the branded token marks. By symbol the best-ranked entry wins (lowest market cap rank), so an obscure token with the same
 * ticker never takes the mark of the real one. Addresses are kept exactly and in lower case (EVM addresses are case-insensitive;
 * Solana addresses are not).
 */
export function buildTokenMarkIndex(entries: readonly MetaToken[]): TokenMarkIndex {
  const bySymbol = new Map<string, { file: string; rank: number }>();
  const byAddress = new Map<string, string>();
  for (const t of entries) {
    if (!t.variants?.includes("branded") || !t.filePath.startsWith("token:")) continue;
    const file = t.filePath.slice("token:".length);
    if (!file) continue;
    const sym = t.symbol.trim().toLowerCase();
    const rank = t.marketCapRank ?? Number.POSITIVE_INFINITY;
    const cur = bySymbol.get(sym);
    if (!cur || rank < cur.rank) bySymbol.set(sym, { file, rank });
    for (const addr of Object.values(t.addresses ?? {})) {
      if (!addr) continue;
      if (!byAddress.has(addr)) byAddress.set(addr, file);
      const lower = addr.toLowerCase();
      if (!byAddress.has(lower)) byAddress.set(lower, file);
    }
  }
  return { bySymbol: new Map([...bySymbol].map(([k, v]) => [k, v.file])), byAddress };
}

export type MarkInput = { symbol: string; contract?: string | null; chain?: string | null; assetId?: string | null };

/** The self-hosted mark for a NEAR asset id or a known symbol (public/tokens). Null when none is mapped. */
export function localTokenMarkUrl(input: Pick<MarkInput, "symbol" | "assetId">): string | null {
  return tokenIcon({ assetId: input.assetId ?? null, symbol: input.symbol.trim() })?.src ?? null;
}

/** DexScreener image URLs for a contract. A chain given narrows it to that chain; otherwise the address format decides. */
function dexUrls(contract: string, chain: string): string[] {
  if (!contract) return [];
  const evm = EVM_ADDRESS.test(contract);
  const sol = !evm && SOLANA_ADDRESS.test(contract);
  const solUrl = `https://dd.dexscreener.com/ds-data/tokens/solana/${contract}.png`;
  if (chain) {
    const dex = DEX_CHAIN[chain];
    if (!dex) return [];
    if (dex === "solana") return sol ? [solUrl] : [];
    return evm ? [`https://dd.dexscreener.com/ds-data/tokens/${dex}/${contract.toLowerCase()}.png`] : [];
  }
  if (evm) return ["ethereum", "base", "bsc"].map((d) => `https://dd.dexscreener.com/ds-data/tokens/${d}/${contract.toLowerCase()}.png`);
  return sol ? [solUrl] : [];
}

/**
 * Every candidate URL for a token mark, in probe order: the self-hosted mark, the web3icons branded file (by contract, then by
 * symbol, only when the index has it), CoinCap (Latin tickers), DexScreener (by contract), and the spothq SVG last (Latin tickers).
 * The list has no duplicates. CJK and unusual tickers never reach a Latin-only source.
 */
export function tokenMarkCandidates(input: MarkInput, index?: TokenMarkIndex | null): string[] {
  const symbol = input.symbol.trim();
  const s = symbol.toLowerCase();
  const contract = (input.contract ?? "").trim();
  const chain = (input.chain ?? "").trim().toLowerCase();
  const out: string[] = [];
  const local = localTokenMarkUrl(input);
  if (local) out.push(local);
  if (index) {
    const file = (contract && (index.byAddress.get(contract) ?? index.byAddress.get(contract.toLowerCase()))) || index.bySymbol.get(s);
    if (file) out.push(`${WEB3ICONS_CDN}/tokens/branded/${file}.svg`);
  }
  if (LATIN.test(symbol)) out.push(`https://assets.coincap.io/assets/icons/${s}@2x.png`);
  out.push(...dexUrls(contract, chain));
  if (LATIN.test(symbol)) out.push(`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${s}.svg`);
  return [...new Set(out)];
}

/** Two characters for a monogram. CJK tickers are kept as written; Latin ones are upper-cased. Empty becomes "?". */
export function tokenGlyph(symbol: string | null | undefined): string {
  const letters = [...(symbol ?? "").trim().replace(/[^\p{L}\p{N}]/gu, "")];
  const head = letters.slice(0, 2).join("");
  if (!head) return "?";
  return CJK.test(head) ? head : head.toUpperCase();
}

/** Cache key for a token's resolved mark (sessionStorage). */
export function markCacheKey(symbol: string, contract?: string | null): string {
  return `icon:${symbol.trim()}:${(contract ?? "").trim()}`;
}

/** Cache key for a chain's network mark (sessionStorage). */
export function chainMarkCacheKey(chain: string): string {
  return `chainmark:${chain.trim().toLowerCase()}`;
}

/** Try the URLs one at a time, in order; the first that loads wins. Sequential on purpose: no burst of requests per row. */
export async function firstLoading(urls: readonly string[], probe: (url: string) => Promise<boolean>): Promise<string | null> {
  for (const url of urls) if (await probe(url)) return url;
  return null;
}

/**
 * Resolve a token mark. The self-hosted mark is probed first and the metadata index is loaded only when it misses, so pages whose
 * tokens have local marks never download the 140 KB index. Injected probe and index, so the order is tested without a browser.
 */
export async function resolveTokenMark(
  input: MarkInput,
  deps: { probe: (url: string) => Promise<boolean>; index: () => Promise<TokenMarkIndex | null> },
): Promise<string | null> {
  const local = localTokenMarkUrl(input);
  if (local && (await deps.probe(local))) return local;
  const index = await deps.index();
  return firstLoading(tokenMarkCandidates(input, index).filter((u) => u !== local), deps.probe);
}

/** Load one image off the DOM. Resolves false at once when there is no Image (server, tests). */
export function probeImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") { resolve(false); return; }
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

let indexMemo: Promise<TokenMarkIndex | null> | null = null;

/**
 * The branded-token index from @web3icons/common, loaded on first use. A failed load resolves null (the other sources still work)
 * and is retried on the next call.
 */
export function loadTokenMarkIndex(): Promise<TokenMarkIndex | null> {
  if (!indexMemo) {
    indexMemo = import("@web3icons/common/metadata/tokens")
      .then((m) => buildTokenMarkIndex(m.tokens as unknown as MetaToken[]))
      .catch(() => { indexMemo = null; return null; });
  }
  return indexMemo;
}

/** sessionStorage read. undefined: never resolved. "": resolved to no mark. A URL: the winning mark. Storage errors read as undefined. */
export function readMarkCache(key: string): string | undefined {
  try {
    const v = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(key);
    return v == null ? undefined : v;
  } catch {
    return undefined;
  }
}

export function writeMarkCache(key: string, value: string): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the mark is simply resolved again next time.
  }
}
