"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { WalletSelector, WalletModuleFactory } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { buildMessage, EIP191_ENCLAVE_LIVE, freshNonce, intentMessage, toB64, utf8ToHex, type Op, type SignedAuth } from "./nep413";
import { NEP413_RECIPIENT } from "./config";
import { clearSession, inSession, loadSession, saveSession, sessionAuth, sessionParams, type Session } from "./session";
import { callWorker } from "./worker";
import { authFromSignIn, NC_WALLET_KEY, reusable, signInRequest } from "./nearConnect";
import type { NearConnector } from "@hot-labs/near-connect";
import dynamic from "next/dynamic";
import { PRIVY_FLAG, privyEnabled, type PrivyNear } from "./privy";

const PrivyBridge = dynamic(() => import("./privyBridge"), { ssr: false });

let ncPromise: Promise<NearConnector> | null = null;
/** One NearConnector per page (docs.near.org/web3-apps/tutorials/wallet-login). */
function nearConnector(): Promise<NearConnector> {
  if (!ncPromise) ncPromise = import("@hot-labs/near-connect").then(({ NearConnector }) => new NearConnector({ network: "mainnet", features: { signMessage: true } }));
  return ncPromise;
}

/** Tell the enclave to revoke the stored session (best effort) and forget it locally. */
async function revokeStored(account: string | null) {
  const live = loadSession(account);
  clearSession();
  if (live) await callWorker("session_revoke", sessionAuth(live, "session_revoke") as unknown as SignedAuth).catch(() => null);
}

export class SignError extends Error { constructor(public code: string) { super(code); } }

interface WalletCtx {
  accountId: string | null;
  ready: boolean;
  /** A wallet from an earlier visit is being restored; show a neutral pill, not "Connect wallet". */
  restoring: boolean;
  /** MetaMask's active account when it differs from the connected one (lowercase 0x…), else null. */
  mismatch: string | null;
  /** Opens the in-site chooser: a NEAR wallet (connect + unlock in one popup) or MetaMask / other wallets. */
  connect: () => void;
  /** near-connect: sign in and sign the session request in one wallet prompt. */
  connectNear: () => Promise<void>;
  /** The classic selector (MetaMask / Ethereum, and every other wallet). */
  connectOther: () => void;
  /** Google / email through Privy (NEAR docs "Privy" tutorial); signs in-page, no wallet popups. */
  connectSocial: () => void;
  /** True when the Privy app is configured for this build. */
  socialEnabled: boolean;
  /** Which path owns the connection. */
  via: "nc" | "ws" | "privy" | null;
  /** Privy is creating the user's NEAR wallet right after sign-in. */
  socialCreating: boolean;
  choosing: boolean;
  closeChooser: () => void;
  disconnect: () => Promise<void>;
  /** Signs a NEP-413 request for the worker. Redirect wallets resume via `pending` after return. */
  sign: (op: Op, params?: Record<string, unknown>) => Promise<SignedAuth>;
  pending: (SignedAuth & { ctx?: OpResume | null }) | null;
  clearPending: () => void;
  /** Live app session (one wallet signature, 30 min), or null. */
  session: Session | null;
  /** One wallet popup: signs the NEP-413 'session' request and stores the enclave's token. */
  startSession: (tokenId: string, opts?: { reuseOnly?: boolean }) => Promise<{ ok: true } | { ok: false; code: string }>;
  revokeSession: () => Promise<void>;
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
  const [restoring, setRestoring] = useState(false);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [choosing, setChoosing] = useState(false);
  /** Which library owns the connection: near-connect ("nc") or the wallet selector ("ws"). */
  const owner = useRef<"nc" | "ws" | "privy" | null>(null);
  const [via, setVia] = useState<"nc" | "ws" | "privy" | null>(null);
  const [privyOn, setPrivyOn] = useState(false);
  const [wantLogin, setWantLogin] = useState(0);
  const privy = useRef<PrivyNear | null>(null);
  const [socialCreating, setSocialCreating] = useState(false);
  const onPrivy = useCallback((v: PrivyNear) => {
    privy.current = v;
    setSocialCreating(v.creating);
    if (v.accountId) { owner.current = "privy"; setVia("privy"); setAccountId(v.accountId); localStorage.setItem(PRIVY_FLAG, "1"); setReady(true); setRestoring(false); }
    else if (!v.creating && owner.current === "privy") { owner.current = null; setVia(null); setAccountId(null); }
    if (v.ready && !v.creating && !v.accountId) setRestoring(false);
  }, []);
  /** The sign-in signature, kept (in memory only) when the account had no key yet, to unlock right after minting. */
  const stash = useRef<SignedAuth | null>(null);
  useEffect(() => { setSession(loadSession(accountId)); const t = setInterval(() => setSession(loadSession(accountId)), 30_000); return () => clearInterval(t); }, [accountId]);
  const [pending, setPending] = useState<(SignedAuth & { ctx?: OpResume | null }) | null>(null);
  const loading = useRef<Promise<void> | null>(null);

