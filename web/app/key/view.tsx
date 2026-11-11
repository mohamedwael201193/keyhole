"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { checkLog, holders, short, type ChainCheck, type KeyLogBody } from "@/lib/keylog";
import { TEE_MINTER } from "@/lib/config";
import { TxLink } from "@/components/TxLink";
import { Button, CopyBtn, Spinner } from "@/components/ui";
import { TxResult } from "@/components/TxResult";
import { PageHeader, Card, CardHeader, StatusChip } from "@/components/v7";
import { KeyDetails } from "@/components/keys/KeyDetails";
import { useKeyListing, useKeyTier } from "@/components/keys/keyData";
import { useWallet } from "@/lib/wallet";
import { useKeyChain } from "./useKeyChain";
import { keyEvmAddress } from "@/lib/chainsig";
import { LienPanel } from "@/components/lien/LienPanel";
import { useLien } from "@/components/lien/useLien";
import { ChainEvents, KeyTimeline, type ChainEventState } from "@/components/keylog/KeyTimeline";
import { BeforeYouBuy, BuyerProof, ProofPanel } from "./buyer";
import { SaleCard } from "./sale";
import "./key.css";
import "@/components/keys/keys.css";

/** New ids are k + hex; the first keys were minted with plain numbers (0, 1, 2…). */
export const KEY_ID = /^(k[a-z0-9]{4,39}|\d{1,9})$/i;
const ID = KEY_ID;
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The key page (/key): look up a key by id, then its KEY DETAILS panel (the same layout as the gallery), the proof in a link,
 * the sale card, the buyer checks, and the holder table and event log. Every read and check is the one each card made before.
 */
