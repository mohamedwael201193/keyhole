"use client";
import { useEffect, useState } from "react";
import { fetchLiveRegistryClient } from "./liveRegistry";

export type LiveWorker =
  | { status: "loading"; hash: null }
  | { status: "ok"; hash: string }
  | { status: "error"; hash: null };

/**
 * The wasm sha256 currently active on the OutLayer registry, read through /api/registry.
 * Three states so a page can say "reading" while loading and "unavailable" only after a failed read.
 * Never a stale identity.json pin.
 */
export function useLiveWorkerHash(): LiveWorker {
  const [state, setState] = useState<LiveWorker>({ status: "loading", hash: null });
  useEffect(() => {
    let cancel = false;
    fetchLiveRegistryClient()
      .then((r) => { if (!cancel) setState({ status: "ok", hash: r.active_version }); })
      .catch(() => { if (!cancel) setState({ status: "error", hash: null }); });
    return () => { cancel = true; };
  }, []);
  return state;
}
