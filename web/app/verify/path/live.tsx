"use client";
import { useState } from "react";
import { attestation, CONTRACT_CODE_HASH, KEYS_CONTRACT, RPC_URL } from "@/lib/config";
import { fetchLiveRegistryClient } from "@/lib/liveRegistry";
import { currentIndex } from "@/lib/verify";
import { Badge } from "@/components/ui";
import { Button } from "@/components/ui/button";

type R = { ok: boolean; text: string } | null;

function Runner({ label, run, testid }: { label: string; run: () => Promise<{ ok: boolean; text: string }>; testid: string }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<R>(null);
  return (
    <div className="jrun" data-testid={testid} data-state={busy ? "running" : r ? (r.ok ? "pass" : "fail") : "idle"}>
      <Button variant="primary" loading={busy} loadingLabel="Checking" onClick={async () => { setBusy(true); setR(null); try { setR(await run()); } catch { setR({ ok: false, text: "The check could not reach the network. Try again, or use the link beside it." }); } finally { setBusy(false); } }}>
        {r ? "Run again" : label}
      </Button>
      {r && <p className="jrun-out" role="status"><Badge tone={r.ok ? "ok" : "bad"}>{r.ok ? "Pass" : "Fail"}</Badge> {r.text}</p>}
    </div>
  );
}

/** Step 1 in the browser: read the attestation and compare the hash of the code that ran with the live registry build. */
export function CheckBuild({ callId }: { callId: string }) {
  return <Runner testid="run-build" label="Check it here" run={async () => {
    const a = await (await fetch(attestation(callId))).json() as { executed_wasm_sha256?: string };
    const h = String(a.executed_wasm_sha256 || "").toLowerCase();
    // Compare with the live OutLayer registry (docs: Projects, active_version), not the repo pin, which can lag a republish.
    const live = await fetchLiveRegistryClient().then((r) => r.active_version).catch(() => null);
    const i = currentIndex(h, live);
    if (!live) return { ok: false, text: `The code that ran has fingerprint ${h.slice(0, 8) || "(none)"}. The live registry could not be read, so current or previous is unknown.` };
    return i === 0
      ? { ok: true, text: `Intel's report says the code that ran has fingerprint ${h.slice(0, 8)}…, the build active on the OutLayer registry now.` }
      : i > 0
        ? { ok: true, text: `Previous build: the code that ran has fingerprint ${h.slice(0, 8)}…, a genuine earlier published build, not the current worker ${live.slice(0, 8)}….` }
        : { ok: false, text: `The code that ran has fingerprint ${h.slice(0, 8) || "(none)"}, which is not a published build (live worker ${live.slice(0, 8)}…).` };
  }} />;
}

/** Step 2 in the browser: NEAR RPC view_account, compare code_hash with the committed wasm's hash. */
export function CheckContract() {
  return <Runner testid="run-contract" label="Check it here" run={async () => {
    const j = await (await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: KEYS_CONTRACT } }) })).json() as { result?: { code_hash?: string } };
    const ch = j.result?.code_hash ?? "";
    return ch === CONTRACT_CODE_HASH
      ? { ok: true, text: `NEAR reports code hash ${ch.slice(0, 8)}… for ${KEYS_CONTRACT}, the same as the wasm in the repo.` }
      : { ok: false, text: `NEAR reports ${ch.slice(0, 8) || "(none)"}…, the repo wasm hashes to ${CONTRACT_CODE_HASH.slice(0, 8)}…. The contract may have been upgraded since this page was built.` };
  }} />;
}
