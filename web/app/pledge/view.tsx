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

/** Clearly labelled example terms for preview (flag OFF). Not live data. */
const EXAMPLE = {
  floorUsdc: "0.50",
  borrowNear: "0.01",
  repayNear: "0.0101",
  dueLabel: "Due Nov 12, 2026 · 23:59 UTC · example",
  lender: "lender-demo.near",
  termMeta: "72h term\nfixed repay",
  sealed: "Lender sees: floor ≥ 0.50 USDC · Balance: hidden",
} as const;

type Mode = "form" | "active";

/**
 * Pledge dashboard — sketch v5 look + red-team meaning.
 * Flag OFF: labelled Example preview (never claimed live). Locked USDC/NEAR chips.
 * Live: amounts/due from get_loan. Lender path never requests holder balance.
 */
export function PledgeView() {
  const keys = useKeyStore();
  const client = useMemo(() => createPledgeClient(), []);
  const live = client.live && PLEDGE_LIVE;

  const [mode, setMode] = useState<Mode>("form");
  const [loan, setLoan] = useState<Loan | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("preview") === "active") setMode("active");
  }, []);

  useEffect(() => {
    if (!live || !keys.primary) {
      setLoan(null);
      return;
    }
    let cancel = false;
    client.getLoan(keys.primary.token_id).then((L) => {
      if (cancel) return;
      setLoan(L);
      setMode(L?.state === "Active" ? "active" : "form");
    }).catch(() => {});
    return () => { cancel = true; };
  }, [live, keys.primary, client]);

  const primary = keys.primary;
  const tier = keys.tier ?? 1;
  const artN = primary ? keyIdentity(primary.token_id, tier).art : 3;
  const keyThumb = `/heirloom/keys/k${String(artN).padStart(2, "0")}.webp`;
  const keyLabel = primary
    ? `${tier === 1 ? "Bronze" : `Tier ${tier}`} #${shortKeyId(primary.token_id)}`
    : "Bronze #42";
  const keySub = primary ? "Eligible when Pledge goes live" : "Example key";

  const finish = primary
    ? keyIdentity(primary.token_id, tier).finish
    : finishOf(tier, traitSeed("keyhole-devmo.near", "preview"));
  const caps = CAPS[finish];

  const active = mode === "active";
  const floorDisplay = live && loan ? formatFloor(loan) : EXAMPLE.floorUsdc;
  const borrowDisplay = live && loan ? formatNear(loan.terms.principal) : EXAMPLE.borrowNear;
  const repayDisplay = live && loan ? formatNear(loan.terms.repayment) : EXAMPLE.repayNear;
  const dueDisplay = live && loan ? formatDue(loan.due_ns) : EXAMPLE.dueLabel;
  const lenderDisplay = live && loan ? loan.terms.lender : EXAMPLE.lender;
  const countdownLabel = live && loan ? hoursLeftLabel(loan.due_ns) : "71h";

  return (
    <div className={`plg${active ? " is-active" : ""}`} data-testid="pledge-page" data-live={live ? "1" : "0"}>
      <div className="plg-ambient" aria-hidden="true">
        <div className="plg-blob a" />
        <div className="plg-blob b" />
        <div className="plg-blob c" />
      </div>

      <div className="plg-inner">
        <div className="plg-layout">
          <div className="plg-left">
            <div
              className={`plg-banner${live ? " plg-banner--live" : ""}`}
              data-testid="pledge-preview-banner"
              role="status"
            >
              {live ? "Pledge · live wiring on" : "Example — preview · not live"}
            </div>

            <PageHeader
              eyebrow="Pledge"
              title={<>Borrow NEAR without publishing your <em>full balance</em></>}
              lead="Your lender sees one certified minimum, not the full balance while reviewing this offer."
            />

            <aside className="plg-howto" aria-label="How it works">
              <h3>How it works</h3>
            <ol>
              <li>
                <span className="n">1</span>
                <p>
                  <strong>Pledge your key</strong>
                  Freeze the vault. Disclose a USDC floor — keep the rest sealed.
                </p>
              </li>
              <li>
                <span className="n">2</span>
                <p>
                  <strong>Borrow NEAR</strong>
                  Funding starts debt and creates a NEAR claim. Withdraw it separately.
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
            <div className="plg-cap-row" data-testid="pledge-caps">
              <span className="plg-cap-k">{finish} exit caps</span>
              <span className="plg-cap-v">${caps.perTx}/trade · ${caps.daily}/day</span>
            </div>
            </aside>
          </div>

          <div className="plg-stage">
            <div className="plg-float-key" aria-hidden="true" data-testid="pledge-float-key">
              <img src={KEY_ART} alt="" width={120} height={170} />
            </div>

            <div className="plg-widget" data-testid="pledge-widget">
              <div className="plg-form-view" data-testid="pledge-form">
                <div className="plg-widget-head">
                  <h3 className="plg-widget-h">Pledge</h3>
                  <span className="plg-widget-meta">
                    {live ? "Fixed term" : "72h term"}
                    <br />
                    {live ? "sealed floor" : "fixed repay"}
                  </span>
                </div>

                <div className="plg-key-chip" data-testid="pledge-key-chip">
                  <span className="plg-key-thumb">
                    <img src={primary ? keyThumb : KEY_ART} alt="" width={36} height={36} />
                  </span>
                  <span className="plg-tier-dot" title={finish} />
                  <span className="id">
                    <b>{keyLabel}</b>
                    <small>{keySub}</small>
                  </span>
                </div>

                <div className="plg-rows">
                  <div className="plg-row" data-row="pledge">
                    <div className="plg-row-top">
                      <span className="plg-row-label">You pledge</span>
                      <span className="plg-row-hint">Certified floor · sealed</span>
                    </div>
                    <div className="plg-row-main">
                      <div className="plg-amt" data-testid="pledge-floor" aria-label="Floor amount">
                        {floorDisplay}
                      </div>
                      <span className="plg-tok" aria-label="USDC floor (only)">
                        <span className="plg-tok-ico">
                          <img src={USDC_ICON} alt="" />
                        </span>
                        <span className="plg-tok-id">
                          <b>USDC</b>
                          <small>NEAR</small>
                        </span>
                      </span>
                    </div>
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
                      <span className="plg-row-hint">To your wallet</span>
                    </div>
                    <div className="plg-row-main">
                      <input
                        className="plg-amt"
                        value={borrowDisplay}
                        readOnly
                        aria-label="Principal"
                        data-testid="pledge-borrow"
                      />
                      <span className="plg-tok" aria-label="NEAR loan (only)">
                        <span className="plg-tok-ico">
                          <img src={NEAR_ICON} alt="" />
                        </span>
                        <span className="plg-tok-id">
                          <b>NEAR</b>
                          <small>mainnet</small>
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="plg-repay">
                    <span className="l">You repay</span>
                    <span className="v">
                      <span data-testid="pledge-repay">{repayDisplay}</span>{" "}
                      <img src={NEAR_ICON} alt="" /> NEAR
                    </span>
                    <span className="due" data-testid="pledge-due">{dueDisplay}</span>
                  </div>
                </div>

                <div className="plg-meta-row">
                  <span className="plg-lender">
                    Named lender <span className="mono" data-testid="pledge-lender">{lenderDisplay}</span>
                  </span>
                  <span className="plg-ex" data-testid="pledge-example-tag">{live ? "" : "Example"}</span>
                </div>

                <p className="plg-warn" data-testid="pledge-warn" role="note">
                  Whole account is collateral — while pledged it can&apos;t trade, withdraw or transfer; miss repayment and the lender can claim it.
                </p>

                <button
                  type="button"
                  className="plg-cta"
                  data-testid="pledge-cta"
                  disabled={!live}
                  aria-disabled={!live}
                  title={!live ? PLEDGE_CTA_DISABLED : undefined}
                >
                  {live ? "Open request & freeze account" : PLEDGE_CTA_DISABLED}
                </button>

                <div className="plg-sealed-wrap">
                  <span className="plg-sealed">
                    <i className="dot" aria-hidden="true" />
                    {live ? "Certified minimum · full balance sealed from lender while reviewing" : EXAMPLE.sealed}
                  </span>
                </div>
              </div>

              <div className="plg-active-view" data-testid="pledge-active">
                <div className="plg-active-top">
                  <h3 className="plg-widget-h">Active loan</h3>
                  <span className="plg-active-status">
                    <i aria-hidden="true" /> {live && loan ? String(loan.state) : "Frozen"}
                  </span>
                </div>
                <div className="plg-active-key">
                  <img src={primary ? keyThumb : KEY_ART} alt="" width={44} height={44} />
                  <div>
                    <div className="nm">{keyLabel}</div>
                    <div className="mt">Swap · withdraw · transfer · list locked</div>
                  </div>
                </div>
                <div className="plg-countdown">
                  <div className="plg-ring" aria-hidden="true">
                    <svg width="56" height="56" viewBox="0 0 56 56">
                      <circle className="plg-ring-bg" cx="28" cy="28" r="22" />
                      <circle className="plg-ring-fg" cx="28" cy="28" r="22" />
                    </svg>
                    <div className="plg-ring-lab" data-testid="pledge-countdown">{countdownLabel}</div>
                  </div>
                  <div className="plg-cd-text">
                    <p className="t" data-testid="pledge-active-due">{dueDisplay}</p>
                    <p className="s">Repay exactly {repayDisplay} NEAR to unlock</p>
                  </div>
                </div>
                <div className="plg-active-grid">
                  <div className="plg-active-cell">
                    <div className="k">Borrowed</div>
                    <div className="v">{borrowDisplay} <img src={NEAR_ICON} alt="" /></div>
                  </div>
                  <div className="plg-active-cell">
                    <div className="k">Floor sealed</div>
                    <div className="v">≥ {floorDisplay} <img src={USDC_ICON} alt="" /></div>
                  </div>
                </div>
                <button
                  type="button"
                  className="plg-cta"
                  data-testid="pledge-repay-cta"
                  onClick={() => { if (!live) setMode("form"); }}
                >
                  {live ? `Repay ${repayDisplay} NEAR` : `Repay ${EXAMPLE.repayNear} NEAR`}
                </button>
                <div className="plg-sealed-wrap" style={{ marginTop: 12 }}>
                  <span className="plg-sealed">
                    <i className="dot" aria-hidden="true" />
                    Sealed proof still bound to this loan
                  </span>
                </div>
              </div>
            </div>

            <details className="plg-risks">
              <summary>Forfeiture · FX · frozen capital.</summary>
              <ul>
                <li>On default, the whole key and vault can move to the lender (claim path, not a browser timer).</li>
                <li>Debt is NEAR; floor is raw USDC — no oracle, no LTV.</li>
                <li>Exit caps: ${caps.perTx}/trade · ${caps.daily}/day — lender recovery is not instant cash.</li>
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
                  {active ? "Show form example" : "Preview active loan"}
                </button>
              </div>
            )}
          </div>
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
  } catch { return "—"; }
}
function formatFloor(loan: Loan): string {
  try {
    const raw = BigInt(loan.terms.floor_raw);
    const whole = raw / 10n ** 6n;
    const frac = raw % 10n ** 6n;
    const f = frac.toString().padStart(6, "0").replace(/0+$/, "");
    return f ? `${whole}.${f}` : String(whole);
  } catch { return "—"; }
}
function formatDue(dueNs: string): string {
  try {
    const ms = Number(BigInt(dueNs) / 1_000_000n);
    if (!Number.isFinite(ms) || ms <= 0) return "Due date pending on-chain state";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo", year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short",
    }).format(new Date(ms)).replace(/^/, "Due ");
  } catch { return "Due date from on-chain loan state"; }
}
function hoursLeftLabel(dueNs: string): string {
  try {
    const ms = Number(BigInt(dueNs) / 1_000_000n);
    const left = ms - Date.now();
    if (!Number.isFinite(left) || left <= 0) return "due";
    const h = Math.floor(left / 3_600_000);
    return h >= 24 ? `${Math.floor(h / 24)}d` : `${h}h`;
  } catch { return "—"; }
}

// Silence unused import in preview builds that tree-shake PREVIEW_LABEL from banner text
void PLEDGE_PREVIEW_LABEL;
