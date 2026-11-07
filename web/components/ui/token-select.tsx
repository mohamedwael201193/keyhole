"use client";
import { useId, useState } from "react";
import { TokenIcon } from "@/components/TokenIcon";
import { Modal } from "./modal";

/**
 * Token picker: a trigger button showing the selected token, and an accessible dialog with a search box, the real token
 * marks (TokenIcon) and, when given, the balance of each token. Styles: app/ui.css (.kh-token-*).
 */
export type TokenOption = {
  id: string;
  symbol: string;
  name: string;
  /** NEAR asset id or chain name, used for the real mark. */
  assetId?: string;
  chain?: string;
  /** Formatted balance. Shown only when given. */
  balance?: string;
};

/** Case-insensitive match on symbol, name and chain. An empty query returns every option. Pure, so it is unit-tested. */
export function filterTokens(options: TokenOption[], query: string): TokenOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => [o.symbol, o.name, o.chain].some((v) => v?.toLowerCase().includes(q)));
}

export function TokenSelect({ label, options, value, onChange, testid }: {
  label: string;
  options: TokenOption[];
  value: string | null;
  onChange: (id: string) => void;
  testid?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const current = options.find((o) => o.id === value) ?? null;
  const shown = filterTokens(options, query);
  const close = () => { setOpen(false); setQuery(""); };

  return (
    <>
      <button type="button" className="kh-token-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} data-testid={testid}>
        {current ? (
          <>
            <TokenIcon assetId={current.assetId} symbol={current.symbol} chain={current.chain} />
            <span><b>{current.symbol}</b><small>{current.name}</small></span>
          </>
        ) : <span className="kh-token-none">Choose a token</span>}
        <span className="kh-token-caret" aria-hidden="true">▾</span>
        <span className="sr-only">{label}</span>
      </button>
      <Modal open={open} onClose={close} title={label} testid={testid ? `${testid}-dialog` : undefined}>
        <div className="kh-token-search">
          <input
            type="search"
            aria-label="Search tokens"
            placeholder="Search by name or symbol"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-controls={listId}
            autoComplete="off"
          />
        </div>
        {shown.length === 0 ? (
          <p className="kh-token-empty">No token matches “{query.trim()}”.</p>
        ) : (
          <ul id={listId} className="kh-token-list" role="list">
            {shown.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className={`kh-token-row${o.id === value ? " on" : ""}`}
                  aria-current={o.id === value ? "true" : undefined}
                  onClick={() => { onChange(o.id); close(); }}
                  data-testid={testid ? `${testid}-option-${o.id}` : undefined}
                >
                  <TokenIcon assetId={o.assetId} symbol={o.symbol} chain={o.chain} />
                  <span className="kh-token-meta"><b>{o.symbol}</b><small>{o.name}</small></span>
                  {o.balance && <span className="kh-token-bal">{o.balance}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
