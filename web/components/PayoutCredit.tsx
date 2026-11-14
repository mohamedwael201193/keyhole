"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {usePathname} from "next/navigation";
import Link from "next/link";
import {useWallet} from "@/lib/wallet";
import {createPledgeClient,type PendingPayout} from "@/lib/pledgeClient";
import {browserMoneyStore,finalMoneyReceipt,updateMoneyOperation,clearVerifiedMoneyOperation,type MoneyOperation} from "@/lib/pledgeMoney";
import {nearText} from "@/lib/sale";
/**
 * Payout credit notice. It is a notice, not a second claim button: the one claim action lives in the
 * vault (PayoutPanel, the working claim path — claim_payout pays only the caller's own credit). It never
 * shows the amount in NEAR only (never the raw chain units), never shows a button that cannot work, and it is mounted only on the pages
 * that own payout (dashboard home, /pledge) — never site-wide in the app shell, and never on /vault,
 * where the vault panel already shows the same credit.
 */
export function PayoutCredit({embeddedHere=false}:{embeddedHere?:boolean}={}) {
 const wallet=useWallet(),account=wallet.accountId,pathname=usePathname();
 // The vault owns the claim panel backed by this same money store.
 const embedded=pathname==="/vault"||embeddedHere;
 const client=useMemo(()=>createPledgeClient({live:true}),[]);
 const [credit,setCredit]=useState("0"),[pending,setPending]=useState<PendingPayout|null>(null),[operation,setOperation]=useState<MoneyOperation|null>(null),[message,setMessage]=useState(""),[supported,setSupported]=useState(false);
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
  else if(saved||nextPending)setMessage("Your payout is not confirmed yet. Do not send it again. Refresh to check it.");
 },[account,client,store,embedded]);
 useEffect(()=>{let cancelled=false;setCredit("0");setPending(null);setOperation(null);setMessage("");setSupported(false);if(embedded||!account||!store)return;
  let saved:MoneyOperation|null=null;try{saved=store.load();}catch{setMessage("Pending-operation storage is unreadable. Do not submit new money operations.");return;}const url=new URL(location.href),hash=url.searchParams.get("transactionHashes");
  if(saved&&!saved.txHash&&hash&&!hash.includes(",")){void updateMoneyOperation(store,saved,{...saved,txHash:hash,status:"Submitted"}).then(ok=>{if(ok){url.searchParams.delete("transactionHashes");history.replaceState(null,"",url);}}).catch(()=>setMessage("Pending storage update failed; do not resend."));}
  void refresh().catch(()=>{if(!cancelled&&saved)setMessage("Status unavailable. Original money operation is retained; do not resend.");});return ()=>{cancelled=true;};
 },[account,store,refresh,pathname,embedded]);
 useEffect(()=>{if(embedded||!account||!supported)return;const update=()=>{if(document.visibilityState!=="hidden")void refresh().catch(()=>{ /* keep last known state; never send */ });};const timer=setInterval(update,15_000);addEventListener("focus",update);return ()=>{clearInterval(timer);removeEventListener("focus",update);};},[account,supported,refresh,embedded]);
 useEffect(()=>store?.subscribe?.(()=>{try{setOperation(store.load());}catch{setSupported(false);setMessage("Pending operation storage is unreadable; do not send.");}}),[store]);
 if(embedded||!account||(credit==="0"&&!pending&&!operation&&!message))return null;
 return <section aria-label="Payout credit" data-testid="payout-credit" style={{margin:"16px 24px",padding:20,border:"1px solid #d0ddd4",borderRadius:16,background:"#f3f8f4",color:"#1d3430"}}>
  <p>You have {nearText(credit)} NEAR to collect. It is held by the contract and has not been sent to your wallet yet.</p>
  {pending&&<p>A payout is already on its way (reference {pending.nonce}). Please wait — do not send it again.</p>}
  <p><Link href="/vault">Claim in your vault →</Link></p>
  {message&&<p role="status">{message}</p>}
 </section>;
}
