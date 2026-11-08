"use client";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, Sheet } from "@/components/ui";

/**
 * The one sign-in sheet. Every Connect and Sign in button opens it through useWallet().connect(). It only chooses the
 * method; each option calls the function that already existed (connectSocial, connectNear, connectOther), so the auth,
 * session and signing logic in lib/wallet.tsx and lib/privyBridge.tsx is untouched.
 * The last method used is remembered on this device (localStorage) and marked "Last used".
 */
export type SignInMethod = "google" | "email" | "near" | "meteor" | "evm";

const LAST_KEY = "kh_signin_last";
const METHODS: readonly SignInMethod[] = ["google", "email", "near", "meteor", "evm"];

/** The method used last on this device, or null. Storage can be blocked, so every access is guarded. */
export function readLastMethod(): SignInMethod | null {
  try {
    const v = localStorage.getItem(LAST_KEY);
    return METHODS.includes(v as SignInMethod) ? (v as SignInMethod) : null;
  } catch {
    return null;
  }
}

function rememberMethod(m: SignInMethod) {
  try { localStorage.setItem(LAST_KEY, m); } catch { /* private window or blocked storage: nothing to remember */ }
}

/** The note the wallet selector and this sheet both show, so the signing rule is said the same way everywhere. */
export const SIGN_NOTE = "Connecting and minting ask only for a signature. A deposit is a normal transfer you approve in your wallet.";

/** Shown when the browser blocked the wallet's own window (Meteor opens one to sign in and to sign). */
export const POPUP_BLOCKED_HINT = "Your browser or an ad blocker stopped the wallet window. Allow pop-ups for this site and pause the ad blocker here, then try again.";
const POPUP_BLOCKED = /open popup|popup.*block|POPUP_WINDOW_OPEN_FAILED/i;

/** The hint for a sign-in or sign error whose text says the wallet window was blocked, else null. Pure. */
export function popupBlockedHint(message: string | null | undefined): string | null {
  return message && POPUP_BLOCKED.test(message) ? POPUP_BLOCKED_HINT : null;
}

/** The text a wallet error carries: its message, and the Meteor SDK's endTag (e.g. POPUP_WINDOW_OPEN_FAILED) when it has one. */
export function walletErrorText(e: unknown): string {
  const x = e as { message?: unknown; endTag?: unknown } | null;
  return [x?.message, x?.endTag].filter((v): v is string => typeof v === "string" && v !== "").join(" ") || String(e);
}

export type SignInModalProps = {
  open: boolean;
  onClose: () => void;
  /** False when the Privy app is not configured for this build: Google and email are then hidden. */
  socialEnabled: boolean;
  onGoogle: () => void;
  onEmail: () => void;
  onNear: () => void;
  /** Meteor directly through the wallet selector (no chooser). The sheet stays open until it resolves or fails. */
  onMeteor: () => Promise<void>;
  onOther: () => void;
};

type Option = {
  method: SignInMethod;
  testid: string;
  title: string;
  sub: string;
  icon: ReactNode;
  /** Runs at once in the click. A returned promise keeps the sheet open until it settles. */
  run: () => unknown;
};

type Failure = { text: string; detail: string | null };
function failureOf(e: unknown): Failure {
  const msg = walletErrorText(e);
  const hint = popupBlockedHint(msg);
  return hint ? { text: hint, detail: null } : { text: "Sign-in did not finish. Try again.", detail: msg };
}

const MAIL = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="m4 7 8 6 8-6" />
  </svg>
);
const GOOGLE_G = (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" />
    <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
    <path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9z" />
    <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z" />
  </svg>
);
const NEAR_MARK = <Image src="/logos/near.svg" alt="" width={20} height={20} unoptimized />;
const EVM_MARK = <Image src="/logos/eth.svg" alt="" width={20} height={20} unoptimized />;
const METEOR_MARK = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
    <path d="M3.5 20.5 13 11" /><circle cx="16.5" cy="7.5" r="3.5" />
  </svg>
);

export function SignInModal({ open, onClose, socialEnabled, onGoogle, onEmail, onNear, onMeteor, onOther }: SignInModalProps) {
  const [last, setLast] = useState<SignInMethod | null>(null);
  /** The option whose sign-in is still running (Meteor opens its own window), and the failure of the last one. */
  const [busy, setBusy] = useState<SignInMethod | null>(null);
  const [failed, setFailed] = useState<Failure | null>(null);
  // Read on open, not on mount, so a method chosen in another tab shows the next time the sheet opens.
  useEffect(() => { if (open) { setLast(readLastMethod()); setBusy(null); setFailed(null); } }, [open]);

  const options: Option[] = [
    ...(socialEnabled ? [
      { method: "google" as const, testid: "choose-social", title: "Continue with Google", sub: "No wallet needed", icon: GOOGLE_G, run: onGoogle },
      { method: "email" as const, testid: "choose-email", title: "Continue with email", sub: "We email you a one-time code", icon: MAIL, run: onEmail },
    ] : []),
    { method: "near", testid: "choose-near", title: "NEAR wallet", sub: "HOT, MyNearWallet, Intear, Here. Connect and unlock in one popup.", icon: NEAR_MARK, run: onNear },
    { method: "meteor", testid: "signin-meteor", title: "Meteor", sub: "Opens Meteor Web in a small window", icon: METEOR_MARK, run: onMeteor },
    { method: "evm", testid: "choose-other", title: "MetaMask and other EVM wallets", sub: "Opens the full wallet list, including more NEAR wallets", icon: EVM_MARK, run: onOther },
  ];

  /** Called from the click itself, so a wallet window can open while the user's click is still active. */
  const start = (o: Option) => {
    rememberMethod(o.method);
    setFailed(null);
    const run = o.run();
    if (run instanceof Promise) {
      setBusy(o.method);
      run.then(() => setBusy(null), (e: unknown) => { setBusy(null); setFailed(failureOf(e)); });
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Sign in" testid="wallet-chooser">
      <p className="signin-lead">Choose how to sign in. You only sign a message to prove the account.</p>
      <ul className="signin-list">
        {options.map((o) => (
          <li key={o.method}>
            <button
              type="button"
              className="signin-opt"
              data-testid={o.testid}
              data-method={o.method}
              disabled={busy !== null}
              aria-busy={busy === o.method || undefined}
              onClick={() => start(o)}
            >
              <span className="signin-ico" aria-hidden="true">{o.icon}</span>
              <span className="signin-txt">
                <b>{o.title}</b>
                <small>{o.sub}</small>
              </span>
              {last === o.method && <Badge tone="info" testid={`${o.testid}-last`}>Last used</Badge>}
            </button>
          </li>
        ))}
      </ul>
      {failed && (
        <div role="alert" className="errbox" data-testid="signin-error">
          <p>{failed.text}</p>{failed.detail && <p className="note">{failed.detail}</p>}
        </div>
      )}
      <p className="signin-note">{SIGN_NOTE}</p>
      <div className="signin-foot">
        <button type="button" className="kh-btn kh-btn--ghost" data-testid="choose-cancel" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}
