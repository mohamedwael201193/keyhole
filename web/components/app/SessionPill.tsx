"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useKeyStore } from "@/lib/keyStore";
import { minutesLeft } from "@/lib/session";
import { capsOf } from "@/lib/dashboard";
import { errorText } from "@/lib/i18n";
import { Icon } from "@/components/v7/icons";
import Link from "next/link";
import { dashHref } from "@/lib/dashboardSections";

/**
 * The session pill in the app top bar. Locked: one tap starts the 30-minute session (one signature, or in-page for
 * Google and email). Unlocked: the pill opens a small popover that says what the session allows and offers Revoke.
 * The pill never vanishes for a signed-in account: while the key read is still running it reads "Checking your key…",
 * and when the account holds no key it links to /mint. Only a signed-out visitor sees nothing here.
 * It only calls useWallet() and useKeyStore(); the session logic
 * stays in lib/wallet.tsx (startSession, revokeSession) and lib/session.ts.
 */
export function SessionPill() {
  const { accountId, session, startSession, revokeSession, via } = useWallet();
  const { primary, tier, status, refresh } = useKeyStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);

  // The minutes left move on their own: re-render every 20 seconds.
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 20_000); return () => clearInterval(id); }, []);

  const tokenId = primary?.token_id ?? null;
  const minutes = session && tokenId && session.account === accountId && session.token_id === tokenId ? minutesLeft(session) : 0;
  const live = minutes > 0;
  const privy = via === "privy";
  const pop = (open && live) || !!err;

  // Escape closes the popover (and returns focus to the pill); a press outside closes it too.
  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const hadFocus = wrap.current?.contains(document.activeElement);
      setOpen(false); setErr(null);
      if (hadFocus) pill.current?.focus();
    };
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) { setOpen(false); setErr(null); } };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [pop]);

  if (!accountId) return null;

  // Signed in, but the key read has not settled yet (or has never run): the pill stays visible as a
  // disabled "Checking your key…" instead of vanishing — a vanished pill left a signed-in holder with no
  // unlock affordance anywhere while a mint's key was still propagating to the store.
  if (!tokenId && (status === "idle" || status === "loading")) {
    return (
      <div className="sp" ref={wrap}>
        <button type="button" className="sp-pill" disabled aria-busy data-testid="session-pill" data-state="checking">
          <Icon name="lock" size={16} />
          <span>Checking your key…</span>
        </button>
      </div>
    );
  }
  if (!tokenId && status === "error") {
    return (
      <div className="sp" ref={wrap}>
        <button type="button" className="sp-pill" onClick={() => refresh()} data-testid="session-pill" data-state="key-error">
          <Icon name="lock" size={16} />
          <span>Key check failed · Try again</span>
        </button>
      </div>
    );
  }
  // Signed in, key read settled, no key on this account: link to /mint instead of hiding.
  if (!tokenId) {
    return (
      <div className="sp" ref={wrap}>
        <Link href={dashHref("/mint")} className="sp-pill" data-testid="session-pill" data-state="no-key">
          <Icon name="key" size={16} />
          <span>No key on this account</span>
        </Link>
      </div>
    );
  }

  const unlock = async () => {
    setBusy(true); setErr(null);
    const r = await startSession(tokenId);
    setBusy(false);
    if (!r.ok) setErr(r.code);
  };
  const revoke = async () => {
    setOpen(false);
    await revokeSession();
  };
  const caps = tier != null ? capsOf(tier) : null;

  return (
    <div className="sp" ref={wrap}>
      {live ? (
        <button
          ref={pill}
          type="button"
          className="sp-pill on"
          aria-expanded={open}
          aria-controls="sp-pop"
          onClick={() => { setErr(null); setOpen((v) => !v); }}
          data-testid="session-pill"
          data-state="unlocked"
        >
          <Icon name="unlock" size={16} />
          <span className="sp-word">Unlocked</span>
          <span className="sp-sep" aria-hidden="true">·</span>
          <span className="sp-time">{minutes}<span className="sp-unit"> min</span></span>
        </button>
      ) : (
        <button
          ref={pill}
          type="button"
          className="sp-pill"
          onClick={() => void unlock()}
          disabled={busy}
          aria-busy={busy || undefined}
          title={privy ? "Signed in-page. No popup." : "One wallet signature, 30 minutes"}
          data-testid="session-pill"
          data-state="locked"
        >
          <Icon name="lock" size={16} />
          {busy ? (
            <span>{privy ? "Signing in-page…" : "Confirm in wallet…"}</span>
          ) : (
            <>
              <span className="sp-word">Locked</span>
              <span className="sp-sep" aria-hidden="true">·</span>
              <span className="sp-time">Unlock</span>
            </>
          )}
        </button>
      )}
      {pop && (
        <div id="sp-pop" className="sp-pop" role="dialog" aria-label="Session" data-testid="session-pop">
          {err ? (
            <>
              <p role="alert" className="sp-lead">{errorText(err)[0]}</p>
              <p className="sp-note">{errorText(err)[1]}</p>
              <div className="sp-row">
                <button type="button" className="sp-btn" onClick={() => void unlock()} disabled={busy} data-testid="session-retry">Try again</button>
                <button type="button" className="sp-link" onClick={() => setErr(null)}>Dismiss</button>
              </div>
            </>
          ) : (
            <>
              <p className="sp-lead"><b>Unlocked for {minutes} min.</b> Reads and swaps run under your caps{caps ? `: $${caps.perTx} a trade, $${caps.daily} a day` : ""}. Withdrawals always ask your wallet again.</p>
              {privy && <p className="sp-note">Signed in-page. No popup.</p>}
              <div className="sp-row">
                <button type="button" className="sp-btn" onClick={() => void revoke()} data-testid="session-revoke">Revoke</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
