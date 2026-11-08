"use client";
import { useEffect, useState } from "react";
import { KEYS_CONTRACT } from "@/lib/config";
import { nftToken, view, type Config } from "@/lib/near";

/**
 * The key's holder and the minter the contract names, read from NEAR mainnet in the browser (public views, no wallet).
 * undefined while reading; null when the read failed or the key is not on chain; a string when read.
 */
export function useKeyChain(id: string): { owner: string | null | undefined; minter: string | null | undefined } {
  const [st, setSt] = useState<{ id: string; owner: string | null; minter: string | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void Promise.allSettled([nftToken(id), view<Config>("config", {}, KEYS_CONTRACT, { shared: true })]).then(([t, c]) => {
      if (!live) return;
      setSt({
        id,
        owner: t.status === "fulfilled" ? t.value?.owner_id ?? null : null,
        minter: c.status === "fulfilled" ? c.value?.minter ?? null : null,
      });
    });
    return () => { live = false; };
  }, [id]);
  const cur = st && st.id === id ? st : null;
  return { owner: cur ? cur.owner : undefined, minter: cur ? cur.minter : undefined };
}
