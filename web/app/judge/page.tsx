import Link from "next/link";
import { Badge, Proof, See, Step, Steps, Term, Purpose, Reveal, type ProofRow } from "@/components/ui";
import { attestation, acct, acctAlt, KEYS_CONTRACT, tx, txAlt } from "@/lib/config";
import { IDENTITY } from "@/lib/identity.gen";
import { TxLink } from "@/components/TxLink";
import { HealthStrip } from "@/components/HealthStrip";
import { Trust, TrustLegend } from "@/components/Trust";
import { CheckBuild, CheckContract } from "./live";

export const metadata = { title: "Judge path · KEYHOLE" };

const REPO = "https://github.com/mohamedwael201193/keyhole/blob/main";
// Every live identity comes from identity.json (node scripts/gen-identity.mjs).
const INFO_CALL = IDENTITY.worker.info_call;
const CUR = IDENTITY.worker.wasm_sha256;

type Call = { id: string; what: string; ok: boolean; result: string; file?: string; build?: string };
/** Worker build each step-3 call executed on (executed_wasm_sha256 in its attestation). Not the current build. */
const STEP3_BUILD = "a55ebb14";
const txRow = (label: string, h: string): ProofRow => ({ label, value: h, href: tx(h), alt: txAlt(h) });

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
      <summary>Prefer a terminal? <code>{path}</code></summary>
      <p>{children} <a href={`${REPO}/${path.replace(/^\.\//, "").split(" ")[0]}`} target="_blank" rel="noreferrer">Read the script ↗</a></p>
    </details>
  );
}

