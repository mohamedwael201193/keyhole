/** Adversarial component/storage tests only. No real wallet, worker, chain or funded acceptance. */
import {test,expect,type Page} from "@playwright/test";
/** Phone layouts keep one panel on screen. Open inventory, then return to the loan actions. */
async function readPrivate(page: Page) {
  const account = page.getByRole("tab", { name: "Account & inventory", exact: true });
  if (await account.isVisible()) await account.click();
  await page.getByRole("button", { name: "Read private at-risk inventory", exact: true }).click();
  const action = page.getByRole("tab", { name: "Loan action", exact: true });
  if (await action.isVisible()) await action.click();
}
import {build} from "esbuild";
import {createServer,type Server} from "node:http";
import path from "node:path";
let server:Server,url:string;
/** Browser dialogs seen by the current test (window.confirm on exit), and how to answer them. */
const dialogs:string[]=[];let dialogMode:'accept'|'dismiss'='accept';
const terms={lender:"lender.near",principal:"10000000000000000000000",repayment:"10100000000000000000000",duration_sec:"7200",grace_sec:"900",floor_raw:"500000"};
const last={token_id:"k1",nonce:"1",borrower:"alice.near",owner_epoch:"1",terms,state:"UnlockPending",resolution:"repaid",due_ns:"1"};
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {LivePledge} from './app/pledge/LivePledge';import * as money from './lib/pledgeMoney';import * as exits from './lib/pledgeExit';import * as intents from './lib/pledgeIntentStore';import * as redirect from './lib/walletRedirect';import * as auth from './lib/nep413';import {ed25519} from '@noble/curves/ed25519.js';import bs58 from 'bs58';
window.h={exactExitPreviewFixture:true,withdrawSignCalls:0,account:'alice.near',readMs:window.initialDelay||0,failRead:false,reads:0,workerCalls:0,walletCalls:0,authConsumed:0,sent:[],money,exits,intents,redirect,badReceipt:window.initialBadReceipt||false,reconcileCalls:0};
window.h.authFor=(record,n=1)=>{const seed=new Uint8Array(32).fill(9),nonce=new Uint8Array(32).fill(n),message=auth.buildMessage('exact_near_exit_v1','alice.near',{intent_id:record.id,token_id:'k1',owner_epoch:'1',amount:'100000',to:'alice.near',chain:'near',token:'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',exit_mode:'exact-near-v1',min_amount_out:'100000',deadline_ms:Date.now()+300000}),recipient='keyhole';return {account_id:'alice.near',public_key:'ed25519:'+bs58.encode(ed25519.getPublicKey(seed)),message,nonce:auth.toB64(nonce),recipient,signature:auth.toB64(ed25519.sign(auth.payloadHash(message,nonce,recipient),seed))};};
if(!location.search.includes('bare'))createRoot(document.getElementById('root')).render(<LivePledge role='borrower' tokenId='k1'/>);`;
const mockClient=`export const payoutStorageConsent=()=>"No storage fee";
export function createPledgeClient(){const h=window.h;const read=async value=>{const delay=h.readMs;if(delay)await new Promise(r=>setTimeout(r,delay));if(h.failRead)throw Error('RPC unavailable');return value;};return {contractId:'keys.near',rpcUrl:location.origin+'/rpc'+(h.badReceipt?'?bad=1':''),canTransact:()=>true,getLoan:()=>{h.reads++;return read(h.loan||null);},getOwner:()=>read(h.account),getControl:()=>read({owner_epoch:'1',listed:false,transfer_pending:false,pending_value_ops:'0'}),getLenderOffer:()=>read(null),getLoanLimits:()=>read({storage_bond:'1',min_duration_sec:'1',max_duration_sec:'10000',max_grace_sec:'1000'}),getPledgeConfig:()=>read({lending_enabled:true}),getCollateralBinding:()=>read({ready:true}),chainNowNs:()=>read(String(BigInt(Date.now())*1000000n)),getPayoutCredit:()=>read(h.credit||'0'),getPendingPayout:()=>read(null),payoutAccountRegistered:()=>read(true),getCertificateTemplate:()=>read(null),prepareAction:async(account,call)=>{if(h.deferPrepare)await new Promise(r=>h.resolvePrepare=r);return {calls:[call],payoutStorageChargeYocto:'0'};},buildOpenLoan:(args,deposit)=>({method:'open_loan',args,deposit,gas:'200000000000000'}),buildClaimPayout:()=>({method:'claim_payout',args:{},deposit:'1',gas:'200000000000000'})};}`;
const mockWallet=`import {useEffect,useState} from 'react';import {sendRoutedKeysCalls} from './lib/keysTx';
export function useWallet(){const h=window.h;const [account,setAccount]=useState(h.account),[pending,setPending]=useState(()=>{const raw=sessionStorage.getItem('kh_pending_sign');if(raw&&location.hash){const recovered=h.redirect.parseWalletRedirect(raw,location.hash);if(recovered)sessionStorage.removeItem('kh_pending_sign');history.replaceState(null,'',location.pathname+location.search);if(recovered)return recovered;}return JSON.parse(sessionStorage.getItem('test-pending')||'null');});
useEffect(()=>{h.setPending=p=>{sessionStorage.setItem('test-pending',JSON.stringify(p));setPending(p);};h.changeAccount=a=>{h.account=a;setAccount(a);};},[]);
return {accountId:account,pending,clearPending:()=>{h.authConsumed++;sessionStorage.removeItem('test-pending');setPending(null);},connect:()=>{},sign:async(op,params)=>{if(op==='exact_near_exit_v1')h.withdrawSignCalls++;const auth={account_id:account,signature:'sig-'+Date.now(),message:JSON.stringify({op,account_id:account,params})};if(op==='exact_near_exit_v1'&&h.deferSign)return new Promise((r,reject)=>{h.resolveSign=()=>r(auth);h.rejectSign=()=>reject(Error('wallet declined before worker'));});return auth;},sendTxBatch:async(calls,consent)=>sendRoutedKeysCalls(async()=>{if(h.deferRoute)await new Promise(r=>{h.resolveRoute=r;});return {kind:'nc',accountId:h.account,wallet:{signAndSendTransaction:async p=>{h.walletCalls++;return {transaction:{hash:'original',signer_id:p.signerId}};}}};},calls,consent,'keys.near')};}`;
const mockWorker=`export async function callWorker(op,auth){const h=window.h;if(op==='pledge_inventory')return {output:{ok:true,complete:true,account:h.account,token_id:'k1',owner_epoch:'1',observed_at_ns:String(BigInt(Date.now())*1000000n),eligible_pending_zero:true,assets:[{token:'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',amount:'1000000',decimals:6}],obligations:[],limits:{per_tx_usd_micro:1000000,daily_usd_micro:1000000},spent_today_usd_micro:0,withdraw_cooldown_until_ms:null}};if(op==='withdraw_dry_run'){h.dryRunCalls=(h.dryRunCalls||0)+1;const p=JSON.parse(auth.message).params;return {output:{ok:true,op:'withdraw_dry_run',to:p.to,amount:p.amount,token:p.token,chain:p.chain,amount_out:h.exactExitPreviewFixture?p.amount:'990000',min_amount_out:h.exactExitPreviewFixture?p.amount:'985000',broadcast:false,...(h.exactExitPreviewFixture?{exit_mode:'exact-near-v1',execution_supported:true,requires_unshield_readback:true,advisory_only:true}:{})}};}if(op==='exact_near_exit_v1'){const p=JSON.parse(auth.message).params;if(p.exit_mode!=='exact-near-v1'||p.min_amount_out!==p.amount||!Number.isSafeInteger(p.deadline_ms))throw Error('Unbound exact-exit test request');h.workerCalls++;h.sent.push(p);return {output:h.pendingExit?{status:'pending',admission_finished:false,value_op_id:'value-1'}:{status:'success',admission_finished:true}};}if(op==='reconcile_value_op'){h.reconcileCalls++;return h.pendingReconcile?{output:{admission_finished:false,status:'needs_review'}}:{output:{admission_finished:true}};}throw Error('Unexpected test worker call');}`;
// Mock custody transport only; the production preview/consent guard is not replaced.
test.beforeAll(async()=>{
 const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",banner:{js:'window.process={env:{NODE_ENV:"development"}};'},jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'},loader:{".css":"empty"},plugins:[{name:"test-transports",setup(builder){
  builder.onResolve({filter:/^(next\/link|@\/lib\/(wallet|worker|pledgeClient|usePayoutStorageFee|loanCertificate))$/},args=>({path:args.path,namespace:"fixture"}));
  builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path==='next/link'?`import React from 'react';export default function Link({children,...p}){return <a {...p}>{children}</a>}`:args.path.endsWith('/wallet')?mockWallet:args.path.endsWith('/worker')?mockWorker:args.path.endsWith('/pledgeClient')?mockClient:args.path.endsWith('/usePayoutStorageFee')?'export const usePayoutStorageFee=()=>"0";':'export const requestLoanCertificate=async()=>null;export const verifyLoanCertificate=async()=>false;',loader:"tsx",resolveDir:process.cwd()}));
  builder.onResolve({filter:/^\.\/lib\/(keysTx|walletRedirect|withdrawDryRun)$/ ,namespace:"fixture"},args=>({path:path.join(process.cwd(),args.path.slice(2)+".ts")}));
 }}]});
 const js=result.outputFiles[0].text;
 server=createServer(async(req,res)=>{
  if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(js);return;}
  if(req.url?.startsWith('/rpc')){let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);const result=request.method==='tx'?{final_execution_status:'FINAL',transaction_outcome:{block_hash:'block42'},transaction:{hash:request.params?.tx_hash==='R'.repeat(44)?'R'.repeat(44):'X',signer_id:new URL(req.url,'http://localhost').searchParams.has('bad')?'bob.near':'alice.near',receiver_id:'keys.near',actions:[{FunctionCall:{method_name:'claim_payout',args:Buffer.from('{}').toString('base64'),gas:'200000000000000',deposit:'1'}}]}}:{header:{hash:'block42',height:42}};const delay=Number(new URL(req.url,'http://localhost').searchParams.get('delay')||0);if(delay)await new Promise(r=>setTimeout(r,delay));res.setHeader('content-type','application/json');res.end(JSON.stringify({result}));return;}
  res.setHeader('content-type','text/html');res.end('<html><div id="root"></div><script src="/app.js"></script></html>');
 });await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Fixture unavailable');url=`http://127.0.0.1:${address.port}`;
});
test.afterAll(async()=>{if(server)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));});
test.beforeEach(async({page})=>{
 // The exit confirm step is window.confirm. Accept it here so the existing recovery tests reach the withdrawal sign;
 // the dedicated confirm test below cancels it and records the message.
 dialogs.length=0;dialogMode='accept';
 // Every tab of the test answers the confirm, including a second tab opened with context.newPage().
 const answer=(d:import('@playwright/test').Dialog)=>{dialogs.push(d.message());if(dialogMode==='accept')void d.accept();else void d.dismiss();};
 page.context().on('page',p=>p.on('dialog',answer));page.on('dialog',answer);
 await page.addInitScript(value=>{if(!location.search.includes('no-history'))sessionStorage.setItem('keyhole:pledge-last:v1:keys.near:k1',JSON.stringify(value));},last);});
