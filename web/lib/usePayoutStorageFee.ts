"use client";
import {useEffect,useState} from "react";
import type {PledgeClient} from "./pledgeClient";
/** Public final-chain storage quote only; no holder balances, sessions or history. */
export function usePayoutStorageFee(client:PledgeClient,account:string|null):string|null {
 const [quote,setQuote]=useState<{account:string;contract:string;fee:string}|null>(null);
 useEffect(()=>{
  if(!client.live||!account)return;
  let cancelled=false;
  void Promise.all([client.payoutAccountRegistered(account),client.getPayoutStorageCost()]).then(([registered,cost])=>{
   if(cancelled||typeof registered!=="boolean"||typeof cost!=="string"||!/^\d+$/.test(cost)||BigInt(cost)<=0n)return;
   setQuote({account,contract:client.contractId,fee:registered?"0":cost});
  }).catch(()=>{/* Unknown cost stays unquoted, never zero or an automatic registration. */});
  return ()=>{cancelled=true;};
 },[client,account]);
 return client.live&&quote?.account===account&&quote?.contract===client.contractId?quote.fee:null;
}
