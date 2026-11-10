"use client";
import {useEffect,useState} from "react";
import type {PledgeClient} from "./pledgeClient";
/** Public final-chain storage quote only; no holder balances, sessions or history. */
export function usePayoutStorageFee(client:PledgeClient,account:string|null):string|null {
 const [quote,setQuote]=useState<{account:string;contract:string;fee:string}|null>(null);
 useEffect(()=>{
  if(!client.live||!account)return;
  let cancelled=false,sequence=0;
  const update=()=>{const requested=++sequence;void Promise.all([client.payoutAccountRegistered(account),client.getPayoutStorageCost()]).then(([registered,cost])=>{
   if(cancelled||requested!==sequence)return;
   if(typeof registered!=="boolean"||typeof cost!=="string"||!/^\d+$/.test(cost)||BigInt(cost)<=0n){setQuote(null);return;}
   setQuote({account,contract:client.contractId,fee:registered?"0":cost});
  }).catch(()=>{if(!cancelled&&requested===sequence)setQuote(null);});};
  update();const timer=setInterval(update,15000);window.addEventListener("focus",update);window.addEventListener("keyhole:keys-changed",update);
  return ()=>{cancelled=true;clearInterval(timer);window.removeEventListener("focus",update);window.removeEventListener("keyhole:keys-changed",update);};
 },[client,account]);
 return client.live&&quote?.account===account&&quote?.contract===client.contractId?quote.fee:null;
}
