"use client";
import { useEffect, useState } from "react";
import { nftTier, tokensFor, type Token } from "./near";

/**
 * The key a connected account holds: its first key and that key's tier. Shared by /vault and /swap, so both read the holder the same way.
 * `lookingUp` is true from the moment an account is set until its key read settles; `keyMiss` means the read settled with no key.
 */
export function useHeldKey(accountId: string | null) {
  const [held, setHeld] = useState<{ token: Token; tier: number | null } | null>(null);
  const [keysFor, setKeysFor] = useState<string | null>(null);
  const [keysReady, setKeysReady] = useState(false);
  const [keyMiss, setKeyMiss] = useState(false);
  useEffect(() => {
    if (!accountId) { setHeld(null); setKeysFor(null); setKeysReady(false); setKeyMiss(false); return; }
    let cancel = false;
    setKeysFor(accountId);
    setKeysReady(false);
    setHeld(null);
    setKeyMiss(false);
    tokensFor(accountId).then(async (toks) => {
      const token = toks[0];
      if (!token || cancel) { if (!cancel) { setHeld(null); setKeyMiss(true); setKeysReady(true); } return; }
      const tier = await nftTier(token.token_id).catch(() => null);
      if (!cancel) { setHeld({ token, tier }); setKeyMiss(false); setKeysReady(true); }
    }).catch(() => { if (!cancel) { setHeld(null); setKeyMiss(false); setKeysReady(true); } });
    return () => { cancel = true; };
  }, [accountId]);
  const lookingUp = !!accountId && (!keysReady || keysFor !== accountId);
  return { held, keyMiss, lookingUp };
}
