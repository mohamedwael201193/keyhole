import Link from "next/link";

export const metadata = { title: "Judge path · KEYHOLE" };

const SITE = "https://keyhole-seven.vercel.app";
const REPO_EVIDENCE = "docs/evidence/ownership-and-limits";
const att = (id: string) => `https://api.outlayer.ai/attestations/by-call/${id}`;
const tx = (h: string) => `https://nearblocks.io/txns/${h}`;

type Call = { id: string; what: string; result: string; file?: string };

function Calls({ rows }: { rows: Call[] }) {
  return (
    <div className="jcalls">
      {rows.map((r) => (
        <div className="jcall" key={r.id}>
          <div className="jw"><b>{r.what}</b><span className="mono">{r.result}</span></div>
          <div className="jl mono">
            <Link href={`/verify?call=${r.id}`}>Verify {r.id.slice(0, 8)}</Link>
            <a href={att(r.id)} target="_blank" rel="noreferrer">Raw attestation</a>
            {r.file ? <span>{r.file}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function JudgePage() {
  return (
    <div className="page judge" data-testid="judge-page">
      <p className="eb">Judge path · NEAR mainnet · about 5 minutes</p>
      <h1>Check it yourself. <em>Trust nothing we say.</em></h1>
      <p className="lede">Every step below runs against NEAR mainnet and the public OutLayer attestation API. Nothing here needs our keys or an account. Each step says what to do and what you should see. If you see something else, the claim fails.</p>

      <ol className="jsteps">
        <li className="c">
          <h2><span>1</span>The code in the enclave is the code in the repo</h2>
          <p><b>Do:</b> open <Link href="/verify?call=54207d9e-b4f0-438b-9a74-cdba33de80d9">/verify for call 54207d9e</Link>.</p>
          <p><b>See:</b> the page fetches the attestation in your browser, downloads the worker from FastFS, hashes it, recomputes the quote&apos;s report_data from the attested fields, and shows five green checks (the sixth, output, is checked for calls whose output we publish, as in steps 3 to 5). <span className="mono">executed_wasm_sha256</span> is <span className="mono">f7217ae2…a85381</span>, the same value as <span className="mono">tee/worker/DEPLOYED_SHA256</span>. It was published with <a href={tx("CcttLJdwCa8EaLhY42fh6SBZbcVphtycrNTc74jnvkyW")} target="_blank" rel="noreferrer">add_version CcttLJdw…</a>.</p>
          <p className="muted"><b>Deeper (2 min with Rust):</b> <span className="mono">./verify.sh 54207d9e-b4f0-438b-9a74-cdba33de80d9 --rebuild</span> rebuilds the worker from source and prints the same hash.</p>
        </li>

        <li className="c">
          <h2><span>2</span>The NFT contract is the one in the repo</h2>
          <p><b>Do:</b> run <span className="mono">./judge/1-contract.sh</span>, or open <a href="https://nearblocks.io/address/keyhole-devmo.near" target="_blank" rel="noreferrer">keyhole-devmo.near</a> and compare its code hash.</p>
          <p><b>See:</b> the on-chain code hash equals sha256 <span className="mono">d985104e…a29e817b</span> of <span className="mono">contracts/keys/deployed/keyhole_keys.wasm</span>. The only minter is the account the TEE holds.</p>
        </li>

        <li className="c">
          <h2><span>3</span>Whoever holds the NFT controls the account, and nobody else</h2>
          <p><b>Do:</b> open the transfer <a href={tx("3AhjtyUNx9T5QCgphV9niUYFFY6si5y1zLo39e8LHkDS")} target="_blank" rel="noreferrer">3AhjtyUN…</a> (key moves from account A to account B), then verify the calls below.</p>
          <p><b>See:</b> before the transfer A could withdraw. After it, the same kind of request from A is refused with <span className="mono">not_owner</span> and B can withdraw. A replayed request and a withdraw while the key is locked for sale are refused too. Each verdict is produced inside the enclave and attested.</p>
          <Calls rows={[
            { id: "440c2378-6c27-49fd-8b6b-d74054f331ae", what: "A withdraws before the transfer", result: "ok · withdraw 0.003 USDC" },
            { id: "e805f050-d416-4a04-9b12-270adbe02068", what: "A signs again after the transfer", result: "refused · not_owner" },
            { id: "a4867e19-4444-48f7-9594-5b1b7303206e", what: "B (new holder) withdraws", result: "ok · withdraw 0.001 USDC" },
            { id: "c3a9839f-64d8-4135-a036-eca3796bb672", what: "B's signed request sent twice", result: "refused · replay" },
            { id: "98b27188-a28c-4720-8fec-1d1329e0f281", what: "B locks the key for sale", result: "ok · lock" },
            { id: "075287b5-a100-4fa5-8e96-94a36019c6bc", what: "B tries to withdraw while locked", result: "refused · locked" },
          ]} />
          <p className="muted">These calls ran on earlier worker builds (before f7217ae2), so /verify marks the build as <b>Previous version</b>. Their outputs are published in the repo and hash to the attested <span className="mono">output_hash</span>.</p>
        </li>

        <li className="c">
          <h2><span>4</span>Holder limits and the cooldown are enforced in the enclave</h2>
          <p><b>Do:</b> verify the calls below. The key went back to A in <a href={tx("HbrJmfpzpiQEqPyoz1QdvL2iYBVLBAvbAZfTtxGbnkXU")} target="_blank" rel="noreferrer">HbrJmfpz…</a>.</p>
          <p><b>See:</b> A cuts its own caps below the Bronze tier and the cut applies at once. A raise is stored as pending for 24 hours. A quote above the holder cap is refused. Because the key changed hands, withdraw is refused with <span className="mono">cooldown</span> for 10 minutes while swaps still work.</p>
          <Calls rows={[
            { id: "38ae4d84-9058-4e3b-a01d-e0f0a1f35bb4", what: "A cuts caps to $0.002 per trade, $0.005 per day", result: "ok · applies now" },
            { id: "8e142cce-a608-4ed4-ae61-9eed8f7dec12", what: "A asks to raise them again", result: "ok · pending 24 h" },
            { id: "396bb6dd-ae97-497c-8a09-81e2118d0890", what: "A quotes above its own cap", result: "refused · over_cap_per_tx" },
            { id: "ec00a7aa-ee0f-465d-bb09-283911aec406", what: "A withdraws right after receiving the key", result: "refused · cooldown" },
          ]} />
        </li>

        <li className="c">
          <h2><span>5</span>Tier caps hold on real trades</h2>
          <p><b>See:</b> a 2 USDC swap against the $1 Bronze cap was refused by the enclave before anything moved.</p>
          <Calls rows={[{ id: "a02613a2-d503-45e2-83b8-ef71927c2533", what: "2 USDC swap on a Bronze key", result: "refused · over_cap_per_tx" }]} />
          <p className="muted">All 30 recorded mainnet steps are in <span className="mono">docs/evidence/mainnet-e2e/</span>. Run <span className="mono">./judge/2-attestations.sh</span> to check each one against its attestation.</p>
        </li>

        <li className="c">
          <h2><span>6</span>Try it with your own wallet (optional)</h2>
          <p><b>Do:</b> <Link href="/mint">mint a free key</Link> (one signature, the TEE pays storage), then open <Link href="/vault">/vault</Link> and press <b>Read balance</b>.</p>
          <p><b>See:</b> a result with a call id and a <b>Verify</b> link. That call verifies in step 1 the same way.</p>
        </li>
      </ol>

      <div className="c jlimits">
        <h2>What this does not prove</h2>
        <ul>
          <li>The attestation proves which code ran on which input and output. It does not prove the code is bug-free. The source is open; the threat model is in <span className="mono">THREAT_MODEL.md</span>.</li>
          <li>Trust rests on Intel TDX and the OutLayer operator&apos;s quote collateral, like any TEE system.</li>
          <li>Amounts in the recorded runs are tiny on purpose (fractions of a cent to $0.02).</li>
        </ul>
        <p className="mono muted">Evidence files: {REPO_EVIDENCE}/ in the repository · site {SITE}</p>
      </div>
    </div>
  );
}
