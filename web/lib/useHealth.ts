"use client";
import { useEffect, useState } from "react";
export const OFFLINE_CODES = ["service_unfunded", "gateway", "network"];

/** True on the first success. A miss or a thrown read is tried once more, then false. */
export async function resolveOnline(read: () => Promise<boolean>): Promise<boolean> {
  try { if (await read()) return true; } catch { /* cold first response */ }
  try { return await read(); } catch { return false; }
}

/**
 * A known-live server result can render immediately. A miss stays unknown
 * until the client check, including one retry, so a cold start does not flash offline.
 */
export function useHealth(initial: boolean | null = null) {
  const [online, setOnline] = useState<boolean | null>(initial === true ? true : null);
  useEffect(() => {
    let cancel = false;
    const read = async () => {
      const r = await fetch("/api/health");
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      return !!j.online;
    };
    resolveOnline(read).then((ok) => { if (!cancel) setOnline(ok); });
    return () => { cancel = true; };
  }, []);
  return online;
}
