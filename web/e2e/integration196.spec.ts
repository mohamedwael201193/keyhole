import { test, expect } from "@playwright/test";
import { blockResponse, callFunctionResponse } from "../tests/fixtures/nearRpc";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
let server: Server, url: string;
// Browser component integration only: actual production components/client helpers, mocked wallet/RPC/provider.
// The real signed client fixture is independently verified by Rust; no wallet, secret, paid call or chain write here.
test.beforeAll(async()=>{
  const result=await build({absWorkingDir:process.cwd(),stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PayoutPanel} from './components/PayoutPanel';import {ValueRecovery} from './components/ValueRecovery';createRoot(document.getElementById('root')).render(<><PayoutPanel/><ValueRecovery/></>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",define:{"process.env":"{}","process.env.NODE_ENV":'"production"'},plugins:[{name:"isolated-wallet-adapter",setup(b){
    b.onResolve({filter:/^@\/lib\/wallet$/},()=>({path:"wallet-test-only",namespace:"local-test"}));
    b.onResolve({filter:/^next\/navigation$/},()=>({path:"navigation-test-only",namespace:"local-test"}));
    b.onLoad({filter:/.*/,namespace:"local-test"},a=>({contents:a.path.startsWith("navigation")?`export const usePathname=()=>'/vault';`:`export const useWallet=()=>({accountId:'alice.near',sign:async(op,params={})=>({account_id:'alice.near',public_key:'local-test',signature:'local-test',nonce:'local-test',recipient:'keyhole',message:JSON.stringify({op,account_id:'alice.near',ts_ms:Date.now(),params})}),sendTx:async(call)=>{(window.__calls??=[]).push(call);if(call.method==='register_payout_account')window.__registered=true;await window.__walletSubmitted([call]);return {txHash:'local-test-transaction'};},sendTxBatch:async(calls,consent)=>{if(consent.expectedSigner!=='alice.near')throw Error('wrong expected signer');(window.__calls??=[]).push(...calls);if(calls.some(c=>c.method==='register_payout_account'))window.__registered=true;if(calls.some(c=>c.method==='claim_payout'))window.__claimCalls=(window.__claimCalls??0)+1;await window.__walletSubmitted(calls);return {txHash:'local-test-claim'};}});`,loader:"js"}));
  }}]});
  const js=result.outputFiles[0].text;
  server=createServer((req,res)=>{if(req.url==="/bundle.js"){res.setHeader("content-type","text/javascript");res.end(js);}else{res.setHeader("content-type","text/html");res.end('<!doctype html><html><body><main id="root"></main><script src="/bundle.js"></script></body></html>');}});
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));url=`http://127.0.0.1:${(server.address() as any).port}`;
});
test.afterAll(async()=>{if(server)await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));});
test("ordinary payout consent and original custody recovery survive reload without duplicate dispatch",async({page},info)=>{
  const id="1:"+"a".repeat(64);let reconciles=0, payoutCost="3200000000000000000000", registered=false;
  await page.exposeFunction("__walletSubmitted", (calls:{method:string}[])=>{if(calls.some(c=>c.method==="register_payout_account"))registered=true;});
  await page.addInitScript(({id})=>{const k='kh_value_recovery_v1:'+JSON.stringify(['alice.near','k1234',id]);if(!sessionStorage.getItem('seeded')){localStorage.setItem(k,JSON.stringify({account:'alice.near',token_id:'k1234',value_op_id:id,status:'processing'}));sessionStorage.setItem('seeded','1');}},{id});
  await page.route(/https:\/\/.*(?:fastnear|near).*|https:\/\/rpc\.mainnet.*/,async route=>{
    const j=route.request().postDataJSON();const m=j.params?.method_name;
    if(j.method==='block')return route.fulfill({json:blockResponse()});
    if(j.method==='tx')return route.fulfill({json:{error:{message:'Unknown transaction'}}});
    const value=({payout_storage_cost:payoutCost,payout_account_registered:registered,get_payout_credit:'0',get_pending_payout:null} as any)[m];
    await route.fulfill({json:callFunctionResponse(value)});
  });
  await page.route('**/api/worker',async route=>{const j=route.request().postDataJSON();expect(j.op).toBe('reconcile_value_op');const signed=JSON.parse(j.auth.message);expect(signed.params).toEqual({token_id:'k1234',value_op_id:id});reconciles++;await route.fulfill({json:{call_id:'local-test',output:{ok:reconciles>1,value_op_id:id,status:reconciles>1?'success':'processing',admission_finished:reconciles>1}}});});
  await page.goto(url);
  const register=page.getByRole('button',{name:'Register my payout slot'});await expect(register).toBeDisabled();
  await expect(page.getByTestId('payout-panel')).toContainText('0.0032 NEAR permanent payout storage');
  if(process.env.KEYHOLE_INTEGRATION_SCREENSHOTS){await mkdir(process.env.KEYHOLE_INTEGRATION_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.KEYHOLE_INTEGRATION_SCREENSHOTS,`payout-consent-${info.project.name}.png`),fullPage:true});}
  await page.getByRole('checkbox').check(); await expect(register).toBeEnabled();
  payoutCost="3300000000000000000000"; await page.getByRole('button',{name:'Refresh payout state'}).click();
  await expect(page.getByTestId('payout-panel')).toContainText('0.0033 NEAR permanent payout storage');
  await expect(register).toBeDisabled(); await expect(page.getByRole('checkbox')).not.toBeChecked();
  payoutCost="3200000000000000000000"; await page.getByRole('button',{name:'Refresh payout state'}).click();
  await expect(page.getByTestId('payout-panel')).toContainText('0.0032 NEAR permanent payout storage');
  await expect(register).toBeDisabled(); await page.getByRole('checkbox').check(); await register.click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__calls?.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).__calls[0])).toMatchObject({method:'register_payout_account',deposit:'3200000000000000000000'});
  await page.getByRole('button',{name:'Check original operation'}).click();await expect(page.getByTestId('value-recovery')).toContainText('Still pending or UNKNOWN');
  await page.reload();await expect(page.getByTestId('value-recovery')).toContainText(id);
  await page.getByRole('button',{name:'Check original operation'}).click();await expect(page.getByTestId('value-recovery')).toContainText('Final provider settlement: success');
  if(process.env.KEYHOLE_INTEGRATION_SCREENSHOTS)await page.screenshot({path:join(process.env.KEYHOLE_INTEGRATION_SCREENSHOTS,`recovery-final-${info.project.name}.png`),fullPage:true});
  expect(reconciles).toBe(2);expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('kh_value_recovery_v1:')).length)).toBe(0);
});

