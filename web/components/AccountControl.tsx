"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { useKeyStoreOptional } from "@/lib/keyStore";
import { minutesLeft } from "@/lib/session";
import { compactAccount, shortAccount } from "@/lib/near";
import { acct } from "@/lib/config";
import { copyText } from "@/lib/copyText";

/**
 * The account control: Connect, a neutral "restoring" pill, or the connected account with its menu.
 * Shared by the public top bar (components/Nav.tsx) and the app shell (components/app/AppShell.tsx).
 * It only renders useWallet(); no sign-in or session logic lives here.
 */
export function AccountControl() {
  const { t } = useI18n();
  const { accountId, connect, disconnect, restoring, mismatch, session, startSession, revokeSession } = useWallet();
  // The account menu is the one place a holder looks when the top-bar pill is missed: offer the same
  // unlock there when this account holds a key. Outside the app shell there is no key store; then no
  // unlock entry is shown rather than throwing.
  const keyStore = useKeyStoreOptional();
  const tokenId = keyStore?.primary?.token_id ?? null;
  const live = !!(session && tokenId && session.account === accountId && session.token_id === tokenId && minutesLeft(session) > 0);
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  // The server renders Connect disabled; it becomes clickable only once React owns it, so an early tap
  // can never land on a button with no handler (the mobile first-click flake).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const acctRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMenu(false); }, [path]);
  useEffect(() => {
    if (!menu) return;
    const onPointer = (e: PointerEvent) => { if (!acctRef.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [menu]);
  const copyAccount = async () => {
    if (!accountId) return;
    await copyText(accountId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  if (accountId) {
    return (
      <div className="acct" ref={acctRef}>
        {mismatch && <button type="button" className="cw warn" data-testid="wallet-mismatch" title={`MetaMask is on ${mismatch}, but this site is connected as ${accountId}. Reconnect to switch.`} onClick={() => { void disconnect().then(() => connect()); }}>MetaMask switched · reconnect</button>}
        <button type="button" className="cw" aria-expanded={menu} aria-controls="acct-menu" aria-label={accountId} data-testid="account" onClick={() => setMenu((v) => !v)} title={accountId}><span className="cw-avatar" aria-hidden="true">{accountId.replace(/[^a-z0-9]/gi, "").slice(0, 1).toUpperCase()}</span><span className="cw-full">{shortAccount(accountId, 4)}</span><span className="cw-short">{compactAccount(accountId)}</span></button>
        {menu && (
          <div id="acct-menu" className="acct-menu" role="menu" data-testid="account-menu">
            <p className="id" data-testid="account-id">{accountId}</p>
            {tokenId && !live && <button type="button" role="menuitem" onClick={() => { setMenu(false); void startSession(tokenId); }} data-testid="account-unlock">Unlock</button>}
            {tokenId && live && <button type="button" role="menuitem" onClick={() => { setMenu(false); void revokeSession(); }} data-testid="account-lock">Lock now</button>}
            <button type="button" role="menuitem" onClick={() => void copyAccount()}>{copied ? t("nav.copied") : t("nav.copy")}</button>
            <a role="menuitem" href={acct(accountId)} target="_blank" rel="noreferrer">{t("nav.explorer")}</a>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); void disconnect().then(() => connect()); }} data-testid="account-switch">Switch account</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); void disconnect(); }}>{t("nav.disconnect")}</button>
          </div>
        )}
      </div>
    );
  }
  if (restoring) {
    // A disabled "Connect wallet" while the session restores reads as a dead button; say what is happening.
    return <button type="button" className="cw" disabled data-testid="wallet-restoring" aria-busy="true">{t("nav.signingBackIn")}</button>;
  }
  return <button type="button" className="cw" onClick={() => void connect()} disabled={!hydrated} data-hydrated={hydrated ? "1" : "0"} data-testid="connect">{t("nav.connect")}</button>;
}
