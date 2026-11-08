import { useEffect, useState } from "react";
import { ASSETS } from "./assets";
import type { Token } from "./tokenList";

/**
 * Client side of the token list. loadTokens() asks /api/tokens once per page load and remembers the answer; a failure is
 * not remembered, so the next call retries. The swap screen falls back to the two vault assets while the list is not there.
 */
export type { Token } from "./tokenList";

const CHAIN_NAMES: Record<string, string> = {
  near: "NEAR", eth: "Ethereum", sol: "Solana", base: "Base", arb: "Arbitrum", bsc: "BNB Chain", op: "Optimism", pol: "Polygon",
  btc: "Bitcoin", avax: "Avalanche", ton: "TON", tron: "TRON", sui: "Sui", aptos: "Aptos", gnosis: "Gnosis",
};

/** Chains shown first in the picker's filter, in this order. Others follow alphabetically. */
export const CHAIN_ORDER = ["near", "eth", "sol", "base", "arb", "bsc", "op", "pol", "btc", "avax", "ton", "tron", "sui", "aptos", "gnosis"];

/** Display name for a 1Click chain id. Unlisted ids are title-cased ("stellar" becomes "Stellar"). */
export function chainName(id: string): string {
  const k = id.trim().toLowerCase();
  if (CHAIN_NAMES[k]) return CHAIN_NAMES[k];
  return k.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || id;
}

/** Sort key for a chain id: its place in CHAIN_ORDER, then after every listed chain. */
export function chainRank(id: string): number {
  const i = CHAIN_ORDER.indexOf(id.trim().toLowerCase());
  return i === -1 ? CHAIN_ORDER.length : i;
}

/** The two assets the vault trade has always supported. Used before the list loads and when it cannot load. */
export function fallbackTokens(): Token[] {
  return [ASSETS.usdc, ASSETS.wnear].map((a) => ({ assetId: a.id, symbol: a.symbol, blockchain: "near", decimals: a.decimals, price: null, contractAddress: null }));
}

type ListBody = { tokens?: unknown; error?: unknown };
let memo: Token[] | null = null;
let inflight: Promise<Token[]> | null = null;

/** The full list, from /api/tokens. Resolves with the tokens, or rejects with a plain message. */
export function loadTokens(): Promise<Token[]> {
  if (memo) return Promise.resolve(memo);
  if (!inflight) {
    inflight = fetch("/api/tokens", { headers: { accept: "application/json" } })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as ListBody | null;
        if (!r.ok || !j || !Array.isArray(j.tokens)) throw new Error(typeof j?.error === "string" ? j.error : "The token list is unavailable right now.");
        memo = j.tokens as Token[];
        return memo;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export type TokenListState = { status: "loading" | "ready" | "error"; tokens: Token[]; error: string | null; retry: () => void };

/** The token list for a component. `tokens` is empty until status is "ready". */
export function useTokenList(): TokenListState {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; tokens: Token[]; error: string | null }>(() =>
    memo ? { status: "ready", tokens: memo, error: null } : { status: "loading", tokens: [], error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancel = false;
    if (memo) { setState({ status: "ready", tokens: memo, error: null }); return; }
    setState((s) => (s.status === "error" ? { status: "loading", tokens: [], error: null } : s));
    loadTokens().then(
      (tokens) => { if (!cancel) setState({ status: "ready", tokens, error: null }); },
      (e: unknown) => { if (!cancel) setState({ status: "error", tokens: [], error: e instanceof Error ? e.message : "The token list is unavailable right now." }); },
    );
    return () => { cancel = true; };
  }, [attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
