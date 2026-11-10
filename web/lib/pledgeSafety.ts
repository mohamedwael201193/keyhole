/** A charge authorization is specific to the displayed identity and exact decimal quote. */
export type PayoutStorageConsent = {account:string;contract:string;fee:string};
export function storageConsentMatches(consent:PayoutStorageConsent|null,account:string|null,contract:string,fee:string|null):boolean {
 return !!consent&&fee!==null&&consent.account===account&&consent.contract===contract&&consent.fee===fee;
}
export function assertStorageConsent(consent:PayoutStorageConsent|null,account:string,contract:string,shownFee:string|null,plannedFee:string):void {
 if(shownFee===null||shownFee!==plannedFee||(plannedFee!=="0"&&!storageConsentMatches(consent,account,contract,plannedFee)))throw Error("Storage fee changed. Review the fresh nonrefundable fee and consent again.");
}
export type PledgeReadTicket={identity:string;sequence:number;startedAt:number};
export type PledgeReadLease=PledgeReadTicket&{readAt:number};
/** Age is bounded from request START, including the entire aggregate read window. Latest read wins. Starting or failing ANY refresh revokes executable state immediately. */
export function createPledgeReadGate(now:()=>number=()=>performance.now(),maxAgeMs=10000) {
 let sequence=0,latest:PledgeReadTicket|null=null,lease:PledgeReadLease|null=null;
 const current=(ticket:PledgeReadTicket)=>latest?.sequence===ticket.sequence&&latest.identity===ticket.identity;
 return {
  begin(identity:string):PledgeReadTicket {lease=null;return latest={identity,sequence:++sequence,startedAt:now()};},
  complete(ticket:PledgeReadTicket):boolean {if(!current(ticket))return false;if(now()-ticket.startedAt>maxAgeMs){lease=null;throw Error("Chain observation window expired. Refresh before dispatch.");}lease={...ticket,readAt:ticket.startedAt};return true;},
  fail(ticket:PledgeReadTicket):boolean {if(!current(ticket))return false;lease=null;return true;},
  capture(identity:string):PledgeReadLease {if(!lease||lease.identity!==identity||now()-lease.readAt>maxAgeMs)throw Error("Chain state is stale or loading. Refresh before dispatch.");return {...lease};},
  assert(expected:PledgeReadLease,identity:string):void {if(!lease||lease.identity!==identity||expected.identity!==identity||lease.sequence!==expected.sequence||now()-lease.readAt>maxAgeMs)throw Error("Chain state changed, failed or is stale. Refresh before dispatch.");},
 };
}
