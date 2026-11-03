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
import { CopyButton, QRFrame, StepCard, Stepper, StepTransition, SuccessCheck } from "@/components/motion";
import QRCode from "qrcode";
import { accountState, formatNear, type AccountState } from "@/lib/nearAccount";
import { TOPUP_HINT_NEAR } from "@/lib/start";

const TITLES: Record<StartStep, string> = { connect: "Get started", topup: "Add NEAR", mint: "Get your key", unlock: "Unlock", limits: "Limits", fund: "Fund", done: "Ready" };

export function StartView() {
  const { accountId, connect, connectOther, connectSocial, socialEnabled, socialCreating, via, session, startSession } = useWallet();
  const [acct, setAcct] = useState<AccountState | null>(null);
  const [sawTopup, setSawTopup] = useState(false);
  const [qr, setQr] = useState("");
  const [autoTried, setAutoTried] = useState("");
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

  // Right after minting, unlock with the sign-in signature kept from connect (no extra popup when it is still fresh).
  useEffect(() => {
    if (!token || session || !mint.res?.output?.ok || autoTried === token.token_id) return;
    setAutoTried(token.token_id); void startSession(token.token_id, { reuseOnly: true });
  }, [token, session, mint.res, autoTried, startSession]);
  // Account ready: is it on chain, and with how much NEAR? A new Google / email account is an unfunded implicit id.
  useEffect(() => {
    setAcct(null); if (!accountId || /^0x/i.test(accountId)) return;
    let stop = false;
    const tick = async () => { const a = await accountState(accountId); if (!stop && a) setAcct(a); };
    void tick();
    const id = setInterval(tick, 6_000);
    return () => { stop = true; clearInterval(id); };
  }, [accountId]);
  useEffect(() => { if (acct && !acct.exists) setSawTopup(true); }, [acct]);
  useEffect(() => { if (accountId && acct && !acct.exists) QRCode.toString(accountId, { type: "svg", margin: 1, width: 168 }).then(setQr).catch(() => setQr("")); }, [accountId, acct]);
  const step = startStep({ connected: !!accountId, exists: acct ? acct.exists : null, holder, unlocked, limitsDone, funded });
  const steps = START_STEPS.filter((x) => x !== "topup" || sawTopup);
  const idx = steps.indexOf(step);
  const units = toBaseUnits(amt, ASSETS[asset].decimals);
  const addr = account.res?.output?.ok ? (account.res.output.deposit?.deposit_address as string | undefined) : undefined;

  return (
    <main className="page start" data-testid="start">
      <Purpose eyebrow="Start" title={`Set up in ${steps.length - 1} short steps`} line="A private trading account inside a sealed enclave. Sign in with Google or email, or use any wallet. Your progress is kept if you leave." />
      {accountId && <p className="acct-ready" data-testid="account-ready"><span className="note">Signed in{via === "privy" ? " with Google / email" : ""} as</span> <b className="addr" title={accountId}>{accountId.length > 24 ? `${accountId.slice(0, 10)}…${accountId.slice(-8)}` : accountId}</b> <CopyButton value={accountId} />{acct && <span className="note" data-testid="account-balance"> · {acct.exists ? `${formatNear(acct.yocto)} NEAR` : "not on chain yet"}</span>}</p>}
      <div data-testid="start-dots"><Stepper steps={steps.map((x) => TITLES[x])} current={idx} /></div>
      <StepTransition k={step}><StepCard active className="scard" data-testid={`start-step-${step}`}>
        {step === "connect" && !socialCreating && <>
          <h2>1 · Get started</h2>
          {socialEnabled ? <>
            <p>Sign in with Google or email and we create your NEAR account for you. No wallet, no extension. Already have a wallet? Use it instead. Nothing is sent and nothing is charged.</p>
            <div className="start-choices">
              <button className="btn b1 big" type="button" onClick={connectSocial} data-testid="start-social">Continue with Google / email</button>
              <button className="btn b2" type="button" onClick={() => void connectOther()} data-testid="start-connect">All wallets (NEAR, MetaMask, …)</button>
            </div>
          </> : <>
            <p>Connect a NEAR wallet or MetaMask. Nothing is sent and nothing is charged.</p>
            <button className="btn b1" type="button" onClick={() => void connect()} data-testid="start-connect">Connect wallet</button>
          </>}
        </>}
        {step === "connect" && socialCreating && <p data-testid="start-creating"><Busy l="Creating your NEAR account" /></p>}
        {step === "topup" && accountId && <>
          <h2>{idx + 1} · Add a little NEAR</h2>
          <p>Your new NEAR account exists on chain once it holds a little NEAR. Send <b>{TOPUP_HINT_NEAR} NEAR</b> (about a cent) from any NEAR wallet or an exchange to your account id. This page moves on by itself when it arrives.</p>
          <div className="depqr" data-testid="topup">
            {qr && <QRFrame caption="Scan to copy your account id"><div className="qr" role="img" aria-label="QR code of your NEAR account id" dangerouslySetInnerHTML={{ __html: qr }} /></QRFrame>}
            <div>
              <p>Your NEAR account id:</p>
              <div className="vbox ro"><span className="v addr" data-testid="topup-address">{accountId}</span><CopyButton value={accountId} /></div>
              <p className="vhelp"><Busy l="Waiting for NEAR to arrive" /></p>
            </div>
          </div>
        </>}
        {step !== "connect" && holder === null && <p><Busy l="Looking for your key" /></p>}
        {step === "mint" && holder === false && <>
          <h2>{idx + 1} · Get your key</h2>
          <p>A key is a free NFT that opens your own account inside the enclave. No fee: the enclave pays the NEAR storage.</p>
          <button className="btn b1" type="button" disabled={mint.busy} onClick={() => void mint.run({})} data-testid="start-mint">{mint.busy ? <Busy l={mint.label} /> : "Mint my key"}</button>
          {mint.res?.output?.ok && <p className="note"><Busy l="Minted. Waiting for the chain to show it" /></p>}
          {mint.res?.error && <ErrorBox code={mint.res.error.code} />}
        </>}
        {step === "unlock" && token && <>
          <h2>{idx + 1} · Unlock for 30 minutes</h2>
          <SessionCard tokenId={token.token_id} />
        </>}
        {step === "limits" && <>
          <h2>{idx + 1} · Safe limits</h2>
          <p><b>Recommended: $1/trade, $5/day.</b> You can lower them any time; raising them later asks your wallet.</p>
          <button className="btn b1" type="button" disabled={limits.busy} onClick={() => void limits.run(SAFE_LIMITS)} data-testid="start-limits">{limits.busy ? <Busy l={limits.label} /> : "Use recommended limits"}</button>{" "}
          <button className="btn b2" type="button" onClick={() => { if (accountId) localStorage.setItem(`${LIMITS_FLAG}:${accountId}`, "1"); setLimitsDone(true); }} data-testid="start-limits-skip">Keep my key&apos;s tier limits</button>
          {limits.res?.error && <ErrorBox code={limits.res.error.code} />}
        </>}
        {step === "fund" && <>
          <h2>{idx + 1} · Fund</h2>
          <p>Choose an amount. The enclave gives you a deposit address; nothing moves until you send.</p>
          <div className="vfield"><label htmlFor="st-amt">Amount</label><div className="vbox"><input id="st-amt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
            <select aria-label="Asset" value={asset} onChange={(e) => setAsset(e.target.value as AssetKey)}>{(Object.keys(ASSETS) as AssetKey[]).map((k) => <option key={k} value={k}>{ASSETS[k].symbol}</option>)}</select></div></div>
          <button className="btn b1" type="button" disabled={!units || account.busy} onClick={() => units && void account.run(fundParams(asset, units))} data-testid="start-fund">{account.busy ? <Busy l={account.label} /> : "Get deposit address"}</button>
          {addr && <DepositQr evm={accountId && /^0x[0-9a-fA-F]{40}$/.test(accountId) ? accountId : null} address={addr} amount={`${amt} ${ASSETS[asset].symbol}`} />}
          {addr && <p><button className="btn b2" type="button" disabled={dash.busy} onClick={() => void runDash({})} data-testid="start-check">{dash.busy ? <Busy l={dash.label} /> : "I sent it · check balance"}</button> <Link href="/vault" className="note">Skip for now</Link></p>}
          {account.res?.error && <ErrorBox code={account.res.error.code} />}
        </>}
        {step === "done" && <>
          <SuccessCheck size={48} label="Done" /><h2>You&apos;re set</h2>
          <p>Your account is funded and unlocked. Trade, prove your results, or withdraw from the vault.</p>
          <Link className="btn b1" href="/vault" data-testid="start-go">Open my vault</Link>
        </>}
      </StepCard></StepTransition>
    </main>
  );
}
