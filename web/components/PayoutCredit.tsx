"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {usePathname} from "next/navigation";
import {useWallet} from "@/lib/wallet";
import {createPledgeClient,buildClaimPayout,payoutStorageConsent,type PendingPayout} from "@/lib/pledgeClient";
import {browserMoneyStore,dispatchMoneyBatch,finalMoneyReceipt,nextFinalBlockHeight,updateMoneyOperation,clearVerifiedMoneyOperation,type MoneyOperation} from "@/lib/pledgeMoney";
/** Shared across borrower, lender and sale routes: a credit is not wallet delivery. */
export function PayoutCredit() {
 const wallet=useWallet(),account=wallet.accountId,pathname=usePathname();
 const embedded=pathname?.startsWith("/pledge");
 const client=useMemo(()=>createPledgeClient({live:true}),[]);
 const [credit,setCredit]=useState("0"),[pending,setPending]=useState<PendingPayout|null>(null),[operation,setOperation]=useState<MoneyOperation|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[supported,setSupported]=useState(false);
 const store=useMemo(()=>account&&typeof window!=="undefined"?browserMoneyStore(account,client.contractId):null,[account,client.contractId]);
 const refresh=useCallback(async()=>{
  if(embedded||!account||!store)return;
  const saved=store.load();setOperation(saved);
  const hash=new URL(location.href).searchParams.get("transactionHashes"),receiptOp=saved&&!saved.txHash&&hash&&!hash.includes(",")?{...saved,txHash:hash}:saved;
  const finalized=receiptOp?await finalMoneyReceipt(receiptOp,client.rpcUrl):false;
  const [nextCredit,nextPending]=await Promise.all([client.getPayoutCredit(account),client.getPendingPayout(account)]);
  setSupported(true);setCredit(nextCredit??"0");setPending(nextPending);
  if(saved&&finalized&&!nextPending){
   const duplicate=saved.calls?.some(c=>c.method==="register_payout_account")&&saved.error?.includes("already registered");
   if(duplicate&&await client.payoutAccountRegistered(account)!==true)throw Error("Registration status is inconsistent. Keep the original operation; do not resend.");
   const resolved=await clearVerifiedMoneyOperation(store,saved,async()=>finalized);setOperation(store.load());setMessage(!resolved?"The saved operation changed while its receipt was verified. Keep the current original intent; do not resend.":duplicate?"Payout storage is already ready; the failed batch did not complete the intended action. Retry that action manually without another registration fee.":"Original transaction is finalized; current credit is refreshed. A transaction hash alone was not treated as delivery.");
  }
  else if(saved||nextPending)setMessage("Native outcome pending / UNKNOWN. Do not resend. Refresh this original operation.");
 },[account,client,store,embedded]);
 useEffect(()=>{let cancelled=false;setCredit("0");setPending(null);setOperation(null);setMessage("");setSupported(false);if(embedded||!account||!store)return;
  let saved:MoneyOperation|null=null;try{saved=store.load();}catch{setMessage("Pending-operation storage is unreadable. Do not submit new money operations.");return;}const url=new URL(location.href),hash=url.searchParams.get("transactionHashes");
  if(saved&&!saved.txHash&&hash&&!hash.includes(",")){void updateMoneyOperation(store,saved,{...saved,txHash:hash,status:"Submitted"}).then(ok=>{if(ok){url.searchParams.delete("transactionHashes");history.replaceState(null,"",url);}}).catch(()=>setMessage("Pending storage update failed; do not resend."));}
  void refresh().catch(()=>{if(!cancelled&&saved)setMessage("Status unavailable. Original money operation is retained; do not resend.");});return ()=>{cancelled=true;};
 },[account,store,refresh,pathname,embedded]);
 useEffect(()=>{if(embedded||!account||!supported)return;const update=()=>{if(document.visibilityState!=="hidden")void refresh().catch(()=>{ /* keep last known state; never send */ });};const timer=setInterval(update,15_000);addEventListener("focus",update);return ()=>{clearInterval(timer);removeEventListener("focus",update);};},[account,supported,refresh,embedded]);
 useEffect(()=>store?.subscribe?.(()=>{try{setOperation(store.load());}catch{setSupported(false);setMessage("Pending operation storage is unreadable; do not send.");}}),[store]);
 async function claim(){
  if(!account||!store||busy||!client.canTransact()||pending||operation||BigInt(credit)<=0n||/^0x[0-9a-f]{40}$/i.test(account))return;
  setBusy(true);setMessage("Confirm Claim your funds in the connected native NEAR wallet.");
  try {
   const [freshCredit,freshPending]=await Promise.all([client.getPayoutCredit(account),client.getPendingPayout(account)]);
   setCredit(freshCredit??"0");setPending(freshPending);
   if(freshPending)throw Error("A native cashout is already pending. Do not resend.");
   if(!freshCredit||BigInt(freshCredit)<=0n)throw Error("No available credit in the current final-chain view.");
   const plan=await client.prepareAction(account,buildClaimPayout());
   setMessage(payoutStorageConsent(plan.payoutStorageChargeYocto));
   const op=await dispatchMoneyBatch(account,client.contractId,plan.calls,store,calls=>wallet.sendTxBatch(calls,{expectedSigner:account}),await nextFinalBlockHeight(client.rpcUrl));setOperation(op);await refresh();
  }
  catch(e){setMessage(e instanceof Error?e.message:"Outcome unknown; keep the original operation.");setOperation(store.load());}
  finally{setBusy(false);}
 }
 if(embedded||!account||(credit==="0"&&!pending&&!operation&&!message))return null;
 return <section aria-label="Claim your funds" data-testid="payout-credit" style={{margin:"16px 24px",padding:20,border:"1px solid #d0ddd4",borderRadius:16,background:"#f3f8f4",color:"#1d3430"}}>
  <strong>Claim your funds</strong><p>{credit} yoctoNEAR available as backed contract credit, not delivered wallet funds.</p>
  {pending&&<p>Native cashout pending: nonce {pending.nonce}. No timeout refund or guessed retry.</p>}
  <button type="button" disabled={!client.canTransact()||busy||!!pending||!!operation||BigInt(credit)<=0n} onClick={()=>void claim()}>Claim your funds</button>{" "}
  <button type="button" disabled={busy} onClick={()=>{setBusy(true);void refresh().catch(()=>setMessage("Status unavailable. Do not resend.")).finally(()=>setBusy(false));}}>Refresh original status</button>
  {!client.canTransact()&&<p>Wallet dispatch is disabled until the separately reviewed write gate is enabled.</p>}
  <p role="status">{message}</p>
 </section>;
}
