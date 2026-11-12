"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, CopyBtn } from "@/components/ui";
import { SuccessCheck } from "@/components/motion";
import { intentTx } from "@/lib/config";
import { TxLink } from "./TxLink";
import { dashHref } from "@/lib/dashboardSections";

/**
 * Result of one transaction or attested call: pending, confirmed or failed.
 * Shows the NEAR Blocks link (with a second explorer and a copy button) for a chain transaction, and the attested call id
 * with a /verify link when there is one. `children` is a slot for anything else in the result, such as a key reveal.
 * Not wired into any page yet (P5).
 */
export type TxState = "pending" | "confirmed" | "failed";

const TITLE: Record<TxState, string> = {
  pending: "Waiting for the chain",
  confirmed: "Confirmed on NEAR",
  failed: "Not completed",
};

export function TxResult({ state, hash, intentHash, callId, title, reason, children, testid }: {
  state: TxState;
  /** NEAR transaction hash. Links to NEAR Blocks, with the second explorer beside it. */
  hash?: string;
  /** NEAR Intents hash (a swap's intent or deposit). Links to the intents explorer. */
  intentHash?: string;
  /** Attested call id from the enclave. Links to /verify. */
  callId?: string;
  title?: ReactNode;
  /** Plain reason, shown when the state is failed. */
  reason?: ReactNode;
  children?: ReactNode;
  testid?: string;
}) {
  return (
    <section className="kh-tx" data-state={state} data-testid={testid} role={state === "failed" ? "alert" : "status"} aria-live={state === "failed" ? undefined : "polite"}>
      <div className="kh-tx-head">
        {state === "pending" && <span className="khm-spin" aria-hidden="true" />}
        {state === "confirmed" && <span className="kh-tx-check"><SuccessCheck size={28} /></span>}
        {state === "failed" && <Badge tone="bad" testid={testid ? `${testid}-status` : undefined}>Failed</Badge>}
        {state === "pending" && <Badge tone="warn" testid={testid ? `${testid}-status` : undefined}>Pending</Badge>}
        {state === "confirmed" && <Badge tone="ok" testid={testid ? `${testid}-status` : undefined}>Confirmed</Badge>}
        <b>{title ?? TITLE[state]}</b>
      </div>

      {state === "failed" && reason && <p className="note">{reason}</p>}

      {hash && (
        <div className="kh-tx-row" data-testid="tx-hash-row">
          <span>Transaction</span>
          <TxLink hash={hash} />
          <CopyBtn value={hash} label="Copy hash" />
        </div>
      )}

      {intentHash && (
        <div className="kh-tx-row" data-testid="tx-intent-row">
          <span>Intents</span>
          <a href={intentTx(intentHash)} target="_blank" rel="noreferrer">View on the intents explorer ↗</a>
        </div>
      )}

      {callId && (
        <div className="kh-tx-row" data-testid="tx-call-row">
          <span>Attested call</span>
          <code>{callId}</code>
          <Link className="kh-tx-verify" href={dashHref(`/verify?call=${encodeURIComponent(callId)}`)} data-testid="tx-verify">Verify</Link>
        </div>
      )}

      {children}
    </section>
  );
}
