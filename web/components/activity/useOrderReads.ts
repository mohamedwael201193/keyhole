"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SETTLEMENTS, type Settlement } from "@/lib/settlements";
import type { LiveStatus, OrderRead } from "./orders";

/**
 * Reads the live 1Click status of every listed order (GET /api/oneclick, one request per order, in parallel). Each order has its
 * own read: loading, ok (with the status payload) or error. `retry` reads one order again. The pure rules live in ./orders.ts.
 */
export function useOrderReads(orders: readonly Settlement[] = SETTLEMENTS): { reads: Record<string, OrderRead>; retry: (address: string) => void } {
  const [reads, setReads] = useState<Record<string, OrderRead>>({});
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback((address: string) => {
    setReads((r) => ({ ...r, [address]: { state: "loading" } }));
    const fail = () => { if (alive.current) setReads((r) => ({ ...r, [address]: { state: "error" } })); };
    fetch(`/api/oneclick?depositAddress=${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then((j: { ok?: unknown; details?: unknown }) => {
        if (!alive.current) return;
        if (j?.ok === true && j.details && typeof j.details === "object") {
          setReads((r) => ({ ...r, [address]: { state: "ok", live: j as unknown as LiveStatus } }));
        } else {
          fail();
        }
      })
      .catch(fail);
  }, []);

  useEffect(() => {
    for (const o of orders) load(o.depositAddress);
  }, [orders, load]);

  return { reads, retry: load };
}
