"use client";
import { useEffect, useId, useMemo, useState } from "react";
import QRCode from "qrcode";
import { FUND_STEPS, fundsStep, isTerminalStatus, refundAddrOk, statusOf } from "@/lib/oneclick";
import { chainName, useTokenList } from "@/lib/tokens";
import { Button, Spinner, TokenSelect, type TokenOption } from "./ui";
import { CopyButton, QRFrame } from "./motion";

/** The quote as /api/oneclick/deposit returns it (only the fields the screen shows). */
type Quote = {
  depositAddress: string;
  depositMemo: string | null;
  amountInFormatted: string | null;
  amountOutFormatted: string | null;
  minAmountIn: string | null;
  timeEstimate: number | null;
  deadline: string | null;
  timeWhenInactive: string | null;
};
type Status = { status?: string; updatedAt?: string };
type Sent = { symbol: string; chain: string };

const POLL_MS = 10_000;
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
/** The token pre-selected in the picker when the holder has not chosen one: USDC on Base, if the list has it. */
export function defaultOrigin(options: TokenOption[]): string | null {
  return options.find((o) => o.symbol.toUpperCase() === "USDC" && o.chain === "base")?.id ?? null;
}

/**
 * "From another chain" for the vault. The holder picks a token and chain they hold (every 1Click asset except NEAR), and
 * the vault receives `units` of `destSymbol` (USDC or wNEAR) at `recipient`, the vault's deposit target read from the worker.
 * An executable 1Click quote (EXACT_OUTPUT) gives the exact amount to send and the deposit address. Status is polled until
 * a terminal state, then polling stops. Nothing is shown that the quote or the status route did not return.
 */
