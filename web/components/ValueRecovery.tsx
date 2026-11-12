"use client";
import { useEffect, useState } from "react";
import { nearView } from "@/lib/rpc";
import { useWallet } from "@/lib/wallet";
import { callWorker } from "@/lib/worker";
import { loadSession } from "@/lib/session";
import { forgetResolved, recoveries, type Recovery } from "@/lib/valueRecovery";
import { Button } from "@/components/ui";

/** How often the lock is re-checked while it is active, besides when the window regains focus. */
const RECHECK_MS = 30_000;

/** True only when the contract's public view says no value operation is pending for this key. A failed read is false, so the lock stays. */
export async function chainSaysNonePending(tokenId: string, read: (t: string) => Promise<unknown> = (t) => nearView<unknown>("pending_value_op_count", { token_id: t })): Promise<boolean> {
  try { return String(await read(tokenId)) === "0"; } catch { return false; }
}

/**
 * One quiet line inside the card of the operation that is waiting on an earlier one. It is never a page-level card.
 * With a live session the enclave's status is read once in the background (no signature); when it reports nothing pending the
 * local lock is cleared by itself. Confirming the original operation is a money-adjacent check, so the worker still asks for one
 * wallet signature (the session is not accepted for it) and this line shows a single "Confirm" button for it.
 */
export function ValueRecovery({ testid = "value-recovery" }: { testid?: string } = {}) {
  const { accountId, sign, session } = useWallet();
  const [rows, setRows] = useState<Recovery[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
    useEffect(() => {
    const read = () => { try { setRows(accountId ? recoveries(accountId) : []); } catch { setRows([]); } };
    read();
    addEventListener("storage", read); addEventListener("keyhole-recovery", read);
    return () => { removeEventListener("storage", read); removeEventListener("keyhole-recovery", read); };
  }, [accountId]);

  // Background check with the live session (no popup). The local lock is cleared only when BOTH the enclave status reports nothing
  // pending AND the public contract view pending_value_op_count(token_id) is exactly "0". If either read fails, the lock stays.
  // It re-checks every ~30 s and when the window regains focus, for as long as the lock is active.
  const tokens = Array.from(new Set(rows.map((r) => r.token_id))).join(",");
  useEffect(() => {
    if (!accountId || !tokens || !session) return;
    let cancel = false, running = false;
    const check = async () => {
      if (running || cancel || !loadSession(accountId)) return;
      running = true;
      try {
        const r = await callWorker("status", await sign("status"));
        if (cancel || r.error || r.output?.pending_value_op) return;
        for (const tokenId of tokens.split(",")) {
          if (!(await chainSaysNonePending(tokenId))) continue;
          if (forgetResolved(accountId, tokenId, r.output)) dispatchEvent(new Event("keyhole-recovery"));
        }
      } catch { /* stays locked; the Confirm button is the way forward */ }
      finally { running = false; }
    };
    void check();
    const id = setInterval(() => { void check(); }, RECHECK_MS);
    const onFocus = () => { void check(); };
    addEventListener("focus", onFocus);
    return () => { cancel = true; clearInterval(id); removeEventListener("focus", onFocus); };
  }, [accountId, tokens, session, sign]);

  async function confirm(r: Recovery) {
    setBusy(true); setNote("");
    try {
      const out = await callWorker("reconcile_value_op", await sign("reconcile_value_op", { token_id: r.token_id, value_op_id: r.value_op_id }));
      if (out.error) setNote("Still confirming. Nothing was resent. Try again in a moment.");
      else setNote(out.output?.admission_finished === true ? "Confirmed." : "Still confirming. Nothing was resent.");
    } catch { setNote("Still confirming. Nothing was resent."); } finally { setBusy(false); }
  }

  if (!accountId || (!rows.length && !note)) return null;
  const r = rows[0];
  return (
    <div className="kh-quiet" data-testid={testid} role="status">
      <span className="kh-quiet-line">
        {(busy || r) && <span className="spin kh-quiet-spin" aria-hidden="true" />}
        <span>{note && !r ? note : "Confirming an earlier transaction. New ones wait until it's confirmed."}</span>
        {r && <Button size="sm" variant="secondary" loading={busy} loadingLabel="Confirming" onClick={() => void confirm(r)} testid={`${testid}-confirm`}>Confirm</Button>}
      </span>
      {note && r && <span className="kh-quiet-note">{note}</span>}
      {r && (
        <details className="kh-details">
          <summary>Details</summary>
          <p>Reference <code>{r.value_op_id}</code> (not a transaction hash). Confirming asks your wallet for one signature and never starts anything new.</p>
        </details>
      )}
    </div>
  );
}
