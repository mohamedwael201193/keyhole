"use client";
import { useEffect, useState } from "react";
import { nftTier, tokensFor, type Token } from "./near";

/** Enough to count a holder's keys honestly; the dashboard says "50 or more" when the list is full. */
export const KEY_LIST_LIMIT = 50;

export type MyKeys = {
  status: "idle" | "loading" | "ready" | "error";
  /** The account these keys were read for. A result for another account is never shown. */
  accountId: string | null;
  tokens: Token[];
  /** Tier of the first key (nft_tier), or null when unreadable. */
  tier: number | null;
};

export const NO_KEYS: MyKeys = { status: "idle", accountId: null, tokens: [], tier: null };

/**
 * The keys an account holds on NEAR mainnet. Public contract reads only (nft_tokens_for_owner, nft_tier): no signature
 * and no session. `attempt` changes when the holder presses Try again.
 */
export function useMyKeys(accountId: string | null, attempt = 0): MyKeys {
  const [state, setState] = useState<MyKeys>(NO_KEYS);
  useEffect(() => {
    if (!accountId) { setState(NO_KEYS); return; }
    let cancel = false;
    setState({ status: "loading", accountId, tokens: [], tier: null });
    tokensFor(accountId, KEY_LIST_LIMIT)
      .then(async (tokens) => {
        const tier = tokens[0] ? await nftTier(tokens[0].token_id).catch(() => null) : null;
        if (!cancel) setState({ status: "ready", accountId, tokens, tier });
      })
      .catch(() => { if (!cancel) setState({ status: "error", accountId, tokens: [], tier: null }); });
    return () => { cancel = true; };
  }, [accountId, attempt]);
  return state;
}
