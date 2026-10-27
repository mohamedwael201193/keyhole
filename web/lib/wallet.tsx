"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { WalletSelector, WalletModuleFactory } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { buildMessage, freshNonce, toB64, type Op, type SignedAuth } from "./nep413";
import { NEP413_RECIPIENT } from "./config";

export class SignError extends Error { constructor(public code: string) { super(code); } }

interface WalletCtx {
  accountId: string | null;
  ready: boolean;
  connect: () => void;
  disconnect: () => Promise<void>;
  /** Signs a NEP-413 request for the worker. Redirect wallets resume via `pending` after return. */
  sign: (op: Op, params?: Record<string, unknown>) => Promise<SignedAuth>;
  pending: SignedAuth | null;
  clearPending: () => void;
}
const Ctx = createContext<WalletCtx | null>(null);
const PENDING = "kh_pending_sign";

async function init(): Promise<{ selector: WalletSelector; modal: WalletSelectorModal }> {
  const [{ setupWalletSelector }, { setupModal }, mnw, meteor, here, intear, sender, nightly, ledger] = await Promise.all([
    import("@near-wallet-selector/core"), import("@near-wallet-selector/modal-ui"),
    import("@near-wallet-selector/my-near-wallet"), import("@near-wallet-selector/meteor-wallet"),
    import("@near-wallet-selector/here-wallet"), import("@near-wallet-selector/intear-wallet"),
    import("@near-wallet-selector/sender"), import("@near-wallet-selector/nightly"), import("@near-wallet-selector/ledger"),
  ]);
  const modules: WalletModuleFactory[] = [
    mnw.setupMyNearWallet(), meteor.setupMeteorWallet(), here.setupHereWallet(), intear.setupIntearWallet(),
    sender.setupSender(), nightly.setupNightly(), ledger.setupLedger(),
  ];
  const wc = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (wc) {
    const { setupWalletConnect } = await import("@near-wallet-selector/wallet-connect");
    modules.push(setupWalletConnect({ projectId: wc, metadata: { name: "KEYHOLE", description: "NFT viewing keys for confidential accounts", url: location.origin, icons: [`${location.origin}/brand/icon-192.png`] } }) as WalletModuleFactory);
  }
  const selector = await setupWalletSelector({ network: "mainnet", modules });
  const modal = setupModal(selector, { theme: "dark", description: "KEYHOLE only asks for message signatures (NEP-413). No transactions, no gas." });
  return { selector, modal };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const ref = useRef<{ selector: WalletSelector; modal: WalletSelectorModal } | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<SignedAuth | null>(null);
  const loading = useRef<Promise<void> | null>(null);

  const ensure = useCallback(() => {
    if (!loading.current) loading.current = init().then((r) => {
      ref.current = r;
      const sync = () => setAccountId(r.selector.store.getState().accounts.find((a) => a.active)?.accountId ?? null);
      sync();
      r.selector.store.observable.subscribe(sync);
      setReady(true);
    });
    return loading.current;
  }, []);

  useEffect(() => {
    // Resume a redirect-based signMessage (e.g. MyNearWallet returns the signature in the URL hash).
    const h = new URLSearchParams(location.hash.slice(1));
    const saved = sessionStorage.getItem(PENDING);
    if (h.get("signature") && saved) {
      const s = JSON.parse(saved) as { message: string; nonce: string };
      setPending({ account_id: h.get("accountId") || "", public_key: h.get("publicKey") || "", signature: h.get("signature") || "",
        nonce: s.nonce, message: s.message, recipient: NEP413_RECIPIENT });
      sessionStorage.removeItem(PENDING);
      history.replaceState(null, "", location.pathname + location.search);
    }
    // Only load the wallet bundle eagerly if the user connected before; otherwise wait for a click (keeps LCP fast).
    if (localStorage.getItem("near-wallet-selector:selectedWalletId") || localStorage.getItem("near-wallet-selector:recentlySignedInWallets")) {
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback || ((cb: () => void) => setTimeout(cb, 300));
      idle(() => void ensure());
    }
  }, [ensure]);

  const connect = useCallback(() => { void ensure().then(() => ref.current!.modal.show()); }, [ensure]);
  const disconnect = useCallback(async () => {
    await ensure(); const w = await ref.current!.selector.wallet(); await w.signOut(); setAccountId(null);
  }, [ensure]);

  const sign = useCallback(async (op: Op, params: Record<string, unknown> = {}) => {
    await ensure();
    const sel = ref.current!.selector;
    const acc = sel.store.getState().accounts.find((a) => a.active)?.accountId;
    if (!acc) throw new SignError("no_auth");
    const wallet = await sel.wallet();
    if (typeof wallet.signMessage !== "function") throw new SignError("wallet_no_sign_message");
    const message = buildMessage(op, acc, params);
    const nonceBytes = freshNonce();
    const nonce = toB64(nonceBytes);
    sessionStorage.setItem(PENDING, JSON.stringify({ message, nonce }));
    let res;
    try {
      res = await wallet.signMessage({ message, recipient: NEP413_RECIPIENT, nonce: nonceBytes as unknown as Buffer, callbackUrl: location.href.split("#")[0] });
    } catch (e) {
      sessionStorage.removeItem(PENDING);
      const m = String((e as Error)?.message || e);
      throw new SignError(/not supported|not implemented|signMessage/i.test(m) ? "wallet_no_sign_message" : "wallet_rejected");
    }
    if (!res) throw new SignError("wallet_rejected"); // redirect wallets navigate away before this line
    sessionStorage.removeItem(PENDING);
    return { account_id: res.accountId, public_key: res.publicKey, signature: res.signature, nonce, message, recipient: NEP413_RECIPIENT };
  }, [ensure]);

  return <Ctx.Provider value={{ accountId, ready, connect, disconnect, sign, pending, clearPending: () => setPending(null) }}>{children}</Ctx.Provider>;
}
export function useWallet() { const c = useContext(Ctx); if (!c) throw new Error("WalletProvider missing"); return c; }
