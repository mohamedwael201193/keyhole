"use client";
import { useEffect, useState } from "react";
import { attestation } from "./config";
import { publishedBuild, staticChecks, type Attestation } from "./verify";

/**
 * Whether an attested call ran a build we publish: the same two checks the vault runs before it lists a key's entries.
 * Returns null while the attestation is being read, true or false after. Pass null when there is no call to check.
 */
export function useLogCheck(callId: string | null): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    setOk(null);
    if (!callId) return;
    let cancel = false;
    fetch(attestation(callId))
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((a: Attestation) => {
        if (cancel) return;
        const st = staticChecks(a);
        setOk(!!(st.quote && st.registered && publishedBuild(a.executed_wasm_sha256)));
      })
      .catch(() => { if (!cancel) setOk(false); });
    return () => { cancel = true; };
  }, [callId]);
  return ok;
}