test('mounted popup exit blocked by a failed poll is retryable after reload',async({page})=>{
 await page.clock.install();await page.goto(url);await expect(page.getByTestId('settlement')).toContainText('Repaid');await readPrivate(page);await expect(page.getByRole('button',{name:'Exit to my wallet'})).toBeEnabled();await page.evaluate('h.deferSign=true');await page.getByRole('button',{name:'Exit to my wallet'}).click();await page.evaluate('h.failRead=true');await page.clock.runFor(4100);await page.evaluate('h.resolveSign()');await expect.poll(()=>page.evaluate(`h.intents.createBrowserIntentStore("keyhole:pledge-exit:v1:keys.near:alice.near:k1",()=>{},h.intents.browserIntentEnvironment()).load()?.status`)).toBe("Retryable");expect(await page.evaluate('h.workerCalls')).toBe(0);
 await page.reload();await readPrivate(page);await expect(page.getByRole('button',{name:'Exit to my wallet'})).toBeEnabled();await page.getByLabel('Ordinary USDC self-exit').fill('0.90');await page.getByRole('button',{name:'Exit to my wallet'}).click();await expect.poll(()=>page.evaluate('h.workerCalls')).toBe(1);expect(await page.evaluate('h.sent[0].amount')).toBe('100000');await expect(page.getByText(/Exact self-exit verified/)).toBeVisible();
});
test('redirect auth remains unconsumed during failed reads and resumes the saved intent after reload',async({page})=>{
 await page.goto(url);await expect(page.getByTestId('settlement')).toBeVisible();await page.evaluate('h.failRead=true');await page.getByRole('button',{name:'Refresh chain'}).click();await expect(page.getByTestId('loan-state')).toContainText('unavailable');await page.evaluate(`(async()=>{const store=h.intents.createBrowserIntentStore('keyhole:pledge-exit:v1:keys.near:alice.near:k1',()=>{},h.intents.browserIntentEnvironment());const original=await store.reserve({account:'alice.near',token:'k1',epoch:'1',amount:'100000',status:'AwaitingSignature',intent:'exact_near_exit_v1'});h.setPending({account_id:'alice.near',signature:'redirect',message:JSON.stringify({op:'exact_near_exit_v1',account_id:'alice.near',params:{intent_id:original.id,token_id:'k1',owner_epoch:'1',amount:'100000',to:'alice.near',chain:'near',token:'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',exit_mode:'exact-near-v1',min_amount_out:'100000',deadline_ms:Date.now()+300000}})});})()`);
 expect(await page.evaluate("h.authConsumed")).toBe(0);expect(await page.evaluate("h.workerCalls")).toBe(0);
 // Remount with a fresh read; the preserved redirect auth may now continue.
 await page.reload();await expect.poll(()=>page.evaluate('h.workerCalls')).toBe(1);expect(await page.evaluate('h.authConsumed')).toBe(1);await expect(page.getByText(/Exact self-exit verified/)).toBeVisible();
});
test('mounted component makes progress with sustained five-second reads',async({page})=>{
 await page.clock.install();await page.addInitScript('window.initialDelay=5000');await page.goto(url);await page.clock.runFor(4000);expect(await page.evaluate('h.reads')).toBe(1);await expect(page.getByRole('button',{name:'Refresh chain'})).toBeDisabled();await page.clock.runFor(1000);await expect(page.getByRole('button',{name:'Refresh chain'})).toBeEnabled();await page.clock.runFor(4000);expect(await page.evaluate('h.reads')).toBe(2);await page.clock.runFor(5000);await expect(page.getByRole('button',{name:'Refresh chain'})).toBeEnabled();
});
test('two real tabs preserve Y when a delayed FINAL X returns, including reload',async({page,context})=>{
 const other=await context.newPage();await page.goto(url+'/?bare');await other.goto(url+'/?bare');await page.evaluate(`(async()=>{h.store=h.money.browserMoneyStore('alice.near','keys.near');await h.money.dispatchMoneyBatch('alice.near','keys.near',[{method:'claim_payout',args:{},deposit:'1',gas:'200000000000000'}],h.store,async()=>({txHash:'X'}),'42');})()`);
 await other.evaluate(`(()=>{h.store=h.money.browserMoneyStore('alice.near','keys.near');h.saved=h.store.load();h.late=(async()=>{if(await h.money.finalMoneyReceipt(h.saved,location.origin+'/rpc?delay=300'))h.cleared=await h.money.clearMoneyOperation(h.store,h.saved);})();})()`);
 await page.evaluate(`(async()=>{const x=h.store.load();if(!await h.money.finalMoneyReceipt(x,location.origin+'/rpc'))throw Error('receipt');await h.money.clearMoneyOperation(h.store,x);h.y=h.money.dispatchMoneyBatch('alice.near','keys.near',[x.call],h.store,async()=>{await new Promise(r=>h.release=r);return {redirect:true};},'43');})()`);
 await other.evaluate('h.late');expect(await other.evaluate('h.cleared')).toBe(false);await page.reload();expect(await page.evaluate(`h.money.browserMoneyStore('alice.near','keys.near').load().status`)).toBe('AwaitingWallet');expect(await page.evaluate(`h.money.browserMoneyStore('alice.near','keys.near').load().minBlockHeight`)).toBe('43');await other.close();
});
// Chromium's first localStorage read rebinds its observer at the GetAll snapshot.
// A bare tab whose first read races the winning write can see that record while
// dropping its earlier queued event. Prime BOTH real stores before publishing,
// just as the mounted component's initial read does; never substitute a sleep.
async function readyMoneyTabs(tabs: Page[]) {
 for (const tab of tabs) {
  await tab.goto(url+'/?bare');
  expect(await tab.evaluate(`(()=>{
   h.store=h.money.browserMoneyStore('alice.near','keys.near');
   const initial=h.store.load();
   h.events=0;h.notifiedId=null;
   h.store.subscribe(()=>{h.events++;h.notifiedId=h.store.load()?.id??null;});
   h.go=()=>h.money.dispatchMoneyBatch('alice.near','keys.near',[{method:'claim_payout',args:{},deposit:'1',gas:'200000000000000'}],h.store,async()=>{h.walletCalls++;return {redirect:true};},'42').then(()=>true,()=>false);
   return initial;
  })()`)).toBeNull();
 }
}
async function assertOneWalletAndNotifications(tabs: Page[], results: boolean[]) {
 expect(results.filter(Boolean)).toHaveLength(1);
 const calls=await Promise.all(tabs.map(tab=>tab.evaluate<number>('h.walletCalls')));
 expect(calls.reduce((sum,n)=>sum+n,0)).toBe(1);
 const winner=tabs[results.indexOf(true)];
 const id=await winner.evaluate<string>('h.store.load().id');
 // Assert the original event predicate in BOTH tabs, then bind the notification
 // to this real operation. A same-tab custom event alone cannot satisfy both.
 for (const tab of tabs) {
  await expect.poll(()=>tab.evaluate<number>('h.events')).toBeGreaterThan(0);
  await expect.poll(()=>tab.evaluate<string>('h.notifiedId')).toBe(id);
 }
}
test('simultaneous real tabs open one wallet and receive storage notifications',async({page,context})=>{
 const other=await context.newPage(),tabs=[page,other];await readyMoneyTabs(tabs);
 const results=await Promise.all(tabs.map(tab=>tab.evaluate<boolean>('h.go()')));
 await assertOneWalletAndNotifications(tabs,results);await other.close();
});
for (const first of [0,1]) test(`storage notification survives contender ${first+1} finishing before the other starts`,async({page,context})=>{
 const other=await context.newPage(),tabs=[page,other];await readyMoneyTabs(tabs);
 const results=[false,false];results[first]=await tabs[first].evaluate<boolean>('h.go()');
 results[1-first]=await tabs[1-first].evaluate<boolean>('h.go()');
 await assertOneWalletAndNotifications(tabs,results);await other.close();
});

