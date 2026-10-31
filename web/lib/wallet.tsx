"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { WalletSelector, WalletModuleFactory } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { buildMessage, EIP191_ENCLAVE_LIVE, freshNonce, intentMessage, toB64, utf8ToHex, type Op, type SignedAuth } from "./nep413";
import { NEP413_RECIPIENT } from "./config";

export class SignError extends Error { constructor(public code: string) { super(code); } }

interface WalletCtx {
  accountId: string | null;
  ready: boolean;
  connect: () => void;
  disconnect: () => Promise<void>;
  /** Signs a NEP-413 request for the worker. Redirect wallets resume via `pending` after return. */
  sign: (op: Op, params?: Record<string, unknown>) => Promise<SignedAuth>;
  pending: (SignedAuth & { ctx?: OpResume | null }) | null;
  clearPending: () => void;
}
const Ctx = createContext<WalletCtx | null>(null);
const PENDING = "kh_pending_sign";
export const OP_CTX = "kh_op_ctx";
export type OpResume =
  | { op: "swap"; give: string; decimals: number; symbol: string }
  | { op: "withdraw"; amount: string; to: string };
const CONNECTING = "Confirm the connection in the extension window";
const CONNECTING_NEXT = "Confirm the connection in the extension window. It may open in the MetaMask side panel or the toolbar icon.";
const NET_HELP = "MetaMask will ask to add the NEAR Protocol network — approve it to continue.";
const SIGN_NOTE = "Connecting and minting ask only for a signature. A deposit is a normal transfer you approve in your wallet.";
const ETH_MODAL_CSS = `
.ethereum-wallet-modal-backdrop {
  position: fixed; inset: 0; background: #1A2A2C55 !important;
}
.ethereum-wallet-modal-wrapper {
  position: fixed; inset: 0; z-index: 10000; overflow: auto;
}
.ethereum-wallet-modal-container {
  display: flex !important; min-height: 100%; width: 100%;
  align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;
}
.ethereum-wallet-modal-content {
  background: #F6F1E7 !important;
  color: #1F4B4F !important;
  border: 1px solid #B8893E !important;
  border-radius: 28px !important;
  box-shadow: 0 28px 70px -28px #1A2A2C88 !important;
  font-family: var(--sans);
  padding: 28px !important;
  width: min(420px, calc(100vw - 32px));
  max-width: 420px;
}
.ethereum-wallet-modal h2 {
  font-family: var(--serif) !important;
  font-weight: 600 !important;
  font-size: 32px !important;
  line-height: 1.15 !important;
  text-align: center !important;
  color: #1F4B4F !important;
  margin: 0 0 8px !important;
}
.ethereum-wallet-modal .ethereum-wallet-tx-info-text p,
.ethereum-wallet-modal .ethereum-wallet-tx-info-col dt,
.ethereum-wallet-modal .ethereum-wallet-tx-info-col dd,
.ethereum-wallet-modal .kh-net-help {
  color: #1A2A2C !important;
}
.ethereum-wallet-modal .kh-net-help {
  margin: 8px 0 12px;
  font: 500 15px/1.45 var(--sans);
}
.ethereum-wallet-modal .ethereum-wallet-btn-cancel {
  display: flex !important;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 44px;
  margin-top: 16px;
  padding: 10px 16px !important;
  background: #ECE6DA !important;
  color: #1F4B4F !important;
  border: 1px solid #1A2A2C33 !important;
  border-radius: 999px !important;
  font-weight: 700 !important;
}
.ethereum-wallet-modal .ethereum-wallet-btn-cancel:hover {
  background: #1F4B4F14 !important;
}
`;