// Actual ordinary payout component + durable Web Locks/store + receipt helpers; transports remain mocked.
test("Vault cashout keeps UNKNOWN across reload and binds FINAL receipt before delivery", async ({page}) => {
  let final = false, chainPending = true, wrongSigner = false, claimed = false;
  // Mock backend state belongs to the wallet transport, not a document that may
  // be destroyed by reload while an earlier RPC request is still in flight.
  await page.exposeFunction("__walletSubmitted", (calls:{method:string}[])=>{if(calls.some(c=>c.method==="claim_payout"))claimed=true;});
  await page.addInitScript(() => { (window as any).__registered = true; });
  await page.route(/https:\/\/.*(?:fastnear|near).*|https:\/\/rpc\.mainnet.*/, async route => {
    const j = route.request().postDataJSON();
    if (j.method === 'tx') {
      if (!final) return route.fulfill({ json: { error: { message: 'Unknown transaction' } } });
      return route.fulfill({ json: { result: { final_execution_status: 'FINAL', transaction_outcome: {block_hash:'block42'},
        transaction: {hash:'local-test-claim', signer_id:wrongSigner?'bob.near':'alice.near', receiver_id:'keyhole-devmo.near', actions:[{FunctionCall:{method_name:'claim_payout',args:Buffer.from('{}').toString('base64'),deposit:'1',gas:'70000000000000'}}]},
        status:{SuccessValue:'dHJ1ZQ=='}, receipts_outcome:[{block_hash:'block42',outcome:{status:{SuccessValue:''}}},{block_hash:'block42',outcome:{status:{SuccessValue:'dHJ1ZQ=='}}}] } } });
    }
    if (j.method === 'block') return route.fulfill({json:blockResponse({ height: j.params?.block_id ? 42 : 41 })});
    const m = j.params?.method_name;
    const value = ({payout_storage_cost:'3200000000000000000000',payout_account_registered:true,get_payout_credit:claimed?'0':'10',get_pending_payout:claimed&&chainPending?{nonce:'1',amount:'10'}:null} as any)[m];
    await route.fulfill({json:callFunctionResponse(value, { height: 41 })});
  });
  await page.goto(url);
  const claim = page.getByRole('button',{name:'Claim native NEAR'});
  await expect(claim).toBeEnabled(); await claim.click(); await expect(claim).toBeDisabled();
  await expect(page.getByTestId('payout-panel')).toContainText('pending / UNKNOWN');
  expect(await page.evaluate(()=>(window as any).__claimCalls)).toBe(1);
  await page.reload(); await expect(claim).toBeDisabled();
  await expect(page.getByTestId('payout-panel')).not.toContainText('Native payout delivered');
  // FINAL alone cannot clear a chain-pending payout; a foreign signer cannot clear it either.
  final=true; await page.getByRole('button',{name:'Refresh payout state'}).click(); await expect(claim).toBeDisabled();
  chainPending=false; wrongSigner=true; await page.getByRole('button',{name:'Refresh payout state'}).click();
  await expect(page.getByTestId('payout-panel')).toContainText('pending / UNKNOWN');
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('keyhole:pledge-money:v1:')).length)).toBe(1);
  wrongSigner=false; await page.getByRole('button',{name:'Refresh payout state'}).click();
  await expect(page.getByTestId('payout-panel')).toContainText('Native payout delivered · FINAL receipt and callback verified.');
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('keyhole:pledge-money:v1:')).length)).toBe(0);
  expect(await page.evaluate(()=>(window as any).__claimCalls??0)).toBe(0); // no replacement dispatch after reload
});
