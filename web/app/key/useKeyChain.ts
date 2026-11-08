"use client";
import { useCallback, useEffect, useState } from "react";
import { KEYS_CONTRACT } from "@/lib/config";
import { view, type Config, type Token } from "@/lib/near";

/**
 * The key's holder, the minter and the royalty the contract names, read from NEAR mainnet in the browser (public views, no
 * wallet). undefined while reading; null when the read failed or the key is not on chain; a string or number when read.
 * The holder is read fresh (never from the public cache), so a sale shows at once. `refresh` reads both again.
 */
export function useKeyChain(id: string): {
  owner: string | null | undefined;
  minter: string | null | undefined;
  royaltyBps: number | null | undefined;
  refresh: () => void;
} {
  const [round, setRound] = useState(0);
  const [st, setSt] = useState<{ id: string; owner: string | null; minter: string | null; royaltyBps: number | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void Promise.allSettled([
      view<Token | null>("nft_token", { token_id: id }, KEYS_CONTRACT, { shared: false }),
      view<Config>("config", {}, KEYS_CONTRACT, { shared: round === 0 }),
    ]).then(([t, c]) => {
      if (!live) return;
      setSt({
        id,
        owner: t.status === "fulfilled" ? t.value?.owner_id ?? null : null,
        minter: c.status === "fulfilled" ? c.value?.minter ?? null : null,
        royaltyBps: c.status === "fulfilled" && typeof c.value?.royalty_bps === "number" ? c.value.royalty_bps : null,
      });
    });
    return () => { live = false; };
  }, [id, round]);
  const refresh = useCallback(() => setRound((n) => n + 1), []);
  const cur = st && st.id === id ? st : null;
  return {
    owner: cur ? cur.owner : undefined,
    minter: cur ? cur.minter : undefined,
    royaltyBps: cur ? cur.royaltyBps : undefined,
    refresh,
  };
}
