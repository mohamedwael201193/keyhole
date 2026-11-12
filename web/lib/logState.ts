import { b64, verifyQuote } from "./dcap";
import { bindingCheck, currentIndex, staticChecks, type Attestation } from "./verify";

/**
 * pending: still reading. verified: quote present, registered == executed, executed == live registry hash, and the
 * Intel DCAP quote check passes in this browser. quote_unverified: registry match but DCAP could not run here.
 * previous: genuine older published build, not the current worker. failed: anything else, including an unreadable registry.
 */
export type LogState = "pending" | "verified" | "quote_unverified" | "previous" | "failed";

/** Pure decision for one attestation against the live registry hash (null = the live read failed). */
export async function resolveLogState(a: Attestation, live: string | null): Promise<LogState> {
  if (!live) return "failed";
  const idx = currentIndex(a.executed_wasm_sha256, live);
  if (idx < 0) return "failed";
  const st = staticChecks(a, live);
  if (!st.quote || !st.registered) return "failed";
  let ran = true;
  let ok = false;
  try {
    const binding = await bindingCheck(a);
    ok = verifyQuote(b64(a.tdx_quote), { expectReportData: binding?.expected }).ok;
  } catch { ran = false; }
  if (!ran) return idx === 0 ? "quote_unverified" : "failed";
  if (!ok) return "failed";
  return idx === 0 ? "verified" : "previous";
}
