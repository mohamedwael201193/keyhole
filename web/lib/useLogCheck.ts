"use client";
import { useLogState } from "./useLogState";

/**
 * Whether an attested call ran the build currently active on the OutLayer registry AND its Intel quote verifies here.
 * null while reading, true only for a full pass. Pass null when there is no call to check. Fails closed.
 * Use useLogState for the finer states (previous build, quote not verified in this browser).
 */
export function useLogCheck(callId: string | null): boolean | null {
  const s = useLogState(callId);
  return s === "pending" ? null : s === "verified";
}
