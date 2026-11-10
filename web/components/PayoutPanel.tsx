"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { KEYS_CONTRACT, RPC_URL } from "@/lib/config";
import { readPayout, registerPayoutCall, claimPayoutCall, verifyPayoutReceipt, type PayoutState } from "@/lib/payout";
import { browserMoneyStore, clearVerifiedMoneyOperation, dispatchMoneyBatch, finalMoneyReceipt, nextFinalBlockHeight, type MoneyOperation } from "@/lib/pledgeMoney";
import { nearText } from "@/lib/sale";
import { Button } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { TxLink } from "@/components/TxLink";
/** Vault's single ordinary-payout surface; shares Pledge's account/contract intent lock. */
export function PayoutPanel({ onChanged }: { onChanged?: () => void }) {
  const { accountId, sendTx, sendTxBatch } = useWallet();
  const accountNow = useRef(accountId);
  accountNow.current = accountId;
  const store = useMemo(() => accountId && typeof window !== "undefined" ? browserMoneyStore(accountId, KEYS_CONTRACT) : null, [accountId]);
  const [state, setState] = useState<{ account: string; value: PayoutState } | null>(null);
  const [operation, setOperation] = useState<MoneyOperation | null>(null);
  const [round, setRound] = useState(0), [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false), [notice, setNotice] = useState(""), [hash, setHash] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!accountId || !store) return;
    const saved = store.load();
    setOperation(saved);
    const value = await readPayout(accountId);
    if (accountNow.current !== accountId) return;
    setState({ account: accountId, value });
    if (!saved || !value.supported) return;
    // A redirect URL is only a candidate hash; verify every bound action and dispatch height.
    const returned = new URL(location.href).searchParams.get("transactionHashes");
    const txHash = saved.txHash ?? (returned && !returned.includes(",") ? returned : undefined);
    if (!txHash || value.pending || !await finalMoneyReceipt({ ...saved, txHash }, RPC_URL)) {
      setNotice("Native outcome pending / UNKNOWN. Keep the original operation; do not resend.");
      return;
    }
    const delivered = saved.call.method === "claim_payout" && await verifyPayoutReceipt(txHash, accountId);
    if (accountNow.current !== accountId) return;
    const cleared = await clearVerifiedMoneyOperation(store, saved, snapshot => finalMoneyReceipt({ ...snapshot, txHash }, RPC_URL));
    setOperation(store.load()); setHash(txHash);
    setNotice(!cleared ? "The saved operation changed. Keep the current original intent; do not resend." : delivered ? "Native payout delivered · FINAL receipt and callback verified." : "Original transaction finalized; delivery is not confirmed. Current credit is refreshed; no automatic retry.");
  }, [accountId, store]);
  useEffect(() => { setAccepted(false); setHash(null); setNotice(""); setState(null); setOperation(null); }, [accountId]);
  useEffect(() => { let live = true; void refresh().catch(() => { if (live) { setState(null); setNotice("Payout state unavailable. The original operation is retained; do not resend."); } }); return () => { live = false; }; }, [refresh, round]);
  useEffect(() => store?.subscribe?.(() => { try { setOperation(store.load()); } catch { setState(null); setNotice("Pending-operation storage is unreadable. Do not submit new money operations."); } }), [store]);
  const s = state?.account === accountId ? state.value : null;
  async function act(claim: boolean) {
    if (!accountId || !store || !s?.supported || busy || operation || (!claim && !accepted)) return;
    setBusy(true); setNotice("");
    try {
      if (store.load()) throw Error("An earlier money operation is unresolved. Check its original receipt; do not resend.");
      const fresh = await readPayout(accountId);
      if (accountNow.current !== accountId) return;
      const call = claim ? claimPayoutCall(fresh) : registerPayoutCall(fresh, s.cost);
      if (claim) {
        const op = await dispatchMoneyBatch(accountId, KEYS_CONTRACT, [call], store, calls => sendTxBatch(calls, { expectedSigner: accountId }), await nextFinalBlockHeight(RPC_URL));
        setOperation(op); await refresh();
      } else {
        // Registration has its own exact fee consent; it is never silently bought by cashout.
        const r = await sendTx(call);
        if (accountNow.current !== accountId) return;
        if ("error" in r) setNotice(r.error.message);
        else if ("txHash" in r) { setHash(r.txHash); setNotice("Registration transaction recorded. Refresh to verify the registered slot."); }
        else setNotice("Continue in your wallet. Registration is not yet verified.");
      }
      setAccepted(false); setRound(n => n + 1); onChanged?.();
    } catch { setOperation(store.load()); setNotice("No payout is confirmed. Keep the original operation and refresh its receipt; do not resend."); }
    finally { setBusy(false); }
  }
  if (!accountId || s?.supported === false) return null;
  return <Card as="section" testid="payout-panel"><h2>Native payouts &amp; refunds</h2>{!s ? <p>{notice || "Reading final payout state…"}</p> : <>
    {!s.registered ? <><p>First use: {nearText(s.cost)} NEAR permanent payout storage (320 bytes, nonrefundable). Separate from the 0.01 NEAR refundable listing bond and gas. Sale proceeds, listing/approval refunds and mint excess become pull credits, not cash already delivered.</p><label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} /> I accept the exact {nearText(s.cost)} NEAR storage charge.</label><Button disabled={!accepted || busy || !!operation} onClick={()=>void act(false)}>Register my payout slot</Button></> : <>
    <p>Available credit: {nearText(s.credit)} NEAR, backed by the contract, not yet delivered. {s.pending ? "Cashout confirmation pending. Funds may already have arrived; do not send again. Check the original transfer." : "No payout in flight."}</p>
    {s.pending && <details><summary>Technical details</summary><p>Payout nonce {s.pending.nonce}; amount {nearText(s.pending.amount)} NEAR.</p></details>}
    <Button disabled={busy || !!s.pending || !!operation || BigInt(s.credit) === 0n} onClick={()=>void act(true)}>Claim native NEAR</Button></>}
    {operation && <p>Original money operation: {operation.status}. Pending / UNKNOWN is not success or permission to resend.</p>}
    <Button variant="secondary" disabled={busy} onClick={()=>setRound(n=>n+1)}>Refresh payout state</Button><p role="status">{notice}</p>{hash && <TxLink hash={hash} />}</>}</Card>;
}