export function FundFromChain({ recipient, dest, destSymbol, units, amount, evm }: {
  recipient: string;
  dest: "usdc" | "wnear";
  destSymbol: string;
  /** The amount the vault receives, in base units of the destination asset. */
  units: string;
  /** The same amount, as the holder typed it. */
  amount: string;
  evm?: string | null;
}) {
  const list = useTokenList();
  const refundId = useId();
  const options: TokenOption[] = useMemo(() => list.tokens
    .filter((t) => t.blockchain !== "near")
    .map((t) => ({ id: t.assetId, symbol: t.symbol, name: t.symbol, assetId: t.assetId, chain: t.blockchain, price: t.price })), [list.tokens]);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? defaultOrigin(options);
  const current = options.find((o) => o.id === selected) ?? null;
  const [refund, setRefund] = useState(evm ?? "");
  const refundValid = !!current?.chain && refundAddrOk(current.chain, refund.trim());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [svg, setSvg] = useState("");
  const [st, setSt] = useState<Status | null>(null);
  const [stErr, setStErr] = useState(false);
  const addr = quote?.depositAddress ?? null;
  const done = isTerminalStatus(st?.status);

  useEffect(() => {
    if (!addr) return;
    QRCode.toString(addr, { type: "svg", margin: 1, width: 168 }).then(setSvg).catch(() => setSvg(""));
  }, [addr]);

  // Poll the status route every 10 s. Stops for good on a terminal status (SUCCESS, FAILED, REFUNDED, INCOMPLETE_DEPOSIT).
  useEffect(() => {
    if (!addr) return;
    let stop = false;
    let id: ReturnType<typeof setInterval> | undefined;
    const halt = () => { if (id !== undefined) { clearInterval(id); id = undefined; } };
    const tick = async () => {
      const r = await fetch(`/api/oneclick?depositAddress=${encodeURIComponent(addr)}`).then((x) => x.json()).catch(() => null);
      if (stop) return;
      if (r?.ok) { setSt(r as Status); setStErr(false); if (isTerminalStatus(r.status)) halt(); }
      else setStErr(true);
    };
    void tick();
    id = setInterval(() => void tick(), POLL_MS);
    return () => { stop = true; halt(); };
  }, [addr]);

  const get = async () => {
    if (!current || !refundValid || busy) return;
    setBusy(true); setErr(null); setQuote(null); setSent(null); setSt(null); setStErr(false); setSvg("");
    const r = await fetch("/api/oneclick/deposit", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin: current.id, originChain: current.chain, dest, amount: units, recipient, refundTo: refund.trim() }),
    }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (r?.ok && r.quote?.depositAddress) { setQuote(r.quote as Quote); setSent({ symbol: current.symbol, chain: current.chain ?? "" }); return; }
    setErr(r?.error?.code === "rate_limited" ? "Too many quotes in a minute. Wait a moment and try again." : "No solver quoted this route right now. Try another token or amount.");
  };

  const fs = fundsStep(st?.status);
  const chainLabel = current?.chain ? chainName(current.chain) : "";
  const refundPlaceholder = chainLabel ? `Your address on ${chainLabel}` : "Choose a token first";
  const stText = !st ? (stErr ? "Status unavailable right now. Retrying every 10 seconds." : "Checking status…")
    : `${statusOf(st.status).label}. ${statusOf(st.status).where}`;

  return (
    <div className="vlt-fc" data-testid="fund-any-chain">
      <p className="vlt-sub">Pay from a chain you already hold. 1Click (NEAR Intents) swaps it into {destSymbol} and delivers it to your vault. You send from your own wallet; creating the quote moves no funds.</p>

      {list.status === "loading" && <p className="vlt-sub"><Spinner label="Loading tokens" /> Loading the token list…</p>}
      {list.status === "error" && (
        <div className="vlt-stack">
          <p className="vlt-sub" role="alert">{list.error ?? "The token list is unavailable right now."}</p>
          <div className="vlt-actions"><Button variant="secondary" size="sm" onClick={list.retry} testid="fac-retry">Try again</Button></div>
        </div>
      )}

      {list.status === "ready" && !quote && (
        <div className="vlt-stack">
          <div className="vlt-field">
            <span className="vlt-label">Token you hold</span>
            <TokenSelect label="Token you hold" options={options} value={selected} onChange={(id) => { setPicked(id); setErr(null); }} testid="fac-token" />
          </div>
          <div className="vlt-field">
            <label className="vlt-label" htmlFor={refundId}>Refund address{chainLabel ? ` on ${chainLabel}` : ""}</label>
            <div className="vlt-box" aria-invalid={!!refund && !refundValid}>
              <input id={refundId} value={refund} onChange={(e) => { setRefund(e.target.value); setErr(null); }} placeholder={refundPlaceholder} autoComplete="off" spellCheck={false} data-testid="fac-refund" />
            </div>
            {refund && current && !refundValid && <p className="vlt-sub" role="alert">That is not a {chainLabel} address.</p>}
            <p className="vlt-sub">If the swap cannot fill, 1Click returns your deposit to this address.</p>
          </div>
          <p className="vlt-sub">The vault receives <b data-testid="fac-want">{amount} {destSymbol}</b>. The exact amount to send is in the quote.</p>
          <Button block testid="fac-quote" loading={busy} loadingLabel="Asking solvers" disabled={!current || !refundValid || busy} onClick={() => void get()}>
            Get deposit address
          </Button>
          {err && <p className="vlt-sub" role="alert" data-testid="fac-error">{err}</p>}
        </div>
      )}

      {quote && sent && (
        <div className="vlt-stack" data-testid="fac-deposit">
          <div className="depqr">
            {svg && <QRFrame caption="Scan to copy the address"><div className="qr" role="img" aria-label={`QR code of the ${chainName(sent.chain)} deposit address`} dangerouslySetInnerHTML={{ __html: svg }} /></QRFrame>}
            <div className="vlt-stack">
              <p className="vlt-sub">Send exactly <b data-testid="fac-send">{quote.amountInFormatted ?? "—"} {sent.symbol}</b> on <b>{chainName(sent.chain)}</b> to:</p>
              <div className="vlt-box ro"><span className="v addr" data-testid="fac-address">{quote.depositAddress}</span><CopyButton value={quote.depositAddress} label="Copy address" /></div>
              {quote.amountInFormatted && (
                <div className="vlt-actions"><span className="vlt-sub">Amount: <b>{quote.amountInFormatted} {sent.symbol}</b></span><CopyButton value={quote.amountInFormatted} label="Copy amount" /></div>
              )}
              {quote.depositMemo && (
                <div className="vlt-stack" data-testid="fac-memo">
                  <p className="vlt-sub" role="alert">Send this memo with the deposit, or it may not be credited:</p>
                  <div className="vlt-box ro"><span className="v">{quote.depositMemo}</span><CopyButton value={quote.depositMemo} label="Copy memo" /></div>
                </div>
              )}
              <p className="vlt-sub">The vault receives about <b>{quote.amountOutFormatted ?? amount} {destSymbol}</b>. Minimum you can send: {quote.minAmountIn ?? "—"} {sent.symbol}.</p>
              <p className="vlt-sub">Send before {clock(quote.timeWhenInactive ?? quote.deadline)}; quote deadline {clock(quote.deadline)}{quote.timeEstimate ? `. Usually settles within ${quote.timeEstimate}s after the deposit.` : "."}</p>
            </div>
          </div>
          <ol className="vlt-fc-steps" data-testid="fac-progress">
            {FUND_STEPS.map((s, i) => (
              <li key={s} data-state={fs && i < fs.step ? "done" : fs && i === fs.step ? "now" : "next"}>{i === 3 && fs?.refund ? "Refunded to you" : i === 3 ? "Your vault" : s}</li>
            ))}
          </ol>
          <p className="vlt-sub" data-testid="fac-status">{stText}{done ? " Status checks have stopped." : ""}</p>
          <p className="vlt-sub"><a href={`https://explorer.near-intents.org/transactions/${quote.depositAddress}`} target="_blank" rel="noreferrer">Intents explorer ↗</a></p>
          <div className="vlt-actions"><Button variant="secondary" size="sm" testid="fac-new" onClick={() => { setQuote(null); setSent(null); setSt(null); setStErr(false); }}>New quote</Button></div>
        </div>
      )}
    </div>
  );
}
