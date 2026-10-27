"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { PageHead } from "@/components/PageHead";
import { useI18n } from "@/lib/i18n";
import { attestation, WORKER_PUBLISH_TX } from "@/lib/config";
import { CALLS } from "@/lib/evidence";
import { CALL_ID, fastfsCheck, fastfsUrl, staticChecks, type Attestation, type Checks } from "@/lib/verify";

export function VerifyView({ initial }: { initial: string | null }) {
  const { t } = useI18n();
  const [id, setId] = useState(initial || CALLS[3].id);
  const [a, setA] = useState<Attestation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ck, setCk] = useState<Checks | null>(null);
  const go = useCallback(async (cid: string) => {
    setErr(null); setA(null); setCk(null);
    if (!CALL_ID.test(cid.trim())) { setErr("bad_params"); return; }
    setBusy(true);
    try { const r = await fetch(attestation(cid.trim())); if (!r.ok) throw new Error(); const j = (await r.json()) as Attestation; setA(j);
      const st = staticChecks(j); setCk({ ...st, fastfs: null }); const f = await fastfsCheck(j); setCk({ ...st, ...f }); }
    catch { setErr("network"); } finally { setBusy(false); }
  }, []);
  useEffect(() => { if (initial) void go(initial); }, [initial, go]);
  const ok = !!ck && ck.quote && ck.registered && ck.fastfs === true;
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <PageHead eyebrow="Intel TDX · OutLayer" title={t("verify.title")} sub={t("verify.sub")} />
      <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void go(id); }}>
        <label htmlFor="cid" className="sr-only">call id</label>
        <input id="cid" className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder={t("verify.placeholder")} spellCheck={false} />
        <button className="btn btn-signal shrink-0" disabled={busy} data-testid="verify-btn">{busy ? "…" : t("verify.go")}</button>
      </form>
      {err && <p role="alert" className="mt-4 text-red-300" data-testid="verify-error">{err === "bad_params" ? "Not a call id (uuid)." : "Could not fetch the attestation."}</p>}
      {a && ck && (
        <section className={`plate mt-8 p-6 ${ok ? "border-signal/60" : ck.fastfs === null ? "" : "border-red-500/60"}`} data-testid="verdict" data-match={ok}>
          <p className={`font-serif text-3xl ${ok ? "text-signal" : "text-red-300"}`}>{ck.fastfs === null && ck.registered ? "…" : ok ? "✓ " + t("verify.match") : "✕ " + t("verify.nomatch")}</p>
          <ul className="mt-4 grid gap-1 font-mono text-xs">
            <li>{ck.quote ? "✓" : "✕"} Intel TDX quote present ({a.tdx_quote.length} chars)</li>
            <li>{ck.registered ? "✓" : "✕"} registered wasm_hash == executed_wasm_sha256</li>
            <li>{ck.fastfs === null ? "…" : ck.fastfs ? "✓" : "✕"} sha256(FastFS bytes{ck.bytes ? `, ${ck.bytes.toLocaleString()} B` : ""}) == executed, computed in your browser · <a className="text-signal hover:underline" href={fastfsUrl(a.project_id, a.executed_wasm_sha256)}>wasm ↗</a></li>
          </ul>
          <dl className="mt-6 grid gap-3 font-mono text-xs sm:grid-cols-[180px_1fr]">
            <dt className="label">{t("verify.published")}</dt><dd className="break-all">{ck.fastfsHash || "…"}</dd>
            <dt className="label">{t("verify.executed")}</dt><dd className="break-all">{a.executed_wasm_sha256}</dd>
            {(["project_id", "worker_measurement", "input_hash", "output_hash", "build_target"] as const).map((k) => (<Fragment key={k}><dt className="label">{k}</dt><dd className="break-all">{String(a[k])}</dd></Fragment>))}
            <dt className="label">timestamp</dt><dd>{new Date(a.timestamp * 1000).toLocaleString()}</dd>
            <dt className="label">tdx_quote</dt><dd className="break-all">{a.tdx_quote.slice(0, 96)}… ({a.tdx_quote.length} b64 chars)</dd>
          </dl>
          <a className="btn btn-ghost mt-6" href={attestation(a.call_id)} target="_blank" rel="noreferrer">Raw JSON ↗</a>
        </section>
      )}
      <section className="mt-12">
        <h2 className="font-serif text-3xl">{t("verify.how")}</h2>
        <pre className="plate mt-4 overflow-x-auto p-4 font-mono text-xs leading-relaxed">{`H=$(curl -s ${attestation("<call_id>")} | jq -r .executed_wasm_sha256)
curl -s https://main.fastfs.io/keyhole-devmo.near/outlayer.near/$H.wasm | sha256sum   # must equal $H
# first worker release published on-chain: tx ${WORKER_PUBLISH_TX}`}</pre>
        <h3 className="label mt-8">{t("verify.examples")}</h3>
        <ul className="mt-3 flex flex-wrap gap-2">{CALLS.map((x) => <li key={x.id}><button className="btn btn-ghost font-mono text-xs" onClick={() => { setId(x.id); void go(x.id); }}>{x.label}</button></li>)}</ul>
      </section>
    </div>
  );
}
