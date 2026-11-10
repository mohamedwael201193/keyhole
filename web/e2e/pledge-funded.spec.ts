import {test,expect,type Page,type Request} from "@playwright/test";
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import type {KeysCall} from "../lib/keysTx";
import type {CertificateEnvelope} from "../lib/loanCertificate";
import {assertFundedWalletLedger,type WalletSubmission,type FinalWalletReceipt,type WalletRole} from "./support/pledge-ledger";
const shots=process.env.PLEDGE_SHOTS||join(process.cwd(),"test-results","pledge-final");
/** No page.route/RPC mocks. Native calls and receipts come from the real sandbox node.
 * Custody service/registry/WASI host are explicitly labelled mocks in the fixture UI and evidence. */
test("funded Pledge: real UI repay AND default endings with both holders and viewport evidence",async({browser,request},info)=>{
 test.skip(process.env.PLEDGE_SANDBOX_E2E!=="1"||info.project.name!=="desktop","isolated sandbox only; one serial ledger, both widths captured here");
 test.setTimeout(360000);mkdirSync(shots,{recursive:true});
 const bctx=await browser.newContext({baseURL:process.env.BASE_URL}),lctx=await browser.newContext({baseURL:process.env.BASE_URL});
 const borrower=await bctx.newPage(),lender=await lctx.newPage();
 const evidence:{network:string;provider:string;states:unknown[];native_receipts:unknown[];negatives:unknown[]}={network:"local NEAR sandbox",provider:"custody HTTP, registry and WASI host mocked; native contract/wallet/receipts and guarded production pure drivers real",states:[],native_receipts:[],negatives:[]};
 const fixture=async(action:string,params:Record<string,unknown>={})=>{const r=await request.post("/api/pledge-sandbox",{data:{action,...params}});expect(r.ok()).toBeTruthy();const j=await r.json();expect(j.error).toBeFalsy();return j;};
 const meta=await fixture("metadata");
 async function rpc(method:string,params:unknown){const r=await request.post(meta.rpc,{data:{jsonrpc:"2.0",id:"acceptance",method,params}});const j=await r.json();expect(j.error).toBeFalsy();return j.result;}
 async function view(method:string,args:unknown={}){const r=await rpc("query",{request_type:"call_function",finality:"final",account_id:meta.contract,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString("base64")});return JSON.parse(Buffer.from(r.result).toString());}
 const loan=()=>view("get_loan",{token_id:"k1"});
 const balance=async(account:string)=>BigInt((await rpc("query",{request_type:"view_account",finality:"final",account_id:account})).amount);
 const submissions:WalletSubmission[]=[],observed:{role:WalletRole;request:Request}[]=[];
 const privateLenderRequests:string[]=[];
 lender.on("request",r=>{if(r.url().includes("/api/worker")&&r.postData()?.includes('"pledge_inventory"'))privateLenderRequests.push(r.postData()!);});
 // Collect requests synchronously; EVERY response body is awaited below, never swallowed in an async listener.
 for(const [role,page] of [["borrower",borrower],["lender",lender]] as const){page.on("request",r=>{if(r.url().includes("/api/pledge-sandbox")&&r.postDataJSON()?.action==="tx")observed.push({role,request:r});});await page.goto(role==="borrower"?"/pledge?token=k1":"/pledge/lend/k1");await page.getByRole("button",{name:`Use ${role} wallet`,exact:true}).click();}
 const action=(method:string,args:Record<string,unknown>={},deposit="0",gas="200000000000000"):KeysCall=>({method,args,deposit,gas});
 async function submit(p:Page,want:KeysCall|((actual:KeysCall)=>Promise<KeysCall>),click:()=>Promise<unknown>,registration=true){
  const role=p===borrower?"borrower":"lender",account=role==="borrower"?meta.borrower:meta.lender;
  const registered=await view("payout_account_registered",{account_id:account});
  const fee=registration&&!registered?await view("payout_storage_cost"):null;
  const response=p.waitForResponse(r=>r.url().includes("/api/pledge-sandbox")&&r.request().postDataJSON()?.action==="tx");
  await click();const r=await response;expect(r.ok()).toBeTruthy();const payload=r.request().postDataJSON(),j=await r.json();expect(j.error).toBeFalsy();expect(j.transaction?.hash).toBeTruthy();
  const sent=payload.actions.map((a:{params:{methodName:string;args:Record<string,unknown>;gas:string;deposit:string}})=>action(a.params.methodName,a.params.args,a.params.deposit,a.params.gas));
  const call=typeof want==="function"?await want(sent.at(-1)!):want;
  const calls=fee?[action("register_payout_account",{account_id:account},fee,"20000000000000"),call]:[call];
  expect(payload).toEqual({action:"tx",account_id:account,receiver_id:meta.contract,actions:calls.map(c=>({type:"FunctionCall",params:{methodName:c.method,args:c.args,gas:c.gas,deposit:c.deposit}}))});
  expect(j.status).toHaveProperty("SuccessValue");
  const submission:WalletSubmission={role,hash:j.transaction.hash,account,contract:meta.contract,calls};submissions.push(submission);
  return submission;
 }
 async function refresh(){for(const p of [borrower,lender])await p.getByRole("button",{name:"Refresh chain",exact:true}).click();}
 async function state(expected:string){await refresh();for(const p of [borrower,lender])await expect(p.getByTestId("loan-state")).toHaveText(expected,{timeout:30000});}
 async function capture(label:string){await refresh();for(const [role,page] of [["borrower",borrower],["lender",lender]] as const){for(const [width,height] of [[1440,900],[390,844]]){await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready);const bounds=await page.evaluate(()=>{const r=document.scrollingElement!;return {width:r.clientWidth,height:r.clientHeight,scrollWidth:r.scrollWidth,scrollHeight:r.scrollHeight};});await page.screenshot({path:join(shots,`${label}_${role}_${width===1440?"1440x900":"390"}.png`),fullPage:false});if(width===390){await page.getByRole("tab",{name:"Account & inventory",exact:true}).click();await page.screenshot({path:join(shots,`${label}_${role}_390_inventory.png`),fullPage:false});const panelBounds=await page.evaluate(()=>({width:document.scrollingElement!.clientWidth,scrollWidth:document.scrollingElement!.scrollWidth,height:document.scrollingElement!.clientHeight,scrollHeight:document.scrollingElement!.scrollHeight}));expect(panelBounds.scrollWidth,`${label}/${role}: inventory horizontal overflow`).toBeLessThanOrEqual(panelBounds.width+1);const type=await page.evaluate(()=>{const root=document.querySelector(".pledge-live");if(!root)return null;const size=(el:Element)=>parseFloat(getComputedStyle(el).fontSize);const texts=[...root.querySelectorAll("p,small,dt,dd,span,label,li,button,summary,h1,h2")].map(size).filter(n=>n>0);const controls=[...root.querySelectorAll("button,input:not([type=checkbox]),summary")].map(el=>el.getBoundingClientRect().height).filter(n=>n>0);return {body:size(root),minText:Math.min(...texts),minControl:controls.length?Math.min(...controls):0};});expect(type?.body,`${label}/${role}: body text`).toBeGreaterThanOrEqual(12);expect(type?.minText,`${label}/${role}: secondary text`).toBeGreaterThanOrEqual(11);expect(type?.minControl,`${label}/${role}: touch target`).toBeGreaterThanOrEqual(40);await page.getByRole("tab",{name:"Loan action",exact:true}).click();}expect(bounds.scrollWidth,`${label}/${role}: horizontal overflow`).toBeLessThanOrEqual(bounds.width+1);if(width===1440)expect(bounds.scrollHeight,`${label}/${role}: vertical overflow`).toBeLessThanOrEqual(bounds.height+8);evidence.states.push({label,role,viewport:{width,height},bounds});}await page.setViewportSize({width:1440,height:900});}writeFileSync(join(shots,"evidence.json"),JSON.stringify(evidence,null,2));}
 async function readInventory(p:Page){const account=p.getByRole("tab",{name:"Account & inventory",exact:true});if(await account.isVisible())await account.click();await p.getByRole("button",{name:/^(Read private at-risk inventory|Refresh private inventory)$/}).click();await expect(p.getByTestId("inventory-summary")).toContainText("2 assets · 0 pending obligations",{timeout:20000});const action=p.getByRole("tab",{name:"Loan action",exact:true});if(await action.isVisible())await action.click();}
 async function claim(p:Page,label="Claim your funds"){
  const button=p.getByRole("button",{name:label,exact:true}),account=p===borrower?meta.borrower:meta.lender;
  await expect(button).toBeEnabled({timeout:20000});const receipt=await submit(p,action("claim_payout",{},"1"),()=>button.click());
  // Credit is removed before the asynchronous native transfer/refund settles. Zero alone is NOT delivery.
  await expect.poll(()=>view("get_payout_credit",{account_id:account})).toBe("0");
  await expect.poll(()=>view("get_pending_payout",{account_id:account})).toBeNull();
  const final=await rpc("tx",{tx_hash:receipt.hash,sender_account_id:account,wait_until:"FINAL"});
  expect(final.final_execution_status).toBe("FINAL");expect(final.transaction.signer_id).toBe(account);expect(final.transaction.receiver_id).toBe(meta.contract);expect(final.status).toHaveProperty("SuccessValue");
 }
 const finalNs=async()=>BigInt((await rpc("block",{finality:"final"})).header.timestamp_nanosec);
 /** Sandbox blocks are not fixed-duration seconds: advance until the FINAL clock passes a real chain-time bound. */
 async function advancePast(ns:bigint){for(let i=0;i<10&&await finalNs()<=ns;i++)await fixture("advance",{blocks:1000});expect(await finalNs()).toBeGreaterThan(ns);}
 async function begin(label:string){
  await readInventory(borrower);await borrower.getByLabel("Named lender",{exact:true}).fill(meta.lender);await borrower.getByLabel("Term seconds",{exact:true}).fill("120");await borrower.getByLabel("Grace seconds",{exact:true}).fill("30");await borrower.getByRole("checkbox").check();
  const open=borrower.getByRole("button",{name:"Pledge this account",exact:true});await expect(open).toBeEnabled({timeout:20000});const before=await finalNs();await submit(borrower,async sent=>{
   const deadline=(sent.args as {terms:{funding_deadline_ns:string}}).terms.funding_deadline_ns;
   expect(BigInt(deadline)).toBeGreaterThanOrEqual(before+600_000_000_000n);expect(BigInt(deadline)).toBeLessThanOrEqual(await finalNs()+600_000_000_000n);
   return action("open_loan",{token_id:"k1",terms:{lender:meta.lender,principal:"10000000000000000000000",repayment:"10100000000000000000000",duration_sec:"120",grace_sec:"30",floor_raw:"500000",funding_deadline_ns:deadline}},(await view("get_loan_limits")).storage_bond);
  },()=>open.click());await state("Offer open");await capture(`${label}_offered_declared`);
  expect(privateLenderRequests).toEqual([]);const certificateResponse=lender.waitForResponse(r=>r.url().includes("/api/worker")&&r.request().postDataJSON()?.op==="loan_certificate");await lender.getByRole("button",{name:"Verify sealed certificate",exact:true}).click();const cert=(await (await certificateResponse).json()).output as CertificateEnvelope;await expect(lender.getByText("Verified minimum · sealed signature verified",{exact:true})).toBeVisible({timeout:20000});await lender.getByRole("checkbox").check();await capture(`${label}_certificate_verified`);
  const fund=lender.getByRole("button",{name:"Fund 0.01 NEAR",exact:true});await expect(fund).toBeEnabled();const offered=await loan();await submit(lender,action("fund_loan",{token_id:"k1",nonce:offered.nonce,certificate:cert.certificate,signature:cert.signature},offered.terms.principal),()=>fund.click());await state("Funds ready to claim");expect((await loan()).due_ns).toBe("0");await capture(`${label}_funded_no_debt`);
  const balanceBefore=await balance(meta.borrower);await claim(borrower,"Claim 0.01 NEAR");await state("Loan active");expect(BigInt((await loan()).due_ns)).toBeGreaterThan(0n);expect(await balance(meta.borrower)-balanceBefore).toBeGreaterThan(5_000_000_000_000_000_000_000n);await capture(`${label}_native_delivered_active`);
 }
 try{
  await state("Ready to pledge");await capture("00_ready");await readInventory(borrower);await capture("01_private_inventory");
  await begin("repay");
  await fixture("policy",{refuse_thaw:true});await submit(borrower,action("repay_loan",{token_id:"k1",nonce:(await loan()).nonce},"10100000000000000000000"),()=>borrower.getByRole("button",{name:"Repay 0.0101 NEAR",exact:true}).click());await state("Unlocking…");await capture("repay_thaw_pending");
  await fixture("policy",{refuse_thaw:false});await submit(borrower,action("retry_loan_policy",{token_id:"k1",nonce:(await loan()).nonce}),()=>borrower.getByRole("button",{name:"Retry account unlock",exact:true}).click(),false);await state("Repaid · unlock confirmed");await capture("repay_thawed_credits");
  const before=await balance(meta.lender);await claim(lender);expect(await balance(meta.lender)-before).toBeGreaterThan(5_000_000_000_000_000_000_000n);await claim(borrower);
  await readInventory(borrower);await borrower.getByRole("button",{name:"Exit to my wallet",exact:true}).click();await expect(borrower.getByRole("status")).toContainText("Ordinary self-exit confirmed",{timeout:20000});await readInventory(borrower);await capture("repay_ending_exit_confirmed");
  await borrower.getByRole("button",{name:"Prepare another loan",exact:true}).click();await begin("default");
  {const l=await loan();await advancePast(BigInt(l.due_ns)+BigInt(l.terms.grace_sec)*1_000_000_000n);}await refresh();await expect(lender.getByRole("button",{name:"Claim entire collateral account",exact:true})).toBeEnabled({timeout:20000});
  await lender.getByLabel("Default receiver",{exact:true}).fill(meta.borrower);await lender.getByRole("button",{name:"Claim entire collateral account",exact:true}).click();await expect(lender.getByRole("status")).toContainText("no key or return reservation");expect((await loan()).state).toBe("Active");evidence.negatives.push({test:"ineligible default receiver",result:"UI blocked, real loan remains Active"});
  await lender.getByLabel("Default receiver",{exact:true}).fill(meta.lender);await fixture("policy",{refuse_thaw:true});await submit(lender,action("claim_default",{token_id:"k1",nonce:(await loan()).nonce,receiver_id:meta.lender},"1"),()=>lender.getByRole("button",{name:"Claim entire collateral account",exact:true}).click());await state("Unlocking…");await capture("default_new_title_thaw_pending");
  const stale=await fixture("sign",{account_id:meta.borrower,op:"pledge_inventory",params:{token_id:"k1"}});const denied=await request.post("/api/worker",{data:{op:"pledge_inventory",auth:stale}});const rejected=await denied.json();expect(rejected.error).toBeTruthy();expect(rejected.output?.assets).toBeFalsy();evidence.negatives.push({test:"old holder signed private inventory",result:"real final ownership check denies; no private output"});
  const staleValue=await fixture("sign",{account_id:meta.borrower,op:"withdraw",params:{token_id:"k1",owner_epoch:"0",token:"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",chain:"near",amount:"100000",to:meta.borrower}});const bad=await request.post("/api/worker",{data:{op:"withdraw",auth:staleValue}});expect((await bad.json()).error).toBeTruthy();evidence.negatives.push({test:"old holder signed value exit",result:"rejected before provider dispatch"});
  await fixture("policy",{refuse_thaw:false});await submit(lender,action("retry_loan_policy",{token_id:"k1",nonce:(await loan()).nonce}),()=>lender.getByRole("button",{name:"Retry account unlock",exact:true}).click(),false);await state("Loan defaulted · unlock confirmed");await readInventory(lender);await expect(lender.getByRole("button",{name:"Exit to my wallet",exact:true})).toBeDisabled();const cooldownSeenNs=await finalNs();await capture("default_cooldown_enforced");
  await advancePast(cooldownSeenNs+600_000_000_000n);await refresh();await readInventory(lender);await expect(lender.getByRole("button",{name:"Exit to my wallet",exact:true})).toBeEnabled({timeout:20000});await lender.getByRole("button",{name:"Exit to my wallet",exact:true}).click();await expect(lender.getByRole("status")).toContainText("Ordinary self-exit confirmed",{timeout:20000});await claim(borrower);await readInventory(lender);await capture("default_ending_exit_confirmed");
  // Drain every observed response deterministically, including unexpected extra submissions.
  const collected=await Promise.all(observed.map(async x=>{const r=await x.request.response();expect(r?.ok()).toBeTruthy();const j=await r!.json();expect(j.error).toBeFalsy();return {role:x.role,hash:j.transaction.hash};}));
  expect(collected).toEqual(submissions.map(({role,hash})=>({role,hash})));
  const nativeReceipts:FinalWalletReceipt[]=await Promise.all(submissions.map(x=>rpc("tx",{tx_hash:x.hash,sender_account_id:x.account,wait_until:"FINAL"})));
  assertFundedWalletLedger(submissions,nativeReceipts);
  evidence.native_receipts=nativeReceipts;expect(evidence.states).toHaveLength(64);expect(evidence.negatives).toHaveLength(3);
  const pngs=readdirSync(shots).filter(x=>x.endsWith(".png"));expect(pngs).toHaveLength(96);
  const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
  const committedFiles=["web/app/pledge/LivePledge.tsx","web/lib/pledgeExit.ts","web/lib/pledgeIntentStore.ts","web/lib/pledgeMoney.ts","web/lib/keysTx.ts","web/e2e/pledge-funded.spec.ts","web/e2e/support/pledge-ledger.ts","contracts/keys-sandbox/tests/support/ui_harness.rs"];
  const git=(...args:string[])=>execFileSync("git",args,{cwd:join(process.cwd(),"..")});
  const sources=committedFiles.map(file=>({file,sha256:sha(git("show",`HEAD:${file}`))}));
  // Canonical committed blobs, never re-encoded git-show text or OS-local CRLF bytes.
  git("diff","--exit-code","HEAD","--",...committedFiles);
  writeFileSync(join(shots,"native-receipts.json"),JSON.stringify(nativeReceipts,null,2));
  writeFileSync(join(shots,"evidence.json"),JSON.stringify({...evidence,submissions,completed:true},null,2));
  writeFileSync(join(shots,"manifest.json"),JSON.stringify({commit:git("rev-parse","HEAD").toString().trim(),source_fingerprints:sources,counts:{browser_wallet_submissions:submissions.length,unique_final_native_receipts:new Set(nativeReceipts.map(r=>r.transaction.hash)).size,state_viewport_checks:evidence.states.length,negative_cases:evidence.negatives.length,screenshots:pngs.length},receipt_scope:"13 browser-wallet submissions only; provider admission/finish and fixture setup transactions are separate",provider:evidence.provider,evidence_sha256:sha(readFileSync(join(shots,"evidence.json"))),native_receipts_sha256:sha(readFileSync(join(shots,"native-receipts.json"))),screenshots:pngs.map(file=>({file,sha256:sha(readFileSync(join(shots,file)))}))},null,2));
 }finally{await bctx.close();await lctx.close();}
});
