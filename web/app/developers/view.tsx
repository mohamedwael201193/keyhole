"use client";
import Link from "next/link";
import { Purpose } from "@/components/ui";
import { HealthStrip } from "@/components/HealthStrip";
import { TxLink } from "@/components/TxLink";
import { AgentPanel } from "@/components/developers/AgentPanel";
import { KEYS_CONTRACT, WORKER_PUBLISH_TX, WORKER_WASM_SHA256, tx } from "@/lib/config";
import "../public-pages.css";
import "./developers.css";

const REPO = "https://github.com/mohamedwael201193/keyhole";

/** Where each check lives. The holder's own calls are in the dashboard (My proof); these are the public tools. */
const TOOLS: { href: string; title: string; body: string; id: string }[] = [
  { id: "evidence", href: "/verify", title: "Evidence pack and call verifier", body: "Re-check KEYHOLE on mainnet with no wallet: public RPC and attestation reads, a 37-check call verifier, tamper tests, and the lien lookup." },
  { id: "path", href: "/judge", title: "Verification path", body: "Seven checks from the contract to the enclave, each with the command or the page that runs it." },
  { id: "attack", href: "/attack", title: "Attack board", body: "Attempts to move a key's value without the holder, with the refusal the enclave returned for each." },
  { id: "source", href: "/source", title: "Source archive", body: "One tarball cut from one commit, with its sha256, so the code you read is the code that was published." },
  { id: "atlas", href: "/atlas", title: "Atlas", body: "Every chain with a record, with the transaction, dry run or settled order behind it." },
  { id: "holders", href: "/holders", title: "Holder check", body: "Prove you hold a key with a read-only signature. No money moves." },
  { id: "ask", href: "/ask", title: "Ask privately", body: "Ask a question about KEYHOLE and get an answer from an attested model." },
  { id: "demo", href: "/demo", title: "Demo vault", body: "A read-only replay of a real mainnet session." },
];

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/api/health", "Enclave availability, read passively. It does not spend compute."],
  ["GET", "/api/prices", "Public price book used for the USD lines."],
  ["GET", "/api/tokens", "The token list NEAR Intents can swap."],
  ["POST", "/api/oneclick", "A dry 1Click quote. Nothing is signed and nothing moves."],
  ["GET", "/api/agent?r=network|quotas|policy", "Agent API reads, through the server key. Swaps there are dry quotes only."],
  ["POST", "/api/worker", "The signed worker call {op, auth}. Every op is authorised by the holder's own signature or session."],
];

export function DevelopersView() {
  const build = WORKER_WASM_SHA256[0] ?? "";
  return (
    <div className="page pp pp-dev" data-testid="developers-page">
      <Purpose
        eyebrow="Developers"
        title="Verify it, call it, read the data"
        line="Everything a reviewer or an integrator needs, kept apart from the holder dashboard. Nothing on this page moves funds."
      >
        <nav className="dev-jump" aria-label="On this page">
          <a href="#verify">Verify</a><a href="#enclave">Enclave</a><a href="#agent">Agent API</a><a href="#api">APIs and MCP</a><a href="#commands">Commands</a><a href="#data">Raw data</a>
        </nav>
      </Purpose>

      <section className="pp-card" id="verify" aria-labelledby="dev-verify-h">
        <h2 id="dev-verify-h">Verification tools</h2>
        <ul className="dev-tools" data-testid="dev-tools">
          {TOOLS.map((t) => (
            <li key={t.id}><Link href={t.href} data-testid={`dev-tool-${t.id}`}><b>{t.title}</b></Link><span>{t.body}</span></li>
          ))}
        </ul>
        <p className="muted">Your own calls (balance reads, swaps, withdrawals) are verified from <Link href="/dashboard#proof">My proof</Link> in the dashboard.</p>
      </section>

      <section className="pp-card" id="enclave" aria-labelledby="dev-enclave-h">
        <h2 id="dev-enclave-h">Enclave and attestation</h2>
        <HealthStrip />
        <dl className="dev-facts" data-testid="dev-facts">
          <div><dt>Hardware</dt><dd>Intel TDX, attested through OutLayer</dd></div>
          <div><dt>Published worker build</dt><dd><code data-testid="dev-build">{build}</code></dd></div>
          <div><dt>Publish transaction</dt><dd><TxLink hash={WORKER_PUBLISH_TX}>{WORKER_PUBLISH_TX.slice(0, 12)}…</TxLink></dd></div>
          <div><dt>Keys contract</dt><dd><TxLink account={KEYS_CONTRACT}>{KEYS_CONTRACT}</TxLink></dd></div>
        </dl>
        <p className="muted">Each call carries a TDX quote that names the worker build it ran. A call passes the build check when that build is the published one; calls made on earlier builds are labelled as previous builds. Re-check any call with the verifier above or with <code>./verify.sh &lt;call_id&gt;</code>.</p>
      </section>

      <section className="pp-card settle" id="agent" aria-labelledby="dev-agent-h">
        <h2 id="dev-agent-h" className="dev-h2-plain">Agent API demo, quotas and holder caps</h2>
        <AgentPanel />
      </section>

      <section className="pp-card" id="api" aria-labelledby="dev-api-h">
        <h2 id="dev-api-h">APIs and MCP</h2>
        <table className="dev-table" data-testid="dev-endpoints">
          <thead><tr><th>Method</th><th>Path</th><th>What it does</th></tr></thead>
          <tbody>{ENDPOINTS.map(([m, p, d]) => <tr key={p}><td>{m}</td><td><code>{p}</code></td><td>{d}</td></tr>)}</tbody>
        </table>
        <p>The CLI and the MCP server use the same signed worker calls. Your key stays on your machine; only signatures are sent.</p>
        <pre className="term" tabIndex={0} aria-label="Install the CLI and run the MCP server">{`cd cli && npm ci
npx tsx src/cli.ts help      # the command list
npm run mcp                  # the MCP server (stdio)`}</pre>
        <p className="muted">Full reference: <a href={`${REPO}/blob/main/cli/README.md`} target="_blank" rel="noreferrer">cli/README.md</a>.</p>
      </section>

      <section className="pp-card" id="commands" aria-labelledby="dev-cmd-h">
        <h2 id="dev-cmd-h">Commands</h2>
        <p>Check a call against the published build, from a clone of the repository:</p>
        <pre className="term" tabIndex={0} aria-label="Verify a call from a terminal">{`./verify.sh <call_id>            # attestation, wasm hash and FastFS bytes
./verify.sh <call_id> --rebuild  # also against your own rebuild`}</pre>
        <p>The claims checker compares every claim in the README with a live read. Its commands, including the offline mode, are in <a href={`${REPO}/blob/main/VERIFY.md`} target="_blank" rel="noreferrer">VERIFY.md</a>.</p>
      </section>

      <section className="pp-card" id="data" aria-labelledby="dev-data-h">
        <h2 id="dev-data-h">Raw data</h2>
        <ul>
          <li><a href="/source/manifest.json" data-testid="dev-manifest">Source manifest (commit, sha256, size)</a></li>
          <li><a href={`${REPO}/blob/main/identity.json`} target="_blank" rel="noreferrer">identity.json: the published identities</a></li>
          <li><a href={`${REPO}/tree/main/docs/evidence`} target="_blank" rel="noreferrer">Recorded evidence: mainnet runs, receipts and attestations</a></li>
          <li><a href={tx(WORKER_PUBLISH_TX)} target="_blank" rel="noreferrer">The worker publish transaction on NearBlocks</a></li>
        </ul>
      </section>
    </div>
  );
}
