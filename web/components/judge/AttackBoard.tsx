"use client";
/**
 * /attack — "Try to steal a key". Re-fetches real attested refusals and mainnet txs.
 * Every card labels live check vs recorded mainnet evidence. No wallet, no value moves.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, StatusChip, Icon } from "@/components/v7";
import { Button } from "@/components/ui";
import { ATTACK_CASES, checkAttestedRefusal, checkNearTx, type AttackCase, type LiveRow } from "@/lib/liveChecks";

type CaseState = { row: LiveRow | null; busy: boolean };

export function AttackBoard() {
  const [states, setStates] = useState<Record<string, CaseState>>(() =>
    Object.fromEntries(ATTACK_CASES.map((c) => [c.id, { row: null, busy: false }]))
  );
  const [running, setRunning] = useState(false);

  const runOne = async (c: AttackCase): Promise<LiveRow> => {
    if (c.kind === "tx" && c.txHash) {
      return checkNearTx(c.txHash, c.expected, c.expectTxSuccess !== false);
    }
    if (c.kind === "attestation" && c.callId && c.keyword) {
      return checkAttestedRefusal(c.callId, c.keyword, c.expected);
    }
    return { id: c.id, claim: c.expected, how: "n/a", ok: false, detail: "Misconfigured case" };
  };

  const runAll = async () => {
    setRunning(true);
    setStates((s) => Object.fromEntries(Object.keys(s).map((k) => [k, { ...s[k], busy: true }])));
    const results = await Promise.all(ATTACK_CASES.map(async (c) => {
      try {
        const row = await runOne(c);
        return [c.id, row] as const;
      } catch (e) {
        return [c.id, { id: c.id, claim: c.expected, how: "live", ok: false, detail: e instanceof Error ? e.message : "error" } as LiveRow] as const;
      }
    }));
    setStates((s) => {
      const next = { ...s };
      for (const [id, row] of results) next[id] = { row, busy: false };
      return next;
    });
    setRunning(false);
  };

  useEffect(() => { void runAll(); }, []);

  const pass = Object.values(states).filter((s) => s.row?.ok === true).length;
  const total = ATTACK_CASES.length;

  return (
    <div className="atk" data-testid="attack-board">
      <div className="atk-summary v7-card">
        <StatusChip tone={pass === total && !running ? "success" : "warn"}>{running ? "Running…" : `${pass}/${total} refusals confirmed`}</StatusChip>
        <Button variant="secondary" size="sm" loading={running} loadingLabel="Re-checking" onClick={() => void runAll()} testid="attack-rerun">Re-check all</Button>
      </div>

      <div className="atk-grid">
        {ATTACK_CASES.map((c) => {
          const st = states[c.id];
          const row = st?.row;
          return (
            <Card as="article" key={c.id} className="atk-card v7-rise" labelledBy={`atk-h-${c.id}`} testid={`attack-case-${c.id}`}>
              <CardHeader
                title={c.title}
                id={`atk-h-${c.id}`}
                level={2}
                meta={<StatusChip tone={c.kind === "tx" ? "info" : "warn"}>{c.kind === "tx" ? "Recorded mainnet tx · live re-fetch" : "Live attestation + evidence file"}</StatusChip>}
              />
              <dl className="atk-dl">
                <div><dt>Attempt</dt><dd>{c.attempt}</dd></div>
                <div><dt>Expected</dt><dd>{c.expected}</dd></div>
                <div>
                  <dt>Live result</dt>
                  <dd data-testid={`attack-result-${c.id}`}>
                    {st?.busy || !row ? (
                      <StatusChip tone="info">Checking…</StatusChip>
                    ) : (
                      <>
                        <StatusChip tone={row.ok ? "success" : "error"}>{row.ok ? "PASS" : "FAIL"}</StatusChip>
                        <span className="atk-detail">{row.detail}</span>
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>How</dt>
                  <dd><code className="atk-how">{row?.how ?? (c.kind === "tx" ? "Nearblocks tx index" : "OutLayer attestation by-call")}</code></dd>
                </div>
              </dl>
              <div className="atk-actions">
                {c.callId && (
                  <Link className="v7-card-link" href={`/verify?call=${encodeURIComponent(c.callId)}`} data-testid={`attack-verify-${c.id}`}>
                    Re-check quote <Icon name="arrow-up-right" size={14} />
                  </Link>
                )}
                {c.txHash && (
                  <a className="v7-card-link" href={`https://nearblocks.io/txns/${c.txHash}`} target="_blank" rel="noreferrer" data-testid={`attack-tx-${c.id}`}>
                    Open tx <Icon name="external" size={14} />
                  </a>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
