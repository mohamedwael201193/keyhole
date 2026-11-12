"use client";
import { useEffect, useState } from "react";

/**
 * A determinate progress bar for a read that runs inside the enclave, which takes 5 to 8 seconds. It fills toward 95% over the
 * expected time and never claims to be done: the caller unmounts it (or sets `active` false) when the answer lands. So a slow read
 * looks like work in progress, not like a hang. Only the elapsed time is shown; no number comes from the enclave.
 */
export function TeeProgress({ active, expectedMs = 8000, label = "Reading inside the enclave", testid = "tee-progress" }: { active: boolean; expectedMs?: number; label?: string; testid?: string }) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!active) { setMs(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setMs(Date.now() - t0), 250);
    return () => clearInterval(id);
  }, [active]);
  if (!active) return null;
  const pct = Math.min(95, Math.round((ms / expectedMs) * 100));
  const s = Math.floor(ms / 1000);
  return (
    <div className="tee-progress" data-testid={testid} role="status">
      <div className="tee-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
      <small>{label} · {s}s{ms < expectedMs ? ` of about ${Math.round(expectedMs / 1000)}s` : ", still working"}</small>
    </div>
  );
}
