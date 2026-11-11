"use client";
import Link from "next/link";
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {useWallet} from "@/lib/wallet";
import {callWorker} from "@/lib/worker";
import {usePayoutStorageFee} from "@/lib/usePayoutStorageFee";
import {createPledgeClient,payoutStorageConsent,type Loan,type LoanTerms,type LoanLimits,type PledgeConfig,type LenderOffer,type PendingPayout,type CollateralBinding} from "@/lib/pledgeClient";
import {browserMoneyStore,opensLoan,assertNoSavedPledgeExit,dispatchMoneyBatch,finalMoneyReceipt,nextFinalBlockHeight,updateMoneyOperation,clearVerifiedMoneyOperation,recoverFinalMoneyOperation,type MoneyOperation} from "@/lib/pledgeMoney";
import {requestLoanCertificate,verifyLoanCertificate,type CertificateEnvelope} from "@/lib/loanCertificate";
import type {KeysCall} from "@/lib/keysTx";
import type {SignedAuth} from "@/lib/nep413";
import {assertStorageConsent,storageConsentMatches,createPledgeReadGate,type PayoutStorageConsent} from "@/lib/pledgeSafety";
import {abortable,createSingleFlightRefresh,startPledgePolling} from "@/lib/pledgeRefresh";
import {browserExitStore,exitContinuation,dispatchExitContinuation,retryableExit,PLEDGE_EXIT_USDC,type ExitRecord} from "@/lib/pledgeExit";
import {copyText} from "@/lib/copyText";
import {withdrawDryRunDecision,exitConfirmText} from "@/lib/withdrawDryRun";
import {exactExitFields} from "@/lib/exactExit";
import {beginExitStep,bindingMatches,browserExitSteps,claimPreview,claimWithdraw,planExitReturn,readWalletReturn,releaseWithdraw,saveAwaitingWithdraw,saveConfirmed,saveDone} from "@/lib/exitContinuation";
import {accountAccess,actionHeading,assetPresentation,cairoTime,cashoutCopy,currentStep,disbursementCopy,floorCaption,humanSeconds,loanStateLabel,pendingCashoutChrome,policyAction,SWAP_COMPARE_BODY,SWAP_COMPARE_COSTS,SWAP_COMPARE_SUMMARY,terminalLabel,unlockNotice,type AssetBits,type FloorKind} from "@/lib/pledgeCopy";
import {FLOOR_NOTE} from "@/lib/pledgeDisclosure";
import {BorrowerScreen} from "./BorrowerScreen";
import "./live.css";

type Control={owner_epoch:string;listed:boolean;transfer_pending:boolean;pending_value_ops:string};
type Snapshot={readSequence:number;token:string;account:string|null;owner:string|null;control:Control|null;loan:Loan|null;offer:LenderOffer|null;limits:LoanLimits|null;config:PledgeConfig|null;binding:CollateralBinding|null;now:string;credit:string;pending:PendingPayout|null};
type Inventory={ok:true;complete:true;account:string;token_id:string;owner_epoch:string;observed_at_ns:string;binding_ready:boolean;eligible_pending_zero:boolean;assets:{token:string;amount:string;symbol?:string;decimals?:number;priced:false}[];obligations:{id:string;kind:string;status:string;token?:string;amount?:string}[];limits:{per_tx_usd_micro:number;daily_usd_micro:number};spent_today_usd_micro:number;withdraw_cooldown_until_ms:number|null};
const native=(s:string)=>s.length>=2&&s.length<=64&&/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(s)&&!/^0x[0-9a-f]{40}$/i.test(s);
export function exactUnits(value:string,decimals=24):string {if(value.length>80||!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(value))throw Error("Enter an exact positive decimal amount.");const [a,b=""]=value.split(".");const n=BigInt(a)*10n**BigInt(decimals)+BigInt(b.padEnd(decimals,"0"));if(n<=0n||n>=1n<<128n)throw Error("Amount out of range.");return n.toString();}
export function units(value:string,decimals=24):string {const n=BigInt(value),negative=n<0n,v=negative?-n:n,d=10n**BigInt(decimals);return `${negative?"−":""}${v/d}${v%d?`.${(v%d).toString().padStart(decimals,"0").replace(/0+$/,"")}`:""}`;}
const USDC=PLEDGE_EXIT_USDC;
const errorText=(e:unknown)=>e instanceof Error?e.message:"Unavailable. Keep the original operation; do not resend.";
/** Never infer a terminal ending from a remembered loan while its final-chain owner read is unavailable. */
export function lifecycleState(current:{loan:Pick<Loan,"state">|null;owner:string|null}|null,last:(Pick<Loan,"state"|"due_ns"|"borrower">&{resolution?:string|null})|null):string {
 if(!current?.owner)return "Chain state unavailable";
 if(current.loan)return loanStateLabel(current.loan.state);
 if(!last)return "Ready to pledge";
 return terminalLabel(last.resolution);
}
function AssetLine({asset}:{asset:AssetBits}) {
 const view=assetPresentation(asset,asset.decimals===undefined?null:units(asset.amount,asset.decimals));
 return <li><span>{view.name}</span><b>{view.amount}</b><small>{view.note}</small>{view.extra?<small>{view.extra}</small>:null}<details><summary>Token details</summary><p>{view.tip}</p>{view.copyId?<button type="button" onClick={()=>void copyText(asset.token)}>Copy token id</button>:null}</details></li>;
}
const cairo=cairoTime;

