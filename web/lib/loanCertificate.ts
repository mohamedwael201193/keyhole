import type {LoanCertificate,PledgeConfig} from "./pledgeClient";
export const LOAN_CERTIFICATE_DOMAIN="KEYHOLE_SEALED_LOAN_V3_DELIVERY";
/** Canonical Rust Borsh, not JSON signing. No private balances or authority secrets. */
export function certificateBytes(c:LoanCertificate):Uint8Array {
 const out:number[]=[];
 const number=(v:string,width:number)=>{if(typeof v!=="string"||!/^\d+$/.test(v))throw Error("Invalid exact integer");let n=BigInt(v);if(n>=1n<<BigInt(width*8))throw Error("Integer overflow");for(let i=0;i<width;i++){out.push(Number(n&255n));n>>=8n;}};
 const bytes=(v:Uint8Array)=>{number(String(v.length),4);out.push(...v);};
 const text=(v:string)=>{if(typeof v!=="string"||v.length>8192)throw Error("Invalid certificate text");bytes(new TextEncoder().encode(v));};
 for(const x of [c.domain,c.network,c.contract,c.token_id])text(x);
 number(c.loan_nonce,8);text(c.borrower);number(c.owner_epoch,8);text(c.terms.lender);
 number(c.terms.principal,16);number(c.terms.repayment,16);number(c.terms.duration_sec,8);number(c.terms.grace_sec,8);number(c.terms.floor_raw,16);number(c.terms.funding_deadline_ns,8);
 text(c.asset);text(c.wallet_pubkey);number(c.policy_version,8);
 const hash=decode64(c.policy_hash);if(hash.length!==32)throw Error("Invalid policy digest");bytes(hash);
 number(c.observed_at_ns,8);number(c.expires_at_ns,8);
 for(const x of [c.floor_met,c.frozen]){if(typeof x!=="boolean")throw Error("Invalid certificate boolean");out.push(x?1:0);}
 number(c.pending_value_ops,8);return new Uint8Array(out);
}
function decode64(v:string):Uint8Array {
 if(typeof v!=="string"||!v.length||v.length>128||v.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(v))throw Error("Invalid base64");
 const binary=atob(v);if(btoa(binary)!==v)throw Error("Noncanonical base64");return Uint8Array.from(binary,x=>x.charCodeAt(0));
}
export type CertificateEnvelope={certificate:LoanCertificate;signature:string};
/** expected and config MUST be obtained independently from the selected final-chain contract. */
export async function verifyLoanCertificate(bundle:CertificateEnvelope,expected:LoanCertificate,config:PledgeConfig,nowNs:string):Promise<boolean> {
 try {
  const c=bundle.certificate,now=BigInt(nowNs),observed=BigInt(c.observed_at_ns),expires=BigInt(c.expires_at_ns);
  if(c.domain!==LOAN_CERTIFICATE_DOMAIN||c.network!==config.network||c.contract!==expected.contract||!c.floor_met||!c.frozen||c.pending_value_ops!=="0"||observed>now||expires<=now||expires>observed+60_000_000_000n)return false;
  const message=certificateBytes(c),binding=certificateBytes(expected);
  if(message.length!==binding.length||message.some((x,i)=>x!==binding[i]))return false;
  const pk=decode64(config.attestor_public_key),signature=decode64(bundle.signature);if(pk.length!==32||signature.length!==64)return false;
  const key=await crypto.subtle.importKey("raw",new Uint8Array(pk).buffer,{name:"Ed25519"},false,["verify"]);
  return await crypto.subtle.verify({name:"Ed25519"},key,new Uint8Array(signature).buffer,new Uint8Array(message).buffer);
 }catch{return false;}
}
/** Public exact-loan endpoint: caller cannot choose another floor, asset or certificate template. */
export async function requestLoanCertificate(token_id:string,loan_nonce:string,signal?:AbortSignal):Promise<CertificateEnvelope> {
 const response=await fetch("/api/worker",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({op:"loan_certificate",params:{token_id,loan_nonce}}),cache:"no-store",signal});
 const result=await response.json();const output=result.output;
 if(!response.ok||result.error||!output?.ok||!output.certificate||typeof output.signature!=="string")throw Error("Sealed certificate unavailable. Declared floor is not verified.");
 return {certificate:output.certificate,signature:output.signature};
}
