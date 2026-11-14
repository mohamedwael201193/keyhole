"use client";
/** The live supply figure. Server-rendered from loadLanding; it re-reads /api/supply every minute (and on
 * focus) so the number on the page follows mints instead of freezing at the server's read. The server value
 * stays visible until a fresh read lands — never a "..." placeholder. While no number is on screen yet, it
 * retries every 3 s so a slow first read never leaves a blank value for long. */
import { useEffect, useState } from "react";

export function SupplyStat({ initial }: { initial: number | null }) {
  const [n, setN] = useState(initial);
  const missing = n == null;
  useEffect(() => {
    let cancel = false;
    const tick = () => fetch("/api/supply").then((r) => r.json()).then((j) => {
      if (!cancel && Number.isInteger(j?.supply)) setN(j.supply);
    }).catch(() => {});
    tick();
    // Recovery mode while blank (3 s), steady live-update mode once a number lands (60 s).
    const id = window.setInterval(tick, missing ? 3_000 : 60_000);
    const onFocus = () => tick();
    addEventListener("focus", onFocus);
    return () => { cancel = true; window.clearInterval(id); removeEventListener("focus", onFocus); };
  }, [missing]);
  return <span data-testid="supply">{n == null ? "—" : n}</span>;
}
