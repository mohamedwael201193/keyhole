"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { errorText, useI18n } from "@/lib/i18n";
import { EmptyState } from "./EmptyState";
import { OFFLINE_CODES } from "@/lib/useHealth";
import type { WorkerResult } from "@/lib/worker";

export function ErrorBox({ code, vars, retryAfter }: { code: string; vars?: Record<string, string | number>; retryAfter?: number }) {
  const [s, setS] = useState(retryAfter || 0);
  useEffect(() => { if (!s) return; const i = setInterval(() => setS((x) => Math.max(0, x - 1)), 1000); return () => clearInterval(i); }, [s]);
  if (OFFLINE_CODES.includes(code)) return <OfflineState />;
  const [msg, fix] = errorText(code, { ...vars, s });
  if (code === "metamask_next_enclave") {
    return (
      <div role="status" className="note-box" data-testid="metamask-next">
        <p>{msg}</p><p className="note">{fix}</p>
      </div>
    );
  }
  return (
    <div role="alert" className="errbox" data-testid="error" data-code={code}>
      <p>{msg}</p><p className="note">{fix}</p>
      <p className="mono" style={{ fontSize: 13, marginTop: 8 }}>code: {code}</p>
    </div>
  );
}

export function Attested({ r }: { r: WorkerResult }) {
  const { t } = useI18n();
  if (!r.call_id) return null;
  return (
    <p className="mono" style={{ marginTop: 12, fontSize: 13, color: "var(--mu)", display: "flex", flexWrap: "wrap", gap: "8px 16px" }} data-testid="attested">
      <span>{t("result.call")}: {r.call_id.slice(0, 8)}</span>
      {r.attestation_url && <a style={{ color: "var(--teal)" }} href={r.attestation_url} target="_blank" rel="noreferrer">{t("result.attestation")} ↗</a>}
      <a style={{ color: "var(--teal)" }} href={`/verify?call=${r.call_id}`}>Verify</a>
      {r.time_ms != null && <span>{t("result.time")}: {r.time_ms} ms</span>}
    </p>
  );
}

/** Pulls cap value out of a worker message like "... per-trade cap $1.00" for the localized template. */
export function capFrom(message?: string) { return message?.match(/cap \$([\d.]+)/)?.[1] ? `$${message.match(/cap \$([\d.]+)/)![1]}` : "—"; }

export function OfflineState() {
  const { t } = useI18n();
  return (
    <EmptyState tone="amber" title={t("offline.title")} body={t("offline.body")} testid="offline">
      <Link className="btn btn-ghost" href="/verify">{t("offline.verify")}</Link>
      <Link className="btn btn-ghost" href="/gallery">{t("offline.keys")}</Link>
    </EmptyState>
  );
}
