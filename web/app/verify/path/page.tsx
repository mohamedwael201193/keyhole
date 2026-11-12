import Link from "next/link";
import { Badge, Proof, See, Step, Steps, Term, Purpose, Reveal, type ProofRow } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { attestation, acct, acctAlt, KEYS_CONTRACT, tx, txAlt } from "@/lib/config";
import { IDENTITY } from "@/lib/identity.gen";
import { TxLink } from "@/components/TxLink";
import { HealthStrip } from "@/components/HealthStrip";
import { Trust, TrustLegend } from "@/components/Trust";
import { CheckBuild, CheckContract } from "./live";
import "../../public-pages.css";

export const metadata = { title: "Verification path · KEYHOLE" };

const REPO = "https://github.com/mohamedwael201193/keyhole/blob/main";
// Every live identity comes from identity.json (node scripts/gen-identity.mjs).
const INFO_CALL = IDENTITY.worker.info_call;
const CUR = IDENTITY.worker.wasm_sha256;

type Call = { id: string; what: string; ok: boolean; result: string; file?: string; build?: string; current?: boolean };
/** Worker build each step-3 call executed on (executed_wasm_sha256 in its attestation). Not the current build. */
const STEP3_BUILD = "a55ebb14";
const txRow = (label: string, h: string): ProofRow => ({ label, value: h, href: tx(h), alt: txAlt(h) });
/** Transfer run on build a985fd87 (see docs/evidence/transfer-a985fd87). Both wallets are team test wallets, not independent users. */
const SALE_TX = "89vSYY4tbeNPuNuhHB8YmkkAWAcjW5VdniQm3ePHuPYz";
/** Handover calls on build a985fd87 (executed_wasm_sha256). Not the current build — see liveChecks / OutLayer. */
const STEP4_BUILD = "a985fd87";
const STEP4_NOW: Call[] = [
  { id: "baccd727-cdca-4b3e-ae93-999fd581444a", what: "Seller A's status, before the sale", ok: true, result: "Allowed: A holds the key.", build: STEP4_BUILD },
  { id: "ece5d109-6b98-442f-b682-96af0a23f2e7", what: "Seller A reads the balance, before the sale", ok: true, result: "Allowed: 2000 USDC base units.", build: STEP4_BUILD },
  { id: "2a52742a-2b4a-432d-b087-888ea52f03ce", what: "Seller A reads the balance, after the sale", ok: false, result: "Refused: not_owner.", build: STEP4_BUILD },
  { id: "3e996273-e4a0-4c26-aa54-6775fba29236", what: "Buyer B reads the balance, after the sale", ok: true, result: "Allowed: the same 2000 USDC base units. The account moved with the key.", build: STEP4_BUILD },
  { id: "15f93f58-2568-4064-9581-db04c8b2a1aa", what: "Seller A replays the request it signed before the sale", ok: false, result: "Refused: not_owner. The owner check runs before the nonce check.", build: STEP4_BUILD },
  { id: "8485f8d4-c4e1-4ab5-ab9c-a19a0d9d21f7", what: "Buyer B withdraws right after the transfer", ok: false, result: "Refused: cooldown (10 minutes after a transfer).", build: STEP4_BUILD },
];