test('mounted signing aborts if the signer changes during delayed wallet routing',async({page})=>{
 await page.goto(url);await expect(page.getByTestId('settlement')).toBeVisible();await page.evaluate("h.credit='100';h.deferRoute=true");await page.getByRole('button',{name:'Refresh chain'}).click();await page.getByRole('button',{name:'Claim your funds',exact:true}).click();await expect.poll(()=>page.evaluate("typeof h.resolveRoute")).toBe('function');await page.evaluate("h.changeAccount('bob.near');h.resolveRoute()");await expect(page.getByRole('status')).toContainText('Signer changed');expect(await page.evaluate('h.walletCalls')).toBe(0);expect(await page.evaluate("h.money.browserMoneyStore('alice.near','keys.near').load()")).toBeNull();
});
test('mounted timeout recovers and late reads never replace the successful retry',async({page})=>{
 await page.clock.install();await page.addInitScript('window.initialDelay=20000');await page.goto(url);await page.evaluate("h.credit='100'");await page.clock.runFor(15001);await expect(page.getByRole('status')).toContainText('timed out');await expect(page.getByRole('button',{name:'Refresh chain'})).toBeEnabled();await page.evaluate("h.credit='0';h.readMs=0");await page.getByRole('button',{name:'Refresh chain'}).click();await expect(page.getByTestId('settlement')).toContainText('Repaid');await page.clock.runFor(5000);await expect(page.getByTestId('settlement')).toContainText('Repaid');await expect(page.getByRole('button',{name:'Claim your funds',exact:true})).toHaveCount(0);
});
test('mounted observation age is request-start bounded, with a recoverable error',async({page})=>{
 await page.clock.install();await page.addInitScript('window.initialDelay=11000');await page.goto(url);await page.clock.runFor(11001);await expect(page.getByRole('status')).toContainText('observation window expired');await expect(page.getByTestId('loan-state')).toContainText('unavailable');await page.evaluate('h.readMs=0');await page.getByRole('button',{name:'Refresh chain'}).click();await expect(page.getByTestId('settlement')).toContainText('Repaid');
});