export default function JudgePage() {
  return (
    <div className="page judge" data-testid="judge-page">
      <Purpose
        eyebrow="Judge path · 5 min · no wallet"
        title={<>Check it yourself. <em>Trust nothing we say.</em></>}
        line={<>Seven checks, top to bottom. Each one has a button that runs in your browser and a green box that says what you should see. If you see something else, the claim fails.</>}
      />
      <HealthStrip />
      <TrustLegend />
      <Steps testid="judge-steps">
        <Reveal><Step n={1} title="The code running in the enclave is the code in the repo" testid="judge-step-1">
          <Trust src={["outlayer", "browser", "intel", "chain"]} />
          <p>Every answer comes from an <Term k="enclave" /> on <Term k="tdx" /> hardware. Intel signs a report naming the exact code that ran. We compare that code&apos;s <Term k="codehash" /> with the current published build, <b className="mono">{CUR.slice(0, 8)}</b>.</p>
          <div className="uact">
            <CheckBuild callId={INFO_CALL} />
            <Link className="btn b1" href={`/verify?call=${IDENTITY.worker.info_call}`} data-testid="judge-do-1">Run all 37 checks on /verify</Link>
          </div>
          <See>The quick check shows <b>Pass</b>. On /verify, all checks are green: the worker downloaded from FastFS hashes to <b className="mono">{CUR.slice(0, 8)}…</b>, the quote&apos;s report data matches, and Intel&apos;s certificate chain verifies. Badge: <b>Current build</b>. Published with <TxLink hash={IDENTITY.worker.add_version_tx}>add_version</TxLink>.</See>
          <Proof rows={[
            { label: "current build", value: CUR },
            txRow("published in", IDENTITY.worker.add_version_tx),
            { label: "attested call", value: INFO_CALL, href: `/verify?call=${INFO_CALL}`, internal: true },
          ]} />
          <Script path={`./verify.sh ${IDENTITY.worker.info_call} --rebuild`}>Rebuilds the worker from source with Rust (about 2 minutes) and prints the same hash.</Script>
        </Step></Reveal>

        <Reveal><Step n={2} title="The NFT contract is the one in the repo" testid="judge-step-2">
          <Trust src={["chain", "browser"]} />
          <p>NEAR reports a code hash for every contract. We ask NEAR&apos;s public RPC for <span className="mono">{KEYS_CONTRACT}</span> and compare it with the wasm committed in the repo.</p>
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
          <p>These five calls ran on build <b className="mono">{STEP3_BUILD}</b>, which is the previous build. The current build is <b className="mono">{CUR.slice(0, 8)}</b>, and step 1 checks that one. Each answer, including each refusal, was produced inside the enclave and signed by Intel.</p>
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
          <p>The key moved from account A to account B. Before the move A could withdraw; after it A is refused and B can withdraw. Replays and withdrawals while the key is locked are refused too.</p>
          <See>Open the transfer below. Then, under <b>Recorded on earlier builds</b>, each call verifies with the badge <b>Genuine enclave, previous build</b>. That is expected: the attestation names the build that ran at the time.</See>
          <Proof rows={[txRow("key transfer A → B", "G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD"), txRow("key back to A", "HGKe7Dzd3ERMLkWYcVvffV6opweQqN3wbfFevo44uDUn")]} title="Transfers" />
          <details className="jprev" data-testid="judge-previous">
            <summary>Recorded on earlier builds (10 calls)</summary>
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
          <p>A Bronze key may trade at most $1 at a time. A 2 USDC swap was refused before anything moved.</p>
          <Calls rows={[{ id: "a02613a2-d503-45e2-83b8-ef71927c2533", what: "2 USDC swap on a Bronze key (earlier build f13efe92)", ok: false, result: "Refused: over_cap_per_tx." }]} />
          <See>/verify shows the refusal with green checks. All 30 recorded mainnet steps are in the repo.</See>
          <Script path="./judge/2-attestations.sh">Checks each of the 30 recorded steps against its attestation. In the browser instead: open any call id from <a href={`${REPO}/docs/evidence/mainnet-e2e`} target="_blank" rel="noreferrer">docs/evidence/mainnet-e2e</a> on /verify.</Script>
        </Step></Reveal>

        <Reveal><Step n={6} title="Each key can sign for other chains" testid="judge-chainsig">
          <Trust src={["chain", "outlayer"]} />
          <p>With <Term k="chainsig" />, NEAR&apos;s MPC network signed for the holder of key <span className="mono">k5f4750858f328940</span>. The signature recovers to <span className="mono">0xe39C947d…f063</span>, the EVM address derived for that key alone. The minter&apos;s agent key is limited: it may only call <span className="mono">beat</span> on the contract.</p>
          <Calls rows={[{ id: "0cd1c3bd-21be-44dc-bc60-e792a42344e6", what: "chain_sign for key k5f4750858f328940 (build 09d481a5)", ok: true, result: "Allowed: recovers to 0xe39C…f063." }]} />
          <See>The MPC transaction below shows <span className="mono">v1.signer.sign</span> called by the minter. The beat transaction was signed by the limited key.</See>
          <Proof rows={[txRow("MPC sign", "7P9VFx4pz5oxyXpXkyDVE6SheDuTqHgQcEM2vgKFUAfK"), txRow("beat (limited key)", "B1BH9eZycbXqgwod2dqbn6e5UWY8TKTw2ZawyYqLRDtG")]} />
        </Step></Reveal>

        <Reveal><Step n={7} title="Optional: try it with your own wallet" testid="judge-step-7">
          <Trust src={["browser", "chain"]} />
          <p>No wallet? Steps 1 to 6 already cover everything, and the <Link href="/settle">1Click page</Link> gets a real price with no wallet. With a NEAR wallet or MetaMask you can <Link href="/mint">mint a free key</Link>: one signature, and the enclave pays storage. Then open <Link href="/vault">your vault</Link> and press <b>Read balance</b>.</p>
          <See>Your result shows a <Term k="callid" /> and a <b>Verify</b> link. It checks out on /verify just like step 1.</See>
          <p className="muted">MetaMask may warn &ldquo;Malicious site&rdquo;. Its scanner flags every <span className="mono">*.vercel.app</span> address, including ones that were never deployed. Details are in <a href={`${REPO}/research/METAMASK_FLAG.md`} target="_blank" rel="noreferrer">research/METAMASK_FLAG.md</a>.</p>
        </Step></Reveal>
      </Steps>

      <div className="c jlimits jwho" data-testid="who-sees-what">
        <h2>Who sees what</h2>
        <div className="jtw">
          <table className="jtable">
            <thead><tr><th>Party</th><th>Sees</th><th>Does not see</th></tr></thead>
            <tbody>
              <tr><td>NEAR (anyone)</td><td>Token id, holder, tier, transfer time, the minter&apos;s mint and beat transactions</td><td>Balances, trades, history, caps</td></tr>
              <tr><td>KEYHOLE website gateway</td><td>The signed request and the reply it relays to the holder&apos;s browser. Bodies are not logged</td><td>Anything without the holder&apos;s fresh signature</td></tr>
              <tr><td>OutLayer TDX enclave</td><td>Everything for the call it runs, sealed by Intel TDX and attested</td><td>Nothing is hidden from the code, which is why the code hash is checked</td></tr>
              <tr><td>OutLayer custody wallet</td><td>The key account&apos;s balances and the swaps it settles</td><td>Who holds the NFT</td></tr>
              <tr><td>1Click solvers</td><td>The asset pair and amount of a quote</td><td>The key, its holder, its history</td></tr>
              <tr><td>Next holder of the key</td><td>The account, its balances, earlier history rows as hashes</td><td>Earlier holders&apos; trade details</td></tr>
              <tr><td>Previous holder</td><td>Only what they did while holding it. After the transfer every request is refused (<span className="mono">not_owner</span>)</td><td>The new holder&apos;s balances and trades</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted">Who can change things: <span className="mono">keyhole-devmo.near</span> owns the contract (owner-only <span className="mono">set_minter</span> and <span className="mono">set_royalty</span>, royalty capped at 10%) and publishes worker versions with <span className="mono">add_version</span>. Every version is on chain, and an attestation always names the exact build that ran, so a new version cannot rewrite an old proof.</p>
      </div>

      <div className="c jlimits">
        <h2>What this does not prove</h2>
        <ul>
          <li>The attestation proves which code ran on which input and output. It does not prove the code is bug-free. The source is open; the threat model is in <a href={`${REPO}/THREAT_MODEL.md`} target="_blank" rel="noreferrer">THREAT_MODEL.md</a>.</li>
          <li>Trust rests on Intel TDX and the OutLayer operator&apos;s quote collateral, like any TEE system.</li>
          <li>Amounts in the recorded runs are tiny on purpose (fractions of a cent to $0.02).</li>
        </ul>
      </div>
    </div>
  );
}
