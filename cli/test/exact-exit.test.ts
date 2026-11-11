import {test} from "node:test";
import assert from "node:assert/strict";
import {exactWithdrawParams, USDC} from "../src/core.js";
test("exact exit serializes only the signed canonical NEAR USDC flow",()=>assert.deepEqual(exactWithdrawParams("alice.near","100",1000),{chain:"near",to:"alice.near",token:USDC,amount:"100",exit_mode:"exact-near-v1",min_amount_out:"100",deadline_ms:301000}));
test("exact exit refuses zero negative fractional and overflowing amount",()=>{for(const a of ["0","01","-1","1.0","340282366920938463463374607431768211456"])assert.throws(()=>exactWithdrawParams("alice.near",a));});
