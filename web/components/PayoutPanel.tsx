"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { KEYS_CONTRACT, RPC_URL } from "@/lib/config";
import { readPayout, registerPayoutCall, claimPayoutCall, verifyPayoutReceipt, type PayoutState } from "@/lib/payout";
import { browserMoneyStore, clearVerifiedMoneyOperation, dispatchMoneyBatch, finalMoneyReceipt, nextFinalBlockHeight, type MoneyOperation } from "@/lib/pledgeMoney";
import { nearText } from "@/lib/sale";
import { Button, Checkbox } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { InCardFailure, InCardProgress, InCardSuccess, Details } from "@/components/InCard";
import { nearTx } from "@/lib/explorer";

/** What the last payout step said: confirmed (with its transaction), still being confirmed, or not confirmed. */
type Note = { tone: "ok" | "wait" | "bad"; text: string };
/** Vault's single ordinary-payout surface; shares Pledge's account/contract intent lock. */
export function PayoutPanel({ onChanged }: { onChanged?: () => void }) {
  const { accountId, sendTxBatch } = useWallet();
  const accountNow = useRef(accountId);
  useLayoutEffect(() => { accountNow.current = accountId; }, [accountId]);
  const store = useMemo(() => accountId && typeof window !== "undefined" ? browserMoneyStore(accountId, KEYS_CONTRACT) : null, [accountId]);
  const [state, setState] = useState<{ account: string; value: PayoutState } | null>(null);
  const [operation, setOperation] = useState<MoneyOperation | null>(null);
  const [round, setRound] = useState(0), [busy, setBusy] = useState(false), [acceptedFee, setAcceptedFee] = useState<string | null>(null), [notice, setNotice] = useState<Note | null>(null), [hash, setHash] = useState<string | null>(null);
  const consentNow = useRef(acceptedFee);
  useLayoutEffect(() => { consentNow.current = acceptedFee; }, [acceptedFee]);
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
      setNotice({ tone: "wait", text: "Your payout is not confirmed yet. Do not send it again. Refresh to check it." });
      return;
    }
    const delivered = saved.call.method === "claim_payout" && await verifyPayoutReceipt(txHash, accountId);
    if (accountNow.current !== accountId) return;
    const cleared = await clearVerifiedMoneyOperation(store, saved, snapshot => finalMoneyReceipt({ ...snapshot, txHash }, RPC_URL));
    setOperation(store.load()); setHash(txHash);
    setNotice(!cleared ? { tone: "wait", text: "Your saved request changed. Do not send it again." } : delivered ? { tone: "ok", text: "Payout delivered. The network confirmed it." } : saved.call.method === "register_payout_account" ? { tone: "ok", text: "Payout slot request confirmed. Refresh to see your slot." } : { tone: "wait", text: "The payout request is confirmed, but delivery is not. Your credit is refreshed; nothing is sent again." });
  }, [accountId, store]);
  useEffect(() => { setAcceptedFee(null); setHash(null); setNotice(null); setState(null); setOperation(null); }, [accountId]);
  useEffect(() => { let live = true; void refresh().catch(() => { if (live) { setState(null); setNotice({ tone: "bad", text: "Payout details could not be read. Your earlier request is kept; do not send it again." }); } }); return () => { live = false; }; }, [refresh, round]);
  useEffect(() => store?.subscribe?.(() => { try { setOperation(store.load()); } catch { setState(null); setNotice({ tone: "bad", text: "Your saved payout request could not be read. Do not start a new payout." }); } }), [store]);
  const s = state?.account === accountId ? state.value : null;
  const feeKey = s?.supported ? `${KEYS_CONTRACT}:${accountId}:${s.cost}` : null;
  const accepted = feeKey !== null && acceptedFee === feeKey;
  useEffect(() => { setAcceptedFee(null); }, [feeKey]);
  async function act(claim: boolean) {
    if (!accountId || !store || !s?.supported || busy || operation || (!claim && !accepted)) return;
    setBusy(true); setNotice(null);
    try {
      if (store.load()) throw Error("An earlier payout request is unresolved. Check it first; do not send it again.");
      const fresh = await readPayout(accountId);
      if (accountNow.current !== accountId) return;
      const call = claim ? claimPayoutCall(fresh) : registerPayoutCall(fresh, s.cost);
      const op = await dispatchMoneyBatch(accountId, KEYS_CONTRACT, [call], store, calls => sendTxBatch(calls, {
        expectedSigner: accountId,
        assertCurrent: () => {
          if (accountNow.current !== accountId || (!claim && consentNow.current !== feeKey)) throw Error("Signer or exact storage consent changed; nothing was sent.");
        },
      }), await nextFinalBlockHeight(RPC_URL));
      setOperation(op); await refresh();
      setAcceptedFee(null); setRound(n => n + 1); onChanged?.();
    } catch { setOperation(store.load()); setNotice({ tone: "bad", text: "No payout is confirmed. Refresh to check your request; do not send it again." }); }
    finally { setBusy(false); }
  }
  if (!accountId || s?.supported === false) return null;
  const refreshBtn = <Button variant="quiet" size="sm" disabled={busy} onClick={()=>setRound(n=>n+1)}>Refresh payout state</Button>;
  const link = hash ? { href: nearTx(hash), label: "View transaction", testid: "payout-tx-link" } : null;
  return <Card as="section" testid="payout-panel" className="kh-panel"><h2>Native payouts &amp; refunds</h2>
    {busy ? <InCardProgress title={s?.supported && s.registered ? "Claiming your payout…" : "Registering your payout slot…"} line="Confirm in your wallet, then wait a moment." testid="payout-pending" lineTestid="payout-pending-line" />
    : notice?.tone === "ok" && hash ? <InCardSuccess testid="payout-out" title="Confirmed" amount={notice.text} link={link} actions={<>{refreshBtn}<Button variant="quiet" size="sm" onClick={() => { setNotice(null); setHash(null); }}>Done</Button></>} />
    : !s ? <p className="kh-panel-line" role="status">{notice?.text || "Reading your payout state…"}</p> : <>
    {notice && notice.tone === "bad" && <InCardFailure testid="payout-failed" reason={notice.text} action={{ label: "Check again", onClick: () => setRound(n => n + 1), testid: "payout-retry" }} />}
    {!s.registered ? <>
      <p className="kh-panel-line">One-time setup: {nearText(s.cost)} NEAR opens your payout slot. It is a permanent storage charge.</p>
      <Checkbox checked={accepted} onChange={v=>setAcceptedFee(v ? feeKey : null)} label={<>I accept the exact {nearText(s.cost)} NEAR storage charge</>} testid="payout-accept" />
      <div><Button disabled={!accepted || busy || !!operation} onClick={()=>void act(false)}>Register my payout slot</Button></div>
      <div>{refreshBtn}</div>
      <div className="kh-panel-note"><Details label="Details" testid="payout-details"><p>The slot uses 320 bytes of permanent storage and the charge is not refunded. It is separate from the 0.01 NEAR refundable listing bond and from gas. Sale proceeds, listing and approval refunds, and mint excess become credits you claim here; they are not paid out on their own.</p></Details></div>
    </> : <>
      <p className="kh-panel-line">Available credit: {nearText(s.credit)} NEAR. {s.pending ? "A payout is on its way. Funds may already have arrived, so do not send it again." : "Claiming sends it to your wallet."}</p>
      <div><Button disabled={busy || !!s.pending || !!operation || BigInt(s.credit) === 0n} onClick={()=>void act(true)}>Claim native NEAR</Button></div>
      <div>{refreshBtn}</div>
      <div className="kh-panel-note"><Details label="Details" testid="payout-details"><p>The credit is held by the contract and has not been delivered yet.{s.pending ? ` Payout ${s.pending.nonce}: ${nearText(s.pending.amount)} NEAR.` : ""}</p></Details></div>
    </>}
    {operation && <p className="kh-panel-note">Your last payout request is still being confirmed. Do not send it again.</p>}
    {notice && notice.tone === "wait" && <p className="kh-panel-note" role="status">{notice.text}</p>}
    {hash && notice?.tone !== "ok" && <a className="kh-panel-note" href={nearTx(hash)} target="_blank" rel="noreferrer">View transaction</a>}
  </>}</Card>;
}