function Calls({ rows, testid }: { rows: Call[]; testid?: string }) {
  return (
    <ul className="jcalls2" data-testid={testid}>
      {rows.map((r) => (
        <li key={r.id} className="jcall2">
          <div className="jc-what"><Badge tone={r.ok ? "ok" : "info"}>{r.ok ? "Allowed" : "Refused"}</Badge><span>{r.what}</span></div>
          <div className="jc-res">{r.result}</div>
          <div className="jc-act">
            <Link className="ulink" href={`/verify?call=${r.id}`} aria-label={`Verify call ${r.id.slice(0, 8)}: ${r.what}`}>Verify this call</Link>
            <a className="ulink" href={attestation(r.id)} target="_blank" rel="noreferrer" aria-label={`Raw attestation for ${r.id.slice(0, 8)}`}>Raw attestation ↗</a>
            <code title={r.id}>{r.id.slice(0, 8)}</code>
            {r.current && <Badge tone="ok">Current build</Badge>}
            {r.build && <span className="mono">build {r.build}, previous</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Script({ path, children }: { path: string; children: React.ReactNode }) {
  return (
    <details className="jscript">
      <summary>Prefer a terminal? Verification script: <code>{path}</code></summary>
      <p>{children} <a href={`${REPO}/${path.replace(/^\.\//, "").split(" ")[0]}`} target="_blank" rel="noreferrer">Read the script ↗</a></p>
    </details>
  );
}

export default function VerificationPathPage() {
  return (
    <div className="page pp pp-judge" data-testid="judge-page">
      <Purpose
        eyebrow="Verification path · no wallet"
        title={<>Check it yourself. <em>Trust nothing we say.</em></>}
        line={<>Seven steps, top to bottom. Steps 1 and 2 run a quick check in your browser. Steps 3 to 6 open each recorded call on /verify or name a verification script. Step 7 is optional. If you see something else, the claim fails.</>}
      />
      <div className="uact">
        <Button href="/try?start=1" testid="judge-try-free">Try it free — testnet</Button>
      </div>
      <HealthStrip />
      <TrustLegend />
      <Steps testid="judge-steps">
        <Reveal><Step n={1} title="The code running in the enclave is the code in the repo" testid="judge-step-1">
          <Trust src={["outlayer", "browser", "intel", "chain"]} />
          <p className="jclaim">Intel signs a report naming the code that ran, and we compare its fingerprint with the current build, <b className="mono">{CUR.slice(0, 8)}</b>.</p>
          <div className="uact">
            <CheckBuild callId={INFO_CALL} />
            <Button variant="secondary" href={`/verify?call=${IDENTITY.worker.info_call}`} testid="judge-do-1">Run all 37 checks on /verify</Button>
          </div>
          <See>The quick check shows <b>Pass</b>. On /verify, all checks are green: the worker downloaded from FastFS hashes to <b className="mono">{CUR.slice(0, 8)}…</b>, the quote&apos;s report data matches, and Intel&apos;s certificate chain verifies. Badge: <b>Current build</b>. Published with <TxLink hash={IDENTITY.worker.add_version_tx}>add_version</TxLink>.</See>
          <Proof rows={[
            { label: "current build", value: CUR },
            txRow("published in", IDENTITY.worker.add_version_tx),
            { label: "attested call", value: INFO_CALL, href: `/verify?call=${INFO_CALL}`, internal: true },
          ]} />
          <Script path={`./verify.sh ${IDENTITY.worker.info_call} --rebuild`}>Rebuilds the worker from source with Rust and prints the same hash.</Script>
        </Step></Reveal>

        <Reveal><Step n={2} title="The NFT contract is the one in the repo" testid="judge-step-2">
          <Trust src={["chain", "browser"]} />
          <p className="jclaim">NEAR&apos;s public RPC reports the code hash of <span className="mono">{KEYS_CONTRACT}</span>, and we compare it with the wasm committed in the repo.</p>
          <div className="uact"><CheckContract /></div>
          <See>The quick check shows <b>Pass</b>. The contract&apos;s only minter is an account whose key was generated inside the enclave.</See>
          <Proof rows={[
            { label: "expected code hash", value: IDENTITY.contract.code_hash },
            { label: "contract", value: KEYS_CONTRACT, href: acct(KEYS_CONTRACT), alt: acctAlt(KEYS_CONTRACT) },
            { label: "repo file", value: "contracts/keys/deployed/keyhole_keys.wasm", href: `${REPO}/contracts/keys/deployed` },
          ]} />
          <Script path="./judge/1-contract.sh">Same comparison from a terminal, using curl and sha256sum.</Script>
        </Step></Reveal>

        <Reveal><Step n={3} title={`Checks on build ${STEP3_BUILD}: only the real holder gets in`} testid="judge-step-3">
          <Trust src={["outlayer", "us"]} />
          <p className="jclaim">These five calls ran on the previous build, <b className="mono">{STEP3_BUILD}</b>. Each answer, refusals included, was produced inside the enclave and signed by Intel.</p>
          <Calls testid="judge-step3-calls" rows={[
            { id: "40c02b72-b297-4a9a-9265-751ba826fdf8", what: "A limited (function-call) key tries to act for an account", ok: false, result: "Refused: key_not_owned. Only a full-access key counts.", build: STEP3_BUILD },
            { id: "013b022a-2159-4ec2-bdaf-c878dd73e823", what: "The account's real full-access key signs", ok: true, result: "Allowed: the vault opens.", build: STEP3_BUILD },
            { id: "91b5b8e7-96e8-4107-9115-f44cb849b3d0", what: "An account that already holds a key tries to mint another", ok: false, result: "Refused: already_holder. No quota was used.", build: STEP3_BUILD },
            { id: "f5eb650a-b3d4-40df-b5f9-086f0b0f08b5", what: "The holder locks the key for one hour", ok: true, result: "Allowed: locked.", build: STEP3_BUILD },
            { id: "5a7addfa-86e9-49a3-9653-83f683c60356", what: "A cross-chain signature is asked for while the key is locked", ok: false, result: "Refused: locked.", build: STEP3_BUILD },
          ]} />
          <See>Each <b>Verify this call</b> opens /verify with the verdict <b>Genuine enclave, previous build (not the current one).</b> That is expected for these calls, because they ran on build {STEP3_BUILD}.</See>
        </Step></Reveal>

        <Reveal><Step n={4} title="Selling the key moves the account; the old holder is locked out" testid="judge-step-4">
          <Trust src={["chain", "outlayer", "us"]} />
          <p className="jclaim">The key moved from account A to account B on build <b className="mono">{STEP4_BUILD}</b> (not the current build <b className="mono">{CUR.slice(0, 8)}</b>). A and B are team test wallets, not independent users. Before the move A reads its balance. After it, A is refused and B reads the same balance. A replayed request and an early withdrawal by B are refused too.</p>
          <See>Each call below is labelled <b>build {STEP4_BUILD}, previous</b>. Its attestation names that wasm, not the current <b className="mono">{CUR.slice(0, 8)}</b>. Click <b>Verify this call</b> to check one. The sale is one NEAR transaction, and its receipt shows SuccessValue.</See>
          <Calls testid="judge-step4-calls" rows={STEP4_NOW} />
          <Proof rows={[txRow(`sale: nft_transfer, A → B (build ${STEP4_BUILD})`, SALE_TX)]} title="Transfer" />
          <p className="muted">The site gateway also refuses a session-scheme withdraw with HTTP 403 <span className="mono">session_scope</span>, before any enclave call. It has no call id.</p>
          <details className="jprev" data-testid="judge-previous">
            <summary>Recorded on earlier builds (10 calls)</summary>
            <Proof rows={[txRow("key transfer A → B (earlier build)", "G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD"), txRow("key back to A (earlier build)", "HGKe7Dzd3ERMLkWYcVvffV6opweQqN3wbfFevo44uDUn")]} title="Earlier transfers" />
            <Calls rows={[
              { id: "440c2378-6c27-49fd-8b6b-d74054f331ae", what: "A withdraws before the transfer", ok: true, result: "Allowed: withdrew 0.003 USDC." },
              { id: "e805f050-d416-4a04-9b12-270adbe02068", what: "A signs again after the transfer", ok: false, result: "Refused: not_owner." },
              { id: "a4867e19-4444-48f7-9594-5b1b7303206e", what: "B, the new holder, withdraws", ok: true, result: "Allowed: withdrew 0.001 USDC." },
              { id: "c3a9839f-64d8-4135-a036-eca3796bb672", what: "B's signed request is sent twice", ok: false, result: "Refused: replay." },
              { id: "98b27188-a28c-4720-8fec-1d1329e0f281", what: "B locks the key for sale", ok: true, result: "Allowed: locked." },
              { id: "075287b5-a100-4fa5-8e96-94a36019c6bc", what: "B tries to withdraw while locked", ok: false, result: "Refused: locked." },
              { id: "38ae4d84-9058-4e3b-a01d-e0f0a1f35bb4", what: "A cuts its caps to $0.002 per trade, $0.005 per day", ok: true, result: "Allowed: applies now." },
              { id: "8e142cce-a608-4ed4-ae61-9eed8f7dec12", what: "A asks to raise them again", ok: true, result: "Allowed: pending for 24 hours." },
              { id: "396bb6dd-ae97-497c-8a09-81e2118d0890", what: "A asks for a quote above its own cap", ok: false, result: "Refused: over_cap_per_tx." },
              { id: "ec00a7aa-ee0f-465d-bb09-283911aec406", what: "A withdraws right after getting the key back", ok: false, result: "Refused: cooldown (10 minutes)." },
            ]} />
          </details>
        </Step></Reveal>

        <Reveal><Step n={5} title="Tier caps hold on real trades" testid="judge-step-5">
          <Trust src={["outlayer", "us"]} />
          <p className="jclaim">A Bronze key may trade at most $1 at a time, and a 2 USDC swap was refused before anything moved.</p>
          <Calls rows={[{ id: "a02613a2-d503-45e2-83b8-ef71927c2533", what: "2 USDC swap on a Bronze key (earlier build f13efe92)", ok: false, result: "Refused: over_cap_per_tx." }]} />
          <See>/verify shows the refusal with green checks. All 30 recorded mainnet steps are in the repo.</See>
          <Script path="./judge/2-attestations.sh">Checks each of the 30 recorded steps against its attestation. In the browser instead: open any call id from <a href={`${REPO}/docs/evidence/mainnet-e2e`} target="_blank" rel="noreferrer">docs/evidence/mainnet-e2e</a> on /verify.</Script>
        </Step></Reveal>

        <Reveal><Step n={6} title="Each key can sign for other chains" testid="judge-chainsig">
          <Trust src={["chain", "outlayer"]} />
          <p className="jclaim">With Chain Signatures, NEAR&apos;s MPC network signed for the EVM address derived from this key alone.</p>
          <Calls rows={[{ id: "0cd1c3bd-21be-44dc-bc60-e792a42344e6", what: "chain_sign for key k5f4750858f328940 (build 09d481a5)", ok: true, result: "Allowed: recovers to 0xe39C…f063." }]} />
          <See>The signature recovers to <span className="mono">0xe39C947d…f063</span>. The MPC transaction below shows <span className="mono">v1.signer.sign</span> called by the minter, and the beat transaction was signed by the limited key: it may only call <span className="mono">beat</span> on the contract.</See>
          <Proof rows={[txRow("MPC sign", "7P9VFx4pz5oxyXpXkyDVE6SheDuTqHgQcEM2vgKFUAfK"), txRow("beat (limited key)", "B1BH9eZycbXqgwod2dqbn6e5UWY8TKTw2ZawyYqLRDtG")]} />
        </Step></Reveal>

        <Reveal><Step n={7} title="Optional: try it with your own wallet" testid="judge-step-7">
          <Trust src={["browser", "chain"]} />
          <p className="jclaim">Steps 1 to 6 need no wallet. With a NEAR wallet or MetaMask you can mint a free key, one signature, and the enclave pays the storage.</p>
          <div className="uact">
            <Button variant="secondary" href="/mint">Mint a free key</Button>
            <Button variant="ghost" href="/vault">Open your vault</Button>
            <Button variant="ghost" href="/settle">Get a 1Click price</Button>
          </div>
          <See>Your result shows a <Term k="callid" /> and a <b>Verify</b> link. It checks out on /verify just like step 1. In your vault, press <b>Read balance</b>.</See>
          <p className="muted">MetaMask may warn &ldquo;Malicious site&rdquo;. Its scanner flags every <span className="mono">*.vercel.app</span> address, including ones that were never deployed. Details are in <a href={`${REPO}/research/METAMASK_FLAG.md`} target="_blank" rel="noreferrer">research/METAMASK_FLAG.md</a>.</p>
        </Step></Reveal>
      </Steps>

      <section className="pp-card pp-who" data-testid="who-sees-what" aria-labelledby="who-h">
        <h2 id="who-h">Who sees what</h2>
        <div className="jtw">
          <table className="jtable">
            <thead><tr><th scope="col">Party</th><th scope="col">Sees</th><th scope="col">Does not see</th></tr></thead>
            <tbody>
              <tr><td data-label="Party">NEAR (anyone)</td><td data-label="Sees">Token id, holder, tier, transfer time, the minter&apos;s mint and beat transactions</td><td data-label="Does not see">Balances, trades, history, caps</td></tr>
              <tr><td data-label="Party">KEYHOLE website gateway</td><td data-label="Sees">The signed request and the reply it relays to the holder&apos;s browser. Bodies are not logged</td><td data-label="Does not see">Anything without the holder&apos;s fresh signature</td></tr>
              <tr><td data-label="Party">OutLayer TDX enclave</td><td data-label="Sees">Everything for the call it runs, sealed by Intel TDX and attested</td><td data-label="Does not see">Nothing is hidden from the code, which is why the code hash is checked</td></tr>
              <tr><td data-label="Party">OutLayer custody wallet</td><td data-label="Sees">The key account&apos;s balances and the swaps it settles</td><td data-label="Does not see">Who holds the NFT</td></tr>
              <tr><td data-label="Party">1Click solvers</td><td data-label="Sees">The asset pair and amount of a quote</td><td data-label="Does not see">The key, its holder, its history</td></tr>
              <tr><td data-label="Party">Next holder of the key</td><td data-label="Sees">The account, its balances, earlier history rows as hashes</td><td data-label="Does not see">Earlier holders&apos; trade details</td></tr>
              <tr><td data-label="Party">Previous holder</td><td data-label="Sees">Only what they did while holding it. After the transfer every request is refused (<span className="mono">not_owner</span>)</td><td data-label="Does not see">The new holder&apos;s balances and trades</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted">Who can change things: <span className="mono">keyhole-devmo.near</span> owns the contract (owner-only <span className="mono">set_minter</span> and <span className="mono">set_royalty</span>, royalty capped at 10%) and publishes worker versions with <span className="mono">add_version</span>. Every version is on chain, and an attestation always names the exact build that ran, so a new version cannot rewrite an old proof.</p>
      </section>

      <section className="pp-card pp-limits" aria-labelledby="notprove-h">
        <h2 id="notprove-h">What this does not prove</h2>
        <ul>
          <li>The attestation proves which code ran on which input and output. It does not prove the code is bug-free. The source is open; the threat model is in <a href={`${REPO}/THREAT_MODEL.md`} target="_blank" rel="noreferrer">THREAT_MODEL.md</a>.</li>
          <li>Trust rests on Intel TDX and the OutLayer operator&apos;s quote collateral, like any TEE system.</li>
          <li>Amounts in the recorded runs are tiny on purpose (fractions of a cent to $0.02).</li>
        </ul>
      </section>
    </div>
  );
}
