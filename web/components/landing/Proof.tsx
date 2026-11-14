"use client";
/** The live supply figure. Server-rendered from loadLanding; it re-reads /api/supply every minute (and on
 * focus) so the number on the page follows mints instead of freezing at the server's read. The server value
 * stays visible until a fresh read lands — never a "..." placeholder. */
import { useEffect, useState } from "react";

export function SupplyStat({ initial }: { initial: number | null }) {
  const [n, setN] = useState(initial);
  useEffect(() => {
    let cancel = false;
    const tick = () => fetch("/api/supply").then((r) => r.json()).then((j) => {
      if (!cancel && Number.isInteger(j?.supply)) setN(j.supply);
    }).catch(() => {});
    tick();
    const id = window.setInterval(tick, 60_000);
    const onFocus = () => tick();
    addEventListener("focus", onFocus);
    return () => { cancel = true; window.clearInterval(id); removeEventListener("focus", onFocus); };
  }, []);
  return <span data-testid="supply">{n == null ? "—" : n}</span>;
}