  const ensure = useCallback(() => {
    if (!loading.current) loading.current = init().then((r) => {
      ref.current = r;
      const eth = (window as Window & { ethereum?: EthProvider }).ethereum;
      const sync = () => {
        const st = r.selector.store.getState();
        const a = st.accounts.find((x) => x.active)?.accountId ?? null;
        if (owner.current === "nc" || owner.current === "privy") return;
        owner.current = a ? "ws" : null; setVia(owner.current);
        setAccountId(a);
        if (st.selectedWalletId === "ethereum-wallets" && a && eth?.request) {
          void eth.request({ method: "eth_accounts", params: [] }).then((v: unknown) => setMismatch(ethMismatch(a, v)), () => setMismatch(null));
        } else setMismatch(null);
      };
      sync();
      r.selector.store.observable.subscribe(sync);
      eth?.on?.("accountsChanged", sync);
      setReady(true); setRestoring(false);
    }, (e) => { loading.current = null; setRestoring(false); throw e; });
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
    if (privyEnabled() && localStorage.getItem(PRIVY_FLAG)) { setRestoring(true); setPrivyOn(true); return; }
    if (localStorage.getItem(NC_WALLET_KEY)) {
      setRestoring(true);
      void nearConnector().then((nc) => nc.getConnectedWallet()).then(({ accounts }) => {
        owner.current = "nc"; setVia("nc"); setAccountId(accounts[0]?.accountId ?? null); setReady(true);
      }).catch(() => { localStorage.removeItem(NC_WALLET_KEY); }).finally(() => setRestoring(false));
      return;
    }
    // Only load the wallet bundle eagerly if the user connected before; otherwise wait for a click (keeps LCP fast).
    if (localStorage.getItem("near-wallet-selector:selectedWalletId") || localStorage.getItem("near-wallet-selector:recentlySignedInWallets")) {
      setRestoring(true);
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback || ((cb: () => void) => setTimeout(cb, 300));
      idle(() => void ensure());
    }
  }, [ensure]);

