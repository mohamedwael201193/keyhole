"use client";
import { useState } from "react";
import { attestation, CONTRACT_CODE_HASH, KEYS_CONTRACT, RPC_URL, WORKER_WASM_SHA256 } from "@/lib/config";
import { Badge, Spinner } from "@/components/ui";

type R = { ok: boolean; text: string } | null;

function Runner({ label, run, testid }: { label: string; run: () => Promise<{ ok: boolean; text: string }>; testid: string }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<R>(null);
  return (
    <div className="jrun" data-testid={testid} data-state={busy ? "running" : r ? (r.ok ? "pass" : "fail") : "idle"}>
      <button type="button" className="btn b2" disabled={busy} onClick={async () => { setBusy(true); setR(null); try { setR(await run()); } catch { setR({ ok: false, text: "The check could not reach the network. Try again, or use the link beside it." }); } finally { setBusy(false); } }}>
        {busy ? <><Spinner label="Checking" /> Checking…</> : r ? "Run again" : label}
      </button>
      {r && <p className="jrun-out" role="status"><Badge tone={r.ok ? "ok" : "bad"}>{r.ok ? "Pass" : "Fail"}</Badge> {r.text}</p>}
    </div>
  );
}

/** Step 1 in the browser: read the attestation and compare the hash of the code that ran with the current build. */
export function CheckBuild({ callId }: { callId: string }) {
  return <Runner testid="run-build" label="Check it here (2 s)" run={async () => {
    const a = await (await fetch(attestation(callId))).json() as { executed_wasm_sha256?: string };
    const h = String(a.executed_wasm_sha256 || "").toLowerCase();
    return h === WORKER_WASM_SHA256[0]
      ? { ok: true, text: `Intel's report says the code that ran has fingerprint ${h.slice(0, 8)}…, the current published build.` }
      : { ok: false, text: `The code that ran has fingerprint ${h.slice(0, 8) || "(none)"}, not the current build ${WORKER_WASM_SHA256[0].slice(0, 8)}.` };
  }} />;
}

/** Step 2 in the browser: NEAR RPC view_account, compare code_hash with the committed wasm's hash. */
export function CheckContract() {
  return <Runner testid="run-contract" label="Check it here (1 s)" run={async () => {
    const j = await (await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: KEYS_CONTRACT } }) })).json() as { result?: { code_hash?: string } };
    const ch = j.result?.code_hash ?? "";
    return ch === CONTRACT_CODE_HASH
      ? { ok: true, text: `NEAR reports code hash ${ch.slice(0, 8)}… for ${KEYS_CONTRACT}, the same as the wasm in the repo.` }
      : { ok: false, text: `NEAR reports ${ch.slice(0, 8) || "(none)"}…, the repo wasm hashes to ${CONTRACT_CODE_HASH.slice(0, 8)}…. The contract may have been upgraded since this page was built.` };
  }} />;
}
