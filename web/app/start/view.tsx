"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { tokensFor, type Token } from "@/lib/near";
import { ASSETS, toBaseUnits, type AssetKey } from "@/lib/assets";
import { fundParams } from "@/lib/trade";
import { START_STEPS, SAFE_LIMITS, LIMITS_FLAG, startStep, type StartStep } from "@/lib/start";
import { SessionCard } from "@/components/SessionCard";
import { DepositQr } from "@/components/DepositQr";
import { ErrorBox } from "@/components/Result";
import { Busy, Purpose } from "@/components/ui";

const TITLES: Record<StartStep, string> = { connect: "Connect", mint: "Get your key", unlock: "Unlock", limits: "Limits", fund: "Fund", done: "Ready" };

export function StartView() {
  const { accountId, connect, session } = useWallet();
  const [token, setToken] = useState<Token | null>(null);
  const [holder, setHolder] = useState<boolean | null>(null);
  const [limitsDone, setLimitsDone] = useState(false);
  const [funded, setFunded] = useState(false);
  const [amt, setAmt] = useState("1");
  const [asset, setAsset] = useState<AssetKey>("usdc");
  const mint = useSigned("mint");
  const limits = useSigned("limits");
  const account = useSigned("account");
  const dash = useSigned("dashboard");

  const loadKeys = useCallback(async (acc: string) => {
    const toks = await tokensFor(acc).catch(() => null);
    if (!toks) return;
    setToken(toks[0] ?? null); setHolder(toks.length > 0);
  }, []);
  useEffect(() => { setHolder(null); setToken(null); if (accountId) void loadKeys(accountId); }, [accountId, loadKeys]);
  useEffect(() => { if (mint.res?.output?.ok && accountId) { const id = setTimeout(() => void loadKeys(accountId), 3000); return () => clearTimeout(id); } }, [mint.res, accountId, loadKeys]);
  useEffect(() => { setLimitsDone(!!accountId && localStorage.getItem(`${LIMITS_FLAG}:${accountId}`) === "1"); }, [accountId]);
  useEffect(() => { if (limits.res?.output?.ok && accountId) { localStorage.setItem(`${LIMITS_FLAG}:${accountId}`, "1"); setLimitsDone(true); } }, [limits.res, accountId]);
  // Funded = the dashboard shows a non-zero balance. With a session this read costs no popup.
  const runDash = dash.run;
  const unlocked = !!session && !!token && session.token_id === token.token_id;
  useEffect(() => { if (unlocked) void runDash({}, { quiet: true }); }, [unlocked, runDash]);
  useEffect(() => {
    const b = dash.res?.output?.balances as { amount?: string; balance?: string }[] | undefined;
    if (Array.isArray(b) && b.some((x) => { const v = x.amount ?? x.balance; return !!v && /^[0-9]+$/.test(v) && BigInt(v) > BigInt(0); })) setFunded(true);
  }, [dash.res]);

  const step = startStep({ connected: !!accountId, holder, unlocked, limitsDone, funded });
  const idx = START_STEPS.indexOf(step);
  const units = toBaseUnits(amt, ASSETS[asset].decimals);
  const addr = account.res?.output?.ok ? (account.res.output.deposit?.deposit_address as string | undefined) : undefined;

  return (
    <main className="wrap start" data-testid="start">
      <Purpose eyebrow="Start" title="Set up in five short steps" line="A private trading account, three wallet popups at most. Your progress is kept if you leave." />
      <ol className="dots" aria-label="Progress" data-testid="start-dots">
        {START_STEPS.map((s, i) => <li key={s} data-state={i < idx ? "done" : i === idx ? "now" : "next"} aria-current={i === idx ? "step" : undefined}>{TITLES[s]}</li>)}
      </ol>
      <section className="scard" data-testid={`start-step-${step}`}>
        {step === "connect" && <>
          <h2>1 · Connect a wallet</h2>
          <p>Any NEAR wallet, or MetaMask. Nothing is sent and nothing is charged.</p>
          <button className="vbtn pri" type="button" onClick={() => void connect()} data-testid="start-connect">Connect wallet</button>
        </>}
        {step !== "connect" && holder === null && <p><Busy l="Looking for your key" /></p>}
        {step === "mint" && holder === false && <>
          <h2>2 · Get your key</h2>
          <p>A key is a free NFT that opens your own account inside the enclave. One signature, no fee: the enclave pays the NEAR storage.</p>
          <button className="vbtn pri" type="button" disabled={mint.busy} onClick={() => void mint.run({})} data-testid="start-mint">{mint.busy ? <Busy l={mint.label} /> : "Mint my key (1 signature)"}</button>
          {mint.res?.output?.ok && <p className="note"><Busy l="Minted. Waiting for the chain to show it" /></p>}
          {mint.res?.error && <ErrorBox code={mint.res.error.code} />}
        </>}
        {step === "unlock" && token && <>
          <h2>3 · Unlock for 30 minutes</h2>
          <SessionCard tokenId={token.token_id} />
        </>}
        {step === "limits" && <>
          <h2>4 · Safe limits</h2>
          <p>Cap what this key can move: <b>$1 per trade, $5 a day</b>. Lowering limits needs no popup; raising them later asks your wallet.</p>
          <button className="vbtn pri" type="button" disabled={limits.busy} onClick={() => void limits.run(SAFE_LIMITS)} data-testid="start-limits">{limits.busy ? <Busy l={limits.label} /> : "Use safe limits"}</button>{" "}
          <button className="vbtn" type="button" onClick={() => { if (accountId) localStorage.setItem(`${LIMITS_FLAG}:${accountId}`, "1"); setLimitsDone(true); }} data-testid="start-limits-skip">Keep my key&apos;s tier limits</button>
          {limits.res?.error && <ErrorBox code={limits.res.error.code} />}
        </>}
        {step === "fund" && <>
          <h2>5 · Fund</h2>
          <p>Choose an amount. The enclave gives you a deposit address; nothing moves until you send.</p>
          <div className="vfield"><label htmlFor="st-amt">Amount</label><div className="vbox"><input id="st-amt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
            <select aria-label="Asset" value={asset} onChange={(e) => setAsset(e.target.value as AssetKey)}>{(Object.keys(ASSETS) as AssetKey[]).map((k) => <option key={k} value={k}>{ASSETS[k].symbol}</option>)}</select></div></div>
          <button className="vbtn pri" type="button" disabled={!units || account.busy} onClick={() => units && void account.run(fundParams(asset, units))} data-testid="start-fund">{account.busy ? <Busy l={account.label} /> : "Get deposit address"}</button>
          {addr && <DepositQr address={addr} amount={`${amt} ${ASSETS[asset].symbol}`} />}
          {addr && <p><button className="vbtn" type="button" disabled={dash.busy} onClick={() => void runDash({})} data-testid="start-check">{dash.busy ? <Busy l={dash.label} /> : "I sent it · check balance"}</button> <Link href="/vault" className="note">Skip for now</Link></p>}
          {account.res?.error && <ErrorBox code={account.res.error.code} />}
        </>}
        {step === "done" && <>
          <h2>You&apos;re set</h2>
          <p>Your account is funded and unlocked. Trade, prove your results, or withdraw from the vault.</p>
          <Link className="vbtn pri" href="/vault" data-testid="start-go">Open my vault</Link>
        </>}
      </section>
    </main>
  );
}
