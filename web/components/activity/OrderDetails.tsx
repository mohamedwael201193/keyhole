"use client";
import { useState } from "react";
import { TokenMark } from "@/components/TokenMark";
import { Button, Proof } from "@/components/ui";
import { Card, CardHeader, CopyButton, Icon, Skeleton, StatusChip } from "@/components/v7";
import { dashHref } from "@/lib/dashboardSections";
import {
  chipOf, explorerHrefOf, markOf, proofHrefOf, proofRowsOf, rawJsonOf, shortHash, subOf, whereOf, summaryOf, timeOf, timelineOf,
  type StepState, type Timeline, type TimelineLink, type OrderRow,
} from "./orders";

/**
 * The Order details card for one order, one vault trade or one entry of "Your vault". The parent keys it by order id, so the raw
 * view resets on a new selection. Everything on it comes from the row: the live read, the recorded record, the signed history
 * entry, and the timeline rules.
 */
export function OrderDetails({ row, onRetry }: { row: OrderRow; onRetry: (address: string) => void }) {
  const [raw, setRaw] = useState(false);
  if (row.read.state === "signed") return <HistoryDetails row={row} />;
  const vault = row.kind === "vault";
  const chip = chipOf(row);
  const mark = markOf(row);
  const sum = summaryOf(row);
  const proof = proofHrefOf(row);
  const ext = explorerHrefOf(row);
  const timed = timeOf(row) !== null;

  return (
    <Card as="section" labelledBy="act-det-h" testid={vault ? "vault-trade" : "order-details"} className="act-details">
      <CardHeader
        title="Order details"
        id="act-det-h"
        action={
          <>
            {ext && (
              <a className="v7-icon-btn" href={ext} target="_blank" rel="noreferrer" title="Open in the explorer" aria-label="Open in the explorer (opens in a new tab)" data-testid="act-explorer">
                <Icon name="external" size={18} />
              </a>
            )}
            <CopyButton value={row.id} label={vault ? "Copy call ID" : "Copy deposit address"} testid="act-copy" />
          </>
        }
      />

      <div className="act-det-order">
        <span className={`act-det-ico tone-${mark.tone}`} aria-hidden="true"><Icon name={mark.icon} size={20} /></span>
        <div className="act-det-titles">
          <p className="act-det-title">{row.title} <span className="act-tag" data-testid="not-yours">{vault ? "Public example · not your trade" : "Public order · not yours"}</span></p>
          <p className="act-det-id">{vault ? "Call ID" : "Deposit address"} <code title={row.id}>{shortHash(row.id, 10, 6)}</code></p>
        </div>
        <span data-status={row.status ?? "UNREAD"}>
          <StatusChip tone={chip.tone} testid="st-badge">{chip.label}</StatusChip>
        </span>
      </div>

      <p className="act-where"><b>Where the funds are:</b> {whereOf(row)}</p>
      {row.settlement?.note && <p className="act-note">{row.settlement.note}</p>}

      {row.read.state === "loading" && <Skeleton lines={1} label="Reading the live status from 1Click" testid="act-loading" />}
      {row.read.state === "error" && (
        <p className="act-note act-alert" role="status" data-testid="act-unread">
          The live status could not be read.{" "}
          <Button variant="ghost" size="sm" onClick={() => onRetry(row.id)} testid="act-retry">Try again</Button>
        </p>
      )}

      <OrderTimeline tl={timelineOf(row)} />

      <dl className="act-kv">
        <div>
          <dt>From</dt>
          <dd>{sum.from ? <AssetLine symbol={sum.from.symbol} chainName={sum.from.chainName} chainId={sum.from.chainId} assetId={sum.from.assetId} amount={sum.from.amount} /> : "Not recorded"}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{sum.to ? <AssetLine symbol={sum.to.symbol} chainName={sum.to.chainName} chainId={sum.to.chainId} assetId={sum.to.assetId} /> : "Not recorded"}</dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd data-testid="act-received">{sum.received}</dd>
        </div>
        <div>
          <dt>{sum.updatedLabel}</dt>
          <dd data-testid={timed ? "st-updated" : undefined}>{sum.updated}</dd>
        </div>
      </dl>

      <div className="act-actions">
        {proof && (vault ? (
          <Button variant="primary" href={proof.href} testid="vault-trade-verify" icon={<Icon name="shield" size={16} />}>View proof</Button>
        ) : (
          <Button variant="primary" href={proof.href} target="_blank" rel="noreferrer" testid="act-view-proof" icon={<Icon name="arrow-up-right" size={16} />}>View proof</Button>
        ))}
        <Button variant="secondary" aria-expanded={raw} aria-controls="act-raw" onClick={() => setRaw((v) => !v)} testid="act-raw-toggle" icon={<Icon name="more" size={16} />}>
          {raw ? "Hide raw data" : "Raw data"}
        </Button>
      </div>
      <pre id="act-raw" className="act-raw" data-testid="act-raw" hidden={!raw}>{rawJsonOf(row)}</pre>

      <Proof rows={proofRowsOf(row)} testid="proof" />
    </Card>
  );
}

