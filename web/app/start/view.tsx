"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { tokensFor, type Token } from "@/lib/near";
import { ASSETS, toBaseUnits, type AssetKey } from "@/lib/assets";
import { fundParams } from "@/lib/trade";
import { START_STEPS, SAFE_LIMITS, LIMITS_FLAG, startStep, type StartStep } from "@/lib/start";
import { SessionCard } from "@/components/SessionCard";
import { DepositQr } from "@/components/DepositQr";
import { ErrorBox } from "@/components/Result";
import { Busy } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton, QRFrame, StepCard, Stepper, StepTransition, SuccessCheck } from "@/components/motion";
import { FadeUp, GlowReveal, Stagger } from "@/components/motion/primitives";
import QRCode from "qrcode";
import { accountState, formatNear, type AccountState } from "@/lib/nearAccount";
import { TOPUP_HINT_NEAR } from "@/lib/start";
import { TxLink } from "@/components/TxLink";
import { TxResult } from "@/components/TxResult";
import { TokenIcon } from "@/components/TokenIcon";
import { MetaMaskNote } from "@/components/MetaMaskNote";
import { loadMintTx, saveMintTx } from "@/lib/mintTx";
import { minutesLeft } from "@/lib/session";
import "./start.css";

const TITLES: Record<StartStep, string> = { connect: "Get started", topup: "Add NEAR", mint: "Get your key", unlock: "Unlock", limits: "Limits", fund: "Fund", done: "Ready" };

/** Google "G" in its four brand colours (decorative; the button text names the action). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Envelope in the same 1.6 stroke as the rest of the icon set. */
function MailMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3.5 7.5l8.5 6 8.5-6" />
    </svg>
  );
}

