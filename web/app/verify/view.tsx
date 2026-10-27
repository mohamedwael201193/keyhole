"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Scene } from "@/components/Art";
import { useI18n } from "@/lib/i18n";
import { attestation, WORKER_PUBLISH_TX, WORKER_WASM_SHA256, tx } from "@/lib/config";
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
    try {
      const r = await fetch(attestation(cid.trim()));
      if (!r.ok) throw new Error();
      const j = (await r.json()) as Attestation;
      setA(j);
      const st = staticChecks(j);
      setCk({ ...st, fastfs: null });
      const f = await fastfsCheck(j);
      setCk({ ...st, ...f });
    } catch { setErr("network"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (initial) void go(initial); }, [initial, go]);
  const ok = !!ck && ck.quote && ck.registered && ck.fastfs === true;
  const known = !!a && WORKER_WASM_SHA256.includes(a.executed_wasm_sha256.toLowerCase());
  const mark = (pass: boolean | null) => pass == null ? "…" : pass ? "✓" : "✕";
  const dot = (pass: boolean | null) => pass == null ? "wait" : pass ? "" : "bad";
  return (
    <div className="page ver">
      <p className="eb">{t("verify.eyebrow")}</p>
      <h1>{t("verify.h1a")}<em>{t("verify.h1b")}</em></h1>
      <p className="lead">{t("verify.lead")}</p>
      <div className="vg">
        <div className="seal"><Scene name="enclave" alt={t("land.enclAlt")} width={1152} height={864} /></div>
        <div className="card chk">
          <p className="eb" style={{ marginBottom: 10 }}>{t("verify.report")}</p>
          <form className="field" onSubmit={(e) => { e.preventDefault(); void go(id); }} style={{ marginBottom: 8 }}>
            <label htmlFor="cid" className="sr-only">call id</label>
            <input id="cid" className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder={t("verify.placeholder")} spellCheck={false} />
          </form>
          <div className="ck"><span className={`ok ${ck ? dot(ck.quote) : "wait"}`}>{ck ? mark(ck.quote) : "·"}</span><div><b>{t("verify.quote")}</b><small>{t("verify.quoteD")}{a ? ` · ${a.tdx_quote.length}` : ""}</small></div><span className="att">{ck?.quote ? t("verify.badgeAtt") : "—"}</span></div>
          <div className="ck"><span className={`ok ${ck ? dot(ck.registered && ck.fastfs === true) : "wait"}`}>{ck ? mark(ck.fastfs === null ? null : ck.registered && ck.fastfs === true) : "·"}</span><div><b>{t("verify.hash")}</b><small>{a?.executed_wasm_sha256 || t("verify.hashD")}</small></div><span className="att">{ck?.registered && ck.fastfs ? t("verify.badgeMatch") : "—"}</span></div>
          <div className="ck"><span className={`ok ${ck ? dot(ck.fastfs === true) : "wait"}`}>{ck ? mark(ck.fastfs) : "·"}</span><div><b>{t("verify.pub")}</b><small>{known ? <a href={tx(WORKER_PUBLISH_TX)}>{t("verify.tx", { tx: WORKER_PUBLISH_TX })}</a> : a ? <a href={fastfsUrl(a.project_id, a.executed_wasm_sha256)}>wasm</a> : t("verify.pubD")}</small></div><span className="att">{ck?.fastfs ? t("verify.badgeFound") : "—"}</span></div>
          <div className="ck"><span className={`ok ${ok ? "" : "wait"}`}>{ok ? "✓" : "·"}</span><div><b>{t("verify.signed")}</b><small>{t("verify.signedD")}</small></div><span className="att">{ok ? t("verify.badgeValid") : "—"}</span></div>
          <div className="ck"><span className={`ok ${ok ? "" : "wait"}`}>{ok ? "✓" : "·"}</span><div><b>{t("verify.nonce")}</b><small>{t("verify.nonceD")}</small></div><span className="att">{ok ? t("verify.badgeFresh") : "—"}</span></div>
          {err && <p role="alert" className="note" style={{ color: "var(--coral)" }} data-testid="verify-error">{err === "bad_params" ? t("verify.badId") : t("verify.fetchFail")}</p>}
          <div className="res">
            <div>
              <p className="mono" style={{ fontSize: 12, letterSpacing: ".14em", opacity: .8 }}>{t("verify.result")}</p>
              <b data-testid="verdict" data-match={ok ? "true" : "false"}>{ck?.fastfs === null && ck.registered ? "…" : ok ? t("verify.genuine") : t("verify.notYet")}</b>
            </div>
            <button className="btn" disabled={busy} data-testid="verify-btn" onClick={() => void go(id)}>{busy ? "…" : t("verify.again")}</button>
          </div>
          {a && ck && (
            <dl className="kv" style={{ marginTop: 22 }}>
              <dt>{t("verify.published")}</dt><dd>{ck.fastfsHash || "…"}</dd>
              <dt>{t("verify.executed")}</dt><dd>{a.executed_wasm_sha256}</dd>
              {(["project_id", "worker_measurement", "input_hash", "output_hash", "build_target"] as const).map((k) => (
                <Fragment key={k}><dt>{k}</dt><dd>{String(a[k])}</dd></Fragment>
              ))}
              <dt>timestamp</dt><dd>{new Date(a.timestamp * 1000).toLocaleString()}</dd>
            </dl>
          )}
          {a && <a className="btn b2" style={{ marginTop: 16 }} href={attestation(a.call_id)} target="_blank" rel="noreferrer">JSON ↗</a>}
        </div>
      </div>
      <section style={{ marginTop: 36 }}>
        <h2 className="eb">{t("verify.examples")}</h2>
        <div className="examples">
          {CALLS.map((x) => <button key={x.id} onClick={() => { setId(x.id); void go(x.id); }}>{x.label}</button>)}
        </div>
        <pre className="term" style={{ marginTop: 18 }}>{`H=$(curl -s ${attestation("<call_id>")} | jq -r .executed_wasm_sha256)
curl -s https://main.fastfs.io/keyhole-devmo.near/outlayer.near/$H.wasm | sha256sum
# tx ${WORKER_PUBLISH_TX}`}</pre>
      </section>
    </div>
  );
}
