"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AmountInput, Badge, Button, Card, Purpose, TokenSelect, type TokenOption } from "@/components/ui";
import { TxStatus as TxResult } from "@/components/ui/tx-status";
import { Attested, ErrorBox } from "@/components/Result";
import { useWallet, OP_CTX, type OpResume } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { ASSETS, toBaseUnits } from "@/lib/assets";
import { swapParamsById } from "@/lib/trade";
import { shortAccount } from "@/lib/near";
import { tx } from "@/lib/config";
import { assetByToken, formatAmount, formatUsdMicro, fromBaseUnits, priceToMicro, shortTokenId, tradeSummary, valueMicro, type PriceBook, type RawBalance, type TokenPrice } from "@/lib/amount";
import { SETTLEMENTS } from "@/lib/settlements";
import { useHeldKey } from "@/lib/useHeldKey";
import { useLogVerified } from "@/lib/useLogVerified";
import { swapStep, SWAP_LABEL } from "@/lib/swapFlow";
import { chainName, fallbackTokens, useTokenList, type Token } from "@/lib/tokens";
import "./swap.css";

type Quote = { amountInFormatted?: string; amountOutFormatted?: string; amountInUsd?: string; amountOutUsd?: string; minAmountOut?: string; timeEstimate?: number };
type Hist = { ts_ms?: number; kind?: string; token_in?: string; token_out?: string; amount_in?: string; amount_out?: string };
type Done = { give: string; decimals: number; symbol: string };

/** The vault's own two assets. They are the pair on first paint and the only choice when the full token list cannot load. */
const FALLBACK = fallbackTokens();

function toOption(t: Token, balance?: string): TokenOption {
  const name = chainName(t.blockchain);
  return { id: t.assetId, symbol: t.symbol, name, assetId: t.assetId, chain: t.blockchain, chainName: name, contract: t.contractAddress, price: t.price, balance };
}

/** Plain words for a refused price check. The raw code is never shown to the user. */
function humanDry(code?: string) {
  const M: Record<string, string> = {
    policy_transaction_limit_exceeded: "That amount is above the per-trade limit, so it is refused. Try a smaller amount.",
    rate_limited: "Too many price checks in a minute. Wait a few seconds and try again.",
    no_quote: "No solver offered a price for this pair and amount right now. Try a different amount.",
  };
  return (code && M[code]) || "No price came back. Try again in a moment.";
}

function quoteParams(acct: string, fromId: string, toId: string, u: string) {
  return { origin_asset: fromId, destination_asset: toId, amount: u, refund_to: acct, recipient: acct, refund_type: "INTENTS", recipient_type: "INTENTS", deposit_type: "INTENTS", confidentiality: "basic", execute: false };
}

/** Raw base units the holder has of one asset, from a signed balance read. "0" when the asset is not in it. */
function rawFor(bal: RawBalance[] | null, id: string): string {
  if (!bal) return "0";
  const b = bal.find((x) => (x.token || x.symbol || "").trim().toLowerCase() === id.toLowerCase());
  const raw = b ? String(b.amount ?? b.balance ?? "") : "0";
  return /^\d+$/.test(raw) ? raw : "0";
}

/**
 * The swap screen. It runs the same paths as the vault had: the enclave quote (execute: false) and the signed swap, both through
 * useSigned, and the key and session from useWallet. With no wallet it shows a dry 1Click price, labelled as a price only.
 * Any token in the 1Click list can be picked; the default pair is USDC to wNEAR.
 */