  const connect = useCallback(() => { setChoosing(true); }, []);
  const connectSocial = useCallback(() => { setChoosing(false); setPrivyOn(true); setWantLogin((n) => n + 1); }, []);
  const connectOther = useCallback(() => {
    setChoosing(false);
    return ensure().then(() => {
      const modal = ref.current?.modal;
      if (!modal) return;
      // modal-ui creates its React root on the first show(); a show() that lands before that root has
      // committed is dropped (the cause of the "first click does nothing" flake on slow phones).
      // So: show, then re-show each frame until the wrapper is actually open (bounded, ~2 s).
      let tries = 0;
      const tick = () => {
        if (document.querySelector("#near-wallet-selector-modal .nws-modal-wrapper.open")) { tuneWalletChrome(); return; }
        if (tries++ > 120) return;
        modal.show();
        requestAnimationFrame(tick);
      };
      tick();
    });
  }, [ensure]);
  const disconnect = useCallback(async () => {
    setSession(null); stash.current = null; await revokeStored(accountId);
    if (owner.current === "privy") { await privy.current?.logout().catch(() => {}); localStorage.removeItem(PRIVY_FLAG); }
    else if (owner.current === "nc") { const nc = await nearConnector(); await nc.disconnect().catch(() => {}); localStorage.removeItem(NC_WALLET_KEY); }
    else { await ensure(); const w = await ref.current!.selector.wallet(); await w.signOut(); }
    owner.current = null; setVia(null); setAccountId(null); setMismatch(null);
  }, [ensure, accountId]);

  const sign = useCallback(async (op: Op, params: Record<string, unknown> = {}): Promise<SignedAuth> => {
    const live = loadSession(accountId);
    if (live && inSession(op)) return sessionAuth(live, op, params) as unknown as SignedAuth;
    if (owner.current === "privy") {
      const p = privy.current;
      if (!p?.signer || !accountId) throw new SignError("no_auth");
      const message = buildMessage(op, accountId, params);
      const nonceBytes = freshNonce();
      let r;
      try { r = await p.signer.signNep413Message(accountId, { message, recipient: NEP413_RECIPIENT, nonce: nonceBytes }); }
      catch { throw new SignError("wallet_rejected"); }
      return { account_id: accountId, public_key: r.publicKey.toString(), signature: toB64(r.signature), nonce: toB64(nonceBytes), message, recipient: NEP413_RECIPIENT };
    }
    if (owner.current === "nc") {
      const nc = await nearConnector();
      const w = await nc.wallet().catch(() => null);
      if (!w || !accountId) throw new SignError("no_auth");
      const message = buildMessage(op, accountId, params);
      const nonceBytes = freshNonce();
      let r;
      try { r = await w.signMessage({ message, recipient: NEP413_RECIPIENT, nonce: nonceBytes }); }
      catch (e) { const m = String((e as Error)?.message || e); throw new SignError(/not supported|not implemented/i.test(m) ? "wallet_no_sign_message" : "wallet_rejected"); }
      if (!r?.signature) throw new SignError("wallet_rejected");
      return { account_id: r.accountId || accountId, public_key: r.publicKey, signature: r.signature, nonce: toB64(nonceBytes), message, recipient: NEP413_RECIPIENT };
    }
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
  }, [ensure, accountId]);

