"use client";

import { useEffect, useState } from "react";
import { KEYS_CONTRACT, acct, tx, txAlt } from "@/lib/config";
import { createPledgeClient } from "@/lib/pledgeClient";
import {
  ATTESTATION_URL,
  EVIDENCE_VERIFIED_AT,
  LOAN_A,
  LOAN_B,
  LOAN_BORROWER,
  LOAN_COSTS,
  LOAN_COSTS_NOTE,
  LOAN_COSTS_NO_PROFIT,
  LOAN_LENDER,
  LOAN_TOKEN,
  LOAN_TOKEN_TITLE,
  RESERVES,
  VAULT_READS,
  formatLoanTime,
  shortAccount,
  shortHash,
  type LoanShowcase,
  type LoanTx,
} from "@/lib/loans";
import "./loans.css";

type LiveState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; lending: boolean; owner: string | null; loanOpen: boolean; at: number };

function cairoClock(at: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
}

/**
 * Loans showcase — the two real mainnet loans. Nothing here is a demo: every hash
 * was verified against the explorer, and the state panel reads the chain live.
 * Borrowing from the browser stays off; this page only shows what already happened.
 */
export function LoansShowcase() {
  const [liveState, setLiveState] = useState<LiveState>({ status: "loading" });

  useEffect(() => {
    let cancel = false;
    const client = createPledgeClient({ live: true });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("chain read timed out")), 10_000));
    void Promise.race([
      Promise.all([client.getPledgeConfig(), client.getOwner(LOAN_TOKEN), client.getLoan(LOAN_TOKEN)]),
      timeout,
    ])
      .then(([config, owner, loan]) => {
        if (cancel) return;
        setLiveState({ status: "ready", lending: config?.lending_enabled ?? false, owner, loanOpen: loan !== null, at: Date.now() });
      })
      .catch(() => {
        if (!cancel) setLiveState({ status: "error" });
      });
    return () => {
      cancel = true;
    };
  }, []);

  return (
    <div className="loans" data-testid="pledge-page" data-live="0">
      <header className="loans-hero" data-testid="loans-hero">
        <p className="loans-eyebrow">Loans · NEAR mainnet</p>
        <h1>Borrow against your key. If you don&apos;t repay, the lender gets the whole account.</h1>
        <p className="loans-sub">Two real loans on NEAR mainnet: one repaid, one defaulted.</p>
        <p className="loans-badges" aria-label="Loan facts">
          <span>NEAR mainnet</span>
          <span>Live data</span>
          <span>2 loans settled</span>
        </p>
      </header>

      <section className="loans-cards" aria-label="The two loans">
        <LoanCard loan={LOAN_A} testid="loan-card-a" />
        <LoanCard loan={LOAN_B} testid="loan-card-b" />
      </section>

      <section className="loans-safe" aria-label="Why it is safe" data-testid="loans-safe">
        <h2>Why it&apos;s safe</h2>
        <div className="loans-safe-grid">
          <a className="loans-tile" href={acct(KEYS_CONTRACT)} target="_blank" rel="noreferrer">
            <strong>The key is the collateral</strong>
            <span>The whole account backs the loan — not a fraction of it.</span>
            <em>Contract on NearBlocks →</em>
          </a>
          <a className="loans-tile" href={tx(LOAN_B.txs[3].hash)} target="_blank" rel="noreferrer">
            <strong>The contract enforces the default</strong>
            <span>No one has to chase repayment. When the loan defaults, the contract moves the key to the lender.</span>
            <em>The default claim on NearBlocks →</em>
          </a>
          <a className="loans-tile" href={ATTESTATION_URL} target="_blank" rel="noreferrer">
            <strong>Balances stay sealed</strong>
            <span>Only one floor is certified — 0.50 USDC or more. The rest of the balance never leaves the enclave.</span>
            <em>Live attestation →</em>
          </a>
        </div>
      </section>

      <section className="loans-live" aria-label="Live state" data-testid="loans-live-state">
        <h2>Live state</h2>
        {liveState.status === "loading" ? (
          <p role="status">Reading the chain…</p>
        ) : liveState.status === "error" ? (
          <>
            <p role="status">The chain read failed. Showing the last verified state ({EVIDENCE_VERIFIED_AT}):</p>
            <LiveRows lending={false} owner={LOAN_LENDER} loanOpen={false} />
          </>
        ) : (
          <>
            <LiveRows lending={liveState.lending} owner={liveState.owner} loanOpen={liveState.loanOpen} />
            <p className="loans-stamp">Read from chain at {cairoClock(liveState.at)} Cairo time.</p>
          </>
        )}
      </section>

      <section className="loans-history" aria-label="Account value over time" data-testid="loans-value-history">
        <h2>Account value over time</h2>
        <p className="loans-note">Historical attested reads — not current values.</p>
        <ol className="loans-vline">
          {VAULT_READS.map((r) => (
            <li key={r.valueUsdc}>
              <span className="loans-vdot" aria-hidden="true" />
              <div>
                <strong>{r.valueUsdc} USDC</strong>
                <span> · wNEAR {r.wnear}</span>
                <p>{r.date}</p>
              </div>
            </li>
          ))}
        </ol>
        <p>
          The 0.1 USDC move between the two reads is a withdrawal — a canary delivery to the developer wallet — not
          trading profit. No profit number is shown.
        </p>
      </section>

      <section className="loans-reserves" aria-label="Lender reserves" data-testid="loans-reserves">
        <h2>Lender reserves</h2>
        <p>
          Custody credit reported by the enclave worker at funding, {RESERVES.reportedAt}:{" "}
          <strong>{RESERVES.custodyCreditUsdc} USDC</strong> ({RESERVES.custodyCreditRaw} raw) against a{" "}
          {RESERVES.floorUsdc} USDC floor. This is TEE-internal accounting — <strong>not a live on-chain balance</strong>.
          A public balance read for this wallet id returns 0, because the wallet id is not a NEAR account.
        </p>
        <p className="loans-note">
          The shared custody contract holds {RESERVES.pooledUsdc} USDC pooled across all wallets (read 14 Nov 2026) —
          that total does not prove the per-wallet figure.
        </p>
      </section>

      <section className="loans-costs" aria-label="Costs" data-testid="loans-costs">
        <h2>Costs — measured, not estimated</h2>
        <table>
          <tbody>
            {LOAN_COSTS.map((c) => (
              <tr key={c.cost}>
                <th scope="row">{c.cost}</th>
                <td>{c.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="loans-note">{LOAN_COSTS_NOTE}</p>
        <p>{LOAN_COSTS_NO_PROFIT}</p>
      </section>

      <footer className="loans-footer" data-testid="loans-footer">
        <p>Loans ran through the KEYHOLE worker on mainnet. Borrowing from the browser opens in a later release.</p>
        <p className="loans-note">All 12 transaction hashes verified against the explorer, {EVIDENCE_VERIFIED_AT}.</p>
      </footer>
    </div>
  );
}

function LiveRows({ lending, owner, loanOpen }: { lending: boolean; owner: string | null; loanOpen: boolean }) {
  const ownerIsLender = owner === LOAN_LENDER;
  return (
    <dl className="loans-facts">
      <div>
        <dt>New loans</dt>
        <dd>{lending ? "Open" : "Off — paused after the two live runs"}</dd>
      </div>
      <div>
        <dt>Loan token owner</dt>
        <dd>
          {owner ? (
            <a href={acct(owner)} target="_blank" rel="noreferrer" title={owner}>
              {shortAccount(owner)}
            </a>
          ) : (
            "Unavailable"
          )}{" "}
          {ownerIsLender ? "— the lender" : owner ? "— not the lender" : ""}
        </dd>
      </div>
      <div>
        <dt>Open loan on the token</dt>
        <dd>{loanOpen ? "A loan is open" : "None — the last loan settled"}</dd>
      </div>
    </dl>
  );
}

function LoanCard({ loan, testid }: { loan: LoanShowcase; testid: string }) {
  const repaid = loan.outcome === "REPAID";
  return (
    <article className={`loans-card${repaid ? " loans-card--repaid" : " loans-card--defaulted"}`} data-testid={testid}>
      <header className="loans-card-head">
        <div>
          <p className="loans-eyebrow">Loan {loan.nonce === 1 ? "A" : "B"} · nonce {loan.nonce}</p>
          <h3>{LOAN_TOKEN_TITLE}</h3>
          <p className="loans-token mono" title={LOAN_TOKEN}>{LOAN_TOKEN}</p>
        </div>
        <span className={`loans-outcome${repaid ? " loans-outcome--repaid" : " loans-outcome--defaulted"}`}>
          {repaid ? "REPAID" : "DEFAULTED"}
        </span>
      </header>
      <dl className="loans-facts">
        <div>
          <dt>Borrower</dt>
          <dd>
            <a href={acct(LOAN_BORROWER)} target="_blank" rel="noreferrer" title={LOAN_BORROWER}>{shortAccount(LOAN_BORROWER)}</a>
          </dd>
        </div>
        <div>
          <dt>Lender</dt>
          <dd>
            <a href={acct(LOAN_LENDER)} target="_blank" rel="noreferrer" title={LOAN_LENDER}>{shortAccount(LOAN_LENDER)}</a>
          </dd>
        </div>
        <div>
          <dt>Principal</dt>
          <dd>{loan.principalNear} NEAR</dd>
        </div>
        <div>
          <dt>Repaid</dt>
          <dd>{repaid ? `${loan.repaidNear} NEAR` : "Not repaid — the loan defaulted"}</dd>
        </div>
        <div>
          <dt>Bond</dt>
          <dd>{loan.bondNear} NEAR returned</dd>
        </div>
        <div>
          <dt>Floor · term</dt>
          <dd>{loan.floorUsdc} USDC · {loan.term} + {loan.grace} grace</dd>
        </div>
      </dl>
      {!repaid ? (
        <p className="loans-default-note">
          Key transferred to lender · owner_epoch 0 → 1
        </p>
      ) : null}
      <ol className="loans-timeline" data-testid={repaid ? "loans-timeline-a" : "loans-timeline-b"}>
        {loan.txs.map((t, i) => (
          <TimelineNode key={t.hash} node={t} index={i} />
        ))}
      </ol>
      {!repaid ? (
        <div className="loans-keymove" aria-label="The key moved from borrower to lender">
          <span className="loans-keymove-from">Borrower</span>
          <span className="loans-keymove-track">
            <span className="loans-keymove-key" aria-hidden="true">⚿</span>
          </span>
          <span className="loans-keymove-to">Lender</span>
        </div>
      ) : null}
    </article>
  );
}

function TimelineNode({ node, index }: { node: LoanTx; index: number }) {
  return (
    <li
      className={`loans-node${node.status === "FAILED" ? " loans-node--failed" : ""}`}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <span className="loans-node-dot" aria-hidden="true" />
      <div className="loans-node-body">
        <p className="loans-node-name">
          <strong>{node.label}</strong>
          {node.status === "FAILED" ? <span className="loans-node-failed"> failed</span> : null}
        </p>
        <p>{node.plain}</p>
        <p className="loans-node-meta">
          <a href={tx(node.hash)} target="_blank" rel="noreferrer" title={node.hash}>
            {shortHash(node.hash)}
          </a>
          {" · "}
          <a href={txAlt(node.hash)} target="_blank" rel="noreferrer">
            Pikespeak
          </a>
          {" · "}
          <span>
            {formatLoanTime(node.timeUtc)} · block {node.block}
          </span>
        </p>
      </div>
    </li>
  );
}
