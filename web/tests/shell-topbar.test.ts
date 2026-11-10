import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { rowPair } from "@/components/dashboard/Overview";
import { ASSETS } from "@/lib/assets";
import type { HistEntry } from "@/lib/dashboard";
import type { Token } from "@/lib/tokens";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const USDC = ASSETS.usdc.id;
const SOL: Token = { assetId: "nep141:sol.omft.near", symbol: "SOL", blockchain: "sol", decimals: 9, price: null, contractAddress: null };
const TOKENS: Token[] = [{ assetId: USDC, symbol: "USDC", blockchain: "near", decimals: 6, price: null, contractAddress: null }, SOL];

describe("Recent activity rows name tokens by symbol, never by id", () => {
  it("a swap reads as the token pair with the amount paid", () => {
    const e: HistEntry = { kind: "swap", token_in: USDC, amount_in: "600000", token_out: SOL.assetId, amount_out: "6286509", status: "success" };
    expect(rowPair(e, TOKENS)).toBe("0.6 USDC → SOL");
  });

  it("a token we cannot name reads as another token, and no raw id is printed", () => {
    const e: HistEntry = { kind: "swap", token_in: USDC, amount_in: "2500000", token_out: "unknown.near", amount_out: "7", status: "success" };
    const text = rowPair(e, TOKENS);
    expect(text).toBe("2.5 USDC → another token");
    expect(text).not.toContain("unknown.near");
  });

  it("the vault's own two assets resolve even when the full list has not loaded", () => {
    const e: HistEntry = { kind: "swap", token_in: USDC, amount_in: "1000000", token_out: ASSETS.wnear.id, amount_out: "1", status: "success" };
    expect(rowPair(e, [])).toBe("1 USDC → wNEAR");
  });

  it("a withdrawal reads as the amount, the symbol and the chain", () => {
    const e: HistEntry = { kind: "withdraw", token: USDC, amount: "50000", chain: "eth", status: "success" };
    expect(rowPair(e, TOKENS)).toMatch(/^0\.05 USDC to /);
    // Without the token's decimals the amount is left out rather than guessed.
    expect(rowPair({ kind: "withdraw", token: "unknown.near", amount: "5" }, TOKENS)).toBe("another token");
  });
});

describe("the top bar fits a phone (source contract)", () => {
  const css = src("../app/app-shell.css");
  const pill = src("../components/app/SessionPill.tsx");

  it("a disabled Connect wallet keeps the solid deep teal, not a faded grey", () => {
    expect(css).toMatch(/\.app-top \.cw:disabled \{ opacity: 1; background: var\(--primary\); color: var\(--primary-ink\);/);
    expect(css).not.toMatch(/\.app-top \.cw:disabled \{ opacity: \.55/);
    expect(css).toContain(".app-top .cw:focus-visible");
    expect(css).toContain(".app-top .cw:not(:disabled):hover { background: var(--primary-hover); }");
  });

  it("on phones the session pill is icon and minutes, the account pill is an avatar plus a short name, and the network pill is hidden", () => {
    expect(css).toMatch(/@media \(max-width: 599px\) \{[\s\S]*\.app-top \.sp-pill \.sp-word, \.app-top \.sp-pill \.sp-sep \{ display: none; \}/);
    expect(css).toMatch(/\.app-top \.sp-unit::after \{ content: "m";/);
    expect(css).toMatch(/\.app-top \.acct \.cw-full \{ display: none; \}/);
    expect(css).toMatch(/\.app-top \.acct \.cw-short \{ display: inline-block; max-width: 11ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; \}/);
    expect(css).toMatch(/\.app-top-end \{ gap: 6px; padding-inline-end: 12px; min-width: 0; flex: 1 1 auto; overflow: visible; justify-content: flex-end; \}/);
    expect(css).not.toMatch(/\.app-top-end \{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.app-top \.sp-pop \{ position: fixed; top: 68px; left: 12px; right: 12px; width: auto; \}/);
    expect(css).toMatch(/\.sandbox-banner \+ \.app \.app-top \.sp-pop \{ top: 116px; \}/);
    expect(css).toMatch(/\.app-top \.cw-avatar \{ display: grid;/);
    expect(css).not.toMatch(/\.app-top \.acct \.cw \{ max-width: 120px;/);
    expect(css).toMatch(/@media \(max-width: 599px\) \{[\s\S]*\.app-top \.app-net \{ display: none; \}/);
  });

  it("the session pill marks its word and its unit, so the phone rules can target them", () => {
    expect(pill).toContain('className="sp-word">Unlocked</span>');
    expect(pill).toContain('className="sp-unit"');
  });

  it("the network line lives in the menu sheet on phones", () => {
    expect(src("../components/app/AppShell.tsx")).toContain('className="app-net-line"');
  });
});
