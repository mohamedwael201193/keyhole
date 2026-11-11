"use client";
import { Card, CardHeader, StatusChip } from "@/components/v7";
import { DEFAULT_PATH_RULES, LIEN_REFUSALS, formatNs, lienState } from "@/lib/lien";
import type { UseLien } from "./useLien";
import "./lien.css";

/** NEAR amount from yocto, exact, trailing zeros trimmed. */
export function nearFromYocto(y: string): string {
  if (!/^\d+$/.test(y)) return y;
  const n = BigInt(y);
  const whole = n / 10n ** 24n;
  const frac = (n % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Lien facts for one key. Presentational: the caller owns the read (useLien), so /key and /verify share one read. */
export function LienPanel({ lien, testid = "lien-panel" }: { lien: UseLien; testid?: string }) {
  if (!lien.tokenId) return null;
  const busy = lien.status === "loading";
  const s = lienState(lien.control, lien.loan, lien.config);
  const tone = lien.status !== "ready" ? "neutral" : s.locked ? "warn" : "success";
  const label = busy ? "Reading" : lien.status === "error" ? "Not read" : s.locked ? "Locked" : "Not locked";
  const loan = lien.loan;
  return (
    <Card as="section" className="lien" labelledBy="lien-h" testid={testid}>
      <CardHeader title="Lien" id="lien-h" meta={<StatusChip tone={tone} testid="lien-state">{label}</StatusChip>} />
      {lien.status === "error" && <p className="lien-note" role="alert" data-testid="lien-error">{lien.error}</p>}
      {busy && <p className="lien-note">Reading the final chain…</p>}
      {lien.status === "ready" && lien.control && (
        <>
          <dl className="lien-facts" data-testid="lien-facts">
            <dt>Owner</dt><dd className="mono">{lien.owner}</dd>
            <dt>Owner epoch</dt><dd>{lien.control.owner_epoch}</dd>
            <dt>Pledged</dt><dd data-testid="lien-pledged">{String(lien.control.pledged)}</dd>
            <dt>Listed</dt><dd>{String(lien.control.listed)}</dd>
            <dt>Transfer pending</dt><dd>{String(lien.control.transfer_pending)}</dd>
            <dt>Value operations pending</dt><dd>{lien.control.pending_value_ops}</dd>
            <dt>Collateral binding</dt><dd>{lien.binding ? (lien.binding.ready ? "ready" : "not ready") : "none on record"}</dd>
          </dl>
          <p className="lien-note" data-testid="lien-lending">{s.lendingLine}</p>

          {loan ? (
            <div className="lien-loan" data-testid="lien-loan">
              <h3 className="lien-h3">Loan #{loan.nonce} · {loan.state}</h3>
              <dl className="lien-facts">
                <dt>Borrower</dt><dd className="mono">{loan.borrower}</dd>
                <dt>Lender</dt><dd className="mono" data-testid="lien-lender">{loan.terms.lender}</dd>
                <dt>Principal</dt><dd>{nearFromYocto(loan.terms.principal)} NEAR</dd>
                <dt>Repayment</dt><dd>{nearFromYocto(loan.terms.repayment)} NEAR</dd>
                <dt>Duration</dt><dd>{loan.terms.duration_sec} s</dd>
                <dt>Grace</dt><dd>{loan.terms.grace_sec} s</dd>
                <dt>Floor (base units)</dt><dd>{loan.terms.floor_raw}</dd>
                <dt>Due</dt><dd>{loan.due_ns === "0" ? "not set until delivery" : formatNs(BigInt(loan.due_ns))}</dd>
              </dl>
              {loan.state === "Offered" && (
                <div className="lien-cert" data-testid="lien-cert">
                  <button type="button" className="kh-btn kh-btn--secondary kh-btn--sm" onClick={() => void lien.verifyCertificate()} disabled={lien.cert.status === "checking"}>
                    {lien.cert.status === "checking" ? "Checking certificate…" : "Verify the loan certificate"}
                  </button>
                  {lien.cert.message && <p className="lien-note" data-testid="lien-cert-result" data-status={lien.cert.status}>{lien.cert.message}</p>}
                  <p className="lien-note">This asks the enclave for the signed certificate and checks it here. Nothing is signed or sent.</p>
                </div>
              )}
            </div>
          ) : (
            <p className="lien-note" data-testid="lien-no-loan">No loan is recorded for this key.</p>
          )}

          {s.refusalsApply && (
            <div className="lien-refusals" data-testid="lien-refusals">
              <h3 className="lien-h3">While this lien is open, these actions are refused</h3>
              <table className="lien-table">
                <thead><tr><th>Action</th><th>Refused by</th><th>Code the system returns</th></tr></thead>
                <tbody>
                  {LIEN_REFUSALS.map((r) => (
                    <tr key={r.action} data-testid="lien-refusal-row">
                      <td>{r.action}</td>
                      <td>{r.refused_by}</td>
                      <td className="mono">{"message" in r ? r.message : r.code}<small className="lien-src">{r.source}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="lien-default" data-testid="lien-default">
            <h3 className="lien-h3">Default path</h3>
            {s.activeLoan && loan ? (
              <p className="lien-note">
                Only <span className="mono">{loan.terms.lender}</span> can move this key, and only by claim_default, after{" "}
                <b>{formatNs(s.defaultClaimableAtNs)}</b> (due + grace). Before that the contract returns &ldquo;default not due&rdquo;.
                The receiver must be external (&ldquo;distinct external receiver required&rdquo;). These terms are the borrower-signed terms shown above.
              </p>
            ) : (
              <p className="lien-note">No default path exists until a loan is Active. Repayment or cancellation ends the lien instead.</p>
            )}
            <ul className="lien-rules">
              {DEFAULT_PATH_RULES.map((r) => <li key={r.code}><span className="mono">{r.code}</span> — {r.meaning}</li>)}
            </ul>
          </div>
        </>
      )}
    </Card>
  );
}
