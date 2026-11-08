import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SignInModal, readLastMethod } from "@/components/SignInModal";

const noop = () => {};
const render = (p: Partial<Parameters<typeof SignInModal>[0]> = {}) =>
  renderToStaticMarkup(createElement(SignInModal, { open: true, onClose: noop, socialEnabled: true, onGoogle: noop, onEmail: noop, onNear: noop, onOther: noop, ...p }));

describe("the one sign-in sheet", () => {
  it("offers Google, email, NEAR wallets and MetaMask / EVM, each with its testid", () => {
    const m = render();
    for (const id of ["wallet-chooser", "choose-social", "choose-email", "choose-near", "choose-other", "choose-cancel"]) {
      expect(m, id).toContain(`data-testid="${id}"`);
    }
    expect(m).toContain("Continue with Google");
    expect(m).toContain("Continue with email");
    expect(m).toContain("HOT, MyNearWallet, Intear, Here");
    expect(m).not.toContain("Meteor, HOT");
    expect(m).toContain("MetaMask and other EVM wallets");
    expect(m).toContain("Opens the full wallet list, including Meteor");
    expect(m).toContain('role="dialog"');
    expect(m).toContain('aria-modal="true"');
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
    expect(w).toContain("onOther={() => void connectOther()}");
    expect(w).not.toContain("WalletChooser");
  });
});

describe("remembering the last method", () => {
  it("reads back only a known method, and treats blocked storage as nothing remembered", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    expect(readLastMethod()).toBeNull();
    store.set("kh_signin_last", "near");
    expect(readLastMethod()).toBe("near");
    store.set("kh_signin_last", "bogus");
    expect(readLastMethod()).toBeNull();
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(readLastMethod()).toBeNull();
    vi.unstubAllGlobals();
  });
});
