"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { callWorker } from "@/lib/worker";
import { forgetResolved, recoveries, type Recovery } from "@/lib/valueRecovery";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui";
export function ValueRecovery({ vaultOpen = false }: { vaultOpen?: boolean } = {}) {
  const path = usePathname();
  const { accountId, sign } = useWallet();
  const [rows, setRows] = useState<Recovery[]>([]);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const statusWord = (s: string) => (s.toUpperCase() === "UNKNOWN" ? "UNKNOWN (not confirmed, not failed)" : s);
  useEffect(() => { const read = () => setRows(accountId ? recoveries(accountId) : []); read(); addEventListener("storage", read); addEventListener("keyhole-recovery", read); return () => { removeEventListener("storage", read); removeEventListener("keyhole-recovery", read); }; }, [accountId]);
  async function reconcile(r: Recovery) { setBusy(true); setNotice(""); try {
    const out = await callWorker("reconcile_value_op", await sign("reconcile_value_op", { token_id: r.token_id, value_op_id: r.value_op_id }));
    setNotice(out.output?.admission_finished === true ? `Final provider settlement: ${out.output.status}. Original journal reconciled.` : "Still pending or UNKNOWN. Do not resend money; reconcile this same operation again.");
    if (out.error) setNotice(out.error.message ?? out.error.code);
  } catch { setNotice("Recovery unavailable. The original operation remains pending; nothing was resent."); } finally { setBusy(false); } }
  if (!accountId || (!rows.length && !notice && path !== "/vault" && !vaultOpen)) return null;
  return <Card as="section" testid="value-recovery"><h2>Account operation recovery</h2><p>Transfer and new value operations stay locked until the original journal settles. UNKNOWN is not failure.</p><Button disabled={busy} variant="secondary" onClick={() => { setBusy(true); void sign("status").then(auth=>callWorker("status",auth)).then(r=>{ if (r.error) { setNotice(r.error.message ?? r.error.code); return; } if (r.output?.pending_value_op) { setNotice("Original operation recovered. Check its journal below."); return; } const n = accountId ? forgetResolved(accountId, typeof r.output?.token_id === "string" ? r.output.token_id : null, r.output) : 0; if (n) dispatchEvent(new Event("keyhole-recovery")); setNotice(n ? "The enclave reports no pending operation for this key, so the local lock was cleared. The worker still refuses anything unsafe." : "No unfinished custody journal found for the current key."); }).catch(()=>setNotice("Recovery state unavailable. Nothing was resent.")).finally(()=>setBusy(false)); }}>Find an interrupted operation</Button>{rows.map(r => <div key={r.value_op_id} data-testid="recovery-row"><p>Key {r.token_id} · {statusWord(r.status)}</p><p className="note">Operation id (not a transaction hash):</p><code style={{ overflowWrap: "anywhere" }}>{r.value_op_id}</code><p className="note" data-testid="recovery-why">Checking asks your wallet for one signature, even when this session is unlocked. The worker does not accept a session for this check, so a stolen session can never touch a money operation. The check follows the original operation id only; it never starts a new operation.</p><Button disabled={busy} onClick={() => void reconcile(r)}>Check original operation</Button></div>)}<p role="status">{notice}</p>{rows.length > 0 && <p className="note" data-testid="recovery-next">Next step: check the original operation. If the check finds it was never admitted, nothing was sent and the lock clears once that is confirmed. Do not start the same swap or withdrawal again before that.</p>}</Card>;
}
