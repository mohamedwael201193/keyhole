"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Medal } from "./Medal";
import { ASSETS, type AssetKey } from "@/lib/assets";

const KEYS = Object.keys(ASSETS) as AssetKey[];

/** Official mark, symbol and name. Arrow keys move, Enter selects, Escape closes. */
export function TokenPick({ id, value, onChange }: { id: string; value: AssetKey; onChange: (v: AssetKey) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(Math.max(0, KEYS.indexOf(value)));
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const asset = ASSETS[value];
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  function choose(k: AssetKey) { onChange(k); setOpen(false); }
  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(KEYS.length - 1, (open ? i : Math.max(0, KEYS.indexOf(value))) + (open ? 1 : 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); setOpen(true); }
    else if (e.key === "End") { e.preventDefault(); setActive(KEYS.length - 1); setOpen(true); }
    else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) choose(KEYS[active]); else setOpen(true);
    }
  }
  return (
    <div className="tpick" ref={root}>
      <button type="button" id={id} className="tpick-btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)} onKeyDown={onKey}>
        <Medal id={asset.logo} name={asset.symbol} labeled={false} />
        <span><b>{asset.symbol}</b><small>{asset.name}</small></span>
      </button>
      {open && (
        <ul id={listId} role="listbox" aria-labelledby={id} className="tpick-list">
          {KEYS.map((k, i) => {
            const a = ASSETS[k];
            return (
              <li key={k} id={`${id}-opt-${k}`} role="option" aria-selected={k === value} className={i === active ? "on" : ""} onMouseEnter={() => setActive(i)} onClick={() => choose(k)}>
                <Medal id={a.logo} name={a.symbol} labeled={false} />
                <span><b>{a.symbol}</b><small>{a.name}</small></span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
