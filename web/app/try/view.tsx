"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { tierName } from "@/lib/near";
import { RECORDED_MAINNET_TRADE } from "@/lib/recordedTrade";
import {
  clearTrial, freshKey, guestTransfer, loadTrial, saveTrial, trialView,
  type Guest, type SavedTrial, type TrialToken,
} from "@/lib/trialGuest";
import { GUEST_DEPOSIT_YOCTO, TRIAL_BANNER, TRIAL_CODE_HASH, TRIAL_CONTRACT, testnetAccount, testnetTx } from "@/lib/trialPublic";
import { REFUSAL_RECEIVER, classifyRefusal, transferLanded } from "@/lib/trialRefusal";
import "./try.css";

type Busy = "" | "create" | "mint" | "transfer";

function Tx({ hash }: { hash?: string }) {
  const href = hash ? testnetTx(hash) : null;
  if (!href || !hash) return null;
  return <a href={href} target="_blank" rel="noreferrer">tx {hash.slice(0, 8)}… ↗</a>;
}

export function TrialView({ autostart }: { autostart: boolean }) {
  const [saved, setSaved] = useState<SavedTrial>({});
  const [token, setToken] = useState<TrialToken | null>(null);
  const [tier, setTier] = useState<number | null>(null);
  const [oldSupply, setOldSupply] = useState<number | null>(null);
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const started = useRef(false);

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

  async function create(role: "holder" | "receiver"): Promise<Guest | null> {
    const key = material(role);
    const r = await fetch("/api/trial/guest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey: key.publicKey, idempotencyKey: key.idempotencyKey }),
    });
    const j = await r.json() as { accountId?: string; error?: string; message?: string };
    if (!r.ok || !j.accountId) throw new Error(j.message || "The guest account was not created.");
    return { accountId: j.accountId, secretKey: key.secretKey };
  }

  async function onCreate() {
    setBusy("create"); setError(null);
    try {
      const holder = await create("holder");
      if (!holder) return;
      write({ holder });
      setToken(null); setTier(null); setOldSupply(null);
    } catch (e) { setError(e instanceof Error ? e.message : "The guest account was not created."); }
    finally { setBusy(""); }
  }

  async function onMint() {
    if (!saved.holder) return;
    setBusy("mint"); setError(null);
    try {
      const r = await fetch("/api/trial/mint", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ receiverId: saved.holder.accountId, idempotencyKey: material("mint").idempotencyKey }),
      });
      const j = await r.json() as { tokenId?: string; txHash?: string; message?: string };
      if (!r.ok || !j.tokenId) throw new Error(j.message || "The practice key was not minted.");
      const next = { ...saved, tokenId: j.tokenId, mintTx: j.txHash };
      write(next);
      let row: TrialToken | null = null;
      for (let i = 0; i < 5 && !row; i++) {
        if (i) await new Promise((res) => setTimeout(res, 1000));
        row = await readKey(j.tokenId, saved.holder.accountId).catch(() => null);
      }
      if (!row) setError("The mint transaction was sent, but the key is not readable on testnet yet.");
    } catch (e) { setError(e instanceof Error ? e.message : "The practice key was not minted."); }
    finally { setBusy(""); }
  }

  async function onTransfer() {
    if (!saved.holder || !saved.tokenId) return;
    setBusy("transfer"); setError(null);
    try {
      const receiver = await create("receiver");
      if (!receiver) return;
      const moved = await guestTransfer(saved.holder, saved.tokenId, receiver.accountId);
      if (!transferLanded(moved.final, { signer: saved.holder.accountId, tokenId: saved.tokenId, receiverId: receiver.accountId })) {
        throw new Error("The transfer did not land.");
      }
      const refusedTx = await guestTransfer(saved.holder, saved.tokenId, REFUSAL_RECEIVER);
      const verdict = classifyRefusal(refusedTx.final, { signer: saved.holder.accountId, tokenId: saved.tokenId, receiverId: REFUSAL_RECEIVER });
      const next: SavedTrial = {
        ...saved, receiver, transferTx: moved.hash ?? undefined,
        refusalTx: verdict === "refused" ? refusedTx.hash ?? undefined : undefined,
        refusal: verdict,
      };
      write(next);
      await readKey(saved.tokenId, saved.holder.accountId);
    } catch (e) { setError(e instanceof Error ? e.message : "The transfer did not finish."); }
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

  const ownerMoved = !!token && !!saved.receiver && token.owner_id === saved.receiver.accountId;
  const guestNear = (Number(GUEST_DEPOSIT_YOCTO) / 1e24).toFixed(2);

  return (
    <main className="page trial pp" data-testid="trial-page">
      <div className="trial-banner" data-testid="trial-banner">
        <p>{TRIAL_BANNER}</p>
        <div className="net-toggle" role="group" aria-label="Network">
          <Link href="/try" aria-current="page" data-testid="net-testnet">Testnet</Link>
          <Link href="/" data-testid="net-mainnet">Mainnet</Link>
        </div>
      </div>
      <h1>Try the key, free on testnet.</h1>
      <p className="lead">One click makes a guest account and keeps its key in this browser. You mint a practice key, hand it to a second guest, and watch the contract refuse the old holder. Nothing here is real money. Trading inside the enclave stays on mainnet, and that step shows a recorded trade.</p>
      <p className="trial-contract">Contract <a href={testnetAccount(TRIAL_CONTRACT)} target="_blank" rel="noreferrer">{TRIAL_CONTRACT}</a> · code hash <span className="mono">{TRIAL_CODE_HASH}</span></p>
      {error && <p className="trial-error" role="alert" data-testid="trial-error">{error}</p>}
      <ol className="trial-steps">
        <li className="trial-step">
          <h2>1 · Guest account</h2>
          <p>The server asks the testnet account to create yours and fund it with {guestNear} testnet NEAR, the GUEST_DEPOSIT_YOCTO amount. Only the public key leaves this browser.</p>
          {saved.holder ? <p className="trial-ok" data-testid="trial-account">Signed in as guest <b className="mono">{saved.holder.accountId}</b></p> : <Button onClick={() => void onCreate()} loading={busy === "create"} loadingLabel="Creating your guest account" testid="trial-create">Try it free — testnet</Button>}
        </li>
        <li className="trial-step">
          <h2>2 · Mint a practice key</h2>
          <p>The testnet minter, the same rule as mainnet, mints one Bronze key to your guest. The contract is the v2.7 keys code from this repo.</p>
          {saved.tokenId ? <p className="trial-meta" data-testid="trial-token"><span>Key <b className="mono">{saved.tokenId}</b></span><Tx hash={saved.mintTx} /></p> : <Button onClick={() => void onMint()} disabled={!saved.holder || busy !== ""} loading={busy === "mint"} loadingLabel="Minting the practice key" testid="trial-mint">Mint a practice key</Button>}
        </li>
        <li className="trial-step">
          <h2>3 · Tier and history</h2>
          <p>Read from the testnet contract just now. The sealed trade book is mainnet only, so this list is the on-chain history of the practice key.</p>
          <p data-testid="trial-tier">Tier <b>{saved.tokenId ? (tier == null ? "unavailable" : tierName(tier)) : "—"}</b></p>
          <ol className="trial-history" data-testid="trial-history">
            {saved.mintTx && <li>Minted on testnet <Tx hash={saved.mintTx} /></li>}
            {token && <li>Holder on chain <b className="mono">{token.owner_id}</b></li>}
            {saved.transferTx && <li>Transferred on testnet <Tx hash={saved.transferTx} /></li>}
            {!saved.tokenId && <li>Mint a key to read its tier.</li>}
          </ol>
        </li>
        <li className="trial-step">
          <h2>4 · Hand the key to a second guest</h2>
          <p>Your browser signs the transfer. Then the old guest signs again, and the contract refuses them.</p>
          {!ownerMoved && <Button onClick={() => void onTransfer()} disabled={!saved.tokenId || busy !== ""} loading={busy === "transfer"} loadingLabel="Transferring the key" testid="trial-transfer">Transfer to a second guest</Button>}
          {token && saved.receiver && <p className={ownerMoved ? "trial-ok" : "trial-meta"} data-testid="trial-owner">Control is with <b className="mono">{token.owner_id}</b>{ownerMoved ? ". The key moved." : "."}</p>}
          {saved.receiver && <p className="trial-meta">Second guest <b className="mono">{saved.receiver.accountId}</b> <Tx hash={saved.transferTx} /></p>}
          {saved.refusal === "refused" && ownerMoved && <p className="trial-refused" data-testid="trial-refused">Old holder refused. Sender not approved {saved.refusalTx && <Tx hash={saved.refusalTx} />}</p>}
          {saved.refusal === "unknown" && <p data-testid="trial-refusal-unknown">unknown / unavailable</p>}
        </li>
        <li className="trial-step trial-recorded">
          <h2>5 · A vault trade</h2>
          <p>Trading inside the enclave is mainnet only. This step does not send a trade. It shows one that already settled.</p>
          <p data-testid="trial-recorded"><b>{RECORDED_MAINNET_TRADE.label}.</b> {RECORDED_MAINNET_TRADE.summary} <Link href={`/verify?call=${RECORDED_MAINNET_TRADE.callId}`}>Verify this call</Link></p>
        </li>
      </ol>
      <p className="trial-meta"><button type="button" className="lp-link" onClick={() => { clearTrial(); for (const role of ["holder", "receiver", "mint"]) localStorage.removeItem(`keyhole.trial.idem.${role}`); setSaved({}); setToken(null); setTier(null); setOldSupply(null); setError(null); }}>Start again on this browser</button></p>
    </main>
  );
}
