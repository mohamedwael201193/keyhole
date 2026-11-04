"use client";
import { useEffect, useState } from "react";
import { healthLabel, type HealthView } from "@/lib/healthLabel";
export function HealthStrip() {
  const [h, setH] = useState<HealthView | null | "error">(null);
  useEffect(() => {
    let cancel = false;
    fetch("/api/health").then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((j) => { if (!cancel) setH(j); }).catch(() => { if (!cancel) setH("error"); });
    return () => { cancel = true; };
  }, []);
  const l = healthLabel(h);
  return <p className={`hstrip h-${l.state}`} data-testid="health-strip" data-state={l.state} role="status"><i aria-hidden />{l.text}</p>;
}
