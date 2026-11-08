import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SignInModal, readLastMethod, popupBlockedHint, walletErrorText, POPUP_BLOCKED_HINT } from "@/components/SignInModal";

const noop = () => {};
const render = (p: Partial<Parameters<typeof SignInModal>[0]> = {}) =>
  renderToStaticMarkup(createElement(SignInModal, { open: true, onClose: noop, socialEnabled: true, onGoogle: noop, onEmail: noop, onNear: noop, onMeteor: () => Promise.resolve(), onOther: noop, ...p }));

describe("the one sign-in sheet", () => {
  it("offers Google, email, NEAR wallets, Meteor and MetaMask / EVM, each with its testid", () => {
    const m = render();
    for (const id of ["wallet-chooser", "choose-social", "choose-email", "choose-near", "signin-meteor", "choose-other", "choose-cancel"]) {
      expect(m, id).toContain(`data-testid="${id}"`);
    }
    expect(m).toContain("Continue with Google");
    expect(m).toContain("Continue with email");
    expect(m).toContain("HOT, MyNearWallet, Intear, Here");
    expect(m).not.toContain("Meteor, HOT");
    expect(m).toContain("Opens Meteor Web in a small window");
    expect(m).toContain("MetaMask and other EVM wallets");
    expect(m).toContain("Opens the full wallet list, including more NEAR wallets");
    expect(m).not.toContain("including Meteor");
    expect(m).toContain('role="dialog"');
    expect(m).toContain('aria-modal="true"');
  });

  it("lists Meteor as its own row between the NEAR wallet and MetaMask / EVM", () => {
    const m = render();
    const at = (s: string) => m.indexOf(s);
    expect(at('data-testid="choose-near"')).toBeGreaterThan(-1);
    expect(at('data-testid="signin-meteor"')).toBeGreaterThan(at('data-testid="choose-near"'));
    expect(at('data-testid="choose-other"')).toBeGreaterThan(at('data-testid="signin-meteor"'));
  });

  it("hides Google and email when Privy is not configured", () => {
    const m = render({ socialEnabled: false });
    expect(m).not.toContain('data-testid="choose-social"');
    expect(m).not.toContain('data-testid="choose-email"');
    expect(m).toContain('data-testid="choose-near"');
  });

  it("renders nothing while closed", () => {
    expect(render({ open: false })).toBe("");
  });

  it("every option calls an existing connect function, and wallet.tsx wires them to the same calls", () => {
    const w = readFileSync(new URL("../lib/wallet.tsx", import.meta.url), "utf8");
    expect(w).toContain('<SignInModal open={choosing} onClose={() => setChoosing(false)}');
    expect(w).toContain('onGoogle={() => connectSocial("google")}');
    expect(w).toContain('onEmail={() => connectSocial("email")}');
    expect(w).toContain("onNear={() => void connectNear()}");
    expect(w).toContain('onMeteor={() => connectSelectorWallet("meteor-wallet")}');
    expect(w).toContain("onOther={() => void connectOther()}");
    expect(w).not.toContain("WalletChooser");
  });

  it("Meteor signs in through the selector module directly (no modal), and closes the sheet only on success", () => {
    const w = readFileSync(new URL("../lib/wallet.tsx", import.meta.url), "utf8");
    expect(w).toContain("r.selector.wallet(id).then((w) => (w as unknown as InjectedSignIn).signIn({}))");
    expect(w).toContain("return started.then(() => {");
    expect(w).toContain("setChoosing(false);");
    // A NEAR Connect record from an older Meteor attempt is dropped on load and after a selector sign-in.
    expect(w).toContain("if (localStorage.getItem(NC_WALLET_KEY) === METEOR_NEAR_CONNECT_ID) localStorage.removeItem(NC_WALLET_KEY);");
    expect(w).toMatch(/if \(owner\.current === "nc"\) \{\s+localStorage\.removeItem\(NC_WALLET_KEY\);/);
    expect(w).toMatch(/const started = ref\.current \? go\(ref\.current\) : ensure\(\)/);
  });
});

describe("the popup-blocked hint", () => {
  it("maps the Meteor popup failure text to the plain hint", () => {
    expect(popupBlockedHint("Couldn't open popup window to complete wallet action")).toBe(POPUP_BLOCKED_HINT);
    expect(popupBlockedHint("Failed to sign in with Meteor Wallet: Couldn't open popup window to complete wallet action")).toBe(POPUP_BLOCKED_HINT);
    expect(popupBlockedHint("POPUP_WINDOW_OPEN_FAILED")).toBe(POPUP_BLOCKED_HINT);
    expect(popupBlockedHint("the popup was blocked by the browser")).toBe(POPUP_BLOCKED_HINT);
    expect(popupBlockedHint("open popup")).toBe(POPUP_BLOCKED_HINT);
  });
  it("says what to do, in plain words", () => {
    expect(POPUP_BLOCKED_HINT).toBe("Your browser or an ad blocker stopped the wallet window. Allow pop-ups for this site and pause the ad blocker here, then try again.");
  });
  it("leaves other errors and empty text alone", () => {
    expect(popupBlockedHint("User rejected the request")).toBeNull();
    expect(popupBlockedHint("Invalid wallet id")).toBeNull();
    expect(popupBlockedHint("Allow pop-ups for this site")).toBeNull();
    expect(popupBlockedHint("")).toBeNull();
    expect(popupBlockedHint(null)).toBeNull();
    expect(popupBlockedHint(undefined)).toBeNull();
  });
  it("reads the endTag of a Meteor SDK error as well as its message", () => {
    const e = Object.assign(new Error("Couldn't open popup window to complete wallet action"), { endTag: "POPUP_WINDOW_OPEN_FAILED" });
    expect(walletErrorText(e)).toContain("POPUP_WINDOW_OPEN_FAILED");
    expect(popupBlockedHint(walletErrorText(e))).toBe(POPUP_BLOCKED_HINT);
    expect(walletErrorText("plain string")).toBe("plain string");
  });
  it("is wired to the sign path (wallet_popup_blocked) and the selector alert", () => {
    const w = readFileSync(new URL("../lib/wallet.tsx", import.meta.url), "utf8");
    expect(w).toContain('throw new SignError("wallet_popup_blocked")');
    expect(w).toContain('#near-wallet-selector-modal .alert-message');
  });
});

describe("remembering the last method", () => {
  it("reads back only a known method, and treats blocked storage as nothing remembered", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    expect(readLastMethod()).toBeNull();
    store.set("kh_signin_last", "near");
    expect(readLastMethod()).toBe("near");
    store.set("kh_signin_last", "meteor");
    expect(readLastMethod()).toBe("meteor");
    store.set("kh_signin_last", "bogus");
    expect(readLastMethod()).toBeNull();
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(readLastMethod()).toBeNull();
    vi.unstubAllGlobals();
  });
});
