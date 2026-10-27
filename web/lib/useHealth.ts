"use client";
import { useEffect, useState } from "react";
export const OFFLINE_CODES = ["service_unfunded", "gateway", "network"];
/** Server-rendered status first (no late swap), then refreshed once on the client. */
export function useHealth(initial: boolean | null = null) {
  const [online, setOnline] = useState<boolean | null>(initial);
  useEffect(() => { fetch("/api/health").then((r) => r.json()).then((j) => setOnline(!!j.online)).catch(() => {}); }, []);
  return online;
}