  const finishSession = useCallback(async (auth: SignedAuth, tokenId: string) => {
    const r = await callWorker("session", auth);
    const o = r.output;
    if (r.error || !o?.ok || typeof o.session_token !== "string") return { ok: false as const, code: r.error?.code || "session_failed" };
    const s: Session = { token: o.session_token, account: String(o.account), token_id: String(o.token_id ?? tokenId), exp_ms: Number(o.exp_ms), max_usd_micro: Number(o.max_usd_micro) };
    saveSession(s); setSession(s);
    return { ok: true as const };
  }, []);
  const connectNear = useCallback(async () => {
    setChoosing(false);
    const nc = await nearConnector();
    const req = signInRequest();
    let signed: { accountId: string; publicKey: string; signature: string } | undefined;
    const onSigned = (t: { accounts: { accountId: string; publicKey?: string; signedMessage?: { accountId: string; publicKey: string; signature: string } }[] }) => { signed = t.accounts[0]?.signedMessage; };
    nc.on("wallet:signInAndSignMessage", onSigned);
    try {
      const w = await nc.connect({ signMessageParams: req });
      const accs = await w.getAccounts();
      const acc = accs[0]?.accountId;
      if (!acc) return;
      owner.current = "nc"; setVia("nc"); setAccountId(acc);
      if (!signed) return;
      const auth = authFromSignIn(req, signed);
      const r = await finishSession(auth, "");
      // No key yet: keep the signature to unlock right after minting (it stays valid for a few minutes).
      if (!r.ok && (r.code === "not_owner" || r.code === "no_key")) stash.current = auth;
    } catch { /* closed the wallet window */ }
    finally { nc.off("wallet:signInAndSignMessage", onSigned); }
  }, [finishSession]);
  const startSession = useCallback(async (tokenId: string, opts?: { reuseOnly?: boolean }) => {
    const s0 = stash.current;
    if (s0 && s0.account_id === accountId && reusable(s0.message)) {
      stash.current = null;
      const r = await finishSession(s0, tokenId);
      if (r.ok) return r;
    }
    if (opts?.reuseOnly) return { ok: false as const, code: "no_signin" };
    try { return await finishSession(await sign("session", sessionParams(tokenId)), tokenId); }
    catch (e) { return { ok: false as const, code: e instanceof SignError ? e.code : "wallet_rejected" }; }
  }, [sign, finishSession, accountId]);
  // Redirect wallets come back with the signed 'session' request in `pending`.
  useEffect(() => {
    if (!pending) return;
    try { const m = JSON.parse(pending.message) as { op?: string; params?: { token_id?: string } }; if (m.op === "session") { setPending(null); void finishSession(pending, m.params?.token_id || ""); } } catch { /* not ours */ }
  }, [pending, finishSession]);
  const revokeSession = useCallback(async () => { setSession(null); await revokeStored(accountId); }, [accountId]);

  return <Ctx.Provider value={{ accountId, ready, restoring, mismatch, connect, connectNear, connectOther, connectSocial, socialEnabled: privyEnabled(), via, socialCreating, choosing, closeChooser: () => setChoosing(false), disconnect, sign, pending, clearPending: () => setPending(null), session, startSession, revokeSession }}>{children}<WalletChooser />{privyOn && privyEnabled() && <PrivyBridge wantLogin={wantLogin} onChange={onPrivy} />}</Ctx.Provider>;
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

type EthProvider = { request: (a: { method: string; params: unknown[] }) => Promise<unknown>; on?: (e: string, f: () => void) => void };
/** The MetaMask account the extension is on, if it is not the one this site connected. */
export function ethMismatch(connected: string, ethAccounts: unknown): string | null {
  if (!/^0x[0-9a-f]{40}$/i.test(connected) || !Array.isArray(ethAccounts) || ethAccounts.length === 0) return null;
  const cur = String(ethAccounts[0]).toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(cur) && cur !== connected.toLowerCase() ? cur : null;
}

/** In-site chooser (not a wallet popup). */
function WalletChooser() {
  const c = useContext(Ctx);
  if (!c?.choosing) return null;
  return (
    <div className="wchoose" role="dialog" aria-modal="true" aria-label="Connect your wallet" data-testid="wallet-chooser" onClick={(e) => { if (e.target === e.currentTarget) c.closeChooser(); }}>
      <div className="wchoose-card">
        <h2>Connect your wallet</h2>
        <p className="kh-sign-note">{SIGN_NOTE}</p>
        {c.socialEnabled && <button type="button" className="btn b1" data-testid="choose-social" onClick={c.connectSocial}>Continue with Google / email <small>no wallet needed</small></button>}
        <button type="button" className="btn b1" data-testid="choose-near" onClick={() => void c.connectNear()}>NEAR wallet <small>connect and unlock in one popup</small></button>
        <button type="button" className="btn b2" data-testid="choose-other" onClick={() => void c.connectOther()}>MetaMask / Ethereum wallet, or another wallet</button>
        <button type="button" className="btn b2" data-testid="choose-cancel" onClick={c.closeChooser}>Cancel</button>
      </div>
    </div>
  );
}

export function useWallet() { const c = useContext(Ctx); if (!c) throw new Error("WalletProvider missing"); return c; }
