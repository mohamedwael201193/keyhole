"use client";
/**
 * Auto-running claim ↔ method ↔ live PASS/FAIL table for /verify (app shell).
 * Read-only RPC / Nearblocks / OutLayer only.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, StatusChip } from "@/components/v7";
import { Button } from "@/components/ui";
import { runEvidencePack, type LiveRow } from "@/lib/liveChecks";

function tone(ok: boolean | null): "success" | "error" | "warn" | "info" {
  if (ok === true) return "success";
  if (ok === false) return "error";
  return "warn";
}

export function EvidenceTable() {
  const [rows, setRows] = useState<LiveRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRows(await runEvidencePack());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Checks failed");
      setRows(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void run(); }, []);

  const pass = rows?.filter((r) => r.ok === true).length ?? 0;
  const total = rows?.length ?? 0;

  return (
    <Card as="section" className="ev-pack v7-rise" labelledBy="ev-pack-h" testid="evidence-pack">
      <CardHeader
        title="Live evidence pack"
        id="ev-pack-h"
        level={2}
        meta={rows ? <StatusChip tone={pass === total && total > 0 ? "success" : "warn"}>{pass}/{total} pass</StatusChip> : <StatusChip tone="info">Running</StatusChip>}
        action={<Button variant="secondary" size="sm" loading={busy} loadingLabel="Checking" onClick={() => void run()} testid="evidence-rerun">Re-check</Button>}
      />
      <p className="ev-lead">Each row is a claim, the exact public read used to check it, and the live result. No wallet. No signing.</p>
      {err && <p className="ev-err" role="alert" data-testid="evidence-error">{err}</p>}
      <div className="ev-table-wrap" role="table" aria-label="Evidence checks">
        <div className="ev-head" role="row">
          <span role="columnheader">Claim</span>
          <span role="columnheader">How checked</span>
          <span role="columnheader">Result</span>
        </div>
        {(rows ?? Array.from({ length: 7 }, (_, i) => null)).map((r, i) => (
          <div className="ev-row" role="row" key={r?.id ?? `skel-${i}`} data-testid={r ? `evidence-row-${r.id}` : undefined} data-ok={r ? String(r.ok) : undefined}>
            <span role="cell" className="ev-claim">
              {r ? r.claim : <span className="ev-skel" />}
              {r?.href ? <>{" "}<Link className="ev-link" href={r.href} target={r.href.startsWith("http") ? "_blank" : undefined} rel={r.href.startsWith("http") ? "noreferrer" : undefined}>Open</Link></> : null}
            </span>
            <span role="cell" className="ev-how"><code>{r ? r.how : "…"}</code></span>
            <span role="cell" className="ev-res">
              {r ? (
                <>
                  <StatusChip tone={tone(r.ok)}>{r.ok === true ? "PASS" : r.ok === false ? "FAIL" : "…"}</StatusChip>
                  <span className="ev-detail">{r.detail}</span>
                </>
              ) : <StatusChip tone="info">…</StatusChip>}
            </span>
          </div>
        ))}
      </div>
      <p className="ev-note">Judge claims machine: run <code>node judge/verify-claims.mjs</code> in the repo (644 claims; last recorded offline run 0 FAIL). This page re-checks the subset that a browser can read without cloning. The count is the current docs/claims.json length and changes when claims are regenerated.</p>
    </Card>
  );
}