export function KeyHistoryView() {
  const { accountId } = useWallet();
  const [id, setId] = useState("");
  const [body, setBody] = useState<KeyLogBody | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [ck, setCk] = useState<ChainCheck | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [legacy, setLegacy] = useState<string | null>(null);
  /** The key whose chain state is read (holder, minter). Set for every valid id, legacy included. */
  const [active, setActive] = useState("");
  /** The `proof` query value, when the page was opened with a share link. */
  const [proof, setProof] = useState<string | null>(null);
  /** Bumped after a sale action, so the listing in the details panel is read again. */
  const [saleRound, setSaleRound] = useState(0);
  const [chainEvents, setChainEvents] = useState<ChainEventState>({ state: "loading", events: [] });
  const [eventTry, setEventTry] = useState(0);
  /** Bumped on every lookup, including the same key id, so the lien read is not reused. */
  const [lookup, setLookup] = useState(0);
  const chain = useKeyChain(active);
  const tier = useKeyTier(active);
  const listing = useKeyListing(active, saleRound);
  /** Lien facts read from the final chain (views only). Shared by the lien card and the timeline. */
  const lien = useLien(active || null, { owner: chain.owner ?? null, marker: `${saleRound}:${lookup}` });
  /** Derived Chain Signatures address: computed in the browser, labelled as not signing in this build. */
  const evm = active && legacy === null ? keyEvmAddress(active) : null;

  async function load(tid: string) {
    setLookup((n) => n + 1);
    setErr(null); setBody(null); setCk(null); setCallId(null); setLegacy(null);
    setActive(ID.test(tid) ? tid : "");
    setChainEvents({ state: "loading", events: [] });
    if (!ID.test(tid)) { setErr("That is not a key id. Paste one from the gallery, like k5f4750858f328940 or 0."); return; }
    if (/^\d+$/.test(tid)) { setLegacy(tid); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/worker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "provenance", token_id: tid }) });
      const j = await r.json();
      const out = j?.output?.ok ? j.output : null;
      if (!out) { setErr(j?.output?.error?.message || j?.error?.message || "The enclave did not return a log for this key."); return; }
      const b = out as KeyLogBody; setBody(b); setCallId(j.call_id ?? null); setCk(checkLog(b, TEE_MINTER));
    } catch { setErr("Could not reach the enclave. Try again in a moment."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!active) return;
    let live = true;
    fetch(`/api/key-events?id=${encodeURIComponent(active)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        const events = Array.isArray(j?.events) ? j.events : [];
        if (j?.ok && j.complete === true) setChainEvents({ state: "ready", events, complete: true });
        else if (events.length) setChainEvents({ state: "partial", events });
        else setChainEvents({ state: "unavailable", events: [] });
      })
      .catch(() => { if (live) setChainEvents({ state: "unavailable", events: [] }); });
    return () => { live = false; };
  }, [active, lookup, eventTry]);
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const q = sp.get("id") ?? "";
    setId(q); setProof(sp.get("proof") || null);
    if (q) void load(q);
  }, []);

  const hs = body ? holders(body.events) : [];
  const ok = !!ck && ck.chain && ck.head && ck.sig && ck.minter;
  const pill = (pass: boolean, label: string, tid: string) => (
    <span className={`kpill ${pass ? "" : "bad"}`} data-testid={tid} data-pass={String(pass)}>{pass ? "✓" : "✕"} {label}</span>
  );
  return (
    <div className="kp-root kd-page khist" data-testid="key-page">
      <PageHeader
        eyebrow="Key history · public"
        title={<>Every key has a <em>book.</em></>}
        lead="Who held this key, and when it deposited, paid out and traded. This page re-checks every link in your browser; amounts stay sealed."
        testid="key-head"
      />
      <form className="kd-lookup" onSubmit={(e) => { e.preventDefault(); setProof(null); history.replaceState(null, "", `/key?id=${id.trim()}`); void load(id.trim()); }}>
        <label htmlFor="kid" className="sr-only">key id</label>
        <input id="kid" className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="k5f4750858f328940" spellCheck={false} />
        <Button type="submit" loading={busy} loadingLabel="Opening" testid="key-load">Open</Button>
      </form>
      <p className="kd-help" data-testid="key-help">Paste a key id, for example <span className="kd-mono">k5f4750858f328940</span> or <span className="kd-mono">0</span>.</p>
      {busy && !body && <p className="kg-note" data-testid="key-loading"><Spinner label="Loading" /> Reading the book from the enclave and checking every link…</p>}
      {err && <p className="kg-note key-error" role="alert" data-testid="key-error">{err}</p>}

      {legacy !== null && (
        <Card as="section" testid="key-legacy" labelledBy="key-legacy-h">
          <CardHeader title={`KEYHOLE Key #${legacy}`} id="key-legacy-h" />
          <p className="kg-note">An early key, minted before per-key history books existed. Its owner is still on chain: see <span className="kd-mono">nft_token</span> on <TxLink account="keyhole-devmo.near" />.</p>
        </Card>
      )}

      {active && legacy === null && (
        <KeyDetails
          tokenId={active}
          owner={chain.owner}
          tier={tier}
          viewer={accountId}
          sale={listing}
          proofHref="#key-log"
          saleHref="#sale-card"
        />
      )}
      {active && legacy === null && <LienPanel lien={lien} testid="key-lien" />}
      {evm && (
        <Card as="section" className="kevm" labelledBy="evm-h" testid="key-evm">
          <CardHeader title="Chain address" id="evm-h" />
          <p className="kg-note" data-testid="key-evm-label">derived address — signing is disabled in this build</p>
          <p className="mono" data-testid="key-evm-address" style={{ overflowWrap: "anywhere" }}>{evm} <CopyBtn value={evm} label="Copy" /></p>
          <p className="kg-note">Derived in your browser from the TEE minter and this key id, the same rule NEAR&apos;s v1.signer uses. Read only: no network call and nothing is signed.</p>
        </Card>
      )}
      {proof && <ProofPanel raw={proof} id={active} owner={chain.owner} minter={chain.minter} />}
      {active && (
        <div id="sale-card" className="kd-anchor">
          <SaleCard
            id={active}
            owner={chain.owner}
            royaltyBps={chain.royaltyBps}
            minter={chain.minter}
            onChanged={() => { chain.refresh(); setSaleRound((n) => n + 1); lien.refresh(); }}
          />
        </div>
      )}
      {active && !(body && ck) && (
        <Card as="section" className="klog" labelledBy="chain-events-h" testid="key-chain-events">
          <ChainEvents chainEvents={chainEvents} onRetry={() => setEventTry((n) => n + 1)} />
        </Card>
      )}
      {active && legacy === null && <BuyerProof id={active} owner={chain.owner} />}
      {body && ck && (
        <>
          <BeforeYouBuy id={active} body={body} callId={callId} owner={chain.owner} />
          <div className="kpills" data-testid="key-verdict" data-ok={String(ok)}>
            {pill(ck.chain, `${body.events.length} events chain`, "k-chain")}
            {pill(ck.head, "head matches", "k-head")}
            {pill(ck.sig, "head signed", "k-sig")}
            {pill(ck.minter, "signer is the TEE minter", "k-minter")}
          </div>
          <TxResult
            state={ok ? "confirmed" : "failed"}
            title={ok ? "Log checked in your browser" : "Log did not check out"}
            reason="A link in this log does not match the enclave's signed head. Do not trust this history."
            callId={callId ?? undefined}
            testid="key-result"
          />
          <Card as="section" className="khold" labelledBy="holders-h" testid="holders-card">
            <CardHeader title="Holders" id="holders-h" />
            <div className="ktable" data-testid="holders">
              <div className="kr kh"><span>Holder</span><span>From</span><span>To</span><span>Deposits</span><span>Paid out</span><span>Trades</span></div>
              {hs.map((h, i) => (
                <div className="kr" key={`${h.owner}-${i}`} data-testid="holder-row">
                  <span className="mono"><TxLink account={h.owner}>{short(h.owner)}</TxLink></span>
                  <span data-l="From">{when(h.from_ms)}</span><span data-l="To">{h.to_ms ? when(h.to_ms) : "now"}</span>
                  <span data-l="Deposits">{h.deposits}</span><span data-l="Paid out" data-testid="paid-out">{h.withdraws}</span><span data-l="Trades">{h.trades}</span>
                </div>
              ))}
            </div>
            <p className="kg-note">Paid out counts withdraw events. USD totals are private to each holder; a holder can publish a signed total from the vault (<Link href="/pnl">signed swap log</Link>).</p>
          </Card>
          <KeyTimeline body={body} ownerNow={chain.owner} lien={lien} listing={listing} chainEvents={chainEvents} onRetry={() => setEventTry((n) => n + 1)} />
          <Card as="section" className="klog" labelledBy="log-h" testid="key-log-card">
            <span id="key-log" className="kd-anchor" />
            <CardHeader title="Event log" id="log-h" meta={<StatusChip tone={ok ? "success" : "error"}>{ok ? "Checked" : "Not checked"}</StatusChip>} />
            <ol>
              {body.events.map((e) => (
                <li key={e.i}><b>{e.kind}</b><span className="mono"><TxLink account={e.owner}>{short(e.owner)}</TxLink></span><span>{when(e.ts_ms)}</span><span className="mono h" title={`log entry hash ${e.hash}`}>{e.hash.slice(0, 12)}… <CopyBtn value={e.hash} label="Copy hash" /></span></li>
              ))}
            </ol>
            <p className="khead">head {body.head} <CopyBtn value={body.head} label="Copy" /></p>
            <p className="kg-note">Each entry hash covers the previous one, so changing any row breaks every hash after it. These are log hashes, not chain transactions.</p>
          </Card>
        </>
      )}
    </div>
  );
}
