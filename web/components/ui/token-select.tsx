"use client";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { TokenIcon } from "@/components/TokenIcon";
import { formatTokenPrice } from "@/lib/amount";
import { chainName, chainRank } from "@/lib/tokens";
import { Modal } from "./modal";

/**
 * Token picker: a trigger showing the chosen token (24 px mark, symbol, chain), and a dialog with a search box, chain filter
 * chips, a row per token (mark, symbol, chain, USD price) and arrow-key navigation. Escape closes the picker only.
 * Styles: app/ui.css (.kh-token-*).
 */
export type TokenOption = {
  id: string;
  symbol: string;
  name: string;
  /** NEAR asset id, used for the real mark. */
  assetId?: string;
  /** 1Click chain id ("near", "eth", ...). Enables the chain filter when two or more chains are listed. */
  chain?: string;
  /** Display name of the chain. Derived from `chain` when not given. */
  chainName?: string;
  /** Contract address, searchable. */
  contract?: string | null;
  /** USD price of one token. Shown as a column when the key is present; null shows a dash. */
  price?: number | null;
  /** Formatted balance. Shown only when given. */
  balance?: string;
};

/** Case-insensitive match on symbol, name, chain, chain name, asset id and contract. An empty query keeps everything. Pure, so it is unit-tested. */
export function filterTokens(options: TokenOption[], query: string, chain?: string | null): TokenOption[] {
  const q = query.trim().toLowerCase();
  return options.filter((o) =>
    (!chain || o.chain === chain) &&
    (!q || [o.symbol, o.name, o.chain, o.chainName, o.assetId, o.contract].some((v) => v?.toLowerCase().includes(q))));
}

/** The chain filter chips: one per chain present, NEAR and the main chains first. Empty when every token is on one chain. */
export function chainChips(options: TokenOption[]): { id: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const o of options) if (o.chain && !seen.has(o.chain)) seen.set(o.chain, o.chainName ?? chainName(o.chain));
  if (seen.size < 2) return [];
  return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => chainRank(a.id) - chainRank(b.id) || a.label.localeCompare(b.label));
}

export function TokenSelect({ label, options, value, onChange, testid, notice }: {
  label: string;
  options: TokenOption[];
  value: string | null;
  onChange: (id: string) => void;
  testid?: string;
  /** A plain line shown under the search box, for example when the full list could not load. */
  notice?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();
  const current = options.find((o) => o.id === value) ?? null;
  const chips = useMemo(() => chainChips(options), [options]);
  const shown = useMemo(() => filterTokens(options, query, chain), [options, query, chain]);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  const close = () => { setOpen(false); setQuery(""); setChain(null); setActive(0); };
  const pick = (id: string) => { onChange(id); close(); };
  const move = (to: number) => {
    const n = shown.length;
    if (n === 0) return;
    const i = Math.max(0, Math.min(n - 1, to));
    setActive(i);
    rows.current[i]?.scrollIntoView?.({ block: "nearest" });
  };

  // Escape closes this picker and nothing else. Capture phase on document, so an enclosing sheet or dialog never sees the key.
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false); setQuery(""); setChain(null); setActive(0);
    };
    document.addEventListener("keydown", onEsc, true);
    return () => document.removeEventListener("keydown", onEsc, true);
  }, [open]);

  return (
    <>
      <button type="button" className="kh-token-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} data-testid={testid}>
        {current ? (
          <>
            <TokenIcon assetId={current.assetId} symbol={current.symbol} size={24} />
            <span className="kh-token-id"><b>{current.symbol}</b><small>{current.chainName ?? (current.chain ? chainName(current.chain) : current.name)}</small></span>
          </>
        ) : <span className="kh-token-none">Choose a token</span>}
        <span className="kh-token-caret" aria-hidden="true">▾</span>
        <span className="sr-only">{label}</span>
      </button>
      <Modal open={open} onClose={close} title={label} testid={testid ? `${testid}-dialog` : undefined}>
        <div className="kh-token-search">
          <input
            type="search"
            data-autofocus
            aria-label="Search tokens"
            placeholder="Search symbol, chain or contract"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); move(active + 1); }
              else if (e.key === "ArrowUp") { e.preventDefault(); move(active - 1); }
              else if (e.key === "Enter") { const o = shown[active]; if (o) { e.preventDefault(); pick(o.id); } }
            }}
            aria-controls={listId}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {chips.length > 0 && (
          <div className="kh-token-chips" role="group" aria-label="Filter by chain">
            <button type="button" className="kh-token-chip" aria-pressed={chain === null} onClick={() => { setChain(null); setActive(0); }}>All</button>
            {chips.map((c) => (
              <button key={c.id} type="button" className="kh-token-chip" aria-pressed={chain === c.id} onClick={() => { setChain(chain === c.id ? null : c.id); setActive(0); }}>{c.label}</button>
            ))}
          </div>
        )}
        {notice && <p className="kh-token-notice" role="status">{notice}</p>}
        <p className="kh-token-count" aria-live="polite">{shown.length === options.length ? `${options.length} tokens` : `${shown.length} of ${options.length} tokens`}</p>
        {shown.length === 0 ? (
          <p className="kh-token-empty">No token matches “{query.trim()}”.</p>
        ) : (
          <ul id={listId} className="kh-token-list" role="list">
            {shown.map((o, i) => (
              <li key={o.id}>
                <button
                  ref={(el) => { rows.current[i] = el; }}
                  type="button"
                  className={`kh-token-row${o.id === value ? " on" : ""}${i === active ? " is-active" : ""}`}
                  aria-current={o.id === value ? "true" : undefined}
                  data-active={i === active ? "true" : undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o.id)}
                  data-testid={testid ? `${testid}-option-${o.id}` : undefined}
                >
                  <TokenIcon assetId={o.assetId} symbol={o.symbol} size={24} />
                  <span className="kh-token-meta"><b>{o.symbol}</b><small>{o.chainName ?? (o.chain ? chainName(o.chain) : o.name)}</small></span>
                  <span className="kh-token-end">
                    {o.balance && <span className="kh-token-bal">{o.balance}</span>}
                    {o.price !== undefined && <span className="kh-token-price">{formatTokenPrice(o.price)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
