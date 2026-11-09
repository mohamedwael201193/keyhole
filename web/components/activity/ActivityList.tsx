import { Button } from "@/components/ui";
import { Card, CardHeader, EmptyState, Icon, ListRow, StatusChip } from "@/components/v7";
import { chipOf, markOf, metaOf, pageNumbers, subOf, type OrderRow } from "./orders";

/**
 * "Recent activity": the search, the rows of the current page (five at a time) and the page buttons. Presentational: the page
 * owns the filters, the selection and the paging state, and passes the slice in.
 */
export type ActivityListProps = {
  items: OrderRow[];
  /** Rows after the status filter, the date range and the search (the count in the header). */
  matched: number;
  page: number;
  pages: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPage: (page: number) => void;
  query: string;
  onQuery: (q: string) => void;
  /** Shown instead of the rows when nothing matches. `clear` adds a button that resets the filters. */
  empty: { title: string; body: string; clear: boolean } | null;
  onClear: () => void;
};

export function ActivityList(p: ActivityListProps) {
  return (
    <Card as="section" labelledBy="act-list-h" testid="act-list-card" className="act-list-card">
      <CardHeader title="Recent activity" id="act-list-h" meta={`${p.matched} ${p.matched === 1 ? "order" : "orders"}`} />
      <div className="act-search" role="search">
        <Icon name="search" size={18} />
        <input
          type="search"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          placeholder="Search by tx, token, or amount…"
          aria-label="Search orders"
          data-testid="act-search"
          autoComplete="off"
        />
      </div>

      {p.empty ? (
        <EmptyState
          title={p.empty.title}
          body={p.empty.body}
          testid="act-empty"
          action={p.empty.clear ? <Button variant="secondary" size="sm" onClick={p.onClear} testid="act-clear">Clear filters</Button> : undefined}
        />
      ) : (
        <ol className="act-list" data-testid="act-list" aria-label="Orders">
          {p.items.map((row) => (
            <ActivityItem key={row.id} row={row} on={row.id === p.selectedId} onSelect={p.onSelect} />
          ))}
        </ol>
      )}

      {!p.empty && p.pages > 1 && <Pager page={p.page} pages={p.pages} onPage={p.onPage} />}
    </Card>
  );
}

function ActivityItem({ row, on, onSelect }: { row: OrderRow; on: boolean; onSelect: (id: string) => void }) {
  const chip = chipOf(row);
  const mark = markOf(row);
  return (
    <li
      className={`act-item${on ? " on" : ""}`}
      data-testid="settlement"
      data-deposit={row.kind === "live" ? row.id : undefined}
      data-kind={row.kind}
    >
      <ListRow
        icon={<Icon name={mark.icon} size={18} />}
        tone={mark.tone}
        title={<>{row.title}{on && <span className="v7-sr-only"> (selected)</span>}</>}
        sub={subOf(row)}
        value={<span data-status={row.status ?? "UNREAD"}><StatusChip tone={chip.tone}>{chip.label}</StatusChip></span>}
        meta={metaOf(row) || undefined}
        onClick={() => onSelect(row.id)}
        testid="act-row"
      />
    </li>
  );
}

/** Previous, the page numbers (with gaps), next. Each button is a real page change. */
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  return (
    <nav className="act-pages" aria-label="Pages" data-testid="act-pages">
      <button type="button" className="act-page-btn act-page-btn--prev" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page" data-testid="act-prev">
        <Icon name="chevron-right" size={18} />
      </button>
      {pageNumbers(page, pages).map((n, i) =>
        n === "gap" ? (
          <span key={`gap-${i}`} className="act-page-gap" aria-hidden="true">…</span>
        ) : (
          <button
            key={n}
            type="button"
            className={`act-page-btn${n === page ? " on" : ""}`}
            onClick={() => onPage(n)}
            aria-label={`Page ${n}`}
            aria-current={n === page ? "page" : undefined}
            data-testid={`act-page-${n}`}
          >
            {n}
          </button>
        ),
      )}
      <button type="button" className="act-page-btn" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page" data-testid="act-next">
        <Icon name="chevron-right" size={18} />
      </button>
    </nav>
  );
}