export function SwapView() {
  const { accountId, connect, session, startSession, pending } = useWallet();
  const { held, keyMiss, lookingUp } = useHeldKey(accountId);
  const quote = useSigned("quote");
  const swap = useSigned("swap");
  const balance = useSigned("balance");
  const history = useSigned("history");
  const historyOk = useLogVerified(history.res);
  const list = useTokenList();

  // The picker's tokens: the full list once it loads, the vault's two assets until then or when it fails.
  const tokens = useMemo<Token[]>(() => (list.status === "ready" && list.tokens.length > 0 ? list.tokens : FALLBACK), [list.status, list.tokens]);
  const findToken = (id: string): Token | null => tokens.find((t) => t.assetId === id) ?? FALLBACK.find((t) => t.assetId === id) ?? null;

  const [from, setFrom] = useState<Token>(FALLBACK[0]);
  const [to, setTo] = useState<Token>(FALLBACK[1]);
  const [amount, setAmount] = useState("0.05");
  const [quoted, setQuoted] = useState<{ key: string; minOut?: string } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [prices, setPrices] = useState<PriceBook>({});
  const [dry, setDry] = useState<Quote | null>(null);
  const [dryMsg, setDryMsg] = useState<string | null>(null);
  const [dryBusy, setDryBusy] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockErr, setUnlockErr] = useState<string | null>(null);
  const quoteKey = useRef("");

  const fromId = from.assetId;
  const toId = to.assetId;
  const units = toBaseUnits(amount, from.decimals);
  const tradeKey = `${fromId}:${toId}:${units ?? ""}`;
  const samePair = fromId === toId;
  const sessionLive = !!(session && held && session.token_id === held.token.token_id);
  const quoteFresh = !!quoted && quoted.key === tradeKey;
  const swapDone = !!(swap.res?.output?.ok && swap.res.output.op === "swap" && done);

  // Balances come only from the holder's signed read. Nothing is guessed.
  const bal = balance.res?.output?.ok ? (balance.res.output.balances as RawBalance[]) : null;
  const fromRaw = bal ? rawFor(bal, fromId) : null;
  const balanceText = fromRaw != null ? `${fromBaseUnits(fromRaw, from.decimals)} ${from.symbol}` : null;
  const overBalance = fromRaw != null && !!units && BigInt(units) > BigInt(fromRaw);
  const amountError = amount !== "" && !units ? "Enter an amount above zero." : overBalance ? "That is more than your balance." : null;

  // USD of the pay side: the public price book when it has the token, otherwise the price from the token list.
  const priceOf = (t: Token): TokenPrice | undefined => {
    const book = prices[t.assetId.toLowerCase()];
    if (book) return book;
    const m = t.price != null ? priceToMicro(t.price) : null;
    return m != null ? { priceMicro: m } : undefined;
  };
  const fromPrice = priceOf(from);
  const payUsd = units && fromPrice ? valueMicro(units, from.decimals, fromPrice.priceMicro) : null;

  const q = quote.res?.output;
  const qq: Quote | null = quoteFresh && q?.ok ? ((q.quote as Quote | undefined) ?? null) : null;
  const dq: Quote | null = accountId ? null : dry;
  const estimate = qq?.amountOutFormatted ?? dq?.amountOutFormatted ?? null;
  const inFormatted = qq?.amountInFormatted ?? dq?.amountInFormatted ?? amount;
  const rate = estimate && Number(inFormatted) > 0 ? Number(estimate) / Number(inFormatted) : null;
  const usdSrc = qq ?? dq;
  const spread = usdSrc && usdSrc.amountInUsd != null && usdSrc.amountOutUsd != null ? Number(usdSrc.amountInUsd) - Number(usdSrc.amountOutUsd) : null;
  const eta = qq?.timeEstimate ?? dq?.timeEstimate ?? null;
  const minOutText = quoteFresh && quoted?.minOut ? `${fromBaseUnits(quoted.minOut, to.decimals, 6)} ${to.symbol}` : null;

  // The public price book for the USD lines. The page works without it.
  useEffect(() => {
    let cancel = false;
    fetch("/api/prices").then((r) => (r.ok ? r.json() : null)).then((j) => { if (!cancel && j?.prices) setPrices(j.prices); }).catch(() => {});
    return () => { cancel = true; };
  }, []);

  // No wallet: a live dry 1Click price for the same pair. It is labelled as a price only.
  useEffect(() => {
    if (accountId || samePair || !units) { setDry(null); setDryMsg(null); return; }
    let cancel = false;
    const id = setTimeout(async () => {
      setDryBusy(true); setDryMsg(null);
      try {
        const j = await (await fetch("/api/oneclick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin: fromId, dest: toId, amount: units }) })).json();
        if (cancel) return;
        if (j.ok) setDry(j.quote); else { setDry(null); setDryMsg(humanDry(j.error?.code)); }
      } catch { if (!cancel) { setDry(null); setDryMsg("Could not reach 1Click. Check your connection and try again."); } }
      finally { setDryBusy(false); }
    }, 700);
    return () => { cancel = true; clearTimeout(id); };
  }, [accountId, samePair, units, fromId, toId]);

  // With a live session a quote costs no popup, so it is re-run (debounced) when the trade changes.
  const runQuote = quote.run;
  useEffect(() => {
    if (!sessionLive || !units || !accountId || samePair || quoteKey.current === tradeKey) return;
    const id = setTimeout(() => {
      quoteKey.current = tradeKey;
      void runQuote(quoteParams(accountId, fromId, toId, units), { quiet: true });
    }, 800);
    return () => clearTimeout(id);
  }, [sessionLive, units, accountId, fromId, toId, samePair, tradeKey, runQuote]);

  useEffect(() => {
    if (!quote.res) return;
    if (!quote.res.output?.ok) { setQuoted(null); return; }
    const min = (quote.res.output.quote as Quote | undefined)?.minAmountOut;
    setQuoted({ key: quoteKey.current, minOut: typeof min === "string" && /^\d+$/.test(min) ? min : undefined });
  }, [quote.res]);

  // A redirect wallet returns to this page with the swap pending: show the trade it was for.
  useEffect(() => {
    const ctx = pending?.ctx;
    if (ctx?.op === "swap") setDone({ give: ctx.give, decimals: ctx.decimals, symbol: ctx.symbol });
  }, [pending]);
  useEffect(() => { if (swap.res) sessionStorage.removeItem(OP_CTX); }, [swap.res]);
  const readBalance = balance.run;
  useEffect(() => {
    if (!swap.res?.output?.ok || swap.res.output.op !== "swap" || !session) return;
    void readBalance({}, { quiet: true });
  }, [swap.res, readBalance, session]);

  const step = swapStep({
    signedIn: !!accountId, lookingUp, keyMiss, hasKey: !!held, sessionLive,
    amountOk: !!units && !overBalance, samePair, quoteFresh, quoting: quote.busy, swapping: swap.busy, swapDone,
  });
  const cta = SWAP_LABEL[step];

  function review() {
    if (!units || !accountId || samePair) return;
    quoteKey.current = tradeKey;
    swap.reset();
    void quote.run(quoteParams(accountId, fromId, toId, units));
  }
  function confirm() {
    if (!units || !quoted || quoted.key !== tradeKey || !accountId) return;
    const ctx: OpResume = { op: "swap", give: `${amount} ${from.symbol}`, decimals: to.decimals, symbol: to.symbol };
    sessionStorage.setItem(OP_CTX, JSON.stringify(ctx));
    setDone({ give: ctx.give, decimals: ctx.decimals, symbol: ctx.symbol });
    void swap.run(swapParamsById(fromId, toId, units, quoted.minOut));
  }
  async function unlock() {
    if (!held) return;
    setUnlocking(true); setUnlockErr(null);
    const r = await startSession(held.token.token_id);
    setUnlocking(false);
    if (!r.ok) setUnlockErr(r.code);
  }
  function again() {
    swap.reset(); quote.reset(); quoteKey.current = ""; setQuoted(null); setDone(null);
  }
  function onCta() {
    if (step === "connect") void connect();
    else if (step === "unlock") void unlock();
    else if (step === "review") review();
    else if (step === "confirm") confirm();
    else if (step === "done") again();
  }
  function flip() { setFrom(to); setTo(from); }
  function pickFrom(id: string) { const t = findToken(id); if (!t) return; if (t.assetId === toId) setTo(from); setFrom(t); }
  function pickTo(id: string) { const t = findToken(id); if (!t) return; if (t.assetId === fromId) setFrom(to); setTo(t); }

  // Each option carries its balance once the holder has read it (only when it is not zero).
  const options = useMemo<TokenOption[]>(() => tokens.map((t) => {
    const raw = rawFor(bal, t.assetId);
    return toOption(t, bal && raw !== "0" ? `${fromBaseUnits(raw, t.decimals)} ${t.symbol}` : undefined);
  }), [tokens, bal]);

  const notice = list.status === "loading"
    ? "Loading every token NEAR Intents can swap…"
    : list.status === "error"
      ? <>Could not load the full token list. Only {ASSETS.usdc.symbol} and {ASSETS.wnear.symbol} are offered for now. <button type="button" className="kh-token-retry" onClick={list.retry}>Try again</button></>
      : null;

  const hist = history.res?.output?.ok ? ((history.res.output.entries as Hist[] | undefined) ?? []) : null;
  const mine = hist ? [...hist].reverse().filter((e) => e.kind === "swap").slice(0, 6) : [];
  const human = (raw?: string, tok?: string) => {
    const t = tok ? findToken(tok) : null;
    const a = !t && tok ? assetByToken(tok) : null;
    if (t && raw) return `${fromBaseUnits(raw, t.decimals)} ${t.symbol}`;
    if (a && raw) return `${fromBaseUnits(raw, a.decimals)} ${a.symbol}`;
    return `${raw ?? ""} ${tok ? shortTokenId(tok) : ""}`.trim();
  };
  const busyLabel = step === "pending" ? swap.label || "Swapping" : step === "quoting" ? quote.label || "Getting your price" : unlocking ? "Waiting for your wallet" : cta.label;

  return (
    <div className="page sw-page" data-testid="swap-page" data-step={step}>
      <Purpose eyebrow="NEAR Intents · 1Click · mainnet" title="Swap" line="Check the price, then swap. Your swap runs inside your key's vault, from its own balance." />

      <Card as="section" className="sw-card" testid="swap-card" aria-label="Swap">
        <div className="sw-leg">
          <AmountInput
            label="You pay"
            value={amount}
            onChange={setAmount}
            symbol={from.symbol}
            balance={balanceText ?? undefined}
            usd={payUsd != null ? `about ${formatUsdMicro(payUsd)}` : undefined}
            onMax={fromRaw && fromRaw !== "0" ? () => setAmount(fromBaseUnits(fromRaw, from.decimals, from.decimals)) : undefined}
            error={amountError}
            testid="swap-amount"
            end={<TokenSelect label="Pay with" options={options} value={fromId} onChange={pickFrom} testid="swap-from" notice={notice} />}
          />
          {!balanceText && accountId && (
            <div className="sw-hint">
              <Button variant="ghost" size="sm" loading={balance.busy} loadingLabel="Reading your balance" onClick={() => void balance.run({})} testid="swap-balance-btn">
                {sessionLive ? "Read balance (session, no popup)" : "Sign to see balance"}
              </Button>
            </div>
          )}
          {balance.res?.error && <ErrorBox code={balance.res.error.code} retryAfter={balance.res.error.retry_after} />}
        </div>

        <div className="sw-flip">
          <button type="button" onClick={flip} aria-label={`Switch: pay ${to.symbol}, receive ${from.symbol}`} data-testid="swap-flip">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v16M3 16l4 4 4-4" /><path d="M17 20V4M13 8l4-4 4 4" /></svg>
          </button>
        </div>

        <div className="sw-recv">
          <div className="sw-recv-top">
            <span className="sw-label" id="sw-recv-label">You receive</span>
            {dryBusy && !estimate && !accountId ? <span className="sw-busy" role="status">Checking price…</span> : !accountId && <Badge tone="info" testid="price-only">Price only, nothing moves</Badge>}
          </div>
          <div className="sw-recv-row">
            <output className={`sw-amt${estimate ? "" : " empty"}`} aria-labelledby="sw-recv-label" data-testid="swap-receive">
              {estimate ? formatAmount(estimate) : "—"}
            </output>
            <TokenSelect label="Receive in" options={options} value={toId} onChange={pickTo} testid="swap-to" notice={notice} />
          </div>
          {dryMsg && !accountId && <p className="sw-note" role="alert" data-testid="dry-msg">{dryMsg}</p>}
        </div>

        <dl className="sw-facts" data-testid="swap-facts">
          <div><dt>Route</dt><dd>NEAR Intents, via 1Click</dd></div>
          <div><dt>Rate</dt><dd>{rate != null ? `1 ${from.symbol} ≈ ${formatAmount(rate)} ${to.symbol}` : "Shown after you review"}</dd></div>
          <div><dt>Fee and spread</dt><dd>{spread != null ? `about ${formatUsdMicro(Math.max(0, Math.round(spread * 1e6)))}` : "Shown after you review"}</dd></div>
          <div><dt>Max slippage</dt><dd>1%</dd></div>
          <div><dt>Minimum received</dt><dd>{minOutText ?? "Shown after you review"}</dd></div>
          <div><dt>Time</dt><dd>{eta != null ? `about ${eta}s` : "About a minute"}</dd></div>
        </dl>

        {step === "get_key" ? (
          <Button href="/mint" block size="lg" testid="swap-cta">{cta.label}</Button>
        ) : (
          <Button
            block size="lg" testid="swap-cta"
            disabled={!cta.enabled || unlocking}
            loading={step === "quoting" || step === "pending" || unlocking}
            loadingLabel={busyLabel}
            onClick={onCta}
          >
            {busyLabel}
          </Button>
        )}

        {!accountId && <p className="sw-note">Connect a wallet to swap. Checking a price needs no wallet and moves nothing.</p>}
        {accountId && held && <p className="sw-note">Signed in as <span className="mono">{shortAccount(accountId)}</span>. Your key is held.</p>}
        {unlockErr && <ErrorBox code={unlockErr} />}
        {quote.res?.error && <ErrorBox code={quote.res.error.code} retryAfter={quote.res.error.retry_after} />}
        {swap.res?.error && <ErrorBox code={swap.res.error.code} retryAfter={swap.res.error.retry_after} />}
        {swap.busy && <TxResult state="pending" title="Signing and settling the swap" testid="trade-pending" />}
        {swapDone && done && swap.res?.output && (
          <TxResult state="confirmed" testid="trade-out" title={tradeSummary(done.give, String(swap.res.output.amount_out ?? "0"), done.decimals, done.symbol)} callId={swap.res.call_id ?? undefined} intentHash={swap.res.output.intent_hash ? String(swap.res.output.intent_hash) : undefined}>
            <p className="sw-note">{String(swap.res.output.status ?? "")}</p>
          </TxResult>
        )}
        {quote.res && !swapDone && <Attested r={quote.res} />}
      </Card>

      <Card as="section" className="sw-recent" testid="swap-recent" aria-labelledby="sw-recent-h">
        <div className="sw-recent-head">
          <h2 id="sw-recent-h">{hist ? "Your recent swaps" : "Recent public orders"}</h2>
          {accountId && !history.res && (
            <Button variant="secondary" size="sm" loading={history.busy} loadingLabel="Reading your history" onClick={() => void history.run({})} testid="history-btn">
              Read my history
            </Button>
          )}
        </div>
        {hist && historyOk === null && <p className="sw-note">Checking the log…</p>}
        {hist && historyOk === false && <p className="sw-note" data-testid="swap-log-hidden">Not shown: the log did not verify.</p>}
        {hist && historyOk === true && mine.length === 0 && <p className="sw-note">No swaps in your history yet.</p>}
        {hist && historyOk === true && mine.length > 0 && (
          <ul className="sw-list" data-testid="swap-mine">
            {mine.map((e, i) => (
              <li key={i}>
                <span>{human(e.amount_in, e.token_in)} → {human(e.amount_out, e.token_out)}</span>
                <small>{e.ts_ms ? new Date(e.ts_ms).toLocaleString() : ""}</small>
              </li>
            ))}
          </ul>
        )}
        {!hist && (
          <>
            <p className="sw-note">Public 1Click orders on NEAR mainnet, not yours. {accountId ? "Read your history to see your own swaps." : ""}</p>
            <ul className="sw-list" data-testid="swap-public">
              {SETTLEMENTS.slice(0, 3).map((s) => (
                <li key={s.depositAddress}>
                  <span>{s.label}</span>
                  <a href={s.depositTxUrl ?? tx(s.depositTx)} target="_blank" rel="noreferrer">Proof ↗</a>
                </li>
              ))}
            </ul>
            <p className="sw-note"><Link href="/settle">See every order and where its funds are</Link></p>
          </>
        )}
        {history.res?.error && <ErrorBox code={history.res.error.code} retryAfter={history.res.error.retry_after} />}
      </Card>
    </div>
  );
}
