"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {PageHeader} from "@/components/v7";
import {createPledgeClient,type LenderOffer} from "@/lib/pledgeClient";
import "../../pledge.css";
import {requestLoanCertificate,verifyLoanCertificate} from "@/lib/loanCertificate";
/** This route never imports holder data/session APIs. Guest sees only the public projection. */
export function LenderView({tokenId}:{tokenId:string}) {
 const client=useMemo(()=>createPledgeClient(),[]);
 const [offer,setOffer]=useState<LenderOffer|null>(null),[error,setError]=useState("");
 useEffect(()=>{let cancelled=false;if(client.live)client.getLenderOffer(tokenId).then(x=>{if(!cancelled){setOffer(x);if(!x)setError("No on-chain offer at this link.");}}).catch(()=>{if(!cancelled)setError("Public loan status unavailable. Reload the same link; do not resend money.");});return ()=>{cancelled=true;};},[client,tokenId]);
 const loan=offer?.loan;
 const [verified,setVerified]=useState(false),[certificateStatus,setCertificateStatus]=useState(""),[verifying,setVerifying]=useState(false),[certificateTtl,setCertificateTtl]=useState(0);
 useEffect(()=>{setVerified(false);},[tokenId,loan?.nonce,loan?.owner_epoch,loan?.state]);
 useEffect(()=>{if(!verified)return;const timer=setTimeout(()=>{setVerified(false);setCertificateStatus("Certificate display expired; verify a fresh exact-loan certificate.");},certificateTtl);return ()=>clearTimeout(timer);},[verified,certificateTtl]);
 async function verifyFloor(){
  if(!loan||!client.live||verifying)return;const started=performance.now();setVerifying(true);setVerified(false);
  try {
   const bundle=await requestLoanCertificate(tokenId,loan.nonce);
   const [config,expected,current,now]=await Promise.all([client.getPledgeConfig(),client.getCertificateTemplate(tokenId,bundle.certificate.observed_at_ns,bundle.certificate.expires_at_ns),client.getLenderOffer(tokenId),client.chainNowNs()]);
   if(!config||!expected||!current||current.loan.nonce!==loan.nonce||current.loan.state!=="Offered"||current.loan.policy_busy||!current.funding_open||!await verifyLoanCertificate(bundle,expected,config,now))throw Error("Sealed certificate did not verify against this current loan.");
   const remaining=Number((BigInt(bundle.certificate.expires_at_ns)-BigInt(now))/1_000_000n)-(performance.now()-started)-1000;if(remaining<=0)throw Error("Certificate is too close to expiry; request a fresh one.");
   setCertificateTtl(Math.min(30_000,remaining));setOffer(current);setVerified(true);setCertificateStatus("Pinned Ed25519 signature and exact final-chain loan binding verified. Trusted floor statement, not a ZK proof; independent signer/runtime attestation is still required before funding.");
  }catch(e){setCertificateStatus(e instanceof Error?e.message:"Certificate unavailable; floor remains declared only.");}finally{setVerifying(false);}
 }

 return <div className="plg" data-testid="lender-page"><div className="plg-inner"><div className="plg-banner" role="status">{client.live?"On-chain read only · funding disabled": "Lender example · preview · not live"}</div>
 <PageHeader eyebrow="Named lender · review" title={<>Know the terms.<br/><em>Not the full balance.</em></>} lead="Review one declared USDC minimum; treat it as certified only after verifying its sealed certificate. Repayment or control of the entire account — never guaranteed yield."/>
 <div className="plg-lender-layout"><section className="plg-widget plg-lender-card" aria-label="Lender cashflows">
 <h2>Principal out · repayment or account control</h2>
 <dl><dt>Principal out now</dt><dd>{loan?near(loan.terms.principal):client.live?"Loading":"0.01 NEAR · example"}</dd>
 <dt>Receive if repaid</dt><dd>{loan?near(loan.terms.repayment):client.live?"Loading":"0.0101 NEAR · example"} · backed credit, then separate cashout</dd>
 <dt>{verified?"Certified public minimum":"Declared, not yet verified"}</dt><dd>{loan?`${loan.terms.floor_raw} raw USDC · ${offer?.decimals} decimals`:client.live?"Loading":"0.50 USDC · example"}</dd>
 <dt>Borrower / named lender</dt><dd>{loan?`${loan.borrower} / ${loan.terms.lender}`:"Immutable named parties; no pooled or instant credit"}</dd>
 <dt>Term / grace</dt><dd>{loan?`${loan.terms.duration_sec}s / ${loan.terms.grace_sec}s`: "2 hours / 15 minutes · example"}</dd>
 <dt>Chain loan state</dt><dd>{loan?.state??(error||(!client.live?"Example only":"Loading public projection"))}</dd></dl>
 <p className="plg-warn" role="note">Whole account is collateral, including later deposits. On default claim the same account, then recover only through ordinary caps, cooldown and supported routes. There is no surplus-return liquidation.</p>
 <button type="button" className="plg-cta" disabled={!client.live||!loan||verifying||loan.state!=="Offered"} onClick={()=>void verifyFloor()}>{verifying?"Verifying sealed certificate…":"Verify sealed certificate"}</button>
 <p role="status">{certificateStatus}</p><button className="plg-cta" disabled>Funding disabled pending release review</button>
 </section><section className="plg-lender-checks"><h2>Before a lender signs</h2><ol>
 <li>Use a native NEAR identity; EVM-only identity is not a guessed native recipient. The lender itself must own no key and have no provisional-return reservation. {offer?`Current public eligibility: ${offer.lender_has_no_key&&offer.lender_has_no_return_reservation?"empty key slot":"ineligible"}.`:"Rechecked before Fund, not after."}</li>
 <li>Verify exact immutable parties/terms, owner epoch, custody/controller/policy and independently attested signing authority. A signature or copied worker hash alone is not measured-code evidence.</li>
 <li>Require a fresh ≤60-second certificate after terminal lower freeze and pending-zero. Funding certificate expiry is not active-loan expiry. {offer?`Chain funding snapshot: ${offer.funding_open?"open, certificate still required":"not open"}.`:"No certificate is claimed by this preview."}</li>
 <li>Repaid: backed lender credit → claim → finalized native wallet delivery. Failed delivery restores only on known failure; callback loss remains UNKNOWN.</li>
 <li>Default: only after chain now &gt; due + grace, eligible receiver recheck, same title transfer, terminal thaw, real cooldown, actual in-cap self-exit. Old-holder knowledge remains; as new holder you gain private access.</li>
 </ol><p>Gross premium is not profit: subtract gas, compute/provider, routes and capital lock. No APY, LTV, valuation or guaranteed recovery. Related-party trials are mechanism evidence, not organic demand.</p>
 <p role="status">{error}</p><Link href="/pledge">← Borrower journey</Link></section></div></div></div>;
}
function near(x:string){const n=BigInt(x);return `${n/10n**24n}.${(n%10n**24n).toString().padStart(24,"0").replace(/0+$/,"")||"0"} NEAR`;}
