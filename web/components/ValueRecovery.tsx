"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { callWorker } from "@/lib/worker";
import { loadSession } from "@/lib/session";
import { forgetResolved, recoveries, type Recovery } from "@/lib/valueRecovery";
import { Button } from "@/components/ui";

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
  const checked = useRef("");
  useEffect(() => {
    const read = () => { try { setRows(accountId ? recoveries(accountId) : []); } catch { setRows([]); } };
    read();
    addEventListener("storage", read); addEventListener("keyhole-recovery", read);
    return () => { removeEventListener("storage", read); removeEventListener("keyhole-recovery", read); };
  }, [accountId]);

  // Background check with the live session: no popup. Clears a stale local lock when the enclave reports nothing pending.
  const first = rows[0]?.value_op_id ?? "";
  useEffect(() => {
    if (!accountId || !first || !session || !loadSession(accountId)) return;
    const k = `${accountId}:${first}`;
    if (checked.current === k) return;
    checked.current = k;
    let cancel = false;
    void (async () => {
      try {
        const r = await callWorker("status", await sign("status"));
        if (cancel || r.error || r.output?.pending_value_op) return;
        const n = forgetResolved(accountId, typeof r.output?.token_id === "string" ? r.output.token_id : null, r.output);
        if (n) dispatchEvent(new Event("keyhole-recovery"));
      } catch { /* stays locked; the Confirm button is the way forward */ }
    })();
    return () => { cancel = true; };
  }, [accountId, first, session, sign]);

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
        <span>{note && !r ? note : "Confirming an earlier deposit… no funds at risk"}</span>
        {r && <Button size="sm" variant="secondary" loading={busy} loadingLabel="Confirming" onClick={() => void confirm(r)} testid={`${testid}-confirm`}>Confirm</Button>}
      </span>
      {note && r && <span className="kh-quiet-note">{note}</span>}
      {r && (
        <details className="kh-details">
          <summary>Details</summary>
          <p>Reference <code>{r.value_op_id}</code> (a reference, not a transaction). Confirming asks your wallet for one signature and never starts anything new.</p>
        </details>
      )}
    </div>
  );
}