export function StartView() {
  const { accountId, connectNear, connectOther, connectSocial, socialEnabled, socialCreating, socialFinishing, via, session, startSession } = useWallet();
  const [acct, setAcct] = useState<AccountState | null>(null);
  const [sawTopup, setSawTopup] = useState(false);
  const [qr, setQr] = useState("");
  const [mintTx, setMintTx] = useState<string | null>(null);
  const [justUnlocked, setJustUnlocked] = useState(false);
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
  useEffect(() => { setMintTx(loadMintTx(accountId)); }, [accountId]);
  useEffect(() => { const h = mint.res?.output?.tx; if (mint.res?.output?.ok && accountId) { saveMintTx(accountId, h); setMintTx(loadMintTx(accountId)); } }, [mint.res, accountId]);
  const wasUnlocked = useRef(false);
  useEffect(() => {
    if (unlocked && !wasUnlocked.current) { setJustUnlocked(true); const id = setTimeout(() => setJustUnlocked(false), 8_000); wasUnlocked.current = true; return () => clearTimeout(id); }
    if (!unlocked) wasUnlocked.current = false;
  }, [unlocked]);
  const steps = START_STEPS.filter((x) => x !== "topup" || sawTopup);
  const idx = steps.indexOf(step);
  const units = toBaseUnits(amt, ASSETS[asset].decimals);
  const addr = account.res?.output?.ok ? (account.res.output.deposit?.deposit_address as string | undefined) : undefined;

  return (
    <main className="page start" data-testid="start">
      <header className="sg-head">
        <h1>{`Set up in ${steps.length - 1} short steps`}</h1>
        <p className="sg-lead">A private trading account inside a sealed enclave. Sign in with Google, an email code or a wallet. Your progress is kept if you leave.</p>
      </header>
      {accountId && <p className="acct-ready" data-testid="account-ready"><span className="note">Signed in{via === "privy" ? " with Google / email" : ""} as</span> <b className="addr" title={accountId}>{accountId.length > 24 ? `${accountId.slice(0, 10)}…${accountId.slice(-8)}` : accountId}</b> <CopyButton value={accountId} />{acct && <span className="note" data-testid="account-balance"> · {acct.exists ? `${formatNear(acct.yocto)} NEAR` : "not on chain yet"}</span>}</p>}
      {mintTx && step !== "mint" && <p className="note acct-ready" data-testid="start-mint-tx">Key minted · <TxLink hash={mintTx} /></p>}
      {justUnlocked && session && <p className="sess on start-unlocked" data-testid="start-unlocked" role="status"><SuccessCheck size={18} /> <b>Unlocked</b> · {minutesLeft(session)} min left</p>}
      <div className="sg-dots" data-testid="start-dots"><Stepper steps={steps.map((x) => TITLES[x])} current={idx} /></div>
      <StepTransition k={step}>
        {step === "connect" ? (
          <div className="sg-connect" data-testid="start-step-connect">
            {socialFinishing && !socialCreating && <p className="sg-busy" data-testid="start-finishing"><Busy l="Finishing Google sign-in" /></p>}
            {socialCreating && <p className="sg-busy" data-testid="start-creating"><Busy l="Creating your NEAR account" /></p>}
            {!socialCreating && !socialFinishing && <>
              <h2 className="sg-h2">1 · Choose how to sign in</h2>
              <FadeUp>
                <Stagger className={socialEnabled ? "sg-choices" : "sg-choices sg-choices--solo"} gap={0.1}>
                  {socialEnabled && (
                    <Card as="section" className="sg-choice" testid="start-choice-google" aria-labelledby="sg-google">
                      <span className="sg-icon" aria-hidden="true"><GoogleMark /></span>
                      <h3 id="sg-google">Google</h3>
                      <p>One click. We create your NEAR account for you, with no wallet to install.</p>
                      <Button variant="primary" block testid="start-social" onClick={() => connectSocial("google")}>Continue with Google</Button>
                    </Card>
                  )}
                  {socialEnabled && (
                    <Card as="section" className="sg-choice" testid="start-choice-email" aria-labelledby="sg-email">
                      <span className="sg-icon" aria-hidden="true"><MailMark /></span>
                      <h3 id="sg-email">Email code</h3>
                      <p>We email you a one-time code. No password to remember.</p>
                      <Button variant="secondary" block testid="start-email" onClick={() => connectSocial("email")}>Continue with email</Button>
                    </Card>
                  )}
                  <Card as="section" className="sg-choice" testid="start-choice-wallet" aria-labelledby="sg-wallet">
                    <span className="sg-marks" aria-hidden="true">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/logos/near.svg" alt="" width={32} height={32} />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/logos/eth.svg" alt="" width={32} height={32} />
                    </span>
                    <h3 id="sg-wallet">Connect a wallet</h3>
                    <p>Use a NEAR wallet or MetaMask. You sign a message, and nothing is sent.</p>
                    <Button variant="primary" block testid="start-near" onClick={() => void connectNear()}>NEAR wallet</Button>
                    <Button variant="secondary" block testid="start-connect" onClick={() => void connectOther()}>MetaMask and other wallets</Button>
                  </Card>
                </Stagger>
              </FadeUp>
              {!socialEnabled && <p className="sg-note" data-testid="start-social-off">Google and email sign-in are not enabled in this build. Connect a wallet to start.</p>}
              <div className="sg-foot"><MetaMaskNote /></div>
            </>}
          </div>
        ) : (
          <StepCard active className="sg-step" data-testid={`start-step-${step}`}>
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
            {step !== "topup" && holder === null && <p><Busy l="Looking for your key" /></p>}
            {step === "mint" && holder === false && <>
              <h2>{idx + 1} · Get your key</h2>
              <p>A key is a free NFT that opens your own account inside the enclave. No fee: the enclave pays the NEAR storage.</p>
              <Button variant="primary" loading={mint.busy} loadingLabel={mint.label} testid="start-mint" onClick={() => void mint.run({})}>Mint my key</Button>
              {mint.res?.output?.ok && <TxResult state="pending" testid="start-mint-result" title="Minted. Waiting for the chain to show it" hash={typeof mint.res.output.tx === "string" ? mint.res.output.tx : undefined} />}
              {mint.res?.error && <ErrorBox code={mint.res.error.code} />}
            </>}
            {step === "unlock" && token && <>
              <h2>{idx + 1} · Unlock for 30 minutes</h2>
              <SessionCard tokenId={token.token_id} />
            </>}
            {step === "limits" && <>
              <h2>{idx + 1} · Safe limits</h2>
              <p><b>Recommended: $1/trade, $5/day.</b> You can lower them any time; raising them later asks your wallet.</p>
              <div className="sg-actions">
                <Button variant="primary" loading={limits.busy} loadingLabel={limits.label} testid="start-limits" onClick={() => void limits.run(SAFE_LIMITS)}>Use recommended limits</Button>
                <Button variant="secondary" testid="start-limits-skip" onClick={() => { if (accountId) localStorage.setItem(`${LIMITS_FLAG}:${accountId}`, "1"); setLimitsDone(true); }}>Keep my key&apos;s tier limits</Button>
              </div>
              {limits.res?.error && <ErrorBox code={limits.res.error.code} />}
            </>}
            {step === "fund" && <>
              <h2>{idx + 1} · Fund</h2>
              <p>Choose an amount. The enclave gives you a deposit address; nothing moves until you send.</p>
              <div className="vfield"><label htmlFor="st-amt">Amount</label><div className="vbox sg-amount"><input id="st-amt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
                <TokenIcon assetId={ASSETS[asset].id} symbol={ASSETS[asset].symbol} size="sm" />
                <select aria-label="Asset" value={asset} onChange={(e) => setAsset(e.target.value as AssetKey)}>{(Object.keys(ASSETS) as AssetKey[]).map((k) => <option key={k} value={k}>{ASSETS[k].symbol}</option>)}</select></div></div>
              <div className="sg-actions">
                <Button variant="primary" disabled={!units} loading={account.busy} loadingLabel={account.label} testid="start-fund" onClick={() => units && void account.run(fundParams(asset, units))}>Get deposit address</Button>
              </div>
              {addr && <DepositQr evm={accountId && /^0x[0-9a-fA-F]{40}$/.test(accountId) ? accountId : null} address={addr} amount={`${amt} ${ASSETS[asset].symbol}`} />}
              {addr && <div className="sg-actions">
                <Button variant="secondary" loading={dash.busy} loadingLabel={dash.label} testid="start-check" onClick={() => void runDash({})}>I sent it · check balance</Button>
                <Link href="/vault" className="sg-skip">Skip for now</Link>
              </div>}
              {account.res?.error && <ErrorBox code={account.res.error.code} />}
            </>}
            {step === "done" && <GlowReveal className="sg-done" testid="start-done">
              <SuccessCheck size={56} label="Done" />
              <h2>You&apos;re set</h2>
              <p>Your account is funded and unlocked. Trade, prove your results, or withdraw from the vault.</p>
              <Button href="/vault" variant="primary" size="lg" testid="start-go">Open my vault</Button>
            </GlowReveal>}
          </StepCard>
        )}
      </StepTransition>
    </main>
  );
}