/** Cream-restyle the stock selector title, the injected connecting line, and the chain-switch dialog. */
function tuneWalletChrome() {
  document.querySelectorAll("#near-wallet-selector-modal .nws-modal-title").forEach((el) => {
    if (el.textContent !== "Connect your wallet") el.textContent = "Connect your wallet";
  });
  // The installed modal build accepts `description` and never paints it.
  document.querySelectorAll("#near-wallet-selector-modal .nws-modal-title-wrapper").forEach((wrap) => {
    if (wrap.parentElement?.querySelector("[data-kh-sign]")) return;
    const p = document.createElement("p");
    p.dataset.khSign = "";
    p.className = "kh-sign-note";
    p.textContent = SIGN_NOTE;
    wrap.insertAdjacentElement("afterend", p);
  });
  document.querySelectorAll(".connecting-message span, .connecting-message").forEach((el) => {
    if (el.childElementCount) return;
    if (el.textContent?.trim() === CONNECTING) el.textContent = CONNECTING_NEXT;
  });
  document.querySelectorAll(".ethereum-wallet-modal").forEach((modal) => {
    if (modal.querySelector("[data-kh-net]")) return;
    const h2 = [...modal.querySelectorAll("h2")].find((el) => el.textContent?.trim() === "Switch Network");
    if (!h2) return;
    const p = document.createElement("p");
    p.dataset.khNet = "";
    p.className = "kh-net-help";
    p.textContent = NET_HELP;
    h2.insertAdjacentElement("afterend", p);
  });
  if (!document.querySelector(".ethereum-wallet-modal")) return;
  let style = document.getElementById("kh-eth-modal");
  if (!style) {
    style = document.createElement("style");
    style.id = "kh-eth-modal";
    style.textContent = ETH_MODAL_CSS;
  }
  document.head.appendChild(style);
}

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
  const { ethereumWalletModule } = await import("./ethereumWallets");
  const eth = await ethereumWalletModule();
  if (eth) modules.push(eth);
  const wc = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (wc) {
    const { setupWalletConnect } = await import("@near-wallet-selector/wallet-connect");
    modules.push(setupWalletConnect({ projectId: wc, metadata: { name: "KEYHOLE", description: "NFT viewing keys for confidential accounts", url: location.origin, icons: [`${location.origin}/brand/icon-192.png`] } }) as WalletModuleFactory);
  }
  const selector = await setupWalletSelector({ network: "mainnet", modules });
  const modal = setupModal(selector, { theme: "dark", description: SIGN_NOTE });
  return { selector, modal };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const ref = useRef<{ selector: WalletSelector; modal: WalletSelectorModal } | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<(SignedAuth & { ctx?: OpResume | null }) | null>(null);
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
    document.documentElement.dataset.khTune = "1";
    tuneWalletChrome();
    const obs = new MutationObserver(tuneWalletChrome);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    // Resume a redirect-based signMessage (the signature comes back in the URL hash).
    const h = new URLSearchParams(location.hash.slice(1));
    const saved = sessionStorage.getItem(PENDING);
    if (h.get("signature") && saved) {
      const s = JSON.parse(saved) as { message: string; nonce: string; ctx?: OpResume | null };
      setPending({ account_id: h.get("accountId") || "", public_key: h.get("publicKey") || "", signature: h.get("signature") || "",
        nonce: s.nonce, message: s.message, recipient: NEP413_RECIPIENT, ctx: s.ctx });
      sessionStorage.removeItem(PENDING);
      history.replaceState(null, "", location.pathname + location.search);
    }
    // Only load the wallet bundle eagerly if the user connected before; otherwise wait for a click (keeps LCP fast).
    if (localStorage.getItem("near-wallet-selector:selectedWalletId") || localStorage.getItem("near-wallet-selector:recentlySignedInWallets")) {
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback || ((cb: () => void) => setTimeout(cb, 300));
      idle(() => void ensure());
    }
  }, [ensure]);

  const connect = useCallback(() => {
    return ensure().then(() => {
      const modal = ref.current?.modal;
      if (!modal) return;
      // The selector modal mounts on show(). A show() in the same task as the
      // first createRoot can be dropped, so the header's first click opens it twice.
      modal.show();
      requestAnimationFrame(() => { modal.show(); tuneWalletChrome(); });
    });
  }, [ensure]);
  const disconnect = useCallback(async () => {
    await ensure(); const w = await ref.current!.selector.wallet(); await w.signOut(); setAccountId(null);
  }, [ensure]);

  const sign = useCallback(async (op: Op, params: Record<string, unknown> = {}) => {
    await ensure();
    const sel = ref.current!.selector;
    const acc = sel.store.getState().accounts.find((a) => a.active)?.accountId;
    if (!acc) throw new SignError("no_auth");
    if (sel.store.getState().selectedWalletId === "ethereum-wallets") return signEip191(op, acc, params);
    const wallet = await sel.wallet();
    if (typeof wallet.signMessage !== "function") throw new SignError("wallet_no_sign_message");
    const message = buildMessage(op, acc, params);
    const nonceBytes = freshNonce();
    const nonce = toB64(nonceBytes);
    let ctx: OpResume | null = null;
    try { ctx = JSON.parse(sessionStorage.getItem(OP_CTX) || "null") as OpResume | null; } catch { ctx = null; }
    sessionStorage.setItem(PENDING, JSON.stringify({ message, nonce, ctx }));
    let res;
    try {
      res = await wallet.signMessage({ message, recipient: NEP413_RECIPIENT, nonce: nonceBytes as unknown as Buffer, callbackUrl: location.href.split("#")[0] });
    } catch (e) {
      sessionStorage.removeItem(PENDING);
      const m = String((e as Error)?.message || e);
      throw new SignError(/not supported|not implemented|signMessage/i.test(m) ? "wallet_no_sign_message" : "wallet_rejected");
    }
    if (!res) { sessionStorage.removeItem(PENDING); throw new SignError("wallet_rejected"); } // redirect wallets navigate away before this line
    sessionStorage.removeItem(PENDING);
    return { account_id: res.accountId, public_key: res.publicKey, signature: res.signature, nonce, message, recipient: NEP413_RECIPIENT };
  }, [ensure]);

  return <Ctx.Provider value={{ accountId, ready, connect, disconnect, sign, pending, clearPending: () => setPending(null) }}>{children}</Ctx.Provider>;
}
/** MetaMask personal_sign (EIP-191) over the same intent JSON the worker recovers. */
async function signEip191(op: Op, accountId: string, params: Record<string, unknown>): Promise<SignedAuth> {
  if (!EIP191_ENCLAVE_LIVE) throw new SignError("metamask_next_enclave");
  const account = accountId.toLowerCase();
  const nonce = toB64(freshNonce());
  const message = intentMessage(op, account, params, nonce, NEP413_RECIPIENT, Date.now());
  const eth = (window as Window & { ethereum?: { request: (a: { method: string; params: unknown[] }) => Promise<unknown> } }).ethereum;
  if (!eth?.request) throw new SignError("wallet_no_sign_message");
  let signature: unknown;
  try {
    signature = await eth.request({ method: "personal_sign", params: [utf8ToHex(message), account] });
  } catch {
    throw new SignError("wallet_rejected");
  }
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new SignError("wallet_rejected");
  return { account_id: account, address: account, scheme: "eip191", public_key: "", signature, nonce, message, recipient: NEP413_RECIPIENT };
}

export function useWallet() { const c = useContext(Ctx); if (!c) throw new Error("WalletProvider missing"); return c; }
