"use client";
import { useCallback, useEffect, useState } from "react";
import { isTerminalStatus } from "./oneclick";
import { isOrderVisible, readOrder, removeOrder, writeOrder, type OrderStatus, type SavedOrder } from "./fundOrder";

const POLL_MS = 10_000;

/**
 * The saved order for the holder's key, and its status. Polls /api/oneclick (status) every 10 s and stops for good on a
 * terminal status. `order` is null when there is nothing to show (no saved order, or it is past its window and terminal).
 */
export function useFundOrder(account: string | null, tokenId: string | null) {
  const [saved, setSaved] = useState<SavedOrder | null>(null);
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [statusErr, setStatusErr] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Re-check the window every 30 s, so an order ages out without a reload.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Load the saved order for this account and key. A different key never shows the previous order.
  useEffect(() => {
    setStatus(null);
    setStatusErr(false);
    setSaved(account && tokenId ? readOrder(account, tokenId) : null);
  }, [account, tokenId]);

  const addr = saved?.depositAddress ?? null;
  useEffect(() => {
    if (!addr) return;
    let stop = false;
    let id: ReturnType<typeof setInterval> | undefined;
    const halt = () => { if (id !== undefined) { clearInterval(id); id = undefined; } };
    const tick = async () => {
      const r = await fetch(`/api/oneclick?depositAddress=${encodeURIComponent(addr)}`).then((x) => x.json()).catch(() => null);
      if (stop) return;
      if (r?.ok) { setStatus({ status: r.status, updatedAt: r.updatedAt }); setStatusErr(false); if (isTerminalStatus(r.status)) halt(); }
      else setStatusErr(true);
    };
    void tick();
    id = setInterval(() => void tick(), POLL_MS);
    return () => { stop = true; halt(); };
  }, [addr]);

  const save = useCallback((o: Omit<SavedOrder, "account" | "tokenId" | "createdAt">) => {
    if (!account || !tokenId) return;
    const full: SavedOrder = { ...o, account, tokenId, createdAt: Date.now() };
    writeOrder(full);
    setStatus(null);
    setStatusErr(false);
    setSaved(full);
  }, [account, tokenId]);

  const clear = useCallback(() => {
    if (account && tokenId) removeOrder(account, tokenId);
    setSaved(null);
    setStatus(null);
    setStatusErr(false);
  }, [account, tokenId]);

  const visible = saved && isOrderVisible(saved, status?.status, now) ? saved : null;
  return {
    order: visible,
    status,
    statusErr,
    terminal: isTerminalStatus(status?.status),
    save,
    clear,
  };
}
