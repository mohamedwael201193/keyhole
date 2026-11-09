import {test} from "node:test";
import assert from "node:assert/strict";
import {plan} from "./plan.mjs";
test("offline batch uses distinct new team identities and exact tiny amounts",()=>{const p=plan();assert.notEqual(p.borrower,p.lender);for(const run of [p.runA,p.runB])for(const a of run)if(a.method){assert.equal(a.submit,false);assert(BigInt(a.deposit_yocto)<=10n**23n);}assert.equal(p.runA.find(x=>x.method==="repay_loan").deposit_yocto,"10100000000000000000000");});
test("ordinary two-hour terms, grace, fresh certificate and UNKNOWN stop are explicit",()=>{const p=plan();const o=p.runB.find(x=>x.method==="open_loan");assert.equal(o.args.terms.duration_sec,"7200");assert.equal(o.args.terms.grace_sec,"900");assert.equal(o.deposit_yocto,"9000000000000000000000");assert(JSON.stringify(p).includes("UNKNOWN stops"));});
test("new accounts cannot exceed native account identifier limit",()=>assert.throws(()=>plan({sponsor:"a".repeat(64)})));