function AssetLine({ symbol, chainName, chainId, assetId, amount }: { symbol: string; chainName: string; chainId: string; assetId: string; amount?: string | null }) {
  return (
    <span className="act-asset">
      <TokenMark symbol={symbol} chain={chainId} assetId={assetId} size={24} />
      <span>{amount ? `${amount} ` : ""}{symbol} on {chainName}</span>
    </span>
  );
}

const WORD: Record<StepState, string> = { done: "Done", current: "In progress", todo: "Waiting", skipped: "Not reached" };

/** The order's steps: a vertical timeline. Each state comes from the status rules in ./orders.ts, never from a guess. */
function OrderTimeline({ tl }: { tl: Timeline }) {
  return (
    <ol className="act-tl" data-testid="funds-path" data-step={tl.step} data-refund={tl.refund ? "1" : "0"} aria-label="Order progress">
      {tl.steps.map((s) => (
        <li key={s.id} className={`act-tl-step ${s.state}`} data-state={s.state} data-testid={`act-tl-${s.id}`}>
          <span className="act-tl-mark" aria-hidden="true">
            {s.state === "done" && <Icon name="check" size={14} />}
            {s.state === "current" && <span className="v7-spin" />}
          </span>
          <span className="act-tl-body">
            <b>{s.title}</b>
            <small>{s.sub}</small>
            {s.links.length > 0 && (
              <span className="act-tl-links">
                {s.links.map((l) => <LinkPill key={`${l.label}-${l.hash}`} link={l} />)}
              </span>
            )}
          </span>
          <span className="act-tl-end">{s.amount && <span className="act-tl-amt">{s.amount}</span>}</span>
          <span className="v7-sr-only">{WORD[s.state]}</span>
        </li>
      ))}
    </ol>
  );
}

function LinkPill({ link }: { link: TimelineLink }) {
  const text = `${link.label} ${shortHash(link.hash)}`;
  if (!link.href) return <span className="v7-pill-link act-pill-static" title={link.hash}>{text}</span>;
  return (
    <a className="v7-pill-link" href={link.href} target="_blank" rel="noreferrer" title={link.hash}>
      <span>{text}</span>
      <Icon name="external" size={13} />
      <span className="v7-sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** A history entry of "Your vault": the entry's own fields, the verify link to its attested call, and its raw JSON. */
function HistoryDetails({ row }: { row: OrderRow }) {
  const [raw, setRaw] = useState(false);
  const chip = chipOf(row);
  const mark = markOf(row);
  const sum = summaryOf(row);
  const e = row.read.state === "signed" ? row.read.entry : null;
  const callId = row.read.state === "signed" ? row.read.callId : "";
  return (
    <Card as="section" labelledBy="act-det-h" testid="mine-details" className="act-details">
      <CardHeader
        title="Order details"
        id="act-det-h"
        action={<CopyButton value={callId} label="Copy call ID" testid="act-copy" />}
      />

      <div className="act-det-order">
        <span className={`act-det-ico tone-${mark.tone}`} aria-hidden="true"><Icon name={mark.icon} size={20} /></span>
        <div className="act-det-titles">
          <p className="act-det-title">{row.title} <span className="act-tag">Your vault</span></p>
          <p className="act-det-id">Call ID <code title={callId}>{shortHash(callId, 10, 6)}</code></p>
        </div>
        <span data-status={e?.status ?? "UNREAD"}>
          <StatusChip tone={chip.tone} testid="st-badge">{chip.label}</StatusChip>
        </span>
      </div>

      <p className="act-where"><b>About this entry:</b> {whereOf(row)}</p>

      <dl className="act-kv">
        <div>
          <dt>Amount</dt>
          <dd data-testid="mine-amount">{subOf(row)}</dd>
        </div>
        {e?.chain && (
          <div>
            <dt>Chain</dt>
            <dd>{e.chain}</dd>
          </div>
        )}
        <div>
          <dt>Status</dt>
          <dd>{e?.status ? String(e.status) : "No status recorded"}</dd>
        </div>
        <div>
          <dt>{sum.updatedLabel}</dt>
          <dd data-testid={timeOf(row) !== null ? "st-updated" : undefined}>{sum.updated}</dd>
        </div>
      </dl>

      <div className="act-actions">
        <Button variant="primary" href={dashHref(`/verify?call=${callId}`)} testid="mine-verify" icon={<Icon name="shield" size={16} />}>Verify the call</Button>
        <Button variant="secondary" aria-expanded={raw} aria-controls="act-raw" onClick={() => setRaw((v) => !v)} testid="act-raw-toggle" icon={<Icon name="more" size={16} />}>
          {raw ? "Hide raw data" : "Raw data"}
        </Button>
      </div>
      <pre id="act-raw" className="act-raw" data-testid="act-raw" hidden={!raw}>{rawJsonOf(row)}</pre>
    </Card>
  );
}
