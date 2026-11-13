"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { KeyArt } from "@/components/Art";
import { FoilCard } from "@/components/FoilCard";
import { GoldWaves } from "@/components/landing/GoldWaves";
import { Icon } from "@/components/landing/icons";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { tierName } from "@/lib/near";
import { RECORDED_MAINNET_TRADE } from "@/lib/recordedTrade";
import { keyIdentity } from "@/lib/traits";
import {
  clearTrial, freshKey, guestTransfer, loadTrial, saveTrial, trialView,
  type Guest, type SavedTrial, type TrialToken,
} from "@/lib/trialGuest";
import { GUEST_DEPOSIT_YOCTO, TRIAL_BANNER, TRIAL_CODE_HASH, TRIAL_CONTRACT, testnetAccount, testnetTx } from "@/lib/trialPublic";
import { REFUSAL_RECEIVER, classifyRefusal, transferLanded } from "@/lib/trialRefusal";
import "./try.css";

type Busy = "" | "create" | "mint" | "transfer";
type Step = Exclude<Busy, "">;

/**
 * Display-only progress. Each step records the stage the code has really reached (the handlers below call begin, stage and end at the
 * lines where that is true) and nothing else: the UI never shows a stage the handler has not run. Not stored, not sent.
 */
type Run = { at: number; attempt?: number; startedAt: number; endedAt?: number; status: "running" | "done" | "failed" };

/** The stages of each step, in the order the handlers reach them. Keys are in messages/en.json (try2). */
const STAGES: Record<Step, readonly string[]> = {
  create: ["try2.c1", "try2.c2", "try2.c3"],
  mint: ["try2.m1", "try2.m2", "try2.m3", "try2.m4"],
  transfer: ["try2.t1", "try2.t2", "try2.t3", "try2.t4", "try2.t5", "try2.t6", "try2.t7"],
};

function Tx({ hash }: { hash?: string }) {
  const href = hash ? testnetTx(hash) : null;
  if (!href || !hash) return null;
  return <a className="tr-txchip" href={href} target="_blank" rel="noreferrer">tx {hash.slice(0, 8)}… ↗</a>;
}

