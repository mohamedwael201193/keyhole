"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { callWorker } from "@/lib/worker";
import { recoveries, type Recovery } from "@/lib/valueRecovery";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui";
export function ValueRecovery() {
  const path = usePathname();
  const { accountId, sign } = useWallet();
  const [rows, setRows] = useState<Recovery[]>([]);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => { const read = () => setRows(accountId ? recoveries(accountId) : []); read(); addEventListener("storage", read); addEventListener("keyhole-recovery", read); return () => { removeEventListener("storage", read); removeEventListener("keyhole-recovery", read); }; }, [accountId]);
  async function reconcile(r: Recovery) { setBusy(true); setNotice(""); try {
    const out = await callWorker("reconcile_value_op", await sign("reconcile_value_op", { token_id: r.token_id, value_op_id: r.value_op_id }));
    setNotice(out.output?.admission_finished === true ? `Final provider settlement: ${out.output.status}. Original journal reconciled.` : "Still pending or UNKNOWN. Do not resend money; reconcile this same operation again.");
    if (out.error) setNotice(out.error.message ?? out.error.code);
  } catch { setNotice("Recovery unavailable. The original operation remains pending; nothing was resent."); } finally { setBusy(false); } }
  if (!accountId || (!rows.length && !notice && path !== "/vault")) return null;
  return <Card as="section" testid="value-recovery"><h2>Account operation recovery</h2><p>Transfer and new value operations stay locked until the original journal settles. UNKNOWN is not failure.</p><Button disabled={busy} variant="secondary" onClick={() => { setBusy(true); void sign("status").then(auth=>callWorker("status",auth)).then(r=>setNotice(r.error ? r.error.message ?? r.error.code : r.output?.pending_value_op ? "Original operation recovered. Check its journal below." : "No unfinished custody journal found for the current key.")).catch(()=>setNotice("Recovery state unavailable. Nothing was resent.")).finally(()=>setBusy(false)); }}>Find an interrupted operation</Button>{rows.map(r => <div key={r.value_op_id}><p>Key {r.token_id} · {r.status}</p><code style={{ overflowWrap: "anywhere" }}>{r.value_op_id}</code><Button disabled={busy} onClick={() => void reconcile(r)}>Check original operation</Button></div>)}<p role="status">{notice}</p></Card>;
}
