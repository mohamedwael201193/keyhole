"use client";
import { useLogState } from "./useLogState";
import type { LogState } from "./logState";
import type { WorkerResult } from "./worker";

/** State of the enclave answer's attestation (see useLogState). Pending when there is no ok result to check. */
export function useLogVerifiedState(res: WorkerResult | null): LogState {
  return useLogState(res?.output?.ok && res.call_id ? res.call_id : null);
}

/** true only for a full pass (live registry match + DCAP quote); null while reading; false otherwise. */
export function useLogVerified(res: WorkerResult | null): boolean | null {
  const s = useLogVerifiedState(res);
  if (!res?.output?.ok || !res.call_id) return null;
  return s === "pending" ? null : s === "verified";
}
