"use client";
import { useEffect, useState } from "react";
import { attestation } from "./config";
import { fetchLiveRegistryClient } from "./liveRegistry";
import { resolveLogState, type LogState } from "./logState";
import type { Attestation } from "./verify";

/** State of the attested call that gates a log. `null` call id = nothing to check (stays pending). */
export function useLogState(callId: string | null): LogState {
  const [state, setState] = useState<LogState>("pending");
  useEffect(() => {
    setState("pending");
    if (!callId) return;
    let cancel = false;
    Promise.all([
      fetch(attestation(callId)).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<Attestation>; }),
      fetchLiveRegistryClient().then((r) => r.active_version).catch(() => null),
    ])
      .then(([a, live]) => resolveLogState(a, live))
      .then((s) => { if (!cancel) setState(s); })
      .catch(() => { if (!cancel) setState("failed"); });
    return () => { cancel = true; };
  }, [callId]);
  return state;
}
