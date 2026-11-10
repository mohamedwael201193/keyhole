"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { readPayout, registerPayoutCall, claimPayoutCall, verifyPayoutReceipt, type PayoutState } from "@/lib/payout";
import { nearText } from "@/lib/sale";
import { Button } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { TxLink } from "@/components/TxLink";
export function PayoutPanel({ onChanged }: { onChanged?: () => void }) {
  const { accountId, sendTx } = useWallet();
  const accountNow = useRef(accountId);
  useEffect(() => { accountNow.current = accountId; }, [accountId]);
  const [state, setState] = useState<{ account: string; value: PayoutState } | null>(null);
  const [round, setRound] = useState(0), [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false), [notice, setNotice] = useState(""), [hash, setHash] = useState<string | null>(null);
  useEffect(() => { setAccepted(false); setHash(null); setNotice(""); }, [accountId]);
  useEffect(() => { if (!accountId) return; let live = true; readPayout(accountId).then(value => { if (live) setState({ account: accountId, value }); }, () => { if (live) setNotice("Payout state unavailable. Try refresh; no fee or payment has been sent."); }); return () => { live = false; }; }, [accountId, round]);
  const s = state?.account === accountId ? state.value : null;
  async function act(claim: boolean) { if (!accountId || !s?.supported || busy || (!claim && !accepted)) return; setBusy(true); setNotice("");
    try {
      const fresh = await readPayout(accountId);
      if (accountNow.current !== accountId) return;
      const call = claim ? claimPayoutCall(fresh) : registerPayoutCall(fresh, s.cost);
      sessionStorage.setItem(`kh_payout_return:${accountId}`, claim ? "claim" : "register");
      const r = await sendTx(call);
      if (accountNow.current !== accountId) return;
      if ("error" in r) { sessionStorage.removeItem(`kh_payout_return:${accountId}`); setNotice(r.error.message); }
      else if ("txHash" in r) { sessionStorage.removeItem(`kh_payout_return:${accountId}`); setHash(r.txHash); setNotice(claim ? await verifyPayoutReceipt(r.txHash, accountId) ? "Native payout delivered · FINAL receipt and callback verified." : "Payout not confirmed delivered. Check the pending credit and finalized receipt; never send a duplicate claim." : "Registration transaction recorded. Refresh to verify the registered slot."); }
      else setNotice("Continue in your wallet. No finalized payout is claimed yet.");
      setAccepted(false); setRound(n => n+1); onChanged?.();
    } catch { setNotice("No payout is confirmed. Refresh the credit/pending state before trying again."); } finally { setBusy(false); }
  }
  useEffect(() => { if (!accountId) return; const action = sessionStorage.getItem(`kh_payout_return:${accountId}`); const h = new URL(location.href).searchParams.get("transactionHashes")?.split(",")[0];
    if (!action || !h) return; sessionStorage.removeItem(`kh_payout_return:${accountId}`); setHash(h); setRound(n=>n+1);
    if (action === "claim") void verifyPayoutReceipt(h, accountId).then(ok => setNotice(ok ? "Native payout delivered · FINAL receipt and callback verified." : "Payout not confirmed delivered. Check pending state; do not resend."), () => setNotice("Receipt unavailable; payout delivery is UNKNOWN."));
  }, [accountId]);
  if (!accountId || s?.supported === false) return null;
  return <Card as="section" testid="payout-panel"><h2>Native payouts &amp; refunds</h2>{!s ? <p>{notice || "Reading final payout state…"}</p> : <>
    {!s.registered ? <><p>First use: {nearText(s.cost)} NEAR permanent payout storage (320 bytes, nonrefundable). Separate from the 0.01 NEAR refundable listing bond and gas. Sale proceeds, listing/approval refunds and mint excess become pull credits, not cash already delivered.</p><label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} /> I accept the exact {nearText(s.cost)} NEAR storage charge.</label><Button disabled={!accepted || busy} onClick={()=>void act(false)}>Register my payout slot</Button></> : <>
    <p>Available credit: {nearText(s.credit)} NEAR. {s.pending ? `Native payout pending · ${nearText(s.pending.amount)} NEAR · nonce ${s.pending.nonce}. UNKNOWN stays locked; timeout is not failure.` : "No payout in flight."}</p>
    <Button disabled={busy || !!s.pending || BigInt(s.credit) === 0n} onClick={()=>void act(true)}>Claim native NEAR</Button></>}
    <Button variant="secondary" disabled={busy} onClick={()=>setRound(n=>n+1)}>Refresh payout state</Button><p role="status">{notice}</p>{hash && <TxLink hash={hash} />}</>}</Card>;
}
