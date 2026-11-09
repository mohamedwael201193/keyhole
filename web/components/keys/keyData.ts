"use client";
import { useEffect, useState } from "react";
import { nftSupply, nftTier, nftToken, type Token } from "@/lib/near";
import { readListing, readListings, type Listing, type SaleSupport } from "@/lib/sale";
import { useSaleSupport } from "@/lib/useSaleSupport";

/**
 * Chain reads for the key screens (/keys, /gallery, /key, /mint). Public contract views only: no wallet, no signature.
 * Every hook says "not read yet" with undefined, and a failed read with null, so a screen never shows a guessed value.
 */

/** nft_total_supply. undefined until read; null when the read failed. */
export function useKeyTotal(): number | null | undefined {
  const [total, setTotal] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    nftSupply().then(
      (s) => { const n = Number(s); if (live) setTotal(Number.isFinite(n) ? n : null); },
      () => { if (live) setTotal(null); },
    );
    return () => { live = false; };
  }, []);
  return total;
}

/** nft_tier for each id given. Each id is undefined while unread and null when its read failed. Re-reads only when the ids change. */
export function useTiersFor(ids: string[]): Partial<Record<string, number | null>> {
  const [tiers, setTiers] = useState<Partial<Record<string, number | null>>>({});
  const joined = ids.join(",");
  useEffect(() => {
    if (!joined) return;
    let cancel = false;
    const list = joined.split(",");
    Promise.all(list.map((id) => nftTier(id).catch(() => null))).then((ts) => {
      if (!cancel) setTiers(Object.fromEntries(list.map((id, i) => [id, ts[i]])));
    });
    return () => { cancel = true; };
  }, [joined]);
  return tiers;
}

/** nft_token for each id given: the token, or null when the read failed, or undefined while unread. */
export function useTokensFor(ids: string[]): Partial<Record<string, Token | null>> {
  const [tokens, setTokens] = useState<Partial<Record<string, Token | null>>>({});
  const joined = ids.join(",");
  useEffect(() => {
    if (!joined) return;
    let cancel = false;
    const list = joined.split(",");
    Promise.all(list.map((id) => nftToken(id).catch(() => null))).then((ts) => {
      if (!cancel) setTokens(Object.fromEntries(list.map((id, i) => [id, ts[i]])));
    });
    return () => { cancel = true; };
  }, [joined]);
  return tokens;
}

/** The tier of one key: undefined while reading, null when the read failed. */
export function useKeyTier(id: string): number | null | undefined {
  const [st, setSt] = useState<{ id: string; tier: number | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    nftTier(id).then(
      (tier) => { if (live) setSt({ id, tier: typeof tier === "number" ? tier : null }); },
      () => { if (live) setSt({ id, tier: null }); },
    );
    return () => { live = false; };
  }, [id]);
  return st && st.id === id ? st.tier : undefined;
}

/**
 * The sale state of one key as the details panel and the grid show it:
 * a listing, null (not for sale), "reading", "error" (the listing read failed) or "unavailable" (the contract has no sale).
 */
export type SaleRead = Listing | null | "reading" | "error" | "unavailable";

/** The listing of one key, read fresh. `round` re-reads after a sale transaction. */
export function useKeyListing(id: string, round = 0): SaleRead {
  const { support } = useSaleSupport();
  const [st, setSt] = useState<{ id: string; round: number; value: Listing | null | "error" } | null>(null);
  useEffect(() => {
    if (support !== "open" || !id) return;
    let live = true;
    readListing(id).then(
      (value) => { if (live) setSt({ id, round, value }); },
      () => { if (live) setSt({ id, round, value: "error" }); },
    );
    return () => { live = false; };
  }, [id, round, support]);
  if (support === "v23" || support === "unknown") return "unavailable";
  if (support !== "open" || !st || st.id !== id || st.round !== round) return "reading";
  return st.value;
}

export type ListingsRead =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: Listing[] };

/**
 * Every listed key (nft_listings, up to 100), after the sale feature check. `support` is the feature check; `read` the list.
 * `retrySupport` runs the feature check again; `reload` reads the list again.
 */
export function useListings(): {
  support: SaleSupport;
  read: ListingsRead;
  retrySupport: () => void;
  reload: () => void;
} {
  const { support, retry: retrySupport } = useSaleSupport();
  const [round, setRound] = useState(0);
  const [st, setSt] = useState<{ round: number; read: ListingsRead } | null>(null);
  useEffect(() => {
    if (support !== "open") return;
    let live = true;
    readListings(0, 100).then(
      (items) => { if (live) setSt({ round, read: { status: "ready", items } }); },
      () => { if (live) setSt({ round, read: { status: "error" } }); },
    );
    return () => { live = false; };
  }, [support, round]);
  const read: ListingsRead = support !== "open" || !st || st.round !== round ? { status: "loading" } : st.read;
  return { support, read, retrySupport, reload: () => setRound((n) => n + 1) };
}
