"use client";
import { CardHeader, Card, StatusChip } from "@/components/v7";
import { TxLink } from "@/components/TxLink";
import { short, type KeyLogBody, type KeyEvent } from "@/lib/keylog";
import { LIEN_REFUSALS, DEFAULT_PATH_RULES, formatNs, lienState } from "@/lib/lien";
import { nearFromYocto } from "@/components/lien/LienPanel";
import type { UseLien } from "@/components/lien/useLien";
import type { SaleRead } from "@/components/keys/keyData";
import { describeChainEvent, type IndexedEvent } from "@/lib/chainEvents";

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

type Row = { key: string; title: string; detail: string; ev?: KeyEvent };

/** Log kinds the enclave writes (tee/worker: mint, transfer, level_up; deposit, withdraw, swap, copy from the vault). */
export function describeEvent(e: KeyEvent): { title: string; detail: string } {
  const tier = e.kind === "level_up" ? /level_up (\d+)->(\d+)/.exec(e.detail ?? "") : null;
  switch (e.kind) {
    case "mint": return { title: "Minted", detail: `to ${short(e.owner)}` };
    case "transfer": return { title: "Holder changed", detail: `now ${short(e.owner)}` };
    case "level_up": return tier
      ? { title: "Tier raised", detail: `tier ${tier[1]} → ${tier[2]}` }
      : { title: "Tier change", detail: "the tier amounts are sealed in this log" };
    case "deposit": return { title: "Deposit", detail: "amount private to the holder" };
    case "withdraw": return { title: "Paid out", detail: "amount private to the holder" };
    case "swap": return { title: "Swap", detail: "amount private to the holder" };
    case "copy": return { title: "Copy trade", detail: "amount private to the holder" };
    default: return { title: e.kind, detail: "entry from the enclave log" };
  }
}

/**
 * One timeline for a key. Log rows are the enclave's signed, hash-chained history (already checked by the page).
 * "Now" rows are the current contract state. Sale and loan rows are NEP-297 `keyhole` events read from the public index.
 */
export type ChainEventState =
  | { state: "loading"; events: IndexedEvent[] }
  | { state: "ready"; events: IndexedEvent[]; complete: true }
  | { state: "partial"; events: IndexedEvent[] }
  | { state: "unavailable"; events: IndexedEvent[] };