function seconds(ms: number) {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/** The progress row of one step: a gold line that fills, a pulsing node on the stage in progress, a spinner only while pending. */
function Progress({ step, run, now }: { step: Step; run?: Run; now: number }) {
  const { t } = useI18n();
  if (!run) return null;
  const stages = STAGES[step];
  const last = stages.length - 1;
  const done = run.status === "done";
  const failed = run.status === "failed";
  const fill = done ? 100 : (run.at / last) * 100;
  const label = t(stages[done ? last : run.at]) + (!done && !failed && run.attempt ? ` · ${t("try2.try", { a: run.attempt, b: 5 })}` : "");
  return (
    <div className="tr-prog" data-status={run.status} data-testid={`trial-progress-${step}`}>
      <div className="tr-prog-track" aria-hidden="true">
        <span className="tr-prog-line"><i style={{ width: `${fill}%` }} /></span>
        <ol>
          {stages.map((key, i) => {
            const state = done || i < run.at ? "done" : i === run.at ? (failed ? "failed" : "now") : "next";
            return <li key={key} data-state={state} title={t(key)}>{state === "done" ? <Icon name="check" size={12} /> : state === "failed" ? <Icon name="x" size={12} /> : null}</li>;
          })}
        </ol>
      </div>
      <p className="tr-prog-now" role="status" aria-live="polite">
        {run.status === "running" && <span className="tr-spin" aria-hidden="true" />}
        <span>{label}</span>
        <b className="mono">{seconds((run.endedAt ?? now) - run.startedAt)}</b>
      </p>
    </div>
  );
}

function Fail({ text, onRetry, step, busy }: { text: string; onRetry: () => void; step: Step; busy: boolean }) {
  const { t } = useI18n();
  return (
    <div className="tr-fail" role="alert" data-testid="trial-error">
      <span className="tr-fail-ico"><Icon name="x" size={18} /></span>
      <div>
        <b>{t("try2.failed")}</b>
        <p>{text}</p>
      </div>
      <Button variant="secondary" onClick={onRetry} disabled={busy} testid={`trial-retry-${step}`}>{t("try2.retry")}</Button>
    </div>
  );
}

/** The practice key as the real Bronze FoilCard, standing on Guest 1 until the contract says Guest 2 holds it, then it slides across. */
function KeyStage({ tokenId, tier, moved, holder, receiver }: { tokenId?: string; tier: number | null; moved: boolean; holder?: string; receiver?: string }) {
  const { t } = useI18n();
  const id = tokenId ? keyIdentity(tokenId, tier ?? 1) : null;
  return (
    <div className="tr-stage" data-at={moved ? "2" : "1"} data-testid="trial-stage">
      <p className="tr-stage-label">{t("try2.stageLabel")}</p>
      <div className="tr-slots">
        <div className="tr-slot"><b>{t("try2.guest1")}</b><span className="mono">{holder ?? "—"}</span></div>
        <div className="tr-slot"><b>{t("try2.guest2")}</b><span className="mono">{receiver ?? t("try2.guest2wait")}</span></div>
        <div className="tr-card-rail" aria-hidden={!id}>
          {id ? (
            <div className="tr-card">
              <FoilCard finish={id.finish} className="tr-foil">
                <div className="top"><span className="tier">{id.finish}</span><span className="oo mono">{tokenId}</span></div>
                <div className="art"><KeyArt n={id.art} alt={`${id.finish} practice key`} width={430} height={1080} /></div>
              </FoilCard>
            </div>
          ) : (
            <div className="tr-card tr-card--empty"><span>{t("try2.noKey")}</span></div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The climax: the same two cards as the landing, drawn from the real refusal. `play` runs the 2.6 s reveal once, for a transfer made on this visit. */
function Climax({ previous, next, play, children }: { previous: string; next: string; play: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="tr-climax" data-play={play ? "on" : "rest"} data-testid="trial-climax">
      <p className="tr-eyebrow">{t("try2.climax")}</p>
      <div className="tr-climax-cards">
        <article className="tr-holder tr-holder--prev">
          <span className="tr-tint" aria-hidden="true" />
          <Icon name="user" size={34} />
          <h3>{t("try2.prev")}</h3>
          <span className="mono tr-acct">{previous}</span>
          <p className="tr-pill tr-pill--red"><Icon name="x" size={15} />{t("try2.pillRefused")}</p>
          <code>{t("try2.refusedCode")}</code>
        </article>
        <div className="tr-climax-arrow" aria-hidden="true">
          <svg viewBox="0 0 64 24" focusable="false"><path d="M2 12h56M46 3l12 9-12 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/heirloom/keys/k03.webp" alt="" width={433} height={1077} />
        </div>
        <article className="tr-holder tr-holder--next">
          <span className="tr-tint" aria-hidden="true" />
          <Icon name="user" size={34} />
          <h3>{t("try2.next")}</h3>
          <span className="mono tr-acct">{next}</span>
          <p className="tr-pill tr-pill--green"><Icon name="check" size={15} />{t("try2.pillGranted")}</p>
        </article>
      </div>
      {children}
    </div>
  );
}

export function TrialView({ autostart }: { autostart: boolean }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<SavedTrial>({});
  const [token, setToken] = useState<TrialToken | null>(null);
  const [tier, setTier] = useState<number | null>(null);
  const [oldSupply, setOldSupply] = useState<number | null>(null);
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const started = useRef(false);
  // Display only: the stage each step has reached, the step that failed, the sponsor's tx for each guest, and whether the lock-out happened on this visit.
  const [runs, setRuns] = useState<Partial<Record<Step, Run>>>({});
  const [failedStep, setFailedStep] = useState<Step | null>(null);
  const [guestTx, setGuestTx] = useState<{ holder?: string; receiver?: string }>({});
  const [fresh, setFresh] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const begin = (s: Step) => { setFailedStep(null); setRuns((r) => ({ ...r, [s]: { at: 0, startedAt: Date.now(), status: "running" } })); };
  const stage = (s: Step, at: number, attempt?: number) => setRuns((r) => (r[s] ? { ...r, [s]: { ...r[s]!, at, attempt } } : r));
  const end = (s: Step, status: "done" | "failed") => {
    if (status === "failed") setFailedStep(s);
    setRuns((r) => (r[s] ? { ...r, [s]: { ...r[s]!, status, endedAt: Date.now() } } : r));
  };

  const write = (next: SavedTrial) => { setSaved(next); saveTrial(next); };

  async function readKey(tokenId: string, holder?: string) {
    const [row, tierN, supply] = await Promise.all([
      trialView<TrialToken | null>("nft_token", { token_id: tokenId }),
      trialView<number | null>("nft_tier", { token_id: tokenId }),
      holder ? trialView<string>("nft_supply_for_owner", { account_id: holder }) : Promise.resolve(null),
    ]);
    setToken(row);
    setTier(typeof tierN === "number" ? tierN : null);
    setOldSupply(supply == null ? null : Number(supply));
    return row;
  }

  function material(role: "holder" | "receiver" | "mint"): { publicKey: string; secretKey: string; idempotencyKey: string } {
    const k = `keyhole.trial.idem.${role}`;
    const existing = localStorage.getItem(k);
    if (existing) return JSON.parse(existing) as { publicKey: string; secretKey: string; idempotencyKey: string };
    const key = role === "mint" ? { publicKey: "", secretKey: "" } : freshKey();
    const row = { ...key, idempotencyKey: crypto.randomUUID() };
    localStorage.setItem(k, JSON.stringify(row));
    return row;
  }

  async function create(role: "holder" | "receiver", asStep?: Step, at?: number): Promise<Guest | null> {
    const key = material(role);
    if (asStep) stage(asStep, at ?? 0);
    const r = await fetch("/api/trial/guest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey: key.publicKey, idempotencyKey: key.idempotencyKey }),
    });
    const j = await r.json() as { accountId?: string; txHash?: string; error?: string; message?: string };
    if (!r.ok || !j.accountId) throw new Error(j.message || "The guest account was not created.");
    if (j.txHash) setGuestTx((g) => ({ ...g, [role]: j.txHash }));
    return { accountId: j.accountId, secretKey: key.secretKey };
  }

  async function onCreate() {
    setBusy("create"); setError(null); begin("create");
    try {
      stage("create", 1);
      const holder = await create("holder");
      if (!holder) return;
      write({ holder });
      setToken(null); setTier(null); setOldSupply(null);
      end("create", "done");
    } catch (e) { setError(e instanceof Error ? e.message : "The guest account was not created."); end("create", "failed"); }
    finally { setBusy(""); }
  }

  async function onMint() {
    if (!saved.holder) return;
    setBusy("mint"); setError(null); begin("mint");
    try {
      const r = await fetch("/api/trial/mint", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ receiverId: saved.holder.accountId, idempotencyKey: material("holder").idempotencyKey }),
      });
      const j = await r.json() as { tokenId?: string; txHash?: string; message?: string };
      if (!r.ok || !j.tokenId) throw new Error(j.message || "The practice key was not minted.");
      stage("mint", 1);
      const next = { ...saved, tokenId: j.tokenId, mintTx: j.txHash };
      write(next);
      let row: TrialToken | null = null;
      for (let i = 0; i < 5 && !row; i++) {
        if (i) await new Promise((res) => setTimeout(res, 1000));
        stage("mint", 2, i + 1);
        row = await readKey(j.tokenId, saved.holder.accountId).catch(() => null);
      }
      if (!row) { setError("The mint transaction was sent, but the key is not readable on testnet yet."); end("mint", "failed"); }
      else end("mint", "done");
    } catch (e) { setError(e instanceof Error ? e.message : "The practice key was not minted."); end("mint", "failed"); }
    finally { setBusy(""); }
  }

  async function onTransfer() {
    if (!saved.holder || !saved.tokenId) return;
    setBusy("transfer"); setError(null); begin("transfer");
    try {
      const receiver = await create("receiver", "transfer", 0);
      if (!receiver) return;
      stage("transfer", 1);
      const moved = await guestTransfer(saved.holder, saved.tokenId, receiver.accountId);
      if (!transferLanded(moved.final, { signer: saved.holder.accountId, tokenId: saved.tokenId, receiverId: receiver.accountId })) {
        throw new Error("The transfer did not land.");
      }
      stage("transfer", 3);
      const refusedTx = await guestTransfer(saved.holder, saved.tokenId, REFUSAL_RECEIVER);
      stage("transfer", 4);
      const verdict = classifyRefusal(refusedTx.final, { signer: saved.holder.accountId, tokenId: saved.tokenId, receiverId: REFUSAL_RECEIVER });
      const next: SavedTrial = {
        ...saved, receiver, transferTx: moved.hash ?? undefined,
        refusalTx: verdict === "refused" ? refusedTx.hash ?? undefined : undefined,
        refusal: verdict,
      };
      write(next);
      stage("transfer", 5);
      await readKey(saved.tokenId, saved.holder.accountId);
      if (verdict === "refused") setFresh(true);
      end("transfer", "done");
    } catch (e) { setError(e instanceof Error ? e.message : "The transfer did not finish."); end("transfer", "failed"); }
    finally { setBusy(""); }
  }

  useEffect(() => { setSaved(loadTrial()); setReady(true); }, []);
  useEffect(() => {
    if (!ready || !autostart || started.current || saved.holder) return;
    started.current = true;
    void onCreate();
    // The first visit from the hero creates the guest once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, autostart, saved.holder]);
  useEffect(() => { if (saved.tokenId && saved.holder) void readKey(saved.tokenId, saved.holder.accountId).catch(() => setToken(null)); }, [saved.tokenId, saved.holder]);
  const anyRunning = Object.values(runs).some((r) => r?.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [anyRunning]);

  const ownerMoved = !!token && !!saved.receiver && token.owner_id === saved.receiver.accountId;
  const guestNear = (Number(GUEST_DEPOSIT_YOCTO) / 1e24).toFixed(2);
  const refusedNow = saved.refusal === "refused" && ownerMoved;
  const nodeState = (s: "c" | "m" | "h" | "x" | "r"): string => {
    const done = { c: !!saved.holder, m: !!saved.tokenId, h: !!saved.tokenId, x: ownerMoved, r: false }[s];
    const run = { c: runs.create, m: runs.mint, h: undefined, x: runs.transfer, r: undefined }[s];
    return run?.status === "failed" ? "failed" : run?.status === "running" ? "now" : done ? "done" : "idle";
  };
  const failText = error ?? "";

  return (
    <main className="trx" data-testid="trial-page">
      <header className="tr-hero">
        <GoldWaves variant="pledge" />
        <div className="tr-wrap tr-hero-grid">
          <div className="tr-hero-copy">
            <div className="tr-banner" data-testid="trial-banner">
              <p><i aria-hidden="true" />{TRIAL_BANNER}</p>
              <div className="net-toggle" role="group" aria-label="Network">
                <Link href="/try" aria-current="page" data-testid="net-testnet">Testnet</Link>
                <Link href="/dashboard" data-testid="net-mainnet">Mainnet</Link>
              </div>
            </div>
            <h1>{t("try2.h1a")} <em>{t("try2.h1b")}</em></h1>
            <p className="tr-lead">{t("try2.lead")}</p>
            <p className="tr-chips trial-contract">
              <span className="tr-chip">{t("try2.contract")} <a href={testnetAccount(TRIAL_CONTRACT)} target="_blank" rel="noreferrer" className="mono">{TRIAL_CONTRACT}</a></span>
              <span className="tr-chip">{t("try2.hash")} <span className="mono">{TRIAL_CODE_HASH}</span></span>
            </p>
          </div>
          <KeyStage tokenId={saved.tokenId} tier={tier} moved={ownerMoved} holder={saved.holder?.accountId} receiver={saved.receiver?.accountId} />
        </div>
      </header>

      <div className="tr-wrap">
        <ol className="tr-journey" aria-label={t("try2.journey")}>
          <li className="tr-step" data-node={nodeState("c")}>
            <span className="tr-node" aria-hidden="true">{nodeState("c") === "done" ? <Icon name="check" size={18} /> : 1}</span>
            <div className="tr-card-step">
              <h2>{t("try2.s1t")}</h2>
              <p>{t("try2.s1d", { n: guestNear })}</p>
              <Progress step="create" run={runs.create} now={now} />
              {saved.holder ? (
                <p className="trial-ok tr-ok" data-testid="trial-account"><Icon name="check" size={16} />{t("try2.signedIn")} <b className="mono">{saved.holder.accountId}</b> <Tx hash={guestTx.holder} /></p>
              ) : failedStep === "create" ? (
                <Fail text={failText} onRetry={() => void onCreate()} step="create" busy={busy !== ""} />
              ) : (
                <Button onClick={() => void onCreate()} loading={busy === "create"} loadingLabel={t("try2.creating")} testid="trial-create">{t("try2.create")}</Button>
              )}
            </div>
          </li>

          <li className="tr-step" data-node={nodeState("m")}>
            <span className="tr-node" aria-hidden="true">{nodeState("m") === "done" ? <Icon name="check" size={18} /> : 2}</span>
            <div className="tr-card-step">
              <h2>{t("try2.s2t")}</h2>
              <p>{t("try2.s2d")}</p>
              <Progress step="mint" run={runs.mint} now={now} />
              {saved.tokenId ? (
                <p className="trial-meta tr-meta" data-testid="trial-token"><span>{t("try2.key")} <b className="mono">{saved.tokenId}</b></span><Tx hash={saved.mintTx} /></p>
              ) : failedStep === "mint" ? (
                <Fail text={failText} onRetry={() => void onMint()} step="mint" busy={busy !== ""} />
              ) : (
                <Button onClick={() => void onMint()} disabled={!saved.holder || busy !== ""} loading={busy === "mint"} loadingLabel={t("try2.minting")} testid="trial-mint">{t("try2.mint")}</Button>
              )}
              {saved.tokenId && failedStep === "mint" && <Fail text={failText} onRetry={() => void onMint()} step="mint" busy={busy !== ""} />}
            </div>
          </li>

          <li className="tr-step" data-node={nodeState("h")}>
            <span className="tr-node" aria-hidden="true">{nodeState("h") === "done" ? <Icon name="check" size={18} /> : 3}</span>
            <div className="tr-card-step">
              <h2>{t("try2.s3t")}</h2>
              <p>{t("try2.s3d")}</p>
              <p className="tr-tier" data-testid="trial-tier">{t("try2.tier")} <b>{saved.tokenId ? (tier == null ? t("try2.tierNone") : tierName(tier)) : "—"}</b></p>
              <ol className="tr-history" data-testid="trial-history">
                {saved.mintTx && <li>{t("try2.histMint")} <Tx hash={saved.mintTx} /></li>}
                {token && <li>{t("try2.histHolder")} <b className="mono">{token.owner_id}</b></li>}
                {saved.transferTx && <li>{t("try2.histMoved")} <Tx hash={saved.transferTx} /></li>}
                {!saved.tokenId && <li>{t("try2.histEmpty")}</li>}
              </ol>
            </div>
          </li>

          <li className="tr-step" data-node={nodeState("x")}>
            <span className="tr-node" aria-hidden="true">{nodeState("x") === "done" ? <Icon name="check" size={18} /> : 4}</span>
            <div className="tr-card-step">
              <h2>{t("try2.s4t")}</h2>
              <p>{t("try2.s4d")}</p>
              <Progress step="transfer" run={runs.transfer} now={now} />
              {!ownerMoved && failedStep !== "transfer" && <Button onClick={() => void onTransfer()} disabled={!saved.tokenId || busy !== ""} loading={busy === "transfer"} loadingLabel={t("try2.transferring")} testid="trial-transfer">{t("try2.transfer")}</Button>}
              {failedStep === "transfer" && <Fail text={failText} onRetry={() => void onTransfer()} step="transfer" busy={busy !== ""} />}
              {token && saved.receiver && <p className={ownerMoved ? "trial-ok tr-ok" : "trial-meta tr-meta"} data-testid="trial-owner">{ownerMoved && <Icon name="check" size={16} />}<span>{t("try2.control")} <b className="mono">{token.owner_id}</b>{ownerMoved ? `. ${t("try2.moved")}` : "."}</span></p>}
              {saved.receiver && <p className="trial-meta tr-meta">{t("try2.second")} <b className="mono">{saved.receiver.accountId}</b> <Tx hash={saved.transferTx} /></p>}
              {refusedNow && saved.holder && saved.receiver && (
                <Climax previous={saved.holder.accountId} next={saved.receiver.accountId} play={fresh}>
                  <p className="trial-refused tr-refused" data-testid="trial-refused">{t("try2.refused")} {t("try2.refusedCode")} {saved.refusalTx && <Tx hash={saved.refusalTx} />}</p>
                </Climax>
              )}
              {saved.refusal === "unknown" && <p className="tr-unknown" data-testid="trial-refusal-unknown">{t("try2.unknown")}</p>}
            </div>
          </li>

          <li className="tr-step tr-recorded trial-recorded" data-node="idle">
            <span className="tr-node tr-node--rec" aria-hidden="true">5</span>
            <div className="tr-card-step">
              <h2>{t("try2.s5t")}</h2>
              <p>{t("try2.s5d")}</p>
              <p className="tr-rec" data-testid="trial-recorded"><b>{RECORDED_MAINNET_TRADE.label}.</b> {RECORDED_MAINNET_TRADE.summary} <Link href={`/verify?call=${RECORDED_MAINNET_TRADE.callId}`} className="tr-textlink">{t("try2.verify")}</Link></p>
            </div>
          </li>
        </ol>
        <p className="tr-again"><button type="button" className="tr-textlink" onClick={() => { clearTrial(); for (const role of ["holder", "receiver", "mint"]) localStorage.removeItem(`keyhole.trial.idem.${role}`); setSaved({}); setToken(null); setTier(null); setOldSupply(null); setError(null); setRuns({}); setFailedStep(null); setGuestTx({}); setFresh(false); }}>{t("try2.again")}</button></p>
      </div>
    </main>
  );
}
