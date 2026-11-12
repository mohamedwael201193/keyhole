import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { Landing } from "@/components/Landing";
import { Footer } from "@/components/Footer";
import { I18nProvider } from "@/lib/i18n";
import { curatedMarks } from "@/lib/landing";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const withI18n = (el: ReturnType<typeof createElement>) => createElement(I18nProvider, null, el);
const render = (reach: { tokens: number; chains: number; marks: never[] } | null) =>
  renderToStaticMarkup(withI18n(createElement(Landing, { supply: 12, hash: "f4768da8", reach })));
const html = render(null);

describe("landing sections", () => {
  it("keeps the order: hero, proof, the handover, buyer check, trade, private, judges, the closing band", () => {
    const ids = ['id="top"', 'id="live"', 'id="proof"', 'id="handover"', 'id="check"', 'id="trade"', 'id="private"', 'id="judge"', 'id="cta"'];
    const at = ids.map((id) => html.indexOf(id));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const heads = ["proof-h", "handover-h", "check-h", "trade-h", "private-h", "judge-h", "cta-h"].map((id) => html.indexOf(`id="${id}"`));
    expect(heads.every((i) => i > 0)).toBe(true);
    expect([...heads].sort((a, b) => a - b)).toEqual(heads);
  });

  it("the cut sections are gone: the key collection, the three outcome cards, the old diagram and the attestation card", () => {
    expect(html).not.toContain('id="keys"');
    expect(html).not.toContain('id="outcomes"');
    expect(html).not.toContain('class="lp-grid"');
    expect(html).not.toContain("lp-track");
    expect(html).not.toContain("kh-tilt");
    expect(html).not.toContain('class="how-node');
    expect(html).not.toContain('class="attc"');
    expect(html).not.toContain("lp-more");
  });

  it("the hero's primary action launches the app and the secondary scrolls to the handover", () => {
    expect(html).toMatch(/data-testid="start-cta"[^>]*href="\/dashboard"|href="\/dashboard"[^>]*data-testid="start-cta"/);
    expect(html).toMatch(/data-testid="handover-cta"[^>]*href="#handover"|href="#handover"[^>]*data-testid="handover-cta"/);
    expect(html).toContain("Watch a real handover");
    expect(html).toContain("Sell a trading account");
    expect(html).toMatch(/data-testid="try-free-cta"[^>]*href="\/try\?start=1"|href="\/try\?start=1"[^>]*data-testid="try-free-cta"/);
    expect(html).toContain("Try it free — testnet");
    expect(html).toContain('data-testid="mainnet-stats"');
    expect(html).toContain("keyhole-devmo.near");
  });

  it("the handover: three real steps with their ids and proofs, on the server so the page works without JavaScript", () => {
    expect(html.match(/class="hand-step"/g)?.length).toBe(3);
    expect(html).toContain('href="/verify?call=440c2378-6c27-49fd-8b6b-d74054f331ae"');
    expect(html).toContain("https://nearblocks.io/txns/G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD");
    expect(html).toContain('href="/verify?call=e805f050-d416-4a04-9b12-270adbe02068"');
    expect(html).toContain("not_owner");
    expect(html).toContain("team test wallets");
  });

  it("the buyer check is an example from /key, with the six checks the verdict reads", () => {
    expect(html).toContain("Example from /key");
    expect(html).toContain("Signature valid");
    expect(html).toContain("Signer is the contract&#x27;s minter");
    expect(html).toContain("Proof is for this key");
    expect(html).toContain("Holder read from chain");
    expect(html).toContain("Log head");
    expect(html).toContain('href="/keys"');
  });

  it("proof: the 37 browser checks, the worker hash, the order count and the holder count are final values in the server markup", () => {
    expect(html).toContain('data-testid="checks-stat"');
    expect(html).toMatch(/data-testid="checks-stat"[^]*?>37</);
    expect(html).toContain('data-testid="hash-stat"');
    expect(html).toContain('data-testid="orders-stat"');
    expect(html).toContain("Public orders");
    expect(html).toContain(">6<");
    expect(html).toContain("1 sealed vault swap and 5 1Click orders");
    expect(html).toContain('data-testid="verify-cta"');
    expect(html).toContain('data-testid="judge-cta"');
    expect(html).toContain('data-testid="supply"');
  });

  it("trade anything: with a count, it says the count and shows the marks; without one, no number is printed", () => {
    const counted = render({ tokens: 216, chains: 39, marks: [] });
    expect(counted).toContain("216 tokens on 39 chains");
    expect(counted).toContain('href="/swap"');
    expect(html).toContain("across tokens on many chains");
    expect(html).not.toMatch(/\d+ tokens on \d+ chains/);
  });

  it("private by design: the two columns, the line about the keys, and the links to the proof", () => {
    expect(html).toContain('data-testid="sees-enclave"');
    expect(html).toContain('data-testid="sees-public"');
    expect(html).toContain("Keys to the money never leave the enclave.");
    expect(html).toMatch(/href="\/ask"/);
  });

  it("for judges: commands in a code card, each with a copy button", () => {
    expect(html).toContain('data-testid="judge-commands"');
    expect(html).toContain("git fetch --depth 1 origin");
    expect(html).not.toContain("git clone");
    expect(html).toContain("node judge/verify-claims.mjs");
    expect(html).toContain("open /verify");
    expect(html).toContain("open /attack");
    expect(html.match(/class="khm-copy/g)?.length).toBe(4);
  });

  it("the closing band: get your key and read the proof", () => {
    expect(html).toMatch(/data-testid="cta-get-key"[^>]*href="\/dashboard"|href="\/dashboard"[^>]*data-testid="cta-get-key"/);
    expect(html).toMatch(/data-testid="cta-proof"[^>]*href="\/judge"|href="\/judge"[^>]*data-testid="cta-proof"/);
    expect(html).toContain("Get your key");
    expect(html).toContain("Read the proof");
  });
});

describe("trade row: the curated marks", () => {
  const tok = (assetId: string, symbol: string, blockchain: string) => ({ assetId, symbol, blockchain, decimals: 6, price: 1, contractAddress: null });

  it("shows the listed tokens in the set order and leaves odd tickers out", () => {
    const list = [
      tok("a", "SSC1_PIT", "near"), tok("b", "USDC", "base"), tok("c", "wNEAR", "near"), tok("d", "USDC", "near"), tok("e", "ETH", "eth"),
      tok("f", "USDT", "eth"), tok("g", "BTC", "btc"), tok("h", "ZEC", "zec"), tok("i", "ARB", "arb"), tok("j", "SOL", "sol"),
    ];
    expect(curatedMarks(list).map((t) => t.assetId)).toEqual(["c", "d", "f", "e", "g", "j", "h", "i", "b"]);
  });

  it("leaves out an entry the live list does not have", () => {
    expect(curatedMarks([tok("a", "SSC1_PIT", "near"), tok("b", "ETH", "eth")]).map((t) => t.assetId)).toEqual(["b"]);
  });
});

describe("landing images", () => {
  const images = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]).concat([...html.matchAll(/srcSet="([^"]+)"/g)].map((m) => m[1]));

  it("no longer shows the glass chain picture or the duplicate chests", () => {
    expect(images.some((s) => s.includes("privacy-chain"))).toBe(false);
    expect(images.some((s) => s.includes("privacy-chest"))).toBe(false);
    expect(images.filter((s) => s.includes("/heirloom/privacy")).length).toBe(0);
  });

  it("the enclave chest is not on the landing; the verifier page keeps it", () => {
    expect(images.filter((s) => s.includes("/heirloom/enclave")).length).toBe(0);
  });
});

describe("removed noise", () => {
  it("has no MetaMask note on the landing or in the source", () => {
    expect(html).not.toContain("metamask-note");
    expect(html).not.toContain("MetaMask says");
    expect(() => readFileSync(new URL("../components/MetaMaskNote.tsx", import.meta.url))).toThrow();
  });

  it("the motion module is client-only and guards every effect with reduced motion and ?static", () => {
    const m = src("../components/LandingMotion.tsx");
    expect(m).toContain('"use client"');
    expect(m).toContain("(prefers-reduced-motion: no-preference)");
    expect(m).toContain("?static");
    expect(m).toContain("mm.revert()");
    expect(m).toContain("st.kill(true)");
  });
});

describe("public top bar and footer", () => {
  const nav = src("../components/Nav.tsx");
  it("the top bar holds How it works, Proof, Verification path and Launch app, and no wallet control", () => {
    expect(nav).toContain('href: "/#handover"');
    expect(nav).toContain('href: "/verify"');
    expect(nav).toContain('href: "/attack"');
    expect(nav).toContain('href: "/verify/path"');
    expect(nav).toContain('"/dashboard"');
    expect(nav).toContain('testid="open-app"');
    expect(nav).not.toContain("<AccountControl");
    expect(nav).not.toContain("nav-more");
    expect(nav).not.toContain("more-menu");
  });

  it("the footer has three groups (Product, Proof, Learn), the contract line and the NEAR credit", () => {
    const m = renderToStaticMarkup(withI18n(createElement(Footer)));
    for (const g of ["Product", "Proof", "Learn"]) expect(m).toContain(`aria-label="${g}"`);
    for (const href of ["/dashboard", "/mint", "/swap", "/vault", "/verify", "/holders", "/attack", "/verify/path", "/atlas", "/source", "/ask", "/identity", "/demo"]) expect(m).toContain(`href="${href}"`);
    expect(m).toContain("NEAR mainnet");
    expect(m).toContain("Built on NEAR");
  });
});
