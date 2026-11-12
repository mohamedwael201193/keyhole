"use client";
import type { ReactNode } from "react";
import { SuccessCheck } from "@/components/motion";
import { Button } from "@/components/ui";
import { Icon, type ProgressStep } from "@/components/v7";
import { ProgressSteps } from "@/components/v7/ProgressSteps";

/**
 * The one result pattern for every transaction: it replaces the form inside its own card (never a page banner).
 * Progress: a title, a smooth bar, the current step in a few words. Success: a check mark, the amount, "Settled" and a transaction link.
 * Failure: one plain line and one button. Anything technical goes in a collapsed Details. Styles: app/ui.css (.ic-*).
 */

/** How far a list of steps has got, 0 to 1. The active step counts as half done, so the bar always moves. */
export function stepFraction(steps: ProgressStep[]): number {
  if (!steps.length) return 0.1;
  const v = steps.reduce((n, s) => n + (s.state === "done" ? 1 : s.state === "active" ? 0.5 : 0), 0);
  return Math.min(1, Math.max(0.08, v / steps.length));
}

export function Details({ children, label = "Details", testid }: { children: ReactNode; label?: string; testid?: string }) {
  return <details className="kh-details" data-testid={testid}><summary>{label}</summary>{children}</details>;
}

export function InCardProgress({ title, line, steps, fraction, testid = "trade-pending", lineTestid = "trade-pending-line", stepsTestid = "trade-steps" }: {
  title: string; line?: string; steps?: ProgressStep[]; fraction?: number; testid?: string; lineTestid?: string; stepsTestid?: string;
}) {
  const f = fraction ?? (steps ? stepFraction(steps) : 0.3);
  const current = steps?.find((s) => s.state === "active")?.label;
  return (
    <section className="ic ic-run" data-testid={testid} aria-busy="true">
      <p className="ic-title"><span className="spin" aria-hidden="true" />{title}</p>
      <div className="ic-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)} aria-label={title}><i style={{ width: `${Math.round(f * 100)}%` }} /></div>
      <p className="ic-sub" role="status" data-testid={lineTestid}>{line || current || "Working…"}</p>
      {steps && <Details label="Steps"><ProgressSteps steps={steps} label={title} testid={stepsTestid} /></Details>}
    </section>
  );
}

export function InCardSuccess({ amount, title = "Settled", link, children, actions, testid = "trade-out", status }: {
  /** The amount or trade in one line, for example "Traded 0.02 USDC → 0.004484 wNEAR". */
  amount: ReactNode; title?: string;
  link?: { href: string; label?: string; testid?: string } | null;
  children?: ReactNode; actions?: ReactNode; testid?: string; status?: string;
}) {
  return (
    <section className="ic ic-ok" data-testid={testid} data-status={status} role="status">
      <div className="ic-head">
        <span className="ic-check" aria-hidden="true"><SuccessCheck size={40} /></span>
        <div>
          <p className="ic-amount" data-testid={`${testid}-amount`}>{amount}</p>
          <p className="ic-sub"><b className="ic-word" data-testid={`${testid}-status`}>{title}</b>
            {link && <> · <a className="ic-link" href={link.href} target="_blank" rel="noreferrer" data-testid={link.testid ?? "tx-link"}>{link.label ?? "View transaction"} <Icon name="external" size={13} /><span className="v7-sr-only"> (opens in a new tab)</span></a></>}
          </p>
        </div>
      </div>
      {children}
      {actions && <div className="ic-actions">{actions}</div>}
    </section>
  );
}

export function InCardFailure({ reason, action, children, testid = "trade-failed" }: {
  reason: ReactNode; action?: { label: string; onClick?: () => void; href?: string; testid?: string };
  children?: ReactNode; testid?: string;
}) {
  return (
    <section className="ic ic-bad" data-testid={testid} role="alert">
      <p className="ic-line"><span className="ic-x" aria-hidden="true"><Icon name="x" size={16} /></span><span>{reason}</span></p>
      {action && (action.href
        ? <Button href={action.href} variant="secondary" size="sm" testid={action.testid}>{action.label}</Button>
        : <Button variant="secondary" size="sm" onClick={action.onClick} testid={action.testid}>{action.label}</Button>)}
      {children}
    </section>
  );
}
