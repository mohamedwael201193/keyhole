import {test,expect,type Page,type Request} from "@playwright/test";
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import type {KeysCall} from "../lib/keysTx";
import type {CertificateEnvelope} from "../lib/loanCertificate";
import {readFinalReceipt} from "./support/final-receipt";
import {assertFundedWalletLedger,type WalletSubmission,type FinalWalletReceipt,type WalletRole} from "./support/pledge-ledger";
const shots=process.env.PLEDGE_SHOTS||join(process.cwd(),"test-results","pledge-final");
/** No page.route/RPC mocks. Native calls and receipts come from the real sandbox node.
 * Custody service/registry/WASI host are explicitly labelled mocks in the fixture UI and evidence. */
test("funded Pledge: real UI repay AND default endings with both holders and viewport evidence",async({browser,request},info)=>{
 test.skip(process.env.PLEDGE_SANDBOX_E2E!=="1"||info.project.name!=="desktop","isolated sandbox only; one serial ledger, both widths captured here");
 // Two serial lifecycle endings, 13 FINAL submissions and 96 viewport captures.
 // Keep each operation bounded; the whole evidence run needs headroom on shared CI CPUs.
 test.setTimeout(720000);mkdirSync(shots,{recursive:true});
 const started=Date.now();const progress=(stage:string)=>console.log(`[funded +${Date.now()-started}ms] ${stage}`);
 const bctx=await browser.newContext({baseURL:process.env.BASE_URL}),lctx=await browser.newContext({baseURL:process.env.BASE_URL});
 for(const context of [bctx,lctx]){context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(45000);}
 const borrower=await bctx.newPage(),lender=await lctx.newPage();
 // Refused previews must never reach a withdrawal confirm/sign step. Capture any unexpected dialog.
 const confirms:string[]=[];for(const p of [borrower,lender])p.on("dialog",d=>{confirms.push(d.message());void d.accept();});;
 const evidence:{network:string;provider:string;states:unknown[];native_receipts:unknown[];negatives:unknown[]}={network:"local NEAR sandbox",provider:"custody HTTP, registry and WASI host mocked; native contract/wallet/receipts and guarded production pure drivers real",states:[],native_receipts:[],negatives:[]};
 const fixture=async(action:string,params:Record<string,unknown>={})=>{const r=await request.post("/api/pledge-sandbox",{data:{action,...params}});expect(r.ok()).toBeTruthy();const j=await r.json();expect(j.error).toBeFalsy();return j;};
 const meta=await fixture("metadata");
 async function rpc(method:string,params:unknown){const r=await request.post(meta.rpc,{data:{jsonrpc:"2.0",id:"acceptance",method,params}});const j=await r.json();expect(j.error).toBeFalsy();return j.result;}
 async function view(method:string,args:unknown={}){const r=await rpc("query",{request_type:"call_function",finality:"final",account_id:meta.contract,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString("base64")});return JSON.parse(Buffer.from(r.result).toString());}
 const loan=()=>view("get_loan",{token_id:meta.token_id});
 const balance=async(account:string)=>BigInt((await rpc("query",{request_type:"view_account",finality:"final",account_id:account})).amount);
 const nativeReceipts:FinalWalletReceipt[]=[];
 const submissions:WalletSubmission[]=[],observed:{role:WalletRole;request:Request}[]=[];
 const privateLenderRequests:string[]=[],withdrawalSigns:string[]=[],withdrawalPosts:string[]=[];
 for(const p of [borrower,lender])p.on("request",r=>{if(r.url().includes("/api/pledge-sandbox")&&r.postDataJSON()?.action==="sign"&&r.postDataJSON()?.op==="withdraw")withdrawalSigns.push(r.postData()!);if(r.url().includes("/api/worker")&&r.postDataJSON()?.op==="withdraw")withdrawalPosts.push(r.postData()!);});
 lender.on("request",r=>{if(r.url().includes("/api/worker")&&r.postData()?.includes('"pledge_inventory"'))privateLenderRequests.push(r.postData()!);});
 // Collect requests synchronously; EVERY response body is awaited below, never swallowed in an async listener.
 for(const [role,page] of [["borrower",borrower],["lender",lender]] as const){page.on("request",r=>{if(r.url().includes("/api/pledge-sandbox")&&r.postDataJSON()?.action==="tx")observed.push({role,request:r});});await page.goto(role==="borrower"?`/pledge?token=${meta.token_id}`:`/pledge/lend/${meta.token_id}`);await page.getByRole("button",{name:`Use ${role} wallet`,exact:true}).click();}
 const action=(method:string,args:Record<string,unknown>={},deposit="0",gas="200000000000000"):KeysCall=>({method,args,deposit,gas});
 async function submit(p:Page,want:KeysCall|((actual:KeysCall)=>Promise<KeysCall>),click:()=>Promise<unknown>,registration=true){
  const role=p===borrower?"borrower":"lender",account=role==="borrower"?meta.borrower:meta.lender;
  const registered=await view("payout_account_registered",{account_id:account});
  const fee=registration&&!registered?await view("payout_storage_cost"):null;
  progress(`${role}: awaiting explicit wallet submission`);
  const response=p.waitForResponse(r=>r.url().includes("/api/pledge-sandbox")&&r.request().postDataJSON()?.action==="tx",{timeout:45000});
  const [,r]=await Promise.all([click(),response]);expect(r.ok()).toBeTruthy();const payload=r.request().postDataJSON(),j=await r.json();expect(j.error).toBeFalsy();expect(j.transaction?.hash).toBeTruthy();
  const sent=payload.actions.map((a:{params:{methodName:string;args:Record<string,unknown>;gas:string;deposit:string}})=>action(a.params.methodName,a.params.args,a.params.deposit,a.params.gas));
  const call=typeof want==="function"?await want(sent.at(-1)!):want;
  const calls=fee?[action("register_payout_account",{account_id:account},fee,"20000000000000"),call]:[call];
  expect(payload).toEqual({action:"tx",account_id:account,receiver_id:meta.contract,actions:calls.map(c=>({type:"FunctionCall",params:{methodName:c.method,args:c.args,gas:c.gas,deposit:c.deposit}}))});
  expect(j.status).toHaveProperty("SuccessValue");
  const submission:WalletSubmission={role,hash:j.transaction.hash,account,contract:meta.contract,calls};submissions.push(submission);
  // Capture genuine FINAL evidence before later sandbox clock advances can retire
  // node history. Every read still binds this ORIGINAL submission, never a new tx.
  nativeReceipts.push(await readFinalReceipt(async()=>{
   const response=await request.post(meta.rpc,{data:{jsonrpc:"2.0",id:"final-ledger",method:"tx",params:{tx_hash:submission.hash,sender_account_id:submission.account,wait_until:"FINAL"}}});
   const reply=await response.json();
   if(!response.ok())expect(reply.error?.cause?.name).toBe("TIMEOUT_ERROR");
   return reply;
  }));
  progress(`${role}: FINAL ${submission.hash}`);
  return submission;
 }
 async function refresh(){for(const p of [borrower,lender])await p.getByRole("button",{name:"Refresh chain",exact:true}).click();}
 async function state(expected:string){await refresh();for(const p of [borrower,lender])await expect(p.getByTestId("loan-state")).toHaveText(expected,{timeout:30000});}
 async function capture(label:string){progress(`capture ${label}`);await refresh();for(const [role,page] of [["borrower",borrower],["lender",lender]] as const){for(const [width,height] of [[1440,900],[390,844]]){await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready);const shell=await page.evaluate(()=>{const declared=getComputedStyle(document.documentElement).getPropertyValue("--font-inter");const family=declared.split(",")[0].trim().replace(/^['"]|['"]$/g,"");const used=getComputedStyle(document.querySelector(".app")!).fontFamily;const loaded=[...document.fonts].some(face=>face.status==="loaded"&&face.family.replace(/['"]/g,"")===family);const aside=getComputedStyle(document.querySelector("aside.app-side")!).display;const tabs=getComputedStyle(document.querySelector(".app-tabs")!).display;return {family,used,loaded,aside,tabs};});expect(shell.family.toLowerCase(),`${label}/${role}: UI font`).toContain("inter");expect(shell.used,`${label}/${role}: app font`).toContain(shell.family);expect(shell.loaded,`${label}/${role}: loaded UI face`).toBe(true);if(width===1440){await expect(page.locator("aside.app-side")).toBeVisible();expect(shell.aside).not.toBe("none");}else{await expect(page.locator(".app-tabs")).toBeVisible();expect(shell.tabs).not.toBe("none");}const bounds=await page.evaluate(()=>{const r=document.scrollingElement!;return {width:r.clientWidth,height:r.clientHeight,scrollWidth:r.scrollWidth,scrollHeight:r.scrollHeight};});await page.screenshot({path:join(shots,`${label}_${role}_${width===1440?"1440x900":"390"}.png`),fullPage:false,animations:"disabled",timeout:20000});if(width===390){await page.getByRole("tab",{name:"Account & inventory",exact:true}).click();await page.screenshot({path:join(shots,`${label}_${role}_390_inventory.png`),fullPage:false,animations:"disabled",timeout:20000});const panelBounds=await page.evaluate(()=>({width:document.scrollingElement!.clientWidth,scrollWidth:document.scrollingElement!.scrollWidth,height:document.scrollingElement!.clientHeight,scrollHeight:document.scrollingElement!.scrollHeight}));expect(panelBounds.scrollWidth,`${label}/${role}: inventory horizontal overflow`).toBeLessThanOrEqual(panelBounds.width+1);const type=await page.evaluate(()=>{const root=document.querySelector(".pledge-live");if(!root)return null;const size=(el:Element)=>parseFloat(getComputedStyle(el).fontSize);const texts=[...root.querySelectorAll("p,small,dt,dd,span,label,li,button,summary,h1,h2")].map(size).filter(n=>n>0);const controls=[...root.querySelectorAll("button,input:not([type=checkbox]),summary")].map(el=>el.getBoundingClientRect().height).filter(n=>n>0);return {body:size(root),minText:Math.min(...texts),minControl:controls.length?Math.min(...controls):0};});expect(type?.body,`${label}/${role}: body text`).toBeGreaterThanOrEqual(14);expect(type?.minText,`${label}/${role}: secondary text`).toBeGreaterThanOrEqual(12);expect(type?.minControl,`${label}/${role}: touch target`).toBeGreaterThanOrEqual(44);await page.getByRole("tab",{name:"Loan action",exact:true}).click();}expect(bounds.scrollWidth,`${label}/${role}: horizontal overflow`).toBeLessThanOrEqual(bounds.width+1);evidence.states.push({label,role,viewport:{width,height},bounds,shell});}await page.setViewportSize({width:1440,height:900});}writeFileSync(join(shots,"evidence.json"),JSON.stringify(evidence,null,2));}
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
 async function refusedExit(p:Page,label:string){
  const before=await fixture("metadata"),control=await view("get_control_state",{token_id:meta.token_id}),native=observed.length,signs=withdrawalSigns.length,posts=withdrawalPosts.length,dialogs=confirms.length;
  await p.getByRole("button",{name:"Exit to my wallet",exact:true}).click();
  await expect(p.getByRole("status")).toContainText("Preview is advisory only: provider execution cannot enforce this minimum.",{timeout:20000});
  await expect(p.getByRole("status")).toContainText("No withdrawal was signed.");
  const after=await fixture("metadata");
  for(const field of ["post_calls","custody_signatures","admissions","private_balance"])expect(after[field],`${label}: zero value side effects`).toBe(before[field]);
  expect(await view("get_control_state",{token_id:meta.token_id})).toEqual(control);
  expect(observed).toHaveLength(native);expect(withdrawalSigns).toHaveLength(signs);expect(withdrawalPosts).toHaveLength(posts);expect(confirms).toHaveLength(dialogs);
  expect(control.pending_value_ops).toBe("0");
  evidence.negatives.push({test:label,result:"advisory refusal; zero custody POST/sign, native admission and withdrawal signature; balance unchanged"});
  // This record is proven unsent, so explicit discard is safe and does not hide UNKNOWN.
  await p.getByRole("button",{name:"Discard unsent withdrawal",exact:true}).click();
  await expect(p.getByRole("status")).toContainText("Unsent exit intent discarded. No withdrawal was sent");
 }
 async function begin(label:string){
  await readInventory(borrower);await borrower.getByLabel("Named lender",{exact:true}).fill(meta.lender);await borrower.getByLabel("Term seconds",{exact:true}).fill("120");await borrower.getByLabel("Grace seconds",{exact:true}).fill("30");await borrower.locator(".pledge-live-consent input").check();await expect(borrower.getByTestId("forfeit-line")).toHaveText(/receives the whole key/);await expect(borrower.getByTestId("borrower-numbers")).toContainText("Total cost");await borrower.getByTestId("forfeit-ack").check();
  const open=borrower.getByRole("button",{name:"Pledge this account",exact:true});await expect(open).toBeEnabled({timeout:20000});const before=await finalNs();await submit(borrower,async sent=>{
   const deadline=(sent.args as {terms:{funding_deadline_ns:string}}).terms.funding_deadline_ns;
   expect(BigInt(deadline)).toBeGreaterThanOrEqual(before+600_000_000_000n);expect(BigInt(deadline)).toBeLessThanOrEqual(await finalNs()+600_000_000_000n);
   return action("open_loan",{token_id:meta.token_id,terms:{lender:meta.lender,principal:"10000000000000000000000",repayment:"10100000000000000000000",duration_sec:"120",grace_sec:"30",floor_raw:"500000",funding_deadline_ns:deadline}},(await view("get_loan_limits")).storage_bond);
  },()=>open.click());await state("Offer open");await capture(`${label}_offered_declared`);
  expect(privateLenderRequests).toEqual([]);const certificateResponse=lender.waitForResponse(r=>r.url().includes("/api/worker")&&r.request().postDataJSON()?.op==="loan_certificate",{timeout:30000});await lender.getByRole("button",{name:"Verify sealed certificate",exact:true}).click();const certResponse=await certificateResponse;const certResult=await certResponse.json();expect(certResponse.ok(),JSON.stringify(certResult.error??null)).toBe(true);expect(certResult.error).toBeFalsy();const cert=certResult.output as CertificateEnvelope;await expect(lender.getByText("Verified minimum · sealed signature verified",{exact:true})).toBeVisible({timeout:20000});await lender.getByRole("checkbox").check();await capture(`${label}_certificate_verified`);
  const fund=lender.getByRole("button",{name:"Fund 0.01 NEAR",exact:true});await expect(fund).toBeEnabled();const offered=await loan();await submit(lender,action("fund_loan",{token_id:meta.token_id,nonce:offered.nonce,certificate:cert.certificate,signature:cert.signature},offered.terms.principal),()=>fund.click());await state("Funds ready to claim");expect((await loan()).due_ns).toBe("0");await capture(`${label}_funded_no_debt`);
  const balanceBefore=await balance(meta.borrower);await claim(borrower,"Claim 0.01 NEAR");await state("Loan active");expect(BigInt((await loan()).due_ns)).toBeGreaterThan(0n);expect(await balance(meta.borrower)-balanceBefore).toBeGreaterThan(5_000_000_000_000_000_000_000n);await capture(`${label}_native_delivered_active`);
 }
 try{
  await state("Ready to pledge");await capture("00_ready");await readInventory(borrower);await capture("01_private_inventory");
  await begin("repay");
  await fixture("policy",{refuse_thaw:true});await submit(borrower,action("repay_loan",{token_id:meta.token_id,nonce:(await loan()).nonce},"10100000000000000000000"),()=>borrower.getByRole("button",{name:"Repay 0.0101 NEAR",exact:true}).click());await state("Unlocking…");await capture("repay_thaw_pending");
  await fixture("policy",{refuse_thaw:false});await submit(borrower,action("retry_loan_policy",{token_id:meta.token_id,nonce:(await loan()).nonce}),()=>borrower.getByRole("button",{name:"Retry account unlock",exact:true}).click(),false);await state("Repaid · unlock confirmed");await capture("repay_thawed_credits");
  const before=await balance(meta.lender);await claim(lender);expect(await balance(meta.lender)-before).toBeGreaterThan(5_000_000_000_000_000_000_000n);await claim(borrower);
  expect(await view("nft_token",{token_id:meta.token_id})).toMatchObject({owner_id:meta.borrower});expect(await loan()).toBeNull();
  const floorAfterA=(await fixture("metadata")).private_balance;expect(BigInt(floorAfterA)).toBeGreaterThanOrEqual(500000n);
  await readInventory(borrower);await refusedExit(borrower,"repaid holder public exit unavailable");expect((await fixture("metadata")).private_balance).toBe(floorAfterA);await readInventory(borrower);await capture("repay_ending_exit_refused");
  await borrower.getByRole("button",{name:"Prepare another loan",exact:true}).click();await begin("default");
  {const l=await loan();await advancePast(BigInt(l.due_ns)+BigInt(l.terms.grace_sec)*1_000_000_000n);}await refresh();await expect(lender.getByRole("button",{name:"Claim entire collateral account",exact:true})).toBeEnabled({timeout:20000});
  await lender.getByLabel("Default receiver",{exact:true}).fill(meta.borrower);await lender.getByRole("button",{name:"Claim entire collateral account",exact:true}).click();await expect(lender.getByRole("status")).toContainText("no key or return reservation");expect((await loan()).state).toBe("Active");evidence.negatives.push({test:"ineligible default receiver",result:"UI blocked, real loan remains Active"});
  await lender.getByLabel("Default receiver",{exact:true}).fill(meta.lender);await fixture("policy",{refuse_thaw:true});await submit(lender,action("claim_default",{token_id:meta.token_id,nonce:(await loan()).nonce,receiver_id:meta.lender},"1"),()=>lender.getByRole("button",{name:"Claim entire collateral account",exact:true}).click());await state("Unlocking…");await capture("default_new_title_thaw_pending");
  const stale=await fixture("sign",{account_id:meta.borrower,op:"pledge_inventory",params:{token_id:meta.token_id}});const denied=await request.post("/api/worker",{data:{op:"pledge_inventory",auth:stale}});const rejected=await denied.json();expect(rejected.error).toBeTruthy();expect(rejected.output?.assets).toBeFalsy();evidence.negatives.push({test:"old holder signed private inventory",result:"real final ownership check denies; no private output"});
  const staleValue=await fixture("sign",{account_id:meta.borrower,op:"withdraw",params:{token_id:meta.token_id,owner_epoch:"0",token:"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",chain:"near",amount:"100000",to:meta.borrower}});const bad=await request.post("/api/worker",{data:{op:"withdraw",auth:staleValue}});expect((await bad.json()).error).toBeTruthy();evidence.negatives.push({test:"old holder signed value exit",result:"rejected before provider dispatch"});
  await fixture("policy",{refuse_thaw:false});await submit(lender,action("retry_loan_policy",{token_id:meta.token_id,nonce:(await loan()).nonce}),()=>lender.getByRole("button",{name:"Retry account unlock",exact:true}).click(),false);await state("Loan defaulted · unlock confirmed");await readInventory(lender);await expect(lender.getByRole("button",{name:"Exit to my wallet",exact:true})).toBeDisabled();const cooldownSeenNs=await finalNs();await capture("default_cooldown_enforced");
  await advancePast(cooldownSeenNs+600_000_000_000n);await refresh();await readInventory(lender);await expect(lender.getByRole("button",{name:"Exit to my wallet",exact:true})).toBeEnabled({timeout:20000});
  await refusedExit(lender,"current lender public exit unavailable after cooldown");await claim(borrower);await readInventory(lender);await capture("default_ending_exit_refused");
  expect(await loan()).toBeNull();expect(await view("nft_token",{token_id:meta.token_id})).toMatchObject({owner_id:meta.lender});
  const finalControl=await view("get_control_state",{token_id:meta.token_id});expect(finalControl.owner_epoch).toBe("1");expect(finalControl.pledged).toBe(false);expect(finalControl.pending_value_ops).toBe("0");
  for(const account_id of [meta.borrower,meta.lender]){expect(await view("get_payout_credit",{account_id})).toBe("0");expect(await view("get_pending_payout",{account_id})).toBeNull();}
  expect((await fixture("metadata")).private_balance).toBe(floorAfterA);expect(withdrawalSigns).toEqual([]);expect(withdrawalPosts).toEqual([]);
  // Drain every observed response deterministically, including unexpected extra submissions.
  const collected=await Promise.all(observed.map(async x=>{const r=await x.request.response();expect(r?.ok()).toBeTruthy();const j=await r!.json();expect(j.error).toBeFalsy();return {role:x.role,hash:j.transaction.hash};}));
  expect(collected).toEqual(submissions.map(({role,hash})=>({role,hash})));
  assertFundedWalletLedger(submissions,nativeReceipts);
  evidence.native_receipts=nativeReceipts;expect(evidence.states).toHaveLength(64);expect(evidence.negatives).toHaveLength(5);
  const pngs=readdirSync(shots).filter(x=>x.endsWith(".png"));expect(pngs).toHaveLength(96);
  const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
  const committedFiles=["web/app/pledge/LivePledge.tsx","web/lib/pledgeExit.ts","web/lib/pledgeIntentStore.ts","web/lib/pledgeMoney.ts","web/lib/keysTx.ts","web/e2e/pledge-funded.spec.ts","web/e2e/support/pledge-ledger.ts","web/e2e/support/final-receipt.ts","contracts/keys-sandbox/tests/pledge.rs","contracts/keys-sandbox/tests/support/ui_harness.rs","contracts/keys-sandbox/tests/support/guarded_layer.rs","tee/worker/src/withdrawal_protection.rs"];
  const git=(...args:string[])=>execFileSync("git",args,{cwd:join(process.cwd(),"..")});
  const sources=committedFiles.map(file=>({file,sha256:sha(git("show",`HEAD:${file}`))}));
  // Canonical committed blobs, never re-encoded git-show text or OS-local CRLF bytes.
  git("diff","--exit-code","HEAD","--",...committedFiles);
  writeFileSync(join(shots,"native-receipts.json"),JSON.stringify(nativeReceipts,null,2));
  writeFileSync(join(shots,"evidence.json"),JSON.stringify({...evidence,submissions,completed:true},null,2));
  writeFileSync(join(shots,"manifest.json"),JSON.stringify({commit:git("rev-parse","HEAD").toString().trim(),source_fingerprints:sources,counts:{browser_wallet_submissions:submissions.length,unique_final_native_receipts:new Set(nativeReceipts.map(r=>r.transaction.hash)).size,state_viewport_checks:evidence.states.length,negative_cases:evidence.negatives.length,screenshots:pngs.length},receipt_scope:"13 browser-wallet submissions only; provider admission/finish and fixture setup transactions are separate",provider:evidence.provider,evidence_sha256:sha(readFileSync(join(shots,"evidence.json"))),native_receipts_sha256:sha(readFileSync(join(shots,"native-receipts.json"))),screenshots:pngs.map(file=>({file,sha256:sha(readFileSync(join(shots,file)))}))},null,2));
 }finally{
  // A test timeout already closes pages; cleanup must never replace the original failure.
  await Promise.all([bctx.close().catch(()=>{}),lctx.close().catch(()=>{})]);
 }
});