/** All amounts are chain reads. Private inventory is requested ONLY by an explicit current-holder signature. */
export function LivePledge({tokenId,role}:{tokenId?:string;role:"borrower"|"lender"}) {
 const wallet=useWallet(),account=wallet.accountId;
 const client=useMemo(()=>createPledgeClient(),[]);
 const fee=usePayoutStorageFee(client,account);
 const [mobileTab,setMobileTab]=useState<"account"|"action">("action");
 const [tracked,setTracked]=useState(tokenId??""),[data,setData]=useState<Snapshot|null>(null),[last,setLast]=useState<Loan|null>(null);
 const [inventory,setInventory]=useState<Inventory|null>(null),[dialog,setDialog]=useState(false),[operation,setOperation]=useState<MoneyOperation|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[consent,setConsent]=useState<PayoutStorageConsent|null>(null),[bundle,setBundle]=useState<CertificateEnvelope|null>(null),[certUntil,setCertUntil]=useState(0);
 const [lender,setLender]=useState(""),[principal,setPrincipal]=useState("0.01"),[repayment,setRepayment]=useState("0.0101"),[duration,setDuration]=useState("7200"),[grace,setGrace]=useState("900"),[floor,setFloor]=useState("0.50");
 const [receiver,setReceiver]=useState(""),[exitAmount,setExitAmount]=useState("0.10"),[exitOp,setExitOp]=useState<ExitRecord|null>(null),[originalHash,setOriginalHash]=useState("");
 const [loading,setLoading]=useState(false);
 const readGate=useMemo(()=>createPledgeReadGate(),[]);
 const consentRef=useRef<PayoutStorageConsent|null>(null),feeRef=useRef(fee);
 const ack=storageConsentMatches(consent,account,client.contractId,fee);
 /** Borrower forfeiture acknowledgement. The sign button stays disabled until it is ticked. */
 const [forfeitAck,setForfeitAck]=useState(false);
 const yoctoOrNull=(v:string)=>{try{return exactUnits(v);}catch{return null;}};
 useEffect(()=>{consentRef.current=null;setConsent(null);feeRef.current=fee;},[account,client.contractId,fee]);
 const token=tokenId||tracked,identity=`${account}|${token}`,activeIdentity=useRef(identity);
 useLayoutEffect(()=>{activeIdentity.current=identity;},[identity]);
 useEffect(()=>{if(!bundle||certUntil<=0)return;const t=setTimeout(()=>setBundle(null),Math.max(0,certUntil-performance.now()));return()=>clearTimeout(t);},[bundle,certUntil]);
 const store=useMemo(()=>account&&typeof window!=="undefined"?browserMoneyStore(account,client.contractId):null,[account,client.contractId]);
 const latestData=useRef(data);useLayoutEffect(()=>{latestData.current=data;},[data]);
 const refreshRunner=useMemo(()=>createSingleFlightRefresh(),[]);
 const exitResume=useRef<string|null>(null);
 const exitPreviewOnce=useRef<string|null>(null);
 const exitKey=`keyhole:pledge-exit:v1:${client.contractId}:${account}:${token}`;
 const exitStore=useMemo(()=>account&&typeof window!=="undefined"?browserExitStore(account,client.contractId,token):null,[account,token,client.contractId]);
 useEffect(()=>{const q=new URLSearchParams(location.search).get("token");if(!tokenId&&q&&q.length<=128)setTracked(q);},[tokenId]);
 useEffect(()=>{setConsent(null);consentRef.current=null;setBundle(null);setInventory(null);setData(null);setLast(null);setMessage("");setReceiver(account??"");setExitOp(null);if(!account)return;try{const e=exitStore?.load()??null;if(e&&(e.account!==account||e.token!==token))throw Error("Exit identity mismatch");setExitOp(e);}catch{setMessage("Exit storage invalid. Do not start another exit.");setExitOp({account,token,epoch:"0",amount:"0",status:"UNKNOWN"});}},[identity,account,token,exitKey,exitStore]);
 const refresh=useCallback(()=>refreshRunner.run(async signal=>{
  if(!token)return;const requested=`${account}|${token}`,ticket=readGate.begin(requested);setLoading(true);
  try {
   const saved=store?.load()??null,hash=new URL(location.href).searchParams.get("transactionHashes"),receiptOp=saved&&!saved.txHash&&hash&&!hash.includes(",")?{...saved,txHash:hash}:saved,reads=createPledgeClient({signal});
   const [loan,owner,control,offer,limits,config,binding,now,credit,pending,finalized]=await abortable(Promise.all([reads.getLoan(token),reads.getOwner(token),reads.getControl(token),reads.getLenderOffer(token),reads.getLoanLimits(),reads.getPledgeConfig(),reads.getCollateralBinding(token),reads.chainNowNs(),account?reads.getPayoutCredit(account):Promise.resolve("0"),account?reads.getPendingPayout(account):Promise.resolve(null),receiptOp?finalMoneyReceipt(receiptOp,reads.rpcUrl,signal):Promise.resolve(false)]),signal);
   const duplicate=saved?.calls?.some(c=>c.method==="register_payout_account")&&saved.error?.includes("already registered");
   if(saved&&finalized&&!pending&&duplicate&&account&&await abortable(reads.payoutAccountRegistered(account),signal)!==true)throw Error("Registration status is inconsistent. Keep the original operation; do not resend.");
   const reconciled=!!(saved&&finalized&&!pending&&store&&await abortable(clearVerifiedMoneyOperation(store,saved,async()=>finalized),signal));
   if(activeIdentity.current!==requested||!readGate.complete(ticket))return;
   setData({readSequence:ticket.sequence,token,account,loan,owner,control,offer,limits,config,binding,now,credit:credit??"0",pending});
   const publicKey=`keyhole:pledge-last:v1:${client.contractId}:${token}`;
   if(loan){setLast(loan);sessionStorage.setItem(publicKey,JSON.stringify(loan));}else {try{const old=JSON.parse(sessionStorage.getItem(publicKey)??"null") as Loan|null;if(old?.token_id===token)setLast(old);}catch{/* presentation only; never an authorization */}}
   if(reconciled&&saved&&store){setOperation(store.load());window.dispatchEvent(new Event("keyhole:keys-changed"));setMessage(saved.error?.includes("already registered")?"Storage is already registered. The failed batch did not run the action; retry it manually without another storage fee.":"Original receipt finalized. Current chain state below determines what completed.");}else setOperation(store?.load()??null);
   setLoading(false);
  }catch(e){if(activeIdentity.current===requested&&readGate.fail(ticket)){setData(null);setInventory(null);setBundle(null);setLoading(false);setMessage(errorText(e));}throw e;}
 }),[account,client,store,token,readGate,refreshRunner]);
 useEffect(()=>{if(!token)return;let stop=()=>{},cancelled=false;
  void (async()=>{
   try{const op=store?.load(),url=new URL(location.href),hash=url.searchParams.get("transactionHashes");
    if(op&&!op.txHash&&hash&&!hash.includes(",")&&store&&await updateMoneyOperation(store,op,{...op,txHash:hash,status:"Submitted"})){url.searchParams.delete("transactionHashes");history.replaceState(null,"",url);}
    if(!cancelled)stop=startPledgePolling(refresh,()=>document.visibilityState!=="hidden");
   }catch{setData(null);setMessage("Pending money storage is unreadable. Do not submit another operation.");}
  })();
  return()=>{cancelled=true;stop();};},[token,refresh,store]);
 useEffect(()=>{
  const sync=()=>{try{setOperation(store?.load()??null);setExitOp(exitStore?.load()??null);}catch{setData(null);setMessage("Pending operation storage is unreadable. Do not submit another operation.");}};
  const offMoney=store?.subscribe?.(sync),offExit=exitStore?.subscribe(sync);sync();return()=>{offMoney?.();offExit?.();};
 },[store,exitStore]);
 const current=data?.token===token&&data.account===account?data:null,loan=current?.loan??null;
 const owned=!!account&&current?.owner===account;
 const inv=owned&&inventory?.account===account&&inventory.token_id===token&&inventory.owner_epoch===current?.control?.owner_epoch?inventory:null;
 const invFresh=!!inv&&!!current&&BigInt(inv.observed_at_ns)<=BigInt(current.now)&&BigInt(current.now)-BigInt(inv.observed_at_ns)<=30_000_000_000n;
 const certified=!!bundle&&!!loan&&loan.state==="Offered"&&bundle.certificate.loan_nonce===loan.nonce&&bundle.certificate.owner_epoch===loan.owner_epoch&&certUntil>0&&!!current&&BigInt(current.now)<BigInt(bundle.certificate.expires_at_ns);
 const enabled=client.canTransact()&&!!account&&native(account)&&!!current&&!loading&&!busy&&!operation&&!current.pending;
 const openReady=enabled&&owned&&!loan&&!exitOp&&invFresh&&inv?.eligible_pending_zero&&current.binding?.ready&&current.config?.lending_enabled&&!current.control?.listed&&!current.control?.transfer_pending&&current.control?.pending_value_ops==="0"&&fee!==null&&ack&&forfeitAck;
 const exitReady=enabled&&owned&&!loan&&invFresh&&(!exitOp||retryableExit(exitOp))&&!!inv&&(!inv.withdraw_cooldown_until_ms||!!current&&BigInt(inv.withdraw_cooldown_until_ms)*1_000_000n<=BigInt(current.now))&&!current?.control?.listed&&!current?.control?.transfer_pending&&current?.control?.pending_value_ops==="0";
 const ref=loan?{token_id:token,nonce:loan.nonce}:null;
 const named=!!loan&&account===loan.terms.lender;
 const defaultReady=!!loan&&loan.state==="Active"&&loan.due_ns!=="0"&&!!current&&BigInt(current.now)>BigInt(loan.due_ns)+BigInt(loan.terms.grace_sec)*1_000_000_000n;
 const canceled=last?.resolution==="canceled";
 const state=lifecycleState(current,last);
 async function acceptInventory(auth:SignedAuth){const r=await callWorker("pledge_inventory",auth);if(r.error||!r.output?.ok||r.output.complete!==true)throw Error(r.error?.message??"Complete private inventory unavailable; pledging is blocked.");const next=r.output as Inventory;if(next.account!==account||next.token_id!==token||next.owner_epoch!==current?.control?.owner_epoch)throw Error("Inventory owner or epoch changed; authorize a fresh view.");if(activeIdentity.current!==identity)return;setInventory(next);setMessage("All assets and pending obligations read privately. Unpriced assets and later deposits are also at risk.");}
 async function readInventory(){if(!owned||!account||busy||loading)return;setBusy(true);try{await acceptInventory(await wallet.sign("pledge_inventory",{token_id:token}));await refresh();}catch(e){setInventory(null);setMessage(errorText(e));}finally{setBusy(false);}}
 // Redirect wallets resume only the exact inventory request. No money call is inferred from a URL.
 useEffect(()=>{const p=wallet.pending;if(!p||!owned)return;try{const r=JSON.parse(p.message);if(r.op!=="pledge_inventory"||r.account_id!==account||r.params?.token_id!==token)return;wallet.clearPending();setBusy(true);void acceptInventory(p).catch(e=>setMessage(errorText(e))).finally(()=>setBusy(false));}catch{/* unrelated pending operation belongs to its originating screen */}
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[wallet.pending,owned,account,token]);
 async function verify(){if(!loan||!current||loading||busy)return;setBusy(true);setBundle(null);try{const start=performance.now(),b=await requestLoanCertificate(token,loan.nonce);const [config,expected,fresh,now]=await Promise.all([client.getPledgeConfig(),client.getCertificateTemplate(token,b.certificate.observed_at_ns,b.certificate.expires_at_ns),client.getLenderOffer(token),client.chainNowNs()]);if(!config||!expected||!fresh||fresh.loan.nonce!==loan.nonce||fresh.loan.state!=="Offered"||fresh.loan.policy_busy||!fresh.funding_open||!await verifyLoanCertificate(b,expected,config,now))throw Error("Certificate not verified against the exact current loan.");const left=Number((BigInt(b.certificate.expires_at_ns)-BigInt(now))/1_000_000n)-(performance.now()-start)-1000;if(left<=0)throw Error("Certificate expired; verify a fresh one.");setBundle(b);setCertUntil(performance.now()+Math.min(left,30000));setMessage(`Certified: pinned Ed25519 signature and final-chain loan binding verified. Trusted sealed statement, not a ZK proof. ${FLOOR_NOTE}`);}catch(e){setMessage(errorText(e));}finally{setBusy(false);}}
 async function send(action:KeysCall,registration=true){if(!enabled||!account||!store)return;setBusy(true);try{
  const lease=readGate.capture(identity);
  if(lease.sequence!==current?.readSequence)throw Error("Displayed chain snapshot changed. Review the fresh state before dispatch.");
  const plan=registration?await client.prepareAction(account,action):{calls:[action],payoutStorageChargeYocto:"0"};
  const height=await nextFinalBlockHeight(client.rpcUrl);
  // Recheck AFTER every preflight await: an in-flight/failed refresh or changed identity revokes dispatch.
  readGate.assert(lease,activeIdentity.current);
  if(registration)assertStorageConsent(consentRef.current,account,client.contractId,feeRef.current,plan.payoutStorageChargeYocto);
  await dispatchMoneyBatch(account,client.contractId,plan.calls,store,calls=>wallet.sendTxBatch(calls,{expectedSigner:account,assertCurrent:()=>{readGate.assert(lease,activeIdentity.current);if(action.method==="open_loan")assertNoSavedPledgeExit(account,client.contractId);if(registration)assertStorageConsent(consentRef.current,account,client.contractId,feeRef.current,plan.payoutStorageChargeYocto);}}),height);await refresh();
 }catch(e){setMessage(errorText(e));try{setOperation(store.load());}catch{setData(null);setMessage("Pending money storage is unreadable. Do not submit another operation.");}}finally{setBusy(false);}}
 async function open(){if(!openReady||!account||!current?.limits)return;try{if(exitStore?.load())throw Error("Resolve the original exit before preparing another loan.");if(!native(lender)||lender===account)throw Error("Choose a different native NEAR lender.");if(!/^\d+$/.test(duration)||!/^\d+$/.test(grace))throw Error("Term and grace must be whole seconds.");if(BigInt(duration)<BigInt(current.limits.min_duration_sec)||BigInt(duration)>BigInt(current.limits.max_duration_sec)||BigInt(grace)>BigInt(current.limits.max_grace_sec))throw Error("Term/grace outside current contract limits.");const terms:LoanTerms={lender,principal:exactUnits(principal),repayment:exactUnits(repayment),duration_sec:duration,grace_sec:grace,floor_raw:exactUnits(floor,6),funding_deadline_ns:(BigInt(await client.chainNowNs())+600_000_000_000n).toString()};if(BigInt(terms.repayment)<BigInt(terms.principal))throw Error("Repayment must cover principal.");const fresh=await client.getControl(token);if(!fresh||fresh.owner_epoch!==inv?.owner_epoch||fresh.pending_value_ops!=="0"||fresh.listed||fresh.transfer_pending||await client.getOwner(token)!==account)throw Error("Account control changed. Refresh private inventory before pledging.");const url=new URL(location.href);url.searchParams.set("token",token);history.replaceState(null,"",url);setTracked(token);await send(client.buildOpenLoan({token_id:token,terms},current.limits.storage_bond));}catch(e){setMessage(errorText(e));}}
 async function fund(){if(!enabled||!certified||!bundle||!named||!ack)return;try{const [fresh,config,expected,now]=await Promise.all([client.getLenderOffer(token),client.getPledgeConfig(),client.getCertificateTemplate(token,bundle.certificate.observed_at_ns,bundle.certificate.expires_at_ns),client.chainNowNs()]);if(!fresh?.funding_open||!fresh.lender_has_no_key||!fresh.lender_has_no_return_reservation||!fresh.owner_current||!fresh.lending_enabled||!config||!expected||!await verifyLoanCertificate(bundle,expected,config,now))throw Error("Funding eligibility/certificate changed. Verify again.");await send(client.buildFundLoan({token_id:token,nonce:bundle.certificate.loan_nonce,...bundle}));}catch(e){setBundle(null);setMessage(errorText(e));}}
 async function claimDefault(){if(!enabled||!named||!ref||!defaultReady)return;try{if(!native(receiver)||!await client.receiverEligible(receiver))throw Error("Receiver must be a native account with no key or return reservation.");await send(client.buildClaimDefault({...ref,receiver_id:receiver}));}catch(e){setMessage(errorText(e));}}
 async function checkOriginalHash(){
  if(!store||!operation||busy||loading||!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(originalHash))return;
  setBusy(true);try{if(!await recoverFinalMoneyOperation(store,operation,client.rpcUrl,originalHash))throw Error("No matching FINAL original receipt. The saved operation is unchanged; do not resend.");setOperation(store.load());await refresh();setMessage("Original FINAL receipt verified; the exact saved operation is resolved.");}catch(e){setMessage(errorText(e));}finally{setBusy(false);}
 }
 function exitPreflight(pending:ExitRecord){
  readGate.capture(identity);const fresh=latestData.current;
  const nativeOp=store?.load();if(nativeOp&&opensLoan(nativeOp))throw Error("Original loan opening unresolved; do not dispatch an exit.");
  if(activeIdentity.current!==identity||!fresh||fresh.account!==pending.account||fresh.token!==pending.token||fresh.owner!==pending.account||fresh.loan||fresh.control?.owner_epoch!==pending.epoch||fresh.control.listed||fresh.control.transfer_pending||fresh.control.pending_value_ops!=="0")throw Error("Exit control changed. Refresh before signing the original intent again.");
 }
 async function finishExit(auth:SignedAuth,pending:ExitRecord,consumeAuth=()=>{}){
  if(!exitStore)throw Error("Exit storage unavailable");
  try{
   const {result:r,pending:sent}=await dispatchExitContinuation(auth,pending,exitStore,()=>exitPreflight(pending),a=>callWorker("exact_near_exit_v1",a),consumeAuth);
   const next={...sent,...(r.output?.value_op_id?{value_op_id:String(r.output.value_op_id)}:{})};
   const continuation=exitContinuation(r.output?.continuation,next);
   if(r.output?.status==="success"&&r.output.admission_finished===true){await exitStore.clear(sent);setInventory(null);setMessage("Exact self-exit verified against the original FINAL FT receipt; contract admission finished. Read a fresh private inventory before another exit.");}
   else{await exitStore.replace(sent,{...next,continuation,status:r.error?"UNKNOWN":"Pending"});setMessage(r.error?.message??"Withdrawal not confirmed yet. Don’t send another. Original exit pending.");}
  }finally{setExitOp(exitStore.load());}
 }
 async function finishReconcile(auth:SignedAuth,pending:ExitRecord){
  if(!exitStore)throw Error("Exit storage unavailable");const request=JSON.parse(auth.message);
  if(!pending.id||request.params?.intent_id!==pending.id||request.params?.value_op_id!==pending.value_op_id||request.account_id!==pending.account||auth.account_id!==pending.account)throw Error("Reconciliation signature belongs to another exit intent.");
  const sent:ExitRecord={...pending,status:"UNKNOWN"};
  if(!await exitStore.replace(pending,sent))throw Error("Exit intent changed; reconcile in its owning tab.");
  setExitOp(sent);const r=await callWorker("reconcile_value_op",auth);if(r.error)throw Error(r.error.message??"Exit unresolved");
  if(r.output?.admission_finished===true){await exitStore.clear(sent);setExitOp(exitStore.load());setInventory(null);}
  else{await exitStore.replace(sent,{...sent,continuation:exitContinuation(r.output?.continuation,sent)});setExitOp(exitStore.load());}
  await refresh();setMessage(r.output?.admission_finished===true?"Original exit reconciled. Refresh inventory; no replacement withdrawal was sent.":`Withdrawal not confirmed yet. Don’t send another. Original exit still pending / UNKNOWN (${pending.value_op_id}). No replacement withdrawal was sent.`);
 }
 /** One preview, one confirm, one withdraw sign. Redirect returns call this again with the same nonce; a second claim does not sign another withdrawal. */
 async function continueExit(auth:SignedAuth|null,pending:ExitRecord,mode:"run_preview"|"confirm"){
  if(!exitStore||!account||!pending.id)throw Error("Exit storage unavailable");
  const store=browserExitSteps(sessionStorage);
  let step=store.loadIntent(pending.account,pending.id)??beginExitStep({account:pending.account,token:pending.token,epoch:pending.epoch,intentId:pending.id,amount:pending.amount,asset:USDC,chain:"near"});
  const exitParams={intent_id:pending.id,token_id:token,owner_epoch:pending.epoch,token:USDC,amount:pending.amount,to:account,chain:"near",...exactExitFields(pending.amount)};
  if(mode==="run_preview"){
   if(!auth||!bindingMatches(step.binding,auth,"withdraw_dry_run"))throw Error("This returned route preview does not match the saved exit. No new withdrawal was signed.");
   const claim=claimPreview(store,step,auth.nonce);
   if(claim==="stop")throw Error("This route preview was already continued. No new withdrawal was signed.");
   if(claim==="claimed"){
    const preview=withdrawDryRunDecision((await callWorker("withdraw_dry_run",auth)).output,{account,token:USDC,amount:pending.amount,chain:"near"});
    if(!preview.ok)throw Error(preview.reason);
    step=saveConfirmed(store,store.loadIntent(pending.account,pending.id)??step,preview);
    if(!window.confirm(exitConfirmText(preview,pending.amount))){store.drop(step);throw Error("Withdrawal cancelled before signing. No withdrawal was signed.");}
   }else{
    const shown=store.loadNonce(account,auth.nonce)?.preview;
    if(!shown)throw Error("Route preview unavailable. No withdrawal was signed.");
    if(!window.confirm(exitConfirmText(shown,pending.amount))){store.drop(store.loadIntent(pending.account,pending.id)??step);throw Error("Withdrawal cancelled before signing. No withdrawal was signed.");}
    step=store.loadIntent(pending.account,pending.id)??step;
   }
  }else{
   const shown=step.preview;
   if(!shown)throw Error("Route preview unavailable. No withdrawal was signed.");
   if(!window.confirm(exitConfirmText(shown,pending.amount))){store.drop(step);throw Error("Withdrawal cancelled before signing. No withdrawal was signed.");}
  }
  step=saveAwaitingWithdraw(store,store.loadIntent(pending.account,pending.id)??step);
  const withdrawAuth=await wallet.sign("exact_near_exit_v1",exitParams);
  if(!claimWithdraw(store,step,withdrawAuth))throw Error("This withdrawal signature was already used. No new withdrawal was signed.");
  try{await finishExit(withdrawAuth,pending,wallet.clearPending);saveDone(store,step,withdrawAuth.nonce);}
  catch(e){releaseWithdraw(store,step);throw e;}
 }
 async function ordinaryExit(){if(!exitReady||!account||!current||!inv||!exitStore)return;setBusy(true);let pending:ExitRecord|null=null;try{
  const prior=exitStore.load();if(prior&&!retryableExit(prior))throw Error("Original exit unresolved; reconcile only.");
  const amount=prior?.amount??exactUnits(exitAmount,6),asset=inv.assets.find(a=>a.token===USDC);if(!asset||BigInt(amount)>BigInt(asset.amount))throw Error("Insufficient supported USDC; unpriced assets are not assumed liquid.");
  if(!inv.limits||BigInt(amount)>BigInt(inv.limits.per_tx_usd_micro)||BigInt(amount)+BigInt(inv.spent_today_usd_micro)>BigInt(inv.limits.daily_usd_micro))throw Error("Exit exceeds current per-transaction/daily caps.");
  if(prior&&prior.epoch!==inv.owner_epoch)throw Error("Original exit epoch changed; no withdrawal was dispatched.");
  const next:ExitRecord=prior?{...prior,status:"AwaitingSignature"}:{account,token,epoch:inv.owner_epoch,amount,status:"AwaitingSignature",intent:"exact_near_exit_v1"};
  if(prior){if(!await exitStore.replace(prior,next))throw Error("Continue the original exit in its owning tab.");pending=next;}else pending=await exitStore.reserve(next);
  if(!pending.id)throw Error("Exit storage unavailable");
  setExitOp(pending);const exitParams={intent_id:pending.id,token_id:token,owner_epoch:pending.epoch,token:USDC,amount:pending.amount,to:account,chain:"near",...exactExitFields(pending.amount)};
  // Persist the step before the dry-run signature. A redirect wallet leaves the page and comes back with that signature.
  browserExitSteps(sessionStorage).save(beginExitStep({account,token,epoch:pending.epoch,intentId:pending.id,amount:pending.amount,asset:USDC,chain:"near"}));
  const previewAuth=await wallet.sign("withdraw_dry_run",exitParams);
  await continueExit(previewAuth,pending,"run_preview");
 }catch(e){if(pending&&(!(e instanceof Error)||!("code" in e)||e.code!=="redirect")){const saved=exitStore.load();if(saved?.id===pending.id&&saved?.status==="AwaitingSignature")await exitStore.replace(saved,{...saved,status:"Retryable"});setExitOp(exitStore.load());try{const steps=browserExitSteps(sessionStorage);const step=pending.id?steps.loadIntent(pending.account,pending.id):null;if(step&&step.phase!=="done")steps.drop(step);}catch{/* the exit record remains the source of truth */}}setMessage(errorText(e));}finally{setBusy(false);}}
 async function discardUnsentExit(){
  if(!exitStore||!retryableExit(exitOp)||busy||loading||!exitOp)return;
  const original=exitOp;if(await exitStore.clear(original)){
   const auth=wallet.pending;if(auth){try{const r=JSON.parse(auth.message),p=r.params;if(r.op==="exact_near_exit_v1"&&r.account_id===original.account&&p?.token_id===original.token&&p?.owner_epoch===original.epoch&&p?.amount===original.amount&&p?.intent_id===original.id)wallet.clearPending();}catch{/* unrelated auth remains untouched */}}
   setExitOp(exitStore.load());setMessage("Unsent exit intent discarded. No withdrawal was sent; review a fresh inventory before creating another intent.");setInventory(null);
  }
 }
 async function reconcileExit(){if(!exitOp?.value_op_id||!owned||busy||loading||!exitStore)return;setBusy(true);const pending:ExitRecord={...exitOp,status:"AwaitingSignature",intent:"reconcile_value_op"};try{if(!await exitStore.replace(exitOp,pending))throw Error("Continue the original exit in its owning tab.");setExitOp(pending);const continuation=exitOp.continuation;if(continuation&&!window.confirm(`Continue only the unsent ${continuation.step} hop of the ORIGINAL ${exitOp.amount} USDC-base-unit self-exit? No replacement or change of amount/recipient.`))throw Error("Continuation cancelled; original exit remains pending.");await finishReconcile(await wallet.sign("reconcile_value_op",{...(continuation?{exit_continue:{...continuation,deadline_ms:Number(BigInt(await client.chainNowNs())/1_000_000n)+300_000}}:{}),intent_id:pending.id,token_id:token,owner_epoch:exitOp.epoch,value_op_id:exitOp.value_op_id}),pending);}catch(e){setMessage(errorText(e));}finally{setBusy(false);}}
 useEffect(()=>{const auth=wallet.pending;if(!auth||!owned||!account||loading||busy||!exitStore||exitResume.current===auth.signature)return;try{
  const request=JSON.parse(auth.message),saved=exitStore.load(),p=request.params;
  if(!saved||!saved.id||p?.intent_id!==saved.id||saved.status!=="AwaitingSignature"||saved.account!==account||saved.token!==token||request.account_id!==account||auth.account_id!==account||p?.token_id!==token||p?.owner_epoch!==saved.epoch)return;
  if(request.op==="exact_near_exit_v1"&&saved.intent==="exact_near_exit_v1"&&p.token===USDC&&p.amount===saved.amount&&p.to===account&&p.chain==="near"){
   exitResume.current=auth.signature;setBusy(true);void finishExit(auth,saved,wallet.clearPending).then(()=>{const steps=browserExitSteps(sessionStorage);const step=steps.loadIntent(saved.account,saved.id??"");if(step&&step.phase!=="done")saveDone(steps,step,auth.nonce);}).catch(e=>setMessage(errorText(e))).finally(()=>setBusy(false));
  }else if(request.op==="reconcile_value_op"&&saved.intent==="reconcile_value_op"&&saved.value_op_id&&p.value_op_id===saved.value_op_id){exitResume.current=auth.signature;setBusy(true);void finishReconcile(auth,saved).then(wallet.clearPending).catch(e=>setMessage(errorText(e))).finally(()=>setBusy(false));}
 }catch{setMessage("Pending exit signature could not bind to its saved intent. Nothing new was dispatched.");}
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[wallet.pending,owned,account,token,exitStore,loading,busy,current?.readSequence]);
 // A redirect wallet returns the dry-run signature in `pending`, or errorCode / transactionHashes on the callback URL.
 // The step saved under account + nonce decides whether to preview, confirm, or sign nothing. A reload does not sign a withdrawal by itself.
 useEffect(()=>{
  if(!account||!token||!owned||loading||busy||!exitStore||typeof window==="undefined")return;
  const callback=readWalletReturn(location.search);
  if(callback.kind==="rejected"){
   const url=new URL(location.href);
   if(url.searchParams.has("errorCode")){url.searchParams.delete("errorCode");url.searchParams.delete("errorMessage");history.replaceState(null,"",url);}
  }
  let saved:ExitRecord|null=null;
  try{saved=exitStore.load();}catch{return;}
  const pendingAuth=wallet.pending;
  const store=browserExitSteps(sessionStorage);
  const step=(pendingAuth?store.loadNonce(account,pendingAuth.nonce):null)||(saved?.id?store.loadIntent(account,saved.id):null);
  const plan=planExitReturn({activeAccount:account,activeToken:token,callback,pending:pendingAuth,step,exit:saved});
  if(plan.type==="ignore")return;
  const mark=`${plan.type}:${pendingAuth?.signature??callback.kind}:${"reason" in plan?plan.reason:plan.step.previewNonce}`;
  if(exitPreviewOnce.current===mark)return;
  exitPreviewOnce.current=mark;
  if(plan.type==="ambiguous"){if(plan.clearPending)wallet.clearPending();setMessage(plan.reason);return;}
  if(plan.type==="cancel"){
   wallet.clearPending();store.drop(plan.step);
   void (async()=>{try{const cur=exitStore.load();if(cur&&cur.id===plan.step.binding.intentId&&cur.status==="AwaitingSignature"){await exitStore.replace(cur,{...cur,status:"Retryable"});setExitOp(exitStore.load());}}catch{/* keep the saved exit */}})();
   setMessage(plan.reason);return;
  }
  if(!saved?.id)return;
  const open=saved;
  if(pendingAuth)wallet.clearPending();
  setBusy(true);
  void continueExit(plan.type==="run_preview"?pendingAuth:null,open,plan.type).catch(async e=>{
   setMessage(errorText(e));
   try{
    const cur=exitStore.load();
    if(cur&&cur.id===open.id&&cur.status==="AwaitingSignature"){await exitStore.replace(cur,{...cur,status:"Retryable"});setExitOp(exitStore.load());}
    const left=store.loadIntent(open.account,open.id??"");
    if(left&&left.phase!=="done"&&left.phase!=="awaiting_withdraw")store.drop(left);
   }catch{/* keep the saved exit */}
  }).finally(()=>setBusy(false));
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[wallet.pending,owned,account,token,exitStore,loading,busy,current?.readSequence]);

 const publicLoan=current?(loan??last):null;
 const floorKind:FloorKind=!publicLoan?"proposed":loan?.state==="Offered"?(certified?"verified":"offered"):"funded";
 const access=accountAccess({readable:!!current,freezing:loan?.state==="Freezing",pledged:!!loan&&loan.state!=="UnlockPending"&&loan.state!=="Freezing",unlocking:loan?.state==="UnlockPending",epoch:current?.control?.owner_epoch??null});
 const unlock=loan?.state==="UnlockPending"?unlockNotice(loan.resolution,owned):null;
 const payoutPending=!!current?.pending;
 const pendingNow=payoutPending&&loan?.state==="DisbursementPending"?pendingCashoutChrome(owned):null;
 const disburse=loan?.state==="DisbursementPending"&&!pendingNow?disbursementCopy(owned,units(loan.terms.principal)):null;
 const creditView=current&&account&&((BigInt(current.credit)>0n)||payoutPending||operation)?cashoutCopy({pending:payoutPending,amount:units(current.credit),nonce:current.pending?.nonce??null}):null;
 const heading=pendingNow?.heading??(disburse?disburse.heading:loan?.state==="Active"&&named&&!owned?"Wait or claim":actionHeading({loanState:loan?.state??null,hasHistory:!!last,hasExit:!!exitOp,ownsAccount:owned}));
 const feeLine=fee===null?"Storage fee unavailable — first action blocked":fee==="0"?"Payout storage registered · no new fee":`Agree: ${units(fee)} NEAR one-time nonrefundable storage`;
 return <section className="pledge-live" data-testid={role==="lender"?"lender-page":"pledge-page"} data-state={state}>
  <header className="pledge-live-header"><div><span className="pledge-live-eyebrow">{role==="borrower"?"Pledge / borrower":"Pledge / named lender"}</span><h1>{role==="borrower"?"Borrow NEAR. Keep your vault private.":"Know the floor. Not the balance."}</h1></div><span className="pledge-live-state" data-testid="loan-state" title={loan?.state??state}>{pendingNow?.badge??state}</span></header>
  <nav className="pledge-live-steps" aria-label="Wallet lifecycle">{pendingNow?.step??currentStep(loan?.state??null,owned)}</nav>
  {!account?<button onClick={wallet.connect}>Connect native NEAR wallet</button>:<div className="pledge-live-identity">{account} <span>· {client.contractId}</span></div>}
  {!token?<p>Select an owned account on the dashboard to begin. No example balance is shown as live.</p>:<><div className="pledge-live-tabs" role="tablist" aria-label="Pledge panels"><button role="tab" aria-selected={mobileTab==="account"} aria-controls="pledge-account-panel" onClick={()=>setMobileTab("account")}>Account & inventory</button><button role="tab" aria-selected={mobileTab==="action"} aria-controls="pledge-action-panel" onClick={()=>setMobileTab("action")}>Loan action</button></div><div className="pledge-live-grid" data-tab={mobileTab}>
   <section id="pledge-account-panel" className="pledge-live-card"><div className="pledge-live-card-title"><h2>{owned?"Your at-risk account":"Sealed account"}</h2><span>#{token}</span></div>
    <p className="pledge-live-risk">Pledging risks the entire account and later deposits. Default transfers everything. There is no surplus return.</p>
    <dl className="pledge-live-facts"><div><dt>Current owner</dt><dd>{current?.owner??"Unavailable"}</dd></div><div><dt>USDC minimum</dt><dd>{publicLoan?`${units(publicLoan.terms.floor_raw,6)} USDC`: `${floor} USDC · proposed`}<small>{floorCaption(floorKind)}</small><small>{FLOOR_NOTE}</small>{certified&&bundle?<small>Observed {cairo(bundle.certificate.observed_at_ns)}</small>:null}</dd></div><div><dt>Account status</dt><dd title={access.detail}>{access.label}</dd></div></dl>
    {owned?<div className="pledge-live-private"><button className={inv?undefined:"pledge-live-primary"} disabled={busy||loading} onClick={()=>void readInventory()}>{inv?"Refresh private inventory":"Read private at-risk inventory"}</button>{inv?<><p data-testid="inventory-summary">{inv.assets.length} assets · {inv.obligations.length} pending obligations · {invFresh?"fresh":"refresh required"}</p><ul>{inv.assets.slice(0,2).map(a=><AssetLine key={a.token} asset={a}/>)}</ul><button className="pledge-live-link" onClick={()=>setDialog(true)}>Review all assets and obligations</button></>:<p>Private balances stay on this account until you ask to read them.</p>}</div>:<p className="pledge-live-muted">Full balances, unpriced assets and obligations stay with the holder. Default conveys the same account, not a cash guarantee.</p>}
    {role==="borrower"?<details className="pledge-live-compare" data-testid="live-comparison"><summary>{SWAP_COMPARE_SUMMARY}</summary><p>{SWAP_COMPARE_BODY}</p><p>{SWAP_COMPARE_COSTS}</p></details>:null}
   </section>
   <section id="pledge-action-panel" className="pledge-live-card pledge-live-action"><div className="pledge-live-card-title"><h2>{heading}</h2><button className="pledge-live-link" disabled={busy||loading} onClick={()=>void refresh().catch(()=>{/* refresh centrally fails closed */})}>Refresh chain</button></div>
    <p className="pledge-live-mobile-summary">{pendingNow?.badge??state}{publicLoan?` · ${units(publicLoan.terms.floor_raw,6)} USDC minimum`:""}</p>
    {!loan&&owned&&!last&&!exitOp?<><div className="pledge-live-form"><label className="full">Named lender<input aria-label="Named lender" value={lender} onChange={e=>setLender(e.target.value.trim())} placeholder="lender.near"/></label><label>Borrow NEAR<input aria-label="Borrow NEAR" inputMode="decimal" value={principal} onChange={e=>setPrincipal(e.target.value)}/></label><label>Repay NEAR<input aria-label="Repay NEAR" inputMode="decimal" value={repayment} onChange={e=>setRepayment(e.target.value)}/></label><label>Declared USDC floor<input aria-label="Declared USDC floor" inputMode="decimal" value={floor} onChange={e=>setFloor(e.target.value)}/></label><label>Term <small title={`${duration} seconds`}>{/^\d+$/.test(duration)?humanSeconds(duration):""}</small><input aria-label="Term seconds" value={duration} onChange={e=>setDuration(e.target.value)}/></label><label>Grace <small title={`${grace} seconds`}>{/^\d+$/.test(grace)?humanSeconds(grace):""}</small><input aria-label="Grace seconds" value={grace} onChange={e=>setGrace(e.target.value)}/></label></div>{!inv?<button className="pledge-live-mobile-inventory" onClick={()=>setMobileTab("account")}>First review your private at-risk account →</button>:null}<BorrowerScreen principal={yoctoOrNull(principal)} repayment={yoctoOrNull(repayment)} durationText={/^\d+$/.test(duration)?humanSeconds(duration):"Term not valid"} graceText={/^\d+$/.test(grace)?humanSeconds(grace):"Grace not valid"} ack={forfeitAck} onAck={setForfeitAck}/><p className="pledge-live-muted">Refundable bond:{current?.limits?units(current.limits.storage_bond):"Unavailable"} NEAR. Debt starts only after confirmed native delivery. First-use storage and gas are separate.</p>{current&&!current.binding?.ready?<p>Not eligible yet: sealed collateral registration is not ready.</p>:null}<button className="pledge-live-primary" disabled={!openReady} onClick={()=>void open()}>Pledge this account</button></>:null}
    {publicLoan?<dl className="pledge-live-facts pledge-live-money"><div><dt>Principal / repayment</dt><dd>{units(publicLoan.terms.principal)} / {units(publicLoan.terms.repayment)} NEAR</dd></div><div><dt>Named lender</dt><dd>{publicLoan.terms.lender}</dd></div><div><dt>Repay by</dt><dd title={publicLoan.due_ns==="0"?"due_ns 0":`${publicLoan.due_ns} ns`}>{publicLoan.due_ns==="0"?"Not started":cairo(publicLoan.due_ns)}<small>{publicLoan.due_ns==="0"?"No debt clock until delivery is confirmed":"Chain time, Africa/Cairo, including seconds"}</small></dd></div><div><dt>Grace period</dt><dd title={`${publicLoan.terms.grace_sec} seconds`}>{humanSeconds(publicLoan.terms.grace_sec)}</dd></div></dl>:null}
    {loan?.state==="Freezing"?<p>The account is locking as collateral. Funding is not open, and the debt clock has not started.</p>:null}
    {loan?.state==="Offered"?<>{named?<><button disabled={busy||loading||!current} onClick={()=>void verify()}>Verify sealed certificate</button><button className="pledge-live-primary" disabled={!enabled||!certified||!ack||fee===null} onClick={()=>void fund()}>Fund {units(loan.terms.principal)} NEAR</button></>:<p>Share the named lender’s link. It shows the minimum, never your private inventory.</p>}<Link data-testid="lender-link" href={`/pledge/lend/${encodeURIComponent(token)}`}>Open lender review</Link>{owned&&ref?<button className="pledge-live-link" disabled={!enabled} onClick={()=>void send(client.buildCancelLoan(ref))}>Cancel offer and unlock</button>:null}</>:null}
    {pendingNow?<p className="pledge-live-important">{pendingNow.text}</p>:disburse?<p className="pledge-live-important">{disburse.text}</p>:null}
    {loan?.state==="Active"&&ref?<>{owned?<><button className="pledge-live-primary" disabled={!enabled} onClick={()=>void send(client.buildRepayLoan(ref,loan.terms.repayment))}>Repay {units(loan.terms.repayment)} NEAR</button><p>Repay {units(loan.terms.repayment)} NEAR by {cairo(loan.due_ns)}. The bond comes back separately. Nothing is netted off.</p></>:null}{named?<><label className="pledge-live-receiver">Default receiver<input aria-label="Default receiver" value={receiver} onChange={e=>setReceiver(e.target.value.trim())}/></label><button className={owned?undefined:"pledge-live-primary"} disabled={!enabled||!defaultReady} onClick={()=>void claimDefault()}>Claim entire collateral account</button><p>{defaultReady?"The chain clock is past the due time plus grace.":"Default stays unavailable until the chain clock passes the due time plus grace."} Eligibility is checked again before the claim.</p></>:null}</>:null}
    {unlock?<p className="pledge-live-important" title={unlock.technical}>{unlock.text}</p>:null}
    {loan&&ref&&["Freezing","UnlockPending"].includes(loan.state)&&(owned||named)?(!loan.policy_busy?<button className="pledge-live-primary" disabled={!enabled} onClick={()=>void send({method:"retry_loan_policy",args:ref,deposit:"0",gas:"200000000000000"},false)}>{policyAction(loan.state,"retry")}</button>:loan.policy_call_complete?<button className="pledge-live-primary" disabled={!enabled} onClick={()=>void send({method:"reconcile_loan_policy",args:ref,deposit:"0",gas:"100000000000000"},false)}>{policyAction(loan.state,"check")}</button>:<p>{policyAction(loan.state,"unknown")}</p>):null}
    {current&&(exitOp||(!loan&&last))?<><p data-testid="settlement">{loan?"A saved withdrawal is here, but the active loan blocks withdrawal.":canceled?"Canceled before funding. The account is unlocked.":last?.resolution==="repaid"?"Repaid. The account is unlocked.":last?.resolution==="default_claimed"?`Loan defaulted. The account is now ${current.owner}. The previous holder has no private access.`:last?"Closed · history unverified":"A saved withdrawal is here. No loan ending is inferred."}</p>{owned?<><div className="pledge-live-exit"><label>Ordinary USDC self-exit<input aria-label="Ordinary USDC self-exit" value={exitAmount} onChange={e=>setExitAmount(e.target.value)}/></label><button className={loan?undefined:"pledge-live-primary"} disabled={!exitReady} onClick={()=>void ordinaryExit()}>Exit to my wallet</button></div><small>Current caps, daily spend and the owner-change cooldown apply. Read private inventory first.</small>{inv?.withdraw_cooldown_until_ms?<p>Cooldown until {cairo((BigInt(inv.withdraw_cooldown_until_ms)*1_000_000n).toString())}.</p>:null}{exitOp?<><p>{retryableExit(exitOp)?"Not sent yet.":"Don’t send another."} Original exit {exitOp.status} ({units(exitOp.amount,6)} USDC). {retryableExit(exitOp)?"Sign the saved amount again with Exit to my wallet.":"We’ll check the same transfer."}</p>{retryableExit(exitOp)?<button disabled={busy||loading} onClick={()=>void discardUnsentExit().catch(e=>setMessage(errorText(e)))}>Discard unsent withdrawal</button>:null}<button disabled={busy||loading||!exitOp.value_op_id} onClick={()=>void reconcileExit()}>{exitOp.continuation?"Continue original unsent hop":"Check original withdrawal"}</button></>:null}{!loan&&role==="borrower"&&last&&current?.owner===last.borrower?<button className="pledge-live-link" disabled={busy||loading||!!exitOp||!!operation||!!current.pending} onClick={()=>{if(busy||loading||exitStore?.load()||store?.load()||current.pending){setMessage("Resolve the original operation before preparing another loan.");return;}sessionStorage.removeItem(`keyhole:pledge-last:v1:${client.contractId}:${token}`);setLast(null);setInventory(null);}}>Prepare another loan</button>:null}</>:null}</>:null}
    {creditView?<div className="pledge-live-credit" data-testid="payout-credit"><strong>{creditView.title}</strong><span>{creditView.detail}</span>{payoutPending?null:<button className={loan?.state==="DisbursementPending"&&owned?"pledge-live-primary":undefined} disabled={!enabled||BigInt(current?.credit??"0")<=0n} onClick={()=>void send(client.buildClaimPayout())}>{loan?.state==="DisbursementPending"&&owned?`Claim ${units(loan.terms.principal)} NEAR`:"Claim your funds"}</button>}</div>:null}
    {operation?<div className="pledge-live-unknown"><p>Original money operation {operation.status}. No automatic retry.</p>{!operation.txHash?<><input aria-label="Original transaction hash" value={originalHash} onChange={e=>setOriginalHash(e.target.value)}/><button disabled={busy||loading} onClick={()=>void checkOriginalHash()}>Check original hash</button></>:null}</div>:null}
    <label className="pledge-live-consent" title={payoutStorageConsent(fee)}><input type="checkbox" checked={ack} disabled={fee===null||loading||busy} onChange={e=>{const next=e.target.checked&&account&&fee!==null?{account,contract:client.contractId,fee}:null;consentRef.current=next;setConsent(next);}}/><span>{feeLine}</span></label>
    {!client.canTransact()?<small>Write gate off. Release review is required before any transaction can be sent.</small>:null}
    <details className="pledge-live-more"><summary>Technical details</summary><p title={loan?.state??"none"}>State {loan?.state??"none"}. {access.detail}.{loan?` Nonce ${loan.nonce}.`:""} Contract {client.contractId}. Register, pledge, fund, cash out, repay or claim, unlock, then exit.</p>{creditView?.technical?<p>{creditView.technical}</p>:null}<p>Pending and UNKNOWN stay pending and UNKNOWN. No redispatch or timeout unlock.</p><p>No guaranteed recovery. A sealed floor is not a liquidation value. Related-party trials are mechanism evidence, not adoption.</p></details>
   </section>
  </div></>}
  <footer className="pledge-live-status" role="status">{busy||loading?"Confirm / loading… ":""}{message||"No guaranteed recovery. A sealed floor is not a liquidation value."}</footer>
  {dialog&&inv?<div className="pledge-live-dialog-backdrop"><section role="dialog" aria-modal="true" aria-label="Complete private at-risk inventory"><header><h2>Complete private at-risk inventory</h2><button onClick={()=>setDialog(false)}>Close</button></header><p>All {inv.assets.length} assets, including unpriced balances and future deposits, are at risk. No dollar value is implied.</p><ul>{inv.assets.map(a=><AssetLine key={a.token} asset={a}/>)}</ul><h3>All pending obligations ({inv.obligations.length})</h3>{inv.obligations.length?<ul>{inv.obligations.map((o,i)=><li key={`${o.kind}:${o.id}:${i}`} title={o.status}>{o.kind} · {o.id} · {o.status} · {o.amount??"Amount unavailable"} {o.token??""}</li>)}</ul>:<p>The bounded inventory reports no pending requests, open orders or approvals.</p>}<p>Exit caps: {inv.limits?.per_tx_usd_micro??"Unavailable"} microUSD per transaction, {inv.limits?.daily_usd_micro??"Unavailable"} per day. Spent today: {inv.spent_today_usd_micro} microUSD. Owner epoch {inv.owner_epoch}. Observed {cairo(inv.observed_at_ns)}.</p><p>A retained full-access key could bypass custody until it is removed. What the previous holder already knows cannot be erased.</p></section></div>:null}
 </section>;
}
