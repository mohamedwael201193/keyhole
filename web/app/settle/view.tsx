"use client";
import { useMemo, useState } from "react";
import { statusOf } from "@/lib/oneclick";
import { RECORDED_FAILED } from "@/lib/settlements";
import { Card, CardHeader, FilterChips, Icon, PageHeader, StatusChip, type FilterItem } from "@/components/v7";
import { ActivityList } from "@/components/activity/ActivityList";
import { ActivityStats } from "@/components/activity/ActivityStats";
import { OrderDetails } from "@/components/activity/OrderDetails";
import { useOrderReads } from "@/components/activity/useOrderReads";
import {
  buildOrders, countsOf, filterOrders, pageSlice, RANGES, timeOf, type ChipTone, type FilterId, type RangeId,
} from "@/components/activity/orders";
import { AgentPanel } from "./agent";
import { PriceCheck } from "./price";
import "./settle.css";

/**
 * /settle, the Activity page. The page owns the state (status filter, date range, search, page, selected order); every rule is
 * in components/activity/orders.ts, and the live status comes from useOrderReads (one /api/oneclick read per listed order).
 * Counts and shares come from the real rows. An order that is still loading or unreadable is never counted as a status.
 */
const FILTER_EMPTY: Record<Exclude<FilterId, "all">, { title: string; body: string }> = {
  settled: { title: "No settled orders yet", body: "No order has settled among the orders read." },
  refunded: { title: "No refunded orders", body: "No order among the orders read was refunded." },
  failed: { title: "No failed orders", body: "No live 1Click order has failed. The recorded example below shows what a failed order looks like." },
};

export function SettleView() {
  const { reads, retry } = useOrderReads();
  const rows = useMemo(() => buildOrders(reads), [reads]);
  const counts = useMemo(() => countsOf(rows), [rows]);

  const [filter, setFilter] = useState<FilterId>("all");
  const [range, setRange] = useState<RangeId>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const matched = useMemo(() => filterOrders(rows, { filter, range, text: query, now }), [rows, filter, range, query, now]);
  const slice = pageSlice(matched, page);
  const current = matched.find((r) => r.id === selected) ?? matched[0] ?? null;
  const filtersOn = filter !== "all" || range !== "all" || query.trim() !== "";
  const undated = range === "all" ? 0 : rows.filter((r) => timeOf(r) === null).length;
  const pending = counts.loading + counts.unavailable;

  let empty: { title: string; body: string; clear: boolean } | null = null;
  if (matched.length === 0) {
    const note = pending ? " Orders that are not read yet are not counted here." : "";
    if (filter !== "all" && range === "all" && query.trim() === "") {
      empty = { ...FILTER_EMPTY[filter], body: FILTER_EMPTY[filter].body + note, clear: true };
    } else {
      empty = { title: "No orders match", body: `Nothing matches this ${filtersOn ? "filter, date range or search" : "view"}.`, clear: true };
    }
  }

  const chips: FilterItem<FilterId>[] = [
    { id: "all", label: "All activity", count: counts.total },
    { id: "settled", label: "Settled", count: counts.settled },
    { id: "refunded", label: "Refunded", count: counts.refunded },
    { id: "failed", label: "Failed", count: counts.failed },
  ];

  const pickFilter = (f: FilterId) => { setFilter(f); setPage(1); };
  const pickRange = (r: RangeId) => { setRange(r); setPage(1); setNow(Date.now()); };
  const typeQuery = (q: string) => { setQuery(q); setPage(1); };
  const clearAll = () => { setFilter("all"); setRange("all"); setQuery(""); setPage(1); setNow(Date.now()); };

  return (
    <div className="act" data-testid="activity-page">
      <PageHeader
        eyebrow="Activity"
        title={<>Real quotes. <em>Real settlements.</em></>}
        lead="Each order below was run by KEYHOLE on NEAR mainnet. Its status is read live from 1Click, and its proof is one click away."
        testid="act-head"
      />

      <div className="act-toolbar">
        <FilterChips items={chips} value={filter} onChange={pickFilter} label="Filter orders by status" testid="act-filters" />
        <label className="act-range">
          <span className="v7-sr-only">Date range</span>
          <select value={range} onChange={(e) => pickRange(e.target.value as RangeId)} data-testid="act-range">
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <Icon name="chevron-down" size={16} />
        </label>
      </div>

      {(counts.loading > 0 || undated > 0) && (
        <div className="act-notes">
          {counts.loading > 0 && (
            <p className="act-note">{counts.loading === 1 ? "One order is" : `${counts.loading} orders are`} still reading live status. The counts update as each read lands.</p>
          )}
          {undated > 0 && (
            <p className="act-note">{undated === 1 ? "One order has" : `${undated} orders have`} no readable time, so a bounded date range leaves {undated === 1 ? "it" : "them"} out.</p>
          )}
        </div>
      )}

      <ActivityStats counts={counts} />

      <div className="act-split">
        <ActivityList
          items={slice.items}
          matched={matched.length}
          page={slice.page}
          pages={slice.pages}
          selectedId={current?.id ?? null}
          onSelect={setSelected}
          onPage={setPage}
          query={query}
          onQuery={typeQuery}
          empty={empty}
          onClear={clearAll}
        />
        {current && <OrderDetails key={current.id} row={current} onRetry={retry} />}
      </div>

      <section className="act-extra">
        <RecordedFailed />
        <PriceCheck />
        <div className="settle act-agent">
          <AgentPanel />
        </div>
        <Legend />
      </section>
    </div>
  );
}

/** A recorded failed order, labelled as an example. It is not a live order and is not counted anywhere. */
function RecordedFailed() {
  return (
    <Card as="article" className="act-example" testid="recorded-failed" labelledBy="act-ex-h">
      <CardHeader title="Example only: the shape of a failed order" id="act-ex-h" />
      <div className="act-example-head">
        <p className="act-note">{RECORDED_FAILED.label}</p>
        <span data-status={RECORDED_FAILED.status}>
          <StatusChip tone="error">{statusOf(RECORDED_FAILED.status).label}</StatusChip>
        </span>
      </div>
      <p className="act-where"><b>Where the funds are:</b> {statusOf(RECORDED_FAILED.status).where}</p>
      <p className="act-note">{RECORDED_FAILED.note}</p>
    </Card>
  );
}

const LEGEND = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;
const LEGEND_TONE: Record<string, ChipTone> = { ok: "success", warn: "warn", bad: "error", wait: "info" };

/** What each 1Click status means, from the same table the rows use. */
function Legend() {
  return (
    <details className="act-legend">
      <summary>What each status means</summary>
      <ul>
        {LEGEND.map((k) => {
          const s = statusOf(k);
          return (
            <li key={k} data-status={k}>
              <StatusChip tone={LEGEND_TONE[s.tone] ?? "neutral"}>{s.label}</StatusChip>
              <span>{s.where}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
