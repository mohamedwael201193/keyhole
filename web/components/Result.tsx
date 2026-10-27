"use client";
import { useEffect, useState } from "react";
import { errorText, useI18n } from "@/lib/i18n";
import type { WorkerResult } from "@/lib/worker";

export function ErrorBox({ code, vars, retryAfter }: { code: string; vars?: Record<string, string | number>; retryAfter?: number }) {
  const { locale } = useI18n();
  const [s, setS] = useState(retryAfter || 0);
  useEffect(() => { if (!s) return; const i = setInterval(() => setS((x) => Math.max(0, x - 1)), 1000); return () => clearInterval(i); }, [s]);
  const [msg, fix] = errorText(locale, code, { ...vars, s });
  return (
    <div role="alert" className="rounded border border-red-500/40 bg-red-950/30 p-4" data-testid="error" data-code={code}>
      <p className="font-medium text-red-200">{msg}</p><p className="mt-1 text-sm text-red-200/80">{fix}</p>
      <p className="mt-2 font-mono text-[11px] text-red-300/60">code: {code}</p>
    </div>
  );
}

export function Attested({ r }: { r: WorkerResult }) {
  const { t } = useI18n();
  if (!r.call_id) return null;
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-400" data-testid="attested">
      <span>{t("result.call")}: {r.call_id.slice(0, 8)}</span>
      {r.attestation_url && <a className="text-signal hover:underline" href={r.attestation_url} target="_blank" rel="noreferrer">{t("result.attestation")} ↗</a>}
      <a className="text-signal hover:underline" href={`/verify?call=${r.call_id}`}>verify</a>
      {r.time_ms != null && <span>{t("result.time")}: {r.time_ms} ms</span>}
    </p>
  );
}

/** Pulls cap value out of a worker message like "... per-trade cap $1.00" for the localized template. */
export function capFrom(message?: string) { return message?.match(/cap \$([\d.]+)/)?.[1] ? `$${message.match(/cap \$([\d.]+)/)![1]}` : "—"; }