// R4: the production redirect parser and actual component, with real signatures and browser storage.
test('R4 intact delayed X cannot bind to identical-fields Y after reload',async({page})=>{
 await page.goto(url+'/?bare&no-history');await page.evaluate(`(async()=>{h.store=h.intents.createBrowserIntentStore('keyhole:pledge-exit:v1:keys.near:alice.near:k1',()=>{},h.intents.browserIntentEnvironment());const fields={account:'alice.near',token:'k1',epoch:'1',amount:'100000',status:'AwaitingSignature',intent:'exact_near_exit_v1'};const x=await h.store.reserve(fields);h.old=h.authFor(x);await h.store.clear(x);h.y=await h.store.reserve(fields);sessionStorage.setItem('test-pending',JSON.stringify(h.old));sessionStorage.setItem('expected-Y',JSON.stringify(h.y));})()`);
 await page.goto(url+'/?no-history');await expect(page.getByText(/Original exit AwaitingSignature/)).toBeVisible();expect(await page.evaluate('h.workerCalls')).toBe(0);expect(await page.evaluate(`JSON.stringify(h.intents.createBrowserIntentStore('keyhole:pledge-exit:v1:keys.near:alice.near:k1',()=>{},h.intents.browserIntentEnvironment()).load())===sessionStorage.getItem('expected-Y')`)).toBe(true);
 await readPrivate(page);await page.getByRole('button',{name:'Exit to my wallet',exact:true}).click();await expect.poll(()=>page.evaluate('h.workerCalls')).toBe(1);expect(await page.evaluate("h.sent[0].intent_id===JSON.parse(sessionStorage.getItem('expected-Y')).id")).toBe(true);
});
test('R4 production callback parser rejects X signature paired with overwritten Y challenge',async({page})=>{
 await page.goto(url+'/?bare&no-history');const hash=await page.evaluate(`(async()=>{const store=h.intents.createBrowserIntentStore('keyhole:pledge-exit:v1:keys.near:alice.near:k1',()=>{},h.intents.browserIntentEnvironment()),fields={account:'alice.near',token:'k1',epoch:'1',amount:'100000',status:'AwaitingSignature',intent:'exact_near_exit_v1'};const x=await store.reserve(fields),old=h.authFor(x,1);await store.clear(x);const y=await store.reserve(fields),next=h.authFor(y,2);sessionStorage.setItem('expected-Y',JSON.stringify(y));sessionStorage.setItem('kh_pending_sign',JSON.stringify({message:next.message,nonce:next.nonce,callbackUrl:location.origin+'/?no-history'}));return '#'+new URLSearchParams({signature:old.signature,accountId:old.account_id,publicKey:old.public_key});})()`);
 await page.goto(url+'/?no-history'+hash);await expect(page.getByText(/Original exit AwaitingSignature/)).toBeVisible();expect(await page.evaluate('h.workerCalls')).toBe(0);expect(await page.evaluate('h.authConsumed')).toBe(0);expect(await page.evaluate("sessionStorage.getItem('kh_pending_sign')!==null")).toBe(true);expect(await page.evaluate(`JSON.stringify(h.intents.createBrowserIntentStore('keyhole:pledge-exit:v1:keys.near:alice.near:k1',()=>{},h.intents.browserIntentEnvironment()).load())===sessionStorage.getItem('expected-Y')`)).toBe(true);
 await readPrivate(page);await page.getByRole('button',{name:'Exit to my wallet',exact:true}).click();await expect.poll(()=>page.evaluate('h.workerCalls')).toBe(1);
});
test('R4 actual Prepare button cannot hide awaiting or Retryable exit recovery',async({page})=>{
 await page.goto(url);await expect(page.getByTestId('settlement')).toBeVisible();await readPrivate(page);await page.evaluate('h.deferSign=true');await page.getByRole('button',{name:'Exit to my wallet',exact:true}).click();const prepare=page.getByRole('button',{name:'Prepare another loan',exact:true});await expect(prepare).toBeDisabled();await prepare.evaluate((button:HTMLButtonElement)=>button.click());await page.evaluate('h.rejectSign()');await expect(page.getByText(/Original exit Retryable/)).toBeVisible();await expect(prepare).toBeDisabled();await prepare.evaluate((button:HTMLButtonElement)=>button.click());expect(await page.evaluate('h.workerCalls')).toBe(0);
 await page.reload();await expect(page.getByText(/Original exit Retryable/)).toBeVisible();await expect(page.getByTestId('settlement')).toContainText('Repaid');await readPrivate(page);await page.getByRole('button',{name:'Exit to my wallet',exact:true}).click();await expect.poll(()=>page.evaluate('h.workerCalls')).toBe(1);await expect(page.getByRole('button',{name:'Prepare another loan',exact:true})).toBeEnabled();
});
test('R4 Pending exit survives Prepare and reload; reconcile never resends it',async({page})=>{
 await page.goto(url);await expect(page.getByTestId('settlement')).toBeVisible();await readPrivate(page);await page.evaluate('h.pendingExit=true');await page.getByRole('button',{name:'Exit to my wallet',exact:true}).click();await expect(page.getByText(/Original exit Pending/)).toBeVisible();expect(await page.evaluate('h.workerCalls')).toBe(1);const prepare=page.getByRole('button',{name:'Prepare another loan',exact:true});await expect(prepare).toBeDisabled();await prepare.evaluate((button:HTMLButtonElement)=>button.click());
 await page.reload();await expect(page.getByRole('button',{name:'Check original withdrawal',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Check original withdrawal',exact:true}).click();await expect.poll(()=>page.evaluate('h.reconcileCalls')).toBe(1);expect(await page.evaluate('h.workerCalls')).toBe(0);await expect(page.getByText(/Original exit Pending/)).toHaveCount(0);await page.getByRole('button',{name:'Prepare another loan',exact:true}).click();await expect(page.getByLabel('Named lender',{exact:true})).toBeVisible();
});
test('R4 saved exit recovery renders without any presentation history',async({page})=>{
 await page.goto(url+'/?bare&no-history');await page.evaluate(`(async()=>{const store=h.intents.createBrowserIntentStore('keyhole:pledge-exit:v1:keys.near:alice.near:k1',()=>{},h.intents.browserIntentEnvironment());await store.reserve({account:'alice.near',token:'k1',epoch:'1',amount:'100000',status:'Retryable',intent:'exact_near_exit_v1'});})()`);await page.goto(url+'/?no-history');await expect(page.getByTestId('settlement')).toContainText('No loan ending is inferred');await expect(page.getByRole('button',{name:'Discard unsent withdrawal',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Pledge this account',exact:true})).toHaveCount(0);await readPrivate(page);await page.getByRole('button',{name:'Exit to my wallet',exact:true}).click();await expect.poll(()=>page.evaluate('h.workerCalls')).toBe(1);
});
test('R4 new tab recovers FINAL after originating session closes, but not wrong-signer evidence',async({page,context})=>{
 await page.goto(url+'/?bare&no-history');await page.evaluate(`(async()=>{const store=h.money.browserMoneyStore('alice.near','keys.near');await h.money.dispatchMoneyBatch('alice.near','keys.near',[{method:'claim_payout',args:{},deposit:'1',gas:'200000000000000'}],store,async()=>({txHash:'X'}),'42');})()`);const other=await context.newPage();await other.addInitScript('window.initialBadReceipt=true');await page.close();await other.goto(url+'/?no-history');await expect(other.getByText(/Original money operation Submitted/)).toBeVisible();expect(await other.evaluate('h.walletCalls')).toBe(0);await other.evaluate('h.badReceipt=false');await other.getByRole('button',{name:'Refresh chain',exact:true}).click();await expect.poll(()=>other.evaluate("h.money.browserMoneyStore('alice.near','keys.near').load()")).toBeNull();expect(await other.evaluate('h.walletCalls')).toBe(0);await other.close();
});
test('R4 lost-owner hash recovery verifies first; a forged hash cannot overwrite the intent',async({page,context})=>{
 await page.goto(url+'/?bare&no-history');await page.evaluate(`(async()=>{const store=h.money.browserMoneyStore('alice.near','keys.near');await h.money.dispatchMoneyBatch('alice.near','keys.near',[{method:'claim_payout',args:{},deposit:'1',gas:'200000000000000'}],store,async()=>({redirect:true}),'42');})()`);const other=await context.newPage();await page.close();await other.goto(url+'/?no-history');const input=other.getByLabel('Original transaction hash',{exact:true});await input.fill('Q'.repeat(44));await other.getByRole('button',{name:'Check original hash',exact:true}).click();await expect(other.getByRole('status')).toContainText('No matching FINAL');expect(await other.evaluate("h.money.browserMoneyStore('alice.near','keys.near').load().txHash")).toBeUndefined();await input.fill('R'.repeat(44));await other.getByRole('button',{name:'Check original hash',exact:true}).click();await expect.poll(()=>other.evaluate("h.money.browserMoneyStore('alice.near','keys.near').load()")).toBeNull();expect(await other.evaluate('h.walletCalls')).toBe(0);await other.close();
});
test('R5 actual two-tab preflight race: held exit signature excludes delayed loan open and survives reload',async({page,context})=>{
 const other=await context.newPage();await other.addInitScript(value=>sessionStorage.setItem('keyhole:pledge-last:v1:keys.near:k1',JSON.stringify(value)),last);for(const tab of [page,other])await tab.clock.install();
 await page.goto(url+'/?no-history');await other.goto(url);
 for(const tab of [page,other]){await expect(tab.getByTestId('loan-state')).not.toContainText('unavailable');await readPrivate(tab);}
 await page.getByLabel('Named lender',{exact:true}).fill('lender.near');await page.locator('.pledge-live-consent input').check();await expect(page.getByTestId('forfeit-line')).toHaveText(/receives the whole key/);await page.getByTestId('forfeit-ack').check();await page.evaluate('h.deferPrepare=true');await page.getByRole('button',{name:'Pledge this account',exact:true}).click();await expect.poll(()=>page.evaluate('typeof h.resolvePrepare')).toBe('function');
 await other.evaluate('h.deferSign=true');await other.getByRole('button',{name:'Exit to my wallet',exact:true}).click();await expect.poll(()=>other.evaluate('typeof h.resolveSign')).toBe('function');
 await page.evaluate('h.resolvePrepare()');await expect(page.getByRole('button',{name:'Refresh chain',exact:true})).toBeEnabled();expect(await page.evaluate('h.walletCalls')).toBe(0);await expect(page.getByRole('status')).toContainText('original exit');expect(await other.evaluate('h.workerCalls')).toBe(0);
 await other.reload();await expect(other.getByText(/Original exit AwaitingSignature/)).toBeVisible();await expect(other.getByTestId('settlement')).toBeVisible();expect(await other.evaluate('h.workerCalls')).toBe(0);await other.close();
});
test('R5 inverse two-tab race: reserved loan excludes an ordinary exit while wallet routing is held',async({page,context})=>{
 const other=await context.newPage();await other.addInitScript(value=>sessionStorage.setItem('keyhole:pledge-last:v1:keys.near:k1',JSON.stringify(value)),last);for(const tab of [page,other])await tab.clock.install();await page.goto(url+'/?no-history');await other.goto(url);
 for(const tab of [page,other])await readPrivate(tab);
 await page.getByLabel('Named lender',{exact:true}).fill('lender.near');await page.locator('.pledge-live-consent input').check();await expect(page.getByTestId('forfeit-line')).toHaveText(/receives the whole key/);await page.getByTestId('forfeit-ack').check();await page.evaluate('h.deferRoute=true');await page.getByRole('button',{name:'Pledge this account',exact:true}).click();await expect.poll(()=>page.evaluate('typeof h.resolveRoute')).toBe('function');
 await expect(other.getByRole('button',{name:'Exit to my wallet',exact:true})).toBeDisabled();
 const rejected=await other.evaluate(`h.exits.browserExitStore('alice.near','keys.near','k1').reserve({account:'alice.near',token:'k1',epoch:'1',amount:'100000',status:'AwaitingSignature',intent:'exact_near_exit_v1'}).then(()=>false,()=>true)`);expect(rejected).toBe(true);expect(await other.evaluate('h.workerCalls')).toBe(0);
 // The Web Lock is free during routing; only the durable opening record excludes the exit.
 expect(await other.evaluate(`navigator.locks.request(h.intents.pledgeLifecycleScope('alice.near','keys.near')+':admission',{ifAvailable:true},lock=>!!lock)`)).toBe(true);
 await other.reload();await expect(other.getByText(/Original money operation AwaitingWallet/)).toBeVisible();expect(await other.evaluate("h.exits.browserExitStore('alice.near','keys.near','k1').load()")).toBeNull();expect(await page.evaluate('h.walletCalls')).toBe(0);await other.close();
});
test('R5 shared Web Lock admits only one simultaneous open or exit across real tabs',async({page,context})=>{
 const other=await context.newPage();await page.goto(url+'/?bare');await other.goto(url+'/?bare');
 const result=await Promise.all([page.evaluate(`h.money.dispatchMoneyBatch('alice.near','keys.near',[{method:'open_loan',args:{token_id:'k1'},deposit:'1',gas:'200000000000000'}],h.money.browserMoneyStore('alice.near','keys.near'),async()=>{h.walletCalls++;return {redirect:true};},'42').then(()=>true,()=>false)`),other.evaluate(`h.exits.browserExitStore('alice.near','keys.near','k1').reserve({account:'alice.near',token:'k1',epoch:'1',amount:'100000',status:'AwaitingSignature',intent:'exact_near_exit_v1'}).then(()=>true,()=>false)`)]);expect(result.filter(Boolean)).toHaveLength(1);expect(await page.evaluate('h.walletCalls')).toBe(result[0]?1:0);await other.close();
});
test('R5 unexpected active loan keeps saved exit visible but cannot withdraw',async({page})=>{
 await page.goto(url+'/?bare&no-history');await page.evaluate(`h.exits.browserExitStore('alice.near','keys.near','k1').reserve({account:'alice.near',token:'k1',epoch:'1',amount:'100000',status:'Retryable',intent:'exact_near_exit_v1'})`);
 await page.goto(url+'/?no-history');await page.evaluate(value=>{(window as unknown as {h:{loan:unknown}}).h.loan={...value,state:'Active'};},last);await page.getByRole('button',{name:'Refresh chain',exact:true}).click();await expect(page.getByTestId('loan-state')).toHaveText('Loan active');await expect(page.getByText(/Original exit Retryable/)).toBeVisible();await expect(page.getByTestId('settlement')).toContainText('active loan blocks withdrawal');await expect(page.getByRole('button',{name:'Exit to my wallet',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Discard unsent withdrawal',exact:true})).toBeVisible();expect(await page.evaluate('h.workerCalls')).toBe(0);
 await page.reload();await expect(page.getByText(/Original exit Retryable/)).toBeVisible();expect(await page.evaluate('h.workerCalls')).toBe(0);
});
test('R5 nonterminal reconciliation remains UNKNOWN with original ID across reload and never says reconciled',async({page})=>{
 await page.goto(url);await readPrivate(page);await page.evaluate('h.pendingExit=true;h.pendingReconcile=true');await page.getByRole('button',{name:'Exit to my wallet',exact:true}).click();await expect(page.getByText(/Original exit Pending/)).toBeVisible();await page.getByRole('button',{name:'Check original withdrawal',exact:true}).click();await expect(page.getByRole('status')).toContainText('still pending / UNKNOWN (value-1)');await expect(page.getByRole('status')).not.toContainText('reconciled');await expect(page.getByText(/Original exit UNKNOWN/)).toBeVisible();expect(await page.evaluate('h.workerCalls')).toBe(1);
 await page.reload();await expect(page.getByText(/Original exit UNKNOWN/)).toBeVisible();expect(await page.evaluate("h.exits.browserExitStore('alice.near','keys.near','k1').load().value_op_id")).toBe('value-1');expect(await page.evaluate('h.workerCalls')).toBe(0);await expect(page.getByRole('button',{name:'Check original withdrawal',exact:true})).toBeEnabled();
});
test('R5 wallet-boundary recheck refuses a legacy exit appearing during asynchronous routing',async({page,context})=>{
 const other=await context.newPage();await page.clock.install();await page.goto(url+'/?no-history');await other.goto(url+'/?bare');await readPrivate(page);await page.getByLabel('Named lender',{exact:true}).fill('lender.near');await page.locator('.pledge-live-consent input').check();await expect(page.getByTestId('forfeit-line')).toHaveText(/receives the whole key/);await page.getByTestId('forfeit-ack').check();await page.evaluate('h.deferRoute=true');await page.getByRole('button',{name:'Pledge this account',exact:true}).click();await expect.poll(()=>page.evaluate('typeof h.resolveRoute')).toBe('function');
 // Simulates pre-upgrade persisted state, not a cooperating new-version reservation.
 await other.evaluate(`localStorage.setItem('keyhole:pledge-exit:v1:keys.near:alice.near:k1',JSON.stringify({account:'alice.near',token:'k1',epoch:'1',amount:'100000',status:'Retryable',intent:'exact_near_exit_v1'}))`);await page.evaluate('h.resolveRoute()');await expect(page.getByRole('status')).toContainText('original exit');expect(await page.evaluate('h.walletCalls')).toBe(0);expect(await page.evaluate('h.workerCalls')).toBe(0);await expect(page.getByText(/Original exit Retryable/)).toBeVisible();await other.close();
});

test('exit confirm shows the route preview numbers, and cancelling signs no withdrawal',async({page})=>{
 dialogMode='dismiss';
 await page.clock.install();await page.goto(url);await expect(page.getByTestId('settlement')).toContainText('Repaid');await readPrivate(page);
 await page.getByLabel('Ordinary USDC self-exit').fill('0.10');await page.getByRole('button',{name:'Exit to my wallet'}).click();
 await expect.poll(()=>dialogs.length).toBe(1);
 expect(dialogs[0]).toContain('target output 100000');expect(dialogs[0]).toContain('minimum 100000');expect(dialogs[0]).toContain('Unshield');
 await expect(page.getByText(/Withdrawal cancelled before signing/)).toBeVisible();
 expect(await page.evaluate('h.dryRunCalls')).toBe(1);expect(await page.evaluate('h.workerCalls')).toBe(0);expect(await page.evaluate('h.sent.length')).toBe(0);
});

test('an unbound route preview is not a withdrawal, and the next Exit previews again',async({page})=>{
 await page.goto(url);await expect(page.getByTestId('settlement')).toContainText('Repaid');await readPrivate(page);
 await page.evaluate(`h.setPending({account_id:'alice.near',public_key:'ed25519:x',signature:'s',nonce:'n',recipient:'keyhole',message:JSON.stringify({op:'withdraw_dry_run',account_id:'alice.near',params:{}})})`);
 await expect(page.getByText(/does not match the saved exit/)).toBeVisible();
 expect(await page.evaluate('h.authConsumed')).toBe(1);expect(await page.evaluate('h.workerCalls')).toBe(0);expect(await page.evaluate('h.dryRunCalls || 0')).toBe(0);
 await page.getByLabel('Ordinary USDC self-exit').fill('0.10');await page.getByRole('button',{name:'Exit to my wallet'}).click();
 await expect.poll(()=>page.evaluate('h.workerCalls')).toBe(1);
 expect(await page.evaluate('h.dryRunCalls')).toBe(1);expect(await page.evaluate('h.sent[0].amount')).toBe('100000');
});

test('a redirect return of the matching dry-run signature continues that exit once',async({page})=>{
 await page.goto(url);await expect(page.getByTestId('settlement')).toContainText('Repaid');await readPrivate(page);
 const token='nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
 await page.evaluate(`(async()=>{const rec=await h.exits.browserExitStore('alice.near','keys.near','k1').reserve({account:'alice.near',token:'k1',epoch:'1',amount:'100000',status:'AwaitingSignature',intent:'exact_near_exit_v1'});h.setPending({account_id:'alice.near',public_key:'ed25519:x',signature:'redirect-preview',nonce:'n1',recipient:'keyhole',message:JSON.stringify({op:'withdraw_dry_run',account_id:'alice.near',params:{intent_id:rec.id,token_id:'k1',owner_epoch:'1',amount:'100000',to:'alice.near',chain:'near',token:'${token}',exit_mode:'exact-near-v1',min_amount_out:'100000',deadline_ms:Date.now()+300000}})});})()`);
 await expect.poll(()=>page.evaluate('h.dryRunCalls||0')).toBe(1);
 await expect.poll(()=>page.evaluate('h.workerCalls')).toBe(1);
 expect(await page.evaluate('h.sent.length')).toBe(1);
 expect(dialogs.some(d=>d.includes('target output 100000')&&d.includes('minimum 100000'))).toBe(true);
});

test('the Pledge button stays disabled until the forfeiture checkbox is ticked, and the screen comes first',async({page})=>{
 await page.goto(url+'/?no-history');await readPrivate(page);
 await page.getByLabel('Named lender',{exact:true}).fill('lender.near');await page.locator('.pledge-live-consent input').check();
 const pledge=page.getByRole('button',{name:'Pledge this account',exact:true});
 await expect(page.getByTestId('forfeit-line')).toHaveText(/receives the whole key and everything in its vault/);
 await expect(page.getByTestId('borrower-numbers')).toContainText('Total cost');
 await expect(pledge).toBeDisabled();
 await page.getByTestId('forfeit-ack').check();
 await expect(pledge).toBeEnabled();
});

// Legacy advisory preview is still denied by the same production guard.
test('legacy advisory preview cannot authorize the new exact exit',async({page})=>{
 await page.goto(url);await expect(page.getByTestId('settlement')).toContainText('Repaid');await readPrivate(page);
 await page.evaluate('h.exactExitPreviewFixture=false');
 await page.getByRole('button',{name:'Exit to my wallet',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('advisory only');
 expect(await page.evaluate('h.dryRunCalls')).toBe(1);
 expect(await page.evaluate('h.withdrawSignCalls')).toBe(0);
 expect(await page.evaluate('h.workerCalls')).toBe(0);expect(dialogs).toHaveLength(0);
});
