"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ASSETS, toBaseUnits, type AssetKey } from "@/lib/assets";
import { attestation } from "@/lib/config";
import { CALL_ID, buildIndex } from "@/lib/verify";
import { cooldownFor, latestTransfer, lockFor, type Cooldown, type SellerLock } from "@/lib/buyerCheck";
import { ageLabel, encodeKeyProof, verifyKeyProof } from "@/lib/keyProof";
import { short, type KeyLogBody } from "@/lib/keylog";
import { copyText } from "@/lib/copyText";
import { useSigned } from "@/lib/useSigned";
import { useWallet } from "@/lib/wallet";
import { Button } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { ErrorBox } from "@/components/Result";
import { TxLink } from "@/components/TxLink";

const ASSET_KEYS = Object.keys(ASSETS) as AssetKey[];
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A clock that refreshes every 30 s, so a cooldown or age on screen does not go stale. Only used after data loads (client only). */
function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** "1,000 USDC" style text from base units. Unknown assets keep the raw integer. */
function unitsText(units: string, decimals: number): string {
  if (decimals === 0) return units;
  const s = units.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function cooldownText(c: Cooldown, owner: string | null | undefined): string {
  if (c.state === "active") return `On until ${when(c.until)}. Withdraw waits; swaps still run.`;
  if (c.state === "over") return `Off since ${when(c.until)}.`;
  if (c.state === "none") return "Off. No transfer to the current holder is logged.";
  return unknownText(owner);
}

function unknownText(owner: string | null | undefined): string {
  if (owner === undefined) return "Reading the holder first.";
  if (owner === null) return "Not readable: the holder could not be read from NEAR just now.";
  return "Not readable yet: the enclave log has not recorded the current holder.";
}

function lockText(l: SellerLock, owner: string | null | undefined): string {
  if (l.state === "possible") return `Set by the current holder. Ends no later than ${when(l.endsBy)}. The exact end is private: a holder's proof shows it.`;
  if (l.state === "ended") return `None active. The last seller lock ended by ${when(l.endsBy)}.`;
  if (l.state === "none") return "None logged for the current holder.";
  return unknownText(owner);
}

type Build = { status: "idle" | "loading" | "ok" | "error"; hash: string | null; index: number };

/**
 * Buyer facts for one key, read now: the holder on chain, the latest transfer, the withdraw cooldown, the seller lock
 * and the worker build that served the provenance read (from its attestation). Nothing here is a claim without a read.
 */
export function BeforeYouBuy({ id, body, callId, owner }: { id: string; body: KeyLogBody; callId: string | null; owner: string | null | undefined }) {
  const now = useNow();
  const [build, setBuild] = useState<Build>({ status: "idle", hash: null, index: -1 });
  useEffect(() => {
    if (!callId || !CALL_ID.test(callId)) { setBuild({ status: "idle", hash: null, index: -1 }); return; }
    let live = true;
    setBuild({ status: "loading", hash: null, index: -1 });
    fetch(attestation(callId))
      .then((r) => (r.ok ? (r.json() as Promise<{ executed_wasm_sha256?: string }>) : Promise.reject(new Error("attestation"))))
      .then((a) => {
        if (!live) return;
        const h = (a.executed_wasm_sha256 || "").toLowerCase();
        setBuild({ status: "ok", hash: h || null, index: buildIndex(h) });
      })
      .catch(() => { if (live) setBuild({ status: "error", hash: null, index: -1 }); });
    return () => { live = false; };
  }, [callId]);

  const t = latestTransfer(body.events);
  const cd = cooldownFor(body.events, owner, now);
  const lk = lockFor(body.events, owner, now);
  const verifyHref = callId ? `/verify?call=${callId}` : null;

  let buildLine: string;
  if (!callId) buildLine = "No attested call for this read.";
  else if (build.status === "loading") buildLine = "Checking the build…";
  else if (build.status === "error") buildLine = "The attestation could not be fetched right now.";
  else if (build.status === "ok" && build.hash) {
    const h = build.hash.slice(0, 12);
    buildLine = build.index === 0 ? `Current published build ${h}…`
      : build.index > 0 ? `A superseded published build ${h}…`
      : `Build ${h}… is not in the published list.`;
  } else buildLine = "No build in the attestation.";

  return (
    <Card as="section" className="kb-card" testid="before-buy" aria-labelledby="before-buy-h">
      <p className="eb">Before you buy · public, no wallet</p>
      <h2 id="before-buy-h">Check a key before you buy it.</h2>
      <dl className="kb-grid">
        <div data-testid="bb-owner">
          <dt>Holder now (NEAR chain)</dt>
          <dd>{owner ? <span className="mono"><TxLink account={owner}>{short(owner)}</TxLink></span> : owner === undefined ? "Reading…" : "Not readable right now."}</dd>
        </div>
        <div data-testid="bb-transfer">
          <dt>Latest transfer</dt>
          <dd>{t ? `${when(t.ts_ms)}. The enclave first saw this holder then.` : "None logged. The key has not changed hands since it was minted."}</dd>
        </div>
        <div data-testid="bb-cooldown" data-state={cd.state}>
          <dt>Withdraw cooldown (10 min after a transfer)</dt>
          <dd>{cooldownText(cd, owner)}</dd>
        </div>
        <div data-testid="bb-lock" data-state={lk.state}>
          <dt>Seller lock</dt>
          <dd>{lockText(lk, owner)}</dd>
        </div>
        <div data-testid="bb-build">
          <dt>Worker build that served this read</dt>
          <dd>{buildLine}{verifyHref && <> · <Link href={verifyHref}>Verify this call</Link></>}</dd>
        </div>
      </dl>
      <p className="note">The cooldown and the lock come from the enclave&apos;s signed log, timed on this device. A transfer is logged when the enclave first sees the new holder.</p>
    </Card>
  );
}

/** Shown only to the connected holder. The enclave signs a yes or no for the asset and minimum; the link carries that statement. */
export function BuyerProof({ id, owner }: { id: string; owner: string | null | undefined }) {
  const { accountId } = useWallet();
  const make = useSigned("prove");
  const [asset, setAsset] = useState<AssetKey>("usdc");
  const [min, setMin] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ asset: AssetKey; min: string } | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(location.origin); }, []);

  const isHolder = !!accountId && !!owner && accountId === owner;
  if (!isHolder) return null;

  const out = make.res?.output as { ok?: boolean; statement?: string; sig?: string; minter?: string; holds_at_least?: boolean } | null | undefined;
  const share = out?.ok && out.statement && out.sig && out.minter
    ? { statement: out.statement, sig: out.sig, minter: out.minter, call_id: make.res?.call_id ?? null }
    : null;
  const link = share ? `${origin}/key?id=${encodeURIComponent(id)}&proof=${encodeKeyProof(share)}` : "";
  const meta = made ? ASSETS[made.asset] : null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const a = ASSETS[asset];
    const units = toBaseUnits(min, a.decimals);
    if (!units) { setFormErr(`Enter a minimum above zero, for example 10 ${a.symbol}.`); return; }
    setFormErr(null);
    setMade({ asset, min });
    void make.run({ token_id: id, token: a.id, min: units });
  }

  return (
    <Card as="section" className="kp-card" testid="buyer-proof" aria-labelledby="buyer-proof-h">
      <p className="eb">Proof for buyers · you hold this key</p>
      <h2 id="buyer-proof-h">Show a buyer what this key holds.</h2>
      <p className="kp-say">Your wallet signs once. The enclave checks the balance and signs only a yes or no, never the amount. The link stops checking once you move the key.</p>
      <form className="kp-form" onSubmit={onSubmit} data-testid="proof-form">
        <div className="kp-fields">
          <label className="kp-field">
            <span>Asset</span>
            <select className="input" value={asset} onChange={(e) => setAsset(e.target.value as AssetKey)} data-testid="proof-asset">
              {ASSET_KEYS.map((k) => <option key={k} value={k}>{ASSETS[k].symbol}</option>)}
            </select>
          </label>
          <label className="kp-field">
            <span>Minimum held ({ASSETS[asset].symbol})</span>
            <input className="input" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="10" value={min} onChange={(e) => setMin(e.target.value)} data-testid="proof-min" />
          </label>
        </div>
        {formErr && <p className="note key-error" role="alert" data-testid="proof-form-error">{formErr}</p>}
        <Button type="submit" loading={make.busy} loadingLabel={make.label || "Signing"} testid="proof-make">Sign and make proof</Button>
      </form>
      {make.res?.error && <ErrorBox code={make.res.error.code} retryAfter={make.res.error.retry_after} />}
      {share && meta && made && (
        <div className="kp-out" data-testid="proof-out">
          <p>The enclave says the key holds at least {made.min} {meta.symbol}: <b data-testid="proof-holds">{out?.holds_at_least ? "yes" : "no"}</b></p>
          <div className="kp-actions">
            <Button variant="secondary" testid="proof-copy" onClick={() => void copyText(link)}>Copy link</Button>
          </div>
          <p className="mono kp-raw" data-testid="proof-link">{link.slice(0, 64)}…</p>
        </div>
      )}
    </Card>
  );
}

