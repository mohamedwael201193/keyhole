"use client";
import { Trust, TrustLegend } from "@/components/Trust";
import { attestChecks, verdict } from "@/lib/verifyScore";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Scene } from "@/components/Art";
import { useI18n } from "@/lib/i18n";
import { attestation, WORKER_PUBLISH_TX, tx } from "@/lib/config";
import { CALLS, PUBLISHED_INFO_CALL } from "@/lib/evidence";
import { fetchCollateral, pckInfo, quoteParts, verifyCollateral, type Pcs, type PcsInput } from "@/lib/pcs";
import { b64, verifyQuote, type Dcap } from "@/lib/dcap";
import { fetchLiveRegistry } from "@/lib/liveRegistry";
import { bindingCheck, buildIndex, localChecks, tamperAttestation, TAMPERS, type Tamper, CALL_ID, evidenceOutput, fastfsCheck, fastfsUrl, outputCheck, PUBLISHED_WASM_SHA256, staticChecks, type Attestation, type Checks } from "@/lib/verify";
import { CopyBtn, Spinner } from "@/components/ui";
import { Button } from "@/components/ui/button";
import "@/app/public-pages.css";

/** A real hash with a copy button. It wraps on phones and is never cut short. */
function HashVal({ v }: { v: string }) {
  return <span className="pp-hashval"><code>{v}</code><CopyBtn value={v} /></span>;
}

/** 6 attestation checks, 19 Intel DCAP checks on the quote, 12 Intel PCS collateral checks. */
export const TOTAL_CHECKS = 37;

