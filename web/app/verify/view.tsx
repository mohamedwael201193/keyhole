"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Scene } from "@/components/Art";
import { useI18n } from "@/lib/i18n";
import { attestation, WORKER_PUBLISH_TX, WORKER_WASM_SHA256, tx } from "@/lib/config";
import { CALLS, PUBLISHED_INFO_CALL } from "@/lib/evidence";
import { b64, verifyQuote, type Dcap } from "@/lib/dcap";
import { bindingCheck, buildIndex, CALL_ID, evidenceOutput, fastfsCheck, fastfsUrl, outputCheck, PUBLISHED_WASM_SHA256, staticChecks, type Attestation, type Checks } from "@/lib/verify";

export function VerifyView({ initial }: { initial: string | null }) {
  const { t } = useI18n();
  const [id, setId] = useState(initial || PUBLISHED_INFO_CALL);
  const [dcap, setDcap] = useState<Dcap | null>(null);
  const [bind, setBind] = useState<Record<string, string> | null>(null);
  const [a, setA] = useState<Attestation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ck, setCk] = useState<Checks | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteErr, setPasteErr] = useState(false);
  const go = useCallback(async (cid: string) => {
    setErr(null); setA(null); setCk(null);
    if (/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(cid.trim())) { setErr("tx"); return; }
    if (!CALL_ID.test(cid.trim())) { setErr("bad_params"); return; }
    setBusy(true); setDcap(null); setBind(null);
    try {
      const r = await fetch(attestation(cid.trim()));
      if (!r.ok) throw new Error();
      const j = (await r.json()) as Attestation;
      setA(j);
      const st0 = staticChecks(j);
      const st = { ...st0, published: buildIndex(j.executed_wasm_sha256) >= 0 };
      setCk({ ...st, fastfs: null });
      const [f, binding, ev] = await Promise.all([fastfsCheck(j), bindingCheck(j), evidenceOutput(j.call_id)]);
      const output = ev ? await outputCheck(j, ev, "evidence") : null;
      setCk({ ...st, ...f, binding, output });
      try { setDcap(verifyQuote(b64(j.tdx_quote), { expectReportData: binding?.expected })); } catch { setDcap(null); }
      const bo = (ev && typeof ev === "object" ? (ev as { bind?: Record<string, string> }).bind : undefined) ?? null;
      setBind(bo);
    } catch { setErr("network"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void go(initial || PUBLISHED_INFO_CALL); }, [initial, go]);
  const ok = !!ck && ck.quote && ck.registered && ck.published && ck.fastfs === true && ck.binding?.match === true && ck.output?.match !== false && dcap?.ok === true;
  const bi = a ? buildIndex(a.executed_wasm_sha256) : -1;
  const checkPasted = async () => {
    if (!a || !ck) return;
    setPasteErr(false);
    try {
      const v = JSON.parse(pasted) as { output?: unknown };
      const out = v && typeof v === "object" && "output" in v ? v.output : v;
      setCk({ ...ck, output: await outputCheck(a, out, "pasted") });
    } catch { setPasteErr(true); }
  };
  const known = !!a && WORKER_WASM_SHA256.includes(a.executed_wasm_sha256.toLowerCase());
  const mark = (pass: boolean | null) => pass == null ? "…" : pass ? "✓" : "✕";
  const dot = (pass: boolean | null) => pass == null ? "wait" : pass ? "" : "bad";
  const six = ck ? [ck.quote, ck.registered, ck.fastfs === true, ck.published, ck.binding?.match === true, ck.output?.match !== false] : null;
  const tally = six && dcap ? six.filter(Boolean).length + dcap.checks.filter((c) => c.pass).length : null;
  return (
    <div className="page ver">
      <p className="eb">{t("verify.eyebrow")}</p>
      <h1>{t("verify.h1a")}<em>{t("verify.h1b")}</em></h1>
      <p className="lead">{t("verify.lead")}</p>
      <div className="tally" data-testid="tally" data-n={tally ?? ""}>
        <b className="tn">{tally ?? "·"}<span>/25</span></b>
        <div><b>{tally == null ? t("verify.tallyWait") : t("verify.tallyH", { n: tally })}</b><small>{t("verify.tallyD")}</small></div>
      </div>
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
          <div className="ck"><span className={`ok ${ck ? dot(ck.fastfs === true) : "wait"}`}>{ck ? mark(ck.fastfs) : "·"}</span><div><b>{t("verify.pub")}</b><small>{known && bi === 0 ? <a href={tx(WORKER_PUBLISH_TX)}>{t("verify.tx", { tx: WORKER_PUBLISH_TX })}</a> : a ? <a href={fastfsUrl(a.project_id, a.executed_wasm_sha256)}>wasm</a> : t("verify.pubD")}</small></div><span className="att">{ck?.fastfs ? t("verify.badgeFound") : "—"}</span></div>
          <div className="ck"><span className={`ok ${ck ? dot(ck.published) : "wait"}`}>{ck ? mark(ck.published) : "·"}</span><div><b>{t("verify.build")}</b><small data-testid="build-note">{bi > 0 ? t("verify.buildPrev", { hash: a!.executed_wasm_sha256.slice(0, 8), cur: PUBLISHED_WASM_SHA256.slice(0, 8) }) : t("verify.buildD", { hash: PUBLISHED_WASM_SHA256.slice(0, 8) })}</small></div><span className="att">{ck?.published ? (bi > 0 ? t("verify.badgePrev") : t("verify.badgeBuild")) : "—"}</span></div>
          <div className="ck" data-testid="ck-binding"><span className={`ok ${ck ? (ck.fastfs === null && !ck.binding ? "wait" : dot(ck.binding?.match ?? false)) : "wait"}`}>{ck ? (ck.binding ? mark(ck.binding.match) : ck.fastfs === null ? "…" : "✕") : "·"}</span><div><b>{t("verify.bind")}</b><small>{ck?.binding ? t("verify.bindD", { rd: ck.binding.inQuote.slice(0, 16) }) : t("verify.bindWait")}</small></div><span className="att">{ck?.binding?.match ? t("verify.badgeBound") : "—"}</span></div>
          <div className="ck" data-testid="ck-output"><span className={`ok ${ck?.output ? dot(ck.output.match) : ck && ck.fastfs !== null ? "opt" : "wait"}`}>{ck?.output ? mark(ck.output.match) : ck && ck.fastfs !== null ? "○" : "·"}</span><div><b>{t("verify.out")}</b><small>{ck?.output ? t(ck.output.match ? "verify.outOk" : "verify.outBad", { verdict: ck.output.verdict, src: t(ck.output.source === "evidence" ? "verify.srcEvidence" : "verify.srcPasted") }) : t("verify.outNone")}</small></div><span className="att" data-testid="output-verdict">{ck?.output?.match ? ck.output.verdict : "—"}</span></div>
          <details className="dcap" data-testid="dcap" data-ok={dcap ? String(dcap.ok) : "wait"} open={!!dcap && !dcap.ok}>
            <summary><span className={`ok ${dcap ? dot(dcap.ok) : "wait"}`}>{dcap ? mark(dcap.ok) : "·"}</span><b>{t("verify.dcapH")}</b><small data-testid="dcap-count">{dcap ? t("verify.dcapCount", { n: dcap.checks.filter((c) => c.pass).length, total: dcap.checks.length }) : "…"}</small></summary>
            {dcap && <ol>{dcap.checks.map((c) => <li key={c.id} data-pass={String(c.pass)}><span>{c.pass ? "✓" : "✕"}</span>{c.label}{c.detail ? <em className="mono"> {c.detail}</em> : null}</li>)}</ol>}
            {bind && <p className="mono dbind" data-testid="dcap-bind">{t("verify.bindReq", { token: bind.token_id ?? "—", req: (bind.req_sha256 ?? "").slice(0, 16), nonce: (bind.nonce ?? "").slice(0, 12) })}</p>}
            <p className="note">{t("verify.dcapNote")}</p>
          </details>
          {err && <p role="alert" className="note" style={{ color: "var(--coral)" }} data-testid="verify-error">{err === "tx" ? <>{t("verify.isTx")} <a href={tx(id.trim())} target="_blank" rel="noreferrer">{t("verify.openTx")}</a></> : err === "bad_params" ? t("verify.badId") : t("verify.fetchFail")}</p>}
          <div className="res">
            <div>
              <p className="mono" style={{ fontSize: 12, letterSpacing: ".14em", opacity: .8 }}>{t("verify.result")}</p>
              <b data-testid="verdict" data-match={ok ? "true" : "false"}>{ck?.fastfs === null && ck.registered ? "…" : ok ? t("verify.genuine") : t("verify.notYet")}</b>
            </div>
            <button className="btn" disabled={busy} data-testid="verify-btn" onClick={() => void go(id)}>{busy ? "…" : t("verify.again")}</button>
          </div>
          {a && ck && !ck.output?.match && (
            <form className="vpaste" onSubmit={(e) => { e.preventDefault(); void checkPasted(); }}>
              <label htmlFor="vout">{t("verify.pasteLabel")}</label>
              <textarea id="vout" className="input" rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"ok":false,"error":{...}}' spellCheck={false} />
              {pasteErr && <small style={{ color: "var(--coral)" }}>{t("verify.pasteErr")}</small>}
              <button className="btn b2" type="submit" disabled={!pasted.trim()}>{t("verify.pasteGo")}</button>
            </form>
          )}
          {a && ck && (
            <dl className="kv" style={{ marginTop: 22 }}>
              <dt>{t("verify.published")}</dt><dd className="mono" data-kind="hash">{ck.fastfsHash || "…"}</dd>
              <dt>{t("verify.executed")}</dt><dd className="mono" data-kind="hash">{a.executed_wasm_sha256}</dd>
              {(["project_id", "worker_measurement", "input_hash", "output_hash", "build_target"] as const).map((k) => {
                const hash = k === "worker_measurement" || k === "input_hash" || k === "output_hash";
                return <Fragment key={k}><dt>{k}</dt><dd className={hash || k === "project_id" ? "mono" : undefined} data-kind={hash ? "hash" : undefined}>{String(a[k])}</dd></Fragment>;
              })}
              {ck.binding && <><dt>report_data[0:32]</dt><dd className="mono" data-kind="hash">{ck.binding.inQuote}</dd><dt>{t("verify.recomputed")}</dt><dd className="mono" data-kind="hash">{ck.binding.expected}</dd></>}
              {a.caller_account_id && <><dt>caller</dt><dd className="mono">{a.caller_account_id}</dd></>}
              <dt>timestamp</dt><dd>{new Date(a.timestamp * 1000).toLocaleString(undefined, { timeZoneName: "short" })}</dd>
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
