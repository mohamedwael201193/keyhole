import { test, expect } from "@playwright/test";
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
    b.onLoad({filter:/.*/,namespace:"local-test"},a=>({contents:a.path.startsWith("navigation")?`export const usePathname=()=>'/vault';`:`export const useWallet=()=>({accountId:'alice.near',sign:async(op,params={})=>({account_id:'alice.near',public_key:'local-test',signature:'local-test',nonce:'local-test',recipient:'keyhole',message:JSON.stringify({op,account_id:'alice.near',ts_ms:Date.now(),params})}),sendTx:async(call)=>{(window.__calls??=[]).push(call);if(call.method==='register_payout_account')window.__registered=true;return {txHash:'local-test-transaction'};}});`,loader:"js"}));
  }}]});
  const js=result.outputFiles[0].text;
  server=createServer((req,res)=>{if(req.url==="/bundle.js"){res.setHeader("content-type","text/javascript");res.end(js);}else{res.setHeader("content-type","text/html");res.end('<!doctype html><html><body><main id="root"></main><script src="/bundle.js"></script></body></html>');}});
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));url=`http://127.0.0.1:${(server.address() as any).port}`;
});
test.afterAll(async()=>{if(server)await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));});
test("ordinary payout consent and original custody recovery survive reload without duplicate dispatch",async({page},info)=>{
  const id="1:"+"a".repeat(64);let reconciles=0;
  await page.addInitScript(({id})=>{const k='kh_value_recovery_v1:'+JSON.stringify(['alice.near','k1234',id]);if(!sessionStorage.getItem('seeded')){localStorage.setItem(k,JSON.stringify({account:'alice.near',token_id:'k1234',value_op_id:id,status:'processing'}));sessionStorage.setItem('seeded','1');}},{id});
  await page.route(/https:\/\/.*(?:fastnear|near).*|https:\/\/rpc\.mainnet.*/,async route=>{
    const j=route.request().postDataJSON();const m=j.params?.method_name;
    const registered=await page.evaluate(()=>Boolean((window as any).__registered));
    const value=({payout_storage_cost:'3200000000000000000000',payout_account_registered:registered,get_payout_credit:'0',get_pending_payout:null} as any)[m];
    await route.fulfill({json:{result:{result:[...Buffer.from(JSON.stringify(value))]}}});
  });
  await page.route('**/api/worker',async route=>{const j=route.request().postDataJSON();expect(j.op).toBe('reconcile_value_op');const signed=JSON.parse(j.auth.message);expect(signed.params).toEqual({token_id:'k1234',value_op_id:id});reconciles++;await route.fulfill({json:{call_id:'local-test',output:{ok:reconciles>1,value_op_id:id,status:reconciles>1?'success':'processing',admission_finished:reconciles>1}}});});
  await page.goto(url);
  const register=page.getByRole('button',{name:'Register my payout slot'});await expect(register).toBeDisabled();
  await expect(page.getByTestId('payout-panel')).toContainText('0.0032 NEAR permanent payout storage');
  if(process.env.KEYHOLE_INTEGRATION_SCREENSHOTS){await mkdir(process.env.KEYHOLE_INTEGRATION_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.KEYHOLE_INTEGRATION_SCREENSHOTS,`payout-consent-${info.project.name}.png`),fullPage:true});}
  await page.getByRole('checkbox').check();await register.click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__calls?.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).__calls[0])).toMatchObject({method:'register_payout_account',deposit:'3200000000000000000000'});
  await page.getByRole('button',{name:'Check original operation'}).click();await expect(page.getByTestId('value-recovery')).toContainText('Still pending or UNKNOWN');
  await page.reload();await expect(page.getByTestId('value-recovery')).toContainText(id);
  await page.getByRole('button',{name:'Check original operation'}).click();await expect(page.getByTestId('value-recovery')).toContainText('Final provider settlement: success');
  if(process.env.KEYHOLE_INTEGRATION_SCREENSHOTS)await page.screenshot({path:join(process.env.KEYHOLE_INTEGRATION_SCREENSHOTS,`recovery-final-${info.project.name}.png`),fullPage:true});
  expect(reconciles).toBe(2);expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('kh_value_recovery_v1:')).length)).toBe(0);
});