export function CallVerifier({ initial }: { initial: string | null }) {
  const { t } = useI18n();
  const [id, setId] = useState(initial || PUBLISHED_INFO_CALL);
  const [dcap, setDcap] = useState<Dcap | null>(null);
  const [coll, setColl] = useState<PcsInput | "err" | null>(null);
  const [bind, setBind] = useState<Record<string, string> | null>(null);
  const [a, setA] = useState<Attestation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ck, setCk] = useState<Checks | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteErr, setPasteErr] = useState(false);
  const [orig, setOrig] = useState<{ a: Attestation; ck: Checks; dcap: Dcap | null } | null>(null);
  const [tampered, setTampered] = useState<Tamper | null>(null);
  const [liveHash, setLiveHash] = useState<string | null>(null);
  const tamper = async (k: Tamper | null) => {
    if (!orig) return;
    setTampered(k);
    if (!k) { setA(orig.a); setCk(orig.ck); setDcap(orig.dcap); return; }
    const x = tamperAttestation(orig.a, k);
    const c = await localChecks(x, orig.ck.fastfsHash);
    setA(x); setCk({ ...c, output: orig.ck.output });
    try { setDcap(verifyQuote(b64(x.tdx_quote), { expectReportData: c.binding?.expected })); } catch { setDcap(null); }
  };
  const go = useCallback(async (cid: string) => {
    setErr(null); setA(null); setCk(null); setOrig(null); setTampered(null); setColl(null);
    if (/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(cid.trim())) { setErr("tx"); return; }
    if (!CALL_ID.test(cid.trim())) { setErr("bad_params"); return; }
    setBusy(true); setDcap(null); setBind(null);
    try {
      const [r, live] = await Promise.all([
        fetch(attestation(cid.trim())),
        fetchLiveRegistry().catch(() => null),
      ]);
      if (!r.ok) throw new Error();
      const j = (await r.json()) as Attestation;
      const liveH = live?.active_version ?? null;
      setLiveHash(liveH);
      setA(j);
      const st0 = staticChecks(j, liveH);
      const st = { ...st0, published: buildIndex(j.executed_wasm_sha256, liveH) >= 0 };
      setCk({ ...st, fastfs: null });
      const [f, binding, ev] = await Promise.all([fastfsCheck(j), bindingCheck(j), evidenceOutput(j.call_id)]);
      const output = ev ? await outputCheck(j, ev, "evidence") : null;
      const full = { ...st, ...f, binding, output };
      setCk(full);
      let d: Dcap | null = null;
      try { d = verifyQuote(b64(j.tdx_quote), { expectReportData: binding?.expected }); } catch { d = null; }
      setDcap(d);
      setOrig({ a: j, ck: full, dcap: d });
      try { setColl(await fetchCollateral(pckInfo(quoteParts(b64(j.tdx_quote)).pck).fmspc)); } catch { setColl("err"); }
      const bo = (ev && typeof ev === "object" ? (ev as { bind?: Record<string, string> }).bind : undefined) ?? null;
      setBind(bo);
    } catch { setErr("network"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void go(initial || PUBLISHED_INFO_CALL); }, [initial, go]);
  const pcs: Pcs | null = useMemo(() => {
    if (!a || !coll || coll === "err") return null;
    try { return verifyCollateral(b64(a.tdx_quote), coll); } catch { return null; }
  }, [a, coll]);
  const vd = ck ? verdict(ck, a ? buildIndex(a.executed_wasm_sha256, liveHash) : -1, dcap?.ok === true, pcs?.ok === true) : "no";
  const ok = vd !== "no";
  const bi = a ? buildIndex(a.executed_wasm_sha256, liveHash) : -1;
  const currentHash = liveHash ?? PUBLISHED_WASM_SHA256;
  const checkPasted = async () => {
    if (!a || !ck) return;
    setPasteErr(false);
    try {
      const v = JSON.parse(pasted) as { output?: unknown };
      const out = v && typeof v === "object" && "output" in v ? v.output : v;
      setCk({ ...ck, output: await outputCheck(a, out, "pasted") });
    } catch { setPasteErr(true); }
  };
  const known = !!a && buildIndex(a.executed_wasm_sha256, liveHash) >= 0;
  const mark = (pass: boolean | null) => pass == null ? "…" : pass ? "✓" : "✕";
  const dot = (pass: boolean | null) => pass == null ? "wait" : pass ? "" : "bad";
  const six = ck ? attestChecks(ck) : null;
  const partial = six && dcap ? six.filter(Boolean).length + dcap.checks.filter((c) => c.pass).length : null;
  const pcsDown = coll === "err" && partial != null;
  const total = six && dcap && pcs ? six.length + dcap.checks.length + pcs.checks.length : TOTAL_CHECKS;
  const tally = six && dcap && pcs ? six.filter(Boolean).length + dcap.checks.filter((c) => c.pass).length + pcs.checks.filter((c) => c.pass).length : null;
  const rstate = !ck || (ck.fastfs === null && ck.registered) || pcsDown ? "wait" : vd === "current" ? "ok" : vd === "previous" ? "previous" : "bad";
  return (
    <div className="ver pp pp-verify vf-call">
      <p className="eb vf-call-only">{t("verify.eyebrow")}</p>
      <h2 className="vf-call-h">{t("verify.h1a")}<em>{t("verify.h1b")}</em></h2>
      <p className="lead vf-call-only">{t("verify.lead")}</p>
      <div className="tally" data-testid="tally" data-n={tally ?? ""}>
        <b className="tn">{tally ?? "·"}<span>/{total}</span></b>
        <div><b data-testid="tally-head">{tally != null ? t("verify.tallyH", { n: tally, total }) : pcsDown ? t("verify.pcsDown", { n: partial ?? 0 }) : busy ? <span data-testid="verify-running"><Spinner label="Checking" /> Checking in your browser… {six ? six.filter(Boolean).length + (dcap ? dcap.checks.filter((c) => c.pass).length : 0) : 0} of {total} done</span> : t("verify.tallyWait")}</b><small>{t("verify.tallyD")}</small></div>
        <span className="pp-meter" aria-hidden="true"><i style={{ width: `${tally != null ? (tally / total) * 100 : 0}%` }} /></span>
      </div>
      <div className="res" data-state={rstate}>
        <div>
          <p>{t("verify.result")}</p>
          <b data-testid="verdict" data-match={vd === "current" ? "true" : vd === "previous" ? "previous" : "false"}>{ck?.fastfs === null && ck.registered ? "…" : vd === "previous" ? t("verify.genuinePrev") : ok ? t("verify.genuine") : tampered ? t("verify.tamperFail") : pcsDown ? t("verify.pcsDownV") : t("verify.notYet")}</b>
        </div>
        <Button variant="secondary" testid="verify-btn" loading={busy} loadingLabel="Checking" onClick={() => void go(id)}>{t("verify.again")}</Button>
      </div>
      {/* Separate judge verdicts — one chip each, no combined PASS that hides a miss. */}
      <ul className="vf-verdicts" data-testid="verify-verdicts" aria-label="Separate check verdicts">
        <li data-testid="verdict-quote" data-ok={dcap ? String(dcap.ok && !!ck?.quote) : "wait"}><span className={`ok ${dcap ? (dcap.ok && ck?.quote ? "" : "bad") : "wait"}`}>{dcap ? (dcap.ok && ck?.quote ? "✓" : "✕") : "·"}</span><b>Quote validity</b><small>TDX quote + 19 Intel DCAP checks</small></li>
        <li data-testid="verdict-binding" data-ok={ck?.binding ? String(ck.binding.match) : "wait"}><span className={`ok ${ck?.binding ? (ck.binding.match ? "" : "bad") : "wait"}`}>{ck?.binding ? (ck.binding.match ? "✓" : "✕") : "·"}</span><b>Output binding</b><small>report_data binds request hash / account / token</small></li>
        <li data-testid="verdict-econ" data-ok={ck?.output ? String(ck.output.match) : (ck && ck.fastfs !== null ? "opt" : "wait")}><span className={`ok ${ck?.output ? (ck.output.match ? "" : "bad") : ck && ck.fastfs !== null ? "opt" : "wait"}`}>{ck?.output ? (ck.output.match ? "✓" : "✕") : ck && ck.fastfs !== null ? "○" : "·"}</span><b>Economic semantics</b><small>{ck?.output ? `Recorded outcome: ${ck.output.verdict}` : "Evidence / pasted output vs attestation"}</small></li>
        <li data-testid="verdict-build" data-ok={ck ? String(ck.published && bi === 0) : "wait"}><span className={`ok ${ck ? (ck.published && bi === 0 ? "" : bi > 0 ? "opt" : "bad") : "wait"}`}>{ck ? (ck.published && bi === 0 ? "✓" : bi > 0 ? "prev" : "✕") : "·"}</span><b>Current-build identity</b><small>{a ? `executed ${a.executed_wasm_sha256.slice(0, 8)}… · current ${currentHash.slice(0, 8)}…` : "Wasm vs the live registry"}</small></li>
      </ul>
      <div className="vg">
        <div className="seal"><Scene name="enclave" alt={t("land.enclAlt")} width={1152} height={864} /></div>
        <div className="card chk">
          <p className="eb" style={{ marginBottom: 10 }}>{t("verify.report")}</p>
          <TrustLegend />
          <form className="field" onSubmit={(e) => { e.preventDefault(); void go(id); }} style={{ marginBottom: 8 }}>
            <label htmlFor="cid" className="vlabel">Call ID <small>(an enclave run; prefilled with the latest published one, or paste any from /atlas)</small></label>
            <input id="cid" className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder={t("verify.placeholder")} spellCheck={false} />
          </form>
          <section className="pp-group" aria-labelledby="pp-g1">
            <h3 id="pp-g1">Enclave attestation <small>6 checks</small></h3>
          <div className="ck"><span className={`ok ${ck ? dot(ck.quote) : "wait"}`}>{ck ? mark(ck.quote) : "·"}</span><div><b>{t("verify.quote")}</b> <Trust src={["outlayer", "browser"]} /><small>{t("verify.quoteD")}{a ? ` · ${a.tdx_quote.length}` : ""}</small></div><span className="att">{ck?.quote ? t("verify.badgeAtt") : "—"}</span></div>
          <div className="ck"><span className={`ok ${ck ? dot(ck.registered && ck.fastfs === true) : "wait"}`}>{ck ? mark(ck.fastfs === null ? null : ck.registered && ck.fastfs === true) : "·"}</span><div><b>{t("verify.hash")}</b> <Trust src={["browser"]} /><small>{a?.executed_wasm_sha256 || t("verify.hashD")}</small></div><span className="att">{ck?.registered && ck.fastfs ? t("verify.badgeMatch") : "—"}</span></div>
          <div className="ck"><span className={`ok ${ck ? dot(ck.fastfs === true) : "wait"}`}>{ck ? mark(ck.fastfs) : "·"}</span><div><b>{t("verify.pub")}</b> <Trust src={["chain", "browser"]} /><small>{known && bi === 0 ? <a href={tx(WORKER_PUBLISH_TX)}>{t("verify.tx", { tx: WORKER_PUBLISH_TX })}</a> : a ? <a href={fastfsUrl(a.project_id, a.executed_wasm_sha256)} target="_blank" rel="noreferrer">published wasm file on FastFS ↗</a> : t("verify.pubD")}</small></div><span className="att">{ck?.fastfs ? t("verify.badgeFound") : "—"}</span></div>
          <div className="ck"><span className={`ok ${ck ? dot(ck.published) : "wait"}`}>{ck ? mark(ck.published) : "·"}</span><div><b>{t("verify.build")}</b> <Trust src={["us"]} /><small data-testid="build-note">{bi > 0 ? t("verify.buildPrev", { hash: a!.executed_wasm_sha256.slice(0, 8), cur: currentHash.slice(0, 8) }) : t("verify.buildD", { hash: currentHash.slice(0, 8) })}</small></div><span className="att">{ck?.published ? (bi > 0 ? t("verify.badgePrev") : t("verify.badgeBuild")) : "—"}</span></div>
          <div className="ck" data-testid="ck-binding"><span className={`ok ${ck ? (ck.fastfs === null && !ck.binding ? "wait" : dot(ck.binding?.match ?? false)) : "wait"}`}>{ck ? (ck.binding ? mark(ck.binding.match) : ck.fastfs === null ? "…" : "✕") : "·"}</span><div><b>{t("verify.bind")}</b> <Trust src={["browser"]} /><small>{ck?.binding ? t("verify.bindD", { rd: ck.binding.inQuote.slice(0, 16) }) : t("verify.bindWait")}</small></div><span className="att">{ck?.binding?.match ? t("verify.badgeBound") : "—"}</span></div>
          <div className="ck" data-testid="ck-output"><span className={`ok ${ck?.output ? dot(ck.output.match) : ck && ck.fastfs !== null ? "opt" : "wait"}`}>{ck?.output ? mark(ck.output.match) : ck && ck.fastfs !== null ? "○" : "·"}</span><div><b>{t("verify.out")}</b> <Trust src={["us", "browser"]} /><small>{ck?.output ? t(ck.output.match ? "verify.outOk" : "verify.outBad", { verdict: ck.output.verdict, src: t(ck.output.source === "evidence" ? "verify.srcEvidence" : "verify.srcPasted") }) : t("verify.outNone")}</small></div><span className="att" data-testid="output-verdict">{ck?.output?.match ? ck.output.verdict : "—"}</span></div>
          </section>
          <section className="pp-group" aria-labelledby="pp-g2">
            <h3 id="pp-g2">Intel quote check <small>19 checks</small></h3>
          <details className="dcap" data-testid="dcap" data-ok={dcap ? String(dcap.ok) : "wait"} open={!!dcap && !dcap.ok}>
            <summary><span className={`ok ${dcap ? dot(dcap.ok) : "wait"}`}>{dcap ? mark(dcap.ok) : "·"}</span><b>{t("verify.dcapH")}</b> <Trust src={["browser", "intel"]} /><small data-testid="dcap-count">{dcap ? t("verify.dcapCount", { n: dcap.checks.filter((c) => c.pass).length, total: dcap.checks.length }) : "…"}</small></summary>
            {dcap && <ol>{dcap.checks.map((c) => <li key={c.id} data-pass={String(c.pass)}><span>{c.pass ? "✓" : "✕"}</span><div>{c.label}{c.detail ? <em className="mono"> {c.detail}</em> : null}</div></li>)}</ol>}
            {bind && <p className="mono dbind" data-testid="dcap-bind">{t("verify.bindReq", { token: bind.token_id ?? "—", req: (bind.req_sha256 ?? "").slice(0, 16), nonce: (bind.nonce ?? "").slice(0, 12) })}</p>}
            <p className="note">{t("verify.dcapNote")}</p>
          </details>
          </section>
          <section className="pp-group" aria-labelledby="pp-g3">
            <h3 id="pp-g3">Intel revocation and TCB <small>12 checks</small></h3>
          <details className="dcap" data-testid="pcs" data-ok={pcs ? String(pcs.ok) : coll === "err" ? "err" : "wait"} data-tcb={pcs?.tcbStatus ?? ""} open={!!pcs && !pcs.ok}>
            <summary><span className={`ok ${pcs ? dot(pcs.ok) : coll === "err" ? "bad" : "wait"}`}>{pcs ? mark(pcs.ok) : coll === "err" ? "✕" : "·"}</span><b>{t("verify.pcsH")}</b> <Trust src={["intel", "browser"]} /><small data-testid="pcs-status">{pcs ? t("verify.pcsStatus", { tcb: pcs.tcbStatus, qe: pcs.qeStatus, n: pcs.checks.filter((c) => c.pass).length, total: pcs.checks.length }) : coll === "err" ? t("verify.pcsErr") : "…"}</small></summary>
            {pcs && <ol>{pcs.checks.map((c) => <li key={c.id} data-pass={String(c.pass)}><span>{c.pass ? "✓" : "✕"}</span><div>{c.label}{c.detail ? <em className="mono"> {c.detail}</em> : null}</div></li>)}</ol>}
            {pcs && pcs.advisories.length > 0 && <p className="mono dbind" data-testid="pcs-adv">{t("verify.pcsAdv", { ids: pcs.advisories.join(", ") })}</p>}
            <p className="note">{t("verify.pcsNote")}</p>
          </details>
          </section>
          {err && <p role="alert" className="note" style={{ color: "var(--coral)" }} data-testid="verify-error">{err === "tx" ? <>{t("verify.isTx")} <a href={tx(id.trim())} target="_blank" rel="noreferrer">{t("verify.openTx")}</a></> : err === "bad_params" ? t("verify.badId") : t("verify.fetchFail")}</p>}
          {orig && (
            <div className="tamper" data-testid="tamper" data-active={tampered ?? ""}>
              <p><b>{t("verify.tamperH")}</b> <small>{t("verify.tamperD")}</small></p>
              <div className="tbtns">
                {TAMPERS.map((k) => <button key={k} className={tampered === k ? "on" : ""} data-testid={`tamper-${k}`} onClick={() => void tamper(k)}>{t(`verify.tamper_${k}`)}</button>)}
                {tampered && <button className="reset" data-testid="tamper-reset" onClick={() => void tamper(null)}>{t("verify.tamperReset")}</button>}
              </div>
            </div>
          )}
          {a && ck && !ck.output?.match && (
            <form className="vpaste" onSubmit={(e) => { e.preventDefault(); void checkPasted(); }}>
              <label htmlFor="vout">{t("verify.pasteLabel")}</label>
              <textarea id="vout" className="input" rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"ok":false,"error":{...}}' spellCheck={false} />
              {pasteErr && <small style={{ color: "var(--coral)" }}>{t("verify.pasteErr")}</small>}
              <button className="btn b2" type="submit" disabled={!pasted.trim()}>{t("verify.pasteGo")}</button>
            </form>
          )}
          {a && ck && (<>
            <p className="note" data-testid="hashes-note" style={{ marginTop: 22 }}>{t("verify.hashesNote")}</p>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>{t("verify.published")}</dt><dd className="mono" data-kind="hash">{ck.fastfsHash ? <HashVal v={ck.fastfsHash} /> : "…"}</dd>
              <dt>{t("verify.executed")}</dt><dd className="mono" data-kind="hash"><HashVal v={a.executed_wasm_sha256} /></dd>
              {(["project_id", "worker_measurement", "input_hash", "output_hash", "build_target"] as const).map((k) => {
                const hash = k === "worker_measurement" || k === "input_hash" || k === "output_hash";
                return <Fragment key={k}><dt>{k}</dt><dd className={hash || k === "project_id" ? "mono" : undefined} data-kind={hash ? "hash" : undefined}>{hash ? <HashVal v={String(a[k])} /> : String(a[k])}</dd></Fragment>;
              })}
              {ck.binding && <><dt>report_data[0:32]</dt><dd className="mono" data-kind="hash"><HashVal v={ck.binding.inQuote} /></dd><dt>{t("verify.recomputed")}</dt><dd className="mono" data-kind="hash"><HashVal v={ck.binding.expected} /></dd></>}
              {a.caller_account_id && <><dt>caller</dt><dd className="mono">{a.caller_account_id}</dd></>}
              <dt>timestamp</dt><dd>{new Date(a.timestamp * 1000).toLocaleString(undefined, { timeZoneName: "short" })}</dd>
            </dl>
          </>
          )}
          {a && <a className="btn b2" style={{ marginTop: 16 }} href={attestation(a.call_id)} target="_blank" rel="noreferrer">JSON ↗</a>}
        </div>
      </div>
      <section style={{ marginTop: 36 }}>
        <h2 className="eb">{t("verify.examples")}</h2>
        <div className="examples">
          {CALLS.map((x) => <button key={x.id} onClick={() => { setId(x.id); void go(x.id); }}>{x.label}</button>)}
        </div>
        <pre className="term" tabIndex={0} role="region" aria-label="Verify the enclave hash yourself (shell commands)" style={{ marginTop: 18 }}>{`H=$(curl -s ${attestation("<call_id>")} | jq -r .executed_wasm_sha256)
curl -s https://main.fastfs.io/keyhole-devmo.near/outlayer.near/$H.wasm | sha256sum
# tx ${WORKER_PUBLISH_TX}`}</pre>
      </section>
    </div>
  );
}
