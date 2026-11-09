"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/v7";
import { useKeyStore } from "@/lib/keyStore";
import { shortKeyId } from "@/lib/near";
import { CAPS, finishOf, keyIdentity, traitSeed } from "@/lib/traits";
import { PLEDGE_LIVE } from "@/lib/config";
import {
  PLEDGE_CTA_DISABLED,
  PLEDGE_PREVIEW_LABEL,
  createPledgeClient,
  type Loan,
} from "@/lib/pledgeClient";
import "./pledge.css";

const KEY_ART = "/heirloom/keys/k03.webp";
const USDC_ICON = "/tokens/usdc.svg";
const NEAR_ICON = "/tokens/near.svg";

type Mode = "form" | "active";

/**
 * Pledge dashboard (sketch v5 + red-team meaning fixes).
 * Flag OFF in production: labelled preview, no fake live balances or deadlines,
 * CTA disabled with audit copy. Token chips are locked to the v1 allowlist
 * (USDC floor, native NEAR loan) — no fake multi-asset selectors.
 * Lender preview never requests the holder balance.
 */
export function PledgeView() {
  const keys = useKeyStore();
  const client = useMemo(() => createPledgeClient(), []);
  const live = client.live && PLEDGE_LIVE;

  const [mode, setMode] = useState<Mode>("form");
  const [loan, setLoan] = useState<Loan | null>(null);
  const [loanStatus, setLoanStatus] = useState<"idle" | "loading" | "ready" | "none" | "error">("idle");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("preview") === "active") setMode("active");
  }, []);

  // When live, drive active chrome from contract state — never a hard-coded due date.
  useEffect(() => {
    if (!live || !keys.primary) {
      setLoan(null);
      setLoanStatus(live ? "idle" : "none");
      return;
    }
    let cancel = false;
    setLoanStatus("loading");
    client
      .getLoan(keys.primary.token_id)
      .then((L) => {
        if (cancel) return;
        setLoan(L);
        setLoanStatus(L ? "ready" : "none");
        if (L && (L.state === "Funded" || L.state === "Offered")) setMode("active");
      })
      .catch(() => {
        if (!cancel) setLoanStatus("error");
      });
    return () => {
      cancel = true;
    };
  }, [live, keys.primary, client]);

  const primary = keys.primary;
  const tier = keys.tier ?? 1;
  const artN = primary ? keyIdentity(primary.token_id, tier).art : 3;
  const keyThumb = `/heirloom/keys/k${String(artN).padStart(2, "0")}.webp`;
  const keyLabel = primary
    ? `${tier === 1 ? "Bronze" : `Tier ${tier}`} #${shortKeyId(primary.token_id)}`
    : "No key yet";
  const keySub = primary ? "Key selected · eligibility checked when live" : "Mint a key to pledge later";

  const finish = primary
    ? keyIdentity(primary.token_id, tier).finish
    : finishOf(tier, traitSeed("keyhole-devmo.near", "preview"));
  const caps = CAPS[finish];
  const capLine = `${finish} exit caps: $${caps.perTx} / trade · $${caps.daily} / day (lender recovery is not instant cash)`;

  const active = mode === "active";
  // Preview amounts are em dashes — never invented live figures. Live amounts come from loan.
  const floorDisplay = live && loan ? formatFloor(loan) : "—";
  const borrowDisplay = live && loan ? formatNear(loan.terms.principal) : "—";
  const repayDisplay = live && loan ? formatNear(loan.terms.repayment) : "—";
  const dueDisplay = live && loan ? formatDue(loan.due_ns) : "Due date comes from on-chain loan state";
  const lenderDisplay = live && loan ? loan.terms.lender : "—";
  const countdownLabel = live && loan ? hoursLeftLabel(loan.due_ns) : "—";

  return (
    <div className={`plg${active ? " is-active" : ""}`} data-testid="pledge-page" data-live={live ? "1" : "0"}>
      <div className="plg-ambient" aria-hidden="true">
        <div className="plg-blob a" />
        <div className="plg-blob b" />
        <div className="plg-blob c" />
      </div>

      <div className="plg-banner" data-testid="pledge-preview-banner" role="status">
        {live ? "Pledge · live wiring on" : PLEDGE_PREVIEW_LABEL}
      </div>

      <PageHeader
        eyebrow="Pledge"
        title={<>Borrow NEAR without publishing your <em>full balance</em></>}
        lead="Your lender sees one certified minimum, not the full balance while reviewing this offer."
      />

      <div className="plg-layout">
        <aside className="plg-howto" aria-label="How it works">
          <h3>How it works</h3>
          <ol>
            <li>
              <span className="n">1</span>
              <p>
                <strong>Pledge your key</strong>
                Freeze the vault. Disclose a USDC floor — keep the rest sealed from the lender while the offer is open.
              </p>
            </li>
            <li>
              <span className="n">2</span>
              <p>
                <strong>Borrow NEAR</strong>
                Named lender funds. Principal lands in your wallet.
              </p>
            </li>
            <li>
              <span className="n">3</span>
              <p>
                <strong>Repay or claim</strong>
                Repay by the on-chain due/grace rule, or the lender can claim the account.
              </p>
            </li>
          </ol>
          <p className="plg-caps" data-testid="pledge-caps">
            {capLine}
          </p>
        </aside>

        <div className="plg-stage">
          <div className="plg-float-key" aria-hidden="true" data-testid="pledge-float-key">
            <img src={KEY_ART} alt="" width={96} height={136} />
          </div>

          <div className="plg-widget" id="pledge-widget" data-testid="pledge-widget">
            <div className="plg-form-view" data-testid="pledge-form">
              <div className="plg-widget-head">
                <h3 className="plg-widget-h">Pledge</h3>
                <span className="plg-widget-meta">
                  Fixed term
                  <br />
                  sealed floor
                </span>
              </div>

              <div className="plg-key-chip" aria-label="Selected key" data-testid="pledge-key-chip">
                <span className="plg-key-thumb">
                  <img src={keyThumb} alt="" width={32} height={32} />
                </span>
                <span className="plg-tier-dot" title="Bronze" />
                <span className="id">
                  <b>{keyLabel}</b>
                  <small>{keySub}</small>
                </span>
              </div>

              <div className="plg-rows">
                <div className="plg-row" data-row="pledge">
                  <div className="plg-row-top">
                    <span className="plg-row-label">Certified USDC minimum</span>
                    <span className="plg-row-hint">Vault floor · sealed</span>
                  </div>
                  <div className="plg-row-main">
                    <div className="plg-amt" aria-label="Floor amount" data-testid="pledge-floor">
                      {floorDisplay}
                    </div>
                    {/* Locked chip — v1 allowlist only; not a fake asset picker. */}
                    <span className="plg-tok" aria-label="Floor token USDC (only asset supported for floor)">
                      <span className="plg-tok-ico">
                        <img src={USDC_ICON} alt="" />
                      </span>
                      <span className="plg-tok-id">
                        <b>USDC</b>
                        <small>NEAR · only</small>
                      </span>
                    </span>
                  </div>
                  <p className="plg-collateral" data-testid="pledge-collateral">
                    Entire account is collateral
                  </p>
                </div>

                <div className="plg-connector" aria-hidden="true">
                  <div className="plg-conn-badge">
                    <LockOpen />
                    <LockShut />
                  </div>
                </div>

                <div className="plg-row" data-row="borrow">
                  <div className="plg-row-top">
                    <span className="plg-row-label">You borrow</span>
                    <span className="plg-row-hint">Native NEAR · only</span>
                  </div>
                  <div className="plg-row-main">
                    <input
                      className="plg-amt"
                      value={borrowDisplay}
                      readOnly
                      aria-label="Principal"
                      data-testid="pledge-borrow"
                    />
                    <span className="plg-tok" aria-label="Borrow token NEAR (only loan asset)">
                      <span className="plg-tok-ico">
                        <img src={NEAR_ICON} alt="" />
                      </span>
                      <span className="plg-tok-id">
                        <b>NEAR</b>
                        <small>mainnet · only</small>
                      </span>
                    </span>
                  </div>
                </div>

                <div className="plg-repay" data-row="repay">
                  <span className="l">You repay</span>
                  <span className="v">
                    <span data-testid="pledge-repay">{repayDisplay}</span>{" "}
                    <img src={NEAR_ICON} alt="" /> NEAR
                  </span>
                  <span className="due" data-testid="pledge-due">
                    {dueDisplay}
                  </span>
                </div>
              </div>

              <div className="plg-lender">
                <span>Named lender</span>
                <span className="mono" data-testid="pledge-lender">
                  {lenderDisplay}
                </span>
              </div>
              <p className="plg-lender-note" data-testid="pledge-lender-privacy">
                Lender preview never requests your holder balance — only the sealed floor certificate when live.
              </p>

              <p className="plg-warn" data-testid="pledge-warn" role="note">
                Whole account is collateral: while pledged it can&apos;t trade, withdraw or transfer; miss repayment and
                the lender can claim the entire account.
              </p>

              <button
                type="button"
                className="plg-cta"
                data-testid="pledge-cta"
                disabled={!live}
                aria-disabled={!live}
                title={!live ? PLEDGE_CTA_DISABLED : undefined}
                onClick={() => {
                  if (!live) return;
                }}
              >
                {live ? "Open request & freeze account" : PLEDGE_CTA_DISABLED}
              </button>

              <div className="plg-sealed-wrap">
                <span className="plg-sealed">
                  <i className="dot" aria-hidden="true" />
                  Certified minimum only · full balance stays sealed from the lender while reviewing
                </span>
              </div>
            </div>

            <div className="plg-active-view" data-testid="pledge-active">
              <div className="plg-active-top">
                <h3 className="plg-widget-h">Active loan</h3>
                <span className="plg-active-status">
                  <i aria-hidden="true" /> {live && loan ? String(loan.state) : "Preview"}
                </span>
              </div>
              <div className="plg-active-key">
                <img src={keyThumb} alt="" width={40} height={40} />
                <div>
                  <div className="nm">{keyLabel}</div>
                  <div className="mt">Swap · withdraw · transfer · list locked</div>
                </div>
              </div>
              <div className="plg-countdown">
                <div className="plg-ring" aria-hidden="true">
                  <svg width="48" height="48" viewBox="0 0 56 56">
                    <circle className="plg-ring-bg" cx="28" cy="28" r="22" />
                    <circle className="plg-ring-fg" cx="28" cy="28" r="22" />
                  </svg>
                  <div className="plg-ring-lab" data-testid="pledge-countdown">
                    {countdownLabel}
                  </div>
                </div>
                <div className="plg-cd-text">
                  <p className="t" data-testid="pledge-active-due">
                    {live && loan ? dueDisplay : "Due date from contract state when live"}
                  </p>
                  <p className="s">
                    {live && loan
                      ? `Repay exactly ${repayDisplay} NEAR to unlock`
                      : "Amounts and due time come from get_loan — never hard-coded"}
                  </p>
                </div>
              </div>
              <div className="plg-active-grid">
                <div className="plg-active-cell">
                  <div className="k">Borrowed</div>
                  <div className="v">
                    {borrowDisplay} <img src={NEAR_ICON} alt="" />
                  </div>
                </div>
                <div className="plg-active-cell">
                  <div className="k">Floor sealed</div>
                  <div className="v">
                    {floorDisplay === "—" ? "—" : `≥ ${floorDisplay}`} <img src={USDC_ICON} alt="" />
                  </div>
                </div>
              </div>
              <p className="plg-warn plg-warn--compact" role="note">
                Trading and withdrawals stay stopped until repay or claim settles on-chain.
              </p>
              <button
                type="button"
                className="plg-cta"
                data-testid="pledge-repay-cta"
                onClick={() => {
                  if (!live) setMode("form");
                }}
              >
                {live ? (loan ? `Repay ${repayDisplay} NEAR` : "Repay") : "Back to preview form"}
              </button>
              <div className="plg-sealed-wrap" style={{ marginTop: 10 }}>
                <span className="plg-sealed">
                  <i className="dot" aria-hidden="true" />
                  Signature/terms vs current custody state are checked separately when live
                </span>
              </div>
              {loanStatus === "error" && (
                <p className="plg-caps" role="alert">
                  Could not read loan state from the contract.
                </p>
              )}
            </div>
          </div>

          <details className="plg-risks">
            <summary>FX · additional deposits · exit caps · Details</summary>
            <ul>
              <li>Debt is native NEAR; floor is raw USDC — no oracle, no LTV guarantee.</li>
              <li>Additional deposits while pledged still sit in the same account the lender can claim.</li>
              <li>{capLine}</li>
              <li>Default is a claim path with grace/recipient checks — not a browser timer seizure.</li>
            </ul>
          </details>

          {!live && (
            <div className="plg-morph-wrap">
              <button
                type="button"
                className="plg-morph"
                data-testid="pledge-preview-morph"
                onClick={() => setMode((m) => (m === "form" ? "active" : "form"))}
                aria-pressed={active}
              >
                {active ? "Show form preview" : "Preview active loan chrome"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LockOpen() {
  return (
    <svg className="open" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 11V8a4 4 0 0 1 8 0" />
      <rect x="5" y="11" width="14" height="10" rx="2" />
    </svg>
  );
}

function LockShut() {
  return (
    <svg className="shut" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <rect x="5" y="11" width="14" height="10" rx="2" />
    </svg>
  );
}

function formatNear(yocto: string): string {
  try {
    const n = BigInt(yocto);
    const whole = n / 10n ** 24n;
    const frac = n % 10n ** 24n;
    const f = frac.toString().padStart(24, "0").replace(/0+$/, "").slice(0, 6);
    return f ? `${whole}.${f}` : String(whole);
  } catch {
    return "—";
  }
}

function formatFloor(loan: Loan): string {
  try {
    const raw = BigInt(loan.terms.floor_raw);
    // USDC 6 decimals
    const whole = raw / 10n ** 6n;
    const frac = raw % 10n ** 6n;
    const f = frac.toString().padStart(6, "0").replace(/0+$/, "");
    return f ? `${whole}.${f}` : String(whole);
  } catch {
    return "—";
  }
}

/** Africa/Cairo label from due_ns when live; never invents a sketch date. */
function formatDue(dueNs: string): string {
  try {
    const ms = Number(BigInt(dueNs) / 1_000_000n);
    if (!Number.isFinite(ms) || ms <= 0) return "Due date pending on-chain state";
    const d = new Date(ms);
    const cairo = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).format(d);
    return `Due ${cairo}`;
  } catch {
    return "Due date from on-chain loan state";
  }
}

function hoursLeftLabel(dueNs: string): string {
  try {
    const ms = Number(BigInt(dueNs) / 1_000_000n);
    const left = ms - Date.now();
    if (!Number.isFinite(left)) return "—";
    if (left <= 0) return "due";
    const h = Math.floor(left / 3_600_000);
    if (h >= 24) return `${Math.floor(h / 24)}d`;
    return `${h}h`;
  } catch {
    return "—";
  }
}
