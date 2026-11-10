import {describe,it,expect,vi} from "vitest";
import {webcrypto} from "node:crypto";
import vector from "../../protocol/loan-certificate-v3-delivery.json";
import {certificateBytes,verifyLoanCertificate} from "@/lib/loanCertificate";
import type {PledgeConfig,LoanCertificate} from "@/lib/pledgeClient";
vi.stubGlobal("crypto",webcrypto);
const certificate=vector.certificate as LoanCertificate;
const config:PledgeConfig={network:"sandbox",attestor_public_key:vector.public_key,recovery_account:"recovery.near",recovery_unlock_ns:"0",custody_contract:"custody.near",lending_enabled:true,next_loan_nonce:"1",next_payout_nonce:"0",treasury_available:"0",user_liabilities:"0",treasury_pending:null};
const now=certificate.observed_at_ns;
describe("canonical sealed-loan certificate",()=>{
 it("matches the Rust contract/worker Borsh vector byte-for-byte and verifies actual Ed25519",async()=>{expect(Buffer.from(certificateBytes(certificate)).toString("hex")).toBe(vector.borsh_hex);expect(await verifyLoanCertificate(vector,certificate,config,now)).toBe(true);});
 it.each(["domain","network","contract","token_id","borrower","wallet_pubkey","policy_hash","loan_nonce","owner_epoch","policy_version","pending_value_ops"])("rejects changed %s",async(field)=>{const c={...certificate,[field]:"wrong"};expect(await verifyLoanCertificate({...vector,certificate:c},certificate,config,now)).toBe(false);});
 it.each(["lender","principal","repayment","duration_sec","grace_sec","floor_raw","funding_deadline_ns"])("rejects changed immutable term %s",async field=>{const c={...certificate,terms:{...certificate.terms,[field]:"1"}};expect(await verifyLoanCertificate({...vector,certificate:c},certificate,config,now)).toBe(false);});
 it("rejects expired, future, excessive validity and different pinned signing key",async()=>{expect(await verifyLoanCertificate(vector,certificate,config,certificate.expires_at_ns)).toBe(false);expect(await verifyLoanCertificate(vector,certificate,config,(BigInt(now)-1n).toString())).toBe(false);const bad={...certificate,expires_at_ns:(BigInt(now)+60_000_000_001n).toString()};expect(await verifyLoanCertificate({...vector,certificate:bad},bad,config,now)).toBe(false);expect(await verifyLoanCertificate(vector,certificate,{...config,attestor_public_key:btoa("x".repeat(32))},now)).toBe(false);});
 it("rejects unsigned templates, false predicates, malformed signatures and integer overflows",async()=>{expect(await verifyLoanCertificate({...vector,signature:""},certificate,config,now)).toBe(false);expect(await verifyLoanCertificate({...vector,signature:btoa("x".repeat(64))},certificate,config,now)).toBe(false);for(const c of [{...certificate,floor_met:false},{...certificate,frozen:false},{...certificate,loan_nonce:(1n<<64n).toString()},{...certificate,terms:{...certificate.terms,principal:(1n<<128n).toString()}}])expect(await verifyLoanCertificate({...vector,certificate:c},c,config,now)).toBe(false);});
});
