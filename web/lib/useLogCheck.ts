"use client";
import { useEffect, useState } from "react";
import { attestation } from "./config";
import { fetchLiveRegistry } from "./liveRegistry";
import { logVerifies, type Attestation } from "./verify";

/**
 * Whether an attested call ran the build currently active on the OutLayer registry:
 * the same two checks the vault runs before it lists a key's entries.
 * Returns null while the attestation and registry are being read, true or false after.
 * Pass null when there is no call to check. Fails closed if either read fails.
 */
export function useLogCheck(callId: string | null): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    setOk(null);
    if (!callId) return;
    let cancel = false;
    Promise.all([
      fetch(attestation(callId)).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }),
      fetchLiveRegistry(),
    ])
      .then(([a, reg]: [Attestation, { active_version: string }]) => {
        if (cancel) return;
        setOk(logVerifies(a, reg.active_version));
      })
      .catch(() => { if (!cancel) setOk(false); });
    return () => { cancel = true; };
  }, [callId]);
  return ok;
}
