"use client";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";

type Row = { i?: number; hash?: string; kind?: string; owner?: string };

/** Public key log: owner chain and event hashes. Full rows stay on the signed history op. */
export function KeyLog({ tokenId }: { tokenId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [head, setHead] = useState("");

  async function load() {
    setOpen(true);
    setNote(null);
    const r = await fetch("/api/worker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "provenance", token_id: tokenId }) });
    const j = await r.json().catch(() => null);
    const code = j?.error?.code || j?.output?.error?.code;
    if (code === "unknown_op" || code === "bad_op") { setNote(t("vault.keyLogOld")); setRows([]); return; }
    const out = j?.output?.ok ? j.output : j?.ok ? j : null;
    if (!out) { setNote(t("vault.keyLogOld")); setRows([]); return; }
    setHead(String(out.head || ""));
    setRows(Array.isArray(out.events) ? out.events : []);
  }

  return (
    <div data-testid="key-log">
      <button type="button" className="btn b2 vbtn sec block" onClick={() => void load()}>{t("vault.keyLog")}</button>
      {open && note && <p className="note">{note}</p>}
      {open && rows && rows.length === 0 && !note && <p className="note">{t("vault.keyLogEmpty")}</p>}
      {open && rows && rows.length > 0 && (
        <div className="assets">
          {head && <p className="mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{head}</p>}
          {rows.map((row) => (
            <div className="arow plain" key={row.i ?? row.hash}>
              <div className="who"><b>{row.kind || "—"}</b><small>{row.owner || ""}</small></div>
              <div className="amt"><b>{(row.hash || "").slice(0, 12)}</b></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
