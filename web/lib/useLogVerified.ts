"use client";
import { useEffect, useState } from "react";
import { attestation } from "./config";
import { fetchLiveRegistry } from "./liveRegistry";
import { logVerifies, type Attestation } from "./verify";
import type { WorkerResult } from "./worker";

/**
 * Whether the enclave's answer for a read verifies: its attestation exists, is registered,
 * and was produced by the worker currently active on the OutLayer registry.
 * null while the attestation and registry are being fetched. Used before any history entry is shown.
 */
export function useLogVerified(res: WorkerResult | null): boolean | null {
  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    const id = res?.call_id;
    if (!res?.output?.ok || !id) { setVerified(null); return; }
    let cancel = false;
    setVerified(null);
    Promise.all([
      fetch(attestation(id)).then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      fetchLiveRegistry(),
    ]).then(([a, reg]: [Attestation, { active_version: string }]) => {
      if (cancel) return;
      setVerified(logVerifies(a, reg.active_version));
    }).catch(() => { if (!cancel) setVerified(false); });
    return () => { cancel = true; };
  }, [res]);
  return verified;
}
