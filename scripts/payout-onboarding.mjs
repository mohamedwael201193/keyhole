#!/usr/bin/env node
/** Read-only exact-fee release planning. Prints unsigned actions; NEVER signs, pays, deploys or reads credentials. */
import { pathToFileURL } from 'node:url';
export async function payoutOnboarding(read, accounts = []) {
  const config = await read('config', {});
  const cost = await read('payout_storage_cost', {});
  if (typeof cost !== 'string' || !/^[1-9]\d*$/.test(cost)) throw Error('invalid exact storage cost');
  const recipients = [...new Set([config.minter, ...(config.royalty_bps > 0 ? [config.treasury] : []), ...accounts])];
  const plan=[];
  for(const account of recipients) {
    if(typeof account !== 'string' || !/^[a-z0-9._-]{2,64}$/.test(account)) throw Error('invalid payout recipient');
    const [registered,credit,pending]=await Promise.all([read('payout_account_registered',{account_id:account}),read('get_payout_credit',{account_id:account}),read('get_pending_payout',{account_id:account})]);
    if(typeof registered!=='boolean')throw Error('registration read unavailable');
    plan.push({account,registered,available_credit_yocto:credit,pending,registration:registered?null:{method:'register_payout_account',args:{account_id:account},deposit_yocto:cost,gas:'30000000000000',consent:'Explicit nonrefundable permanent 320-byte storage purchase; anyone may sponsor only after exact-fee approval'},claim:registered && credit!=='0' && !pending ? {signer:account,method:'claim_payout',args:{},deposit_yocto:'1',gas:'70000000000000'}:null});
  }
  return {status:'UNSIGNED_PLAN_NOT_EXECUTED',total_nonrefundable_storage_yocto:(BigInt(cost)*BigInt(plan.filter(p=>!p.registered).length)).toString(),items:plan};
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rpc=process.env.NEAR_RPC || 'https://rpc.mainnet.fastnear.com',contract=process.env.KEYHOLE_CONTRACT || 'keyhole-devmo.near';
  const read=async(method,args)=>{
    const r=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({jsonrpc:'2.0',id:'payout-plan',method:'query',params:{request_type:'call_function',finality:'final',account_id:contract,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString('base64')}})});
    const j=await r.json();if(!r.ok||j.error||j.result?.error)throw Error('candidate payout methods/state unavailable; no actions executed');return JSON.parse(Buffer.from(j.result.result).toString());
  };
  payoutOnboarding(read,process.argv.slice(2)).then(p=>console.log(JSON.stringify({contract,...p},null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