export function ChainEvents({ chainEvents, onRetry }: { chainEvents: ChainEventState; onRetry?: () => void }) {
  const rows = chainEvents.events.flatMap((e) => {
    const d = describeChainEvent(e);
    return d ? [{ e, d }] : [];
  });
  return (
    <>
      <h3 className="lien-h3">Sales and loans, from chain events</h3>
      {chainEvents.state === "loading" && <p className="kg-note" data-testid="timeline-events-loading">Reading NEP-297 sale and loan events.</p>}
      {chainEvents.state === "unavailable" && (
        <p className="kg-note" data-testid="timeline-events-unavailable">
          Sale and loan history is unavailable. Retry.{" "}
          {onRetry && <button type="button" className="linkbtn" onClick={onRetry} data-testid="timeline-events-retry">Retry</button>}
        </p>
      )}
      {chainEvents.state === "partial" && (
        <p className="kg-note" data-testid="timeline-events-partial">
          This scan did not cover every receipt page. An empty list is not a complete history. Retry.{" "}
          {onRetry && <button type="button" className="linkbtn" onClick={onRetry} data-testid="timeline-events-retry">Retry</button>}
        </p>
      )}
      {chainEvents.state === "ready" && rows.length === 0 && <p className="kg-note" data-testid="timeline-events-empty">No sale or loan event is recorded for this key.</p>}
      {rows.length > 0 && (
        <ol className="ktimeline" data-testid="timeline-events">
          {rows.map(({ e, d }) => (
            <li key={`${e.tx}-${e.event}`} data-testid="timeline-event" data-event={e.event}>
              <b>{d.title}</b>
              <span>{d.detail}</span>
              <span className="mono"><TxLink hash={e.tx}>{e.tx.slice(0, 8)}…</TxLink></span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export function KeyTimeline({ body, ownerNow, lien, listing, chainEvents, onRetry }: {
  body: KeyLogBody; ownerNow: string | null | undefined; lien: UseLien; listing: SaleRead;
  chainEvents: ChainEventState;
  onRetry?: () => void;
}) {
  const rows: Row[] = body.events.map((e) => {
    const d = describeEvent(e);
    return { key: `log-${e.i}`, title: d.title, detail: d.detail, ev: e };
  });
  const last = body.events.at(-1);
  const lagging = !!last && !!ownerNow && last.owner !== ownerNow;
  const s = lienState(lien.control, lien.loan, lien.config);
  const now: Row[] = [];
  if (ownerNow) now.push({ key: "now-owner", title: "Holder (contract)", detail: short(ownerNow) });
  if (listing && typeof listing === "object" && "price" in listing) {
    now.push({ key: "now-sale", title: "Listed for sale", detail: `${nearFromYocto(String((listing as { price: unknown }).price))} NEAR` });
  }
  if (lien.loan) {
    now.push({ key: "now-loan", title: `Loan #${lien.loan.nonce} (${lien.loan.state})`, detail: `lender ${short(lien.loan.terms.lender)}; principal ${nearFromYocto(lien.loan.terms.principal)} NEAR; repayment ${nearFromYocto(lien.loan.terms.repayment)} NEAR` });
  }
  if (lien.control?.pledged) now.push({ key: "now-pledged", title: "Lien", detail: s.activeLoan && lien.loan ? `default claimable by the lender after ${formatNs(s.defaultClaimableAtNs)}` : "pledged; no default path until the loan is Active" });

  return (
    <Card as="section" className="klog" labelledBy="timeline-h" testid="key-timeline">
      <CardHeader title="Timeline" id="timeline-h" meta={<StatusChip tone="neutral">{body.events.length} log rows</StatusChip>} />
      {lagging && (
        <p className="kg-note" data-testid="timeline-lag">Holder rows appear when the enclave next syncs. The contract already names {short(ownerNow!)} as holder; the last log row names {short(last!.owner)}.</p>
      )}
      <ol className="ktimeline" data-testid="timeline-log">
        {rows.map((r) => (
          <li key={r.key} data-testid="timeline-row" data-kind={r.ev?.kind}>
            <b>{r.title}</b>
            <span>{r.detail}</span>
            {r.ev && <span>{when(r.ev.ts_ms)}</span>}
            {r.ev && <span className="mono"><TxLink account={r.ev.owner}>{short(r.ev.owner)}</TxLink></span>}
          </li>
        ))}
      </ol>
      <h3 className="lien-h3">Now, from the contract</h3>
      <ol className="ktimeline" data-testid="timeline-now">
        {now.map((r) => <li key={r.key} data-testid="timeline-now-row"><b>{r.title}</b><span>{r.detail}</span></li>)}
        {now.length === 0 && <li>Nothing read from the contract yet.</li>}
      </ol>
      <ChainEvents chainEvents={chainEvents} onRetry={onRetry} />

      {s.refusalsApply && (
        <div data-testid="timeline-enforcement">
          <h3 className="lien-h3">While the lien is open, these refusals are in the source (not a full audit)</h3>
          <ul className="lien-rules">
            {LIEN_REFUSALS.map((r) => (
              <li key={r.action}><b>{r.action}</b> — <span className="mono">{"message" in r ? r.message : r.code}</span> ({r.refused_by.toLowerCase()})</li>
            ))}
          </ul>
          <p className="kg-note">
            The lender moves the key only through claim_default, after due + grace, under the borrower-signed terms
            {lien.loan ? ` (lender ${short(lien.loan.terms.lender)})` : ""}. Refusals: {DEFAULT_PATH_RULES.map((r) => r.code).join("; ")}.
          </p>
        </div>
      )}
    </Card>
  );
}