/**
 * The proof on the page, checked here: decoding, the signature over the exact bytes, the contract's minter, the key id and the
 * owner on chain now. PASS only when every check is a real true.
 */
export function ProofPanel({ raw, id, owner, minter }: { raw: string; id: string; owner: string | null | undefined; minter: string | null | undefined }) {
  const now = useNow();
  const rep = verifyKeyProof(raw, { tokenId: id, chainOwner: owner, contractMinter: minter });
  const st = rep.statement;
  const v = rep.verdict;
  const headline = v === "pass" ? "PASS" : v === "fail" ? "FAIL" : v === "pending" ? "Checking" : "Not verified";
  const say = v === "pass" && st ? `The enclave signed this statement, and ${short(st.owner)} still holds the key on chain.`
    : v === "fail" ? "Do not rely on this proof."
    : v === "pending" ? "Reading the holder and the minter from NEAR."
    : "The signature checks, but the holder or the minter could not be read from NEAR just now. Try again in a moment.";

  const asset = st ? (ASSET_KEYS.find((k) => ASSETS[k].id === st.asset) ?? null) : null;
  const decimals = asset ? ASSETS[asset].decimals : 0;
  const symbol = asset ? ASSETS[asset].symbol : "";
  const lockAtSign = st ? (st.locked_until_ms > st.ts_ms ? `Locked until ${when(st.locked_until_ms)}, as signed.` : "No seller lock when it was signed.") : "";

  return (
    <Card as="section" className="kp-card kp-check-card" testid="proof-panel" data-verdict={v} aria-labelledby="proof-h">
      <p className="eb">Proof check · your browser</p>
      <h2 id="proof-h">The proof in this link</h2>
      <p className={`kp-verdict ${v}`} data-testid="proof-verdict" data-ok={String(v === "pass")} data-verdict={v}>{headline}</p>
      <p className="kp-say">{say}</p>
      <ol className="kp-checks" data-testid="proof-checks">
        {rep.checks.map((c) => (
          <li key={c.id} className="kp-check" data-testid={`proof-check-${c.id}`} data-pass={String(c.pass)}>
            <span className={`kp-mark ${c.pass === true ? "ok" : c.pass === false ? "bad" : "wait"}`} aria-hidden="true">{c.pass === true ? "✓" : c.pass === false ? "✕" : "…"}</span>
            <div>
              <h3>{c.label}</h3>
              <p>{c.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      {st && (
        <dl className="kb-grid kp-claims" data-testid="proof-claims">
          <div><dt>Signed</dt><dd>{when(st.ts_ms)} · {ageLabel(st.ts_ms, now)}</dd></div>
          <div><dt>Claim: holds at least</dt><dd data-testid="proof-claim-holds">{st.holds_at_least ? "Yes" : "No"}, {unitsText(st.min, decimals)} {symbol || st.asset}</dd></div>
          <div><dt>Seller lock</dt><dd>{lockAtSign}</dd></div>
          <div><dt>Log head</dt><dd className="mono">{st.log_head.slice(0, 16)}…</dd></div>
          <div><dt>Key</dt><dd className="mono">{st.token_id}</dd></div>
        </dl>
      )}
    </Card>
  );
}
