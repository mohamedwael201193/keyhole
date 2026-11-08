"use client";
import { useEffect, useState } from "react";
import { attestation } from "./config";
import { publishedBuild, staticChecks, type Attestation } from "./verify";
import type { WorkerResult } from "./worker";

/**
 * Whether the enclave's answer for a read verifies: its attestation exists, is registered, and was produced by the published build.
 * null while the attestation is being fetched. Used before any history entry is shown.
 */
export function useLogVerified(res: WorkerResult | null): boolean | null {
  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    const id = res?.call_id;
    if (!res?.output?.ok || !id) { setVerified(null); return; }
    let cancel = false;
    setVerified(null);
    fetch(attestation(id)).then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((a: Attestation) => {
      if (cancel) return;
      const st = staticChecks(a);
      setVerified(!!(st.quote && st.registered && publishedBuild(a.executed_wasm_sha256)));
    }).catch(() => { if (!cancel) setVerified(false); });
    return () => { cancel = true; };
  }, [res]);
  return verified;
}
