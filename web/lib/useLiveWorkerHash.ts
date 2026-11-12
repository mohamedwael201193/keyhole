"use client";
import { useEffect, useState } from "react";
import { fetchLiveRegistry } from "./liveRegistry";

/**
 * The wasm sha256 currently active on the OutLayer registry.
 * Null until the read lands, and null if it fails — never a stale identity.json pin.
 */
export function useLiveWorkerHash(): string | null {
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    fetchLiveRegistry()
      .then((r) => { if (!cancel) setHash(r.active_version); })
      .catch(() => { if (!cancel) setHash(null); });
    return () => { cancel = true; };
  }, []);
  return hash;
}
