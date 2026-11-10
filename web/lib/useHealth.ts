"use client";
import { useEffect, useState } from "react";
export const OFFLINE_CODES = ["service_unfunded", "gateway", "network"];

/** True on the first success. A miss or a thrown read is tried once more, then false. */
export async function resolveOnline(read: () => Promise<boolean>): Promise<boolean> {
  try { if (await read()) return true; } catch { /* cold first response */ }
  try { return await read(); } catch { return false; }
}

/**
 * Reads the passive health payload once. A not-probed result stays unknown.
 * It is not retried into an offline claim, and it does not start a paid probe.
 */
export function useHealth(initial: boolean | null = null) {
  const [online, setOnline] = useState<boolean | null>(initial === true ? true : null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch("/api/health");
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (cancel) return;
        if (j?.mode === "passive" || j?.online == null) setOnline(null);
        else setOnline(j.online === true);
      } catch {
        if (!cancel) setOnline(false);
      }
    })();
    return () => { cancel = true; };
  }, []);
  return online;
}
