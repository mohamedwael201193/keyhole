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
  it("keeps the order of DESIGN_SPEC: hero, problem, how it works, the lock-out, pledge, live proof, builders, close", () => {
    const ids = ['id="top"', 'id="problem"', 'id="handover"', 'id="lockout"', 'id="pledge"', 'id="proof"', 'id="builders"', 'id="cta"'];
    const at = ids.map((id) => html.indexOf(id));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("the one-screen headings are present, in the same order", () => {
    const heads = ["hero-h", "problem-h", "how-h", "lockout-h", "pledge-h", "proof-h", "builders-h", "cta-h"].map((id) => html.indexOf(`id="${id}"`));
    expect(heads.every((i) => i > 0)).toBe(true);
    expect([...heads].sort((a, b) => a - b)).toEqual(heads);
  });

  it("the hero: the headline, the one-line lead, the contract fact and the two actions, with the trial as a text link", () => {
    expect(html).toContain("An NFT that is the key to a private trading account.");
    expect(html).toContain("Hold the key and you run the account. Sell the key and the account goes with it.");
    expect(html).toContain("Live on NEAR mainnet");
    expect(html).toMatch(/data-testid="start-cta"[^>]*href="\/mint"|href="\/mint"[^>]*data-testid="start-cta"/);
    expect(html).toMatch(/data-testid="verify-cta"[^>]*href="\/verify"|href="\/verify"[^>]*data-testid="verify-cta"/);
    expect(html).toMatch(/data-testid="try-free-cta"[^>]*href="\/try\?start=1"|href="\/try\?start=1"[^>]*data-testid="try-free-cta"/);
    expect(html).toContain("Try it free — testnet");
    expect(html).toContain("keyhole-devmo.near");
    expect(html).toContain("/heirloom/keys/k03.webp");
  });

  it("the hero video has the poster 01, the webm and mp4 sources, and preloads only its metadata", () => {
    expect(html).toMatch(/<video[^>]*preload="metadata"/);
    expect(html).toMatch(/<video[^>]*poster="\/landing\/hero-vault\.webp"/);
    expect(html).toContain("/landing/hero-vault.webp");
    expect(html).toContain("/landing/hero-loop.webm");
    expect(html).toContain("/landing/hero-loop.mp4");
  });

  it("the lock-out: the previous holder is refused with not_owner, the new holder's account is open, and the transfer is linked", () => {
    expect(html).toContain("Previous holder");
    expect(html).toContain("not_owner");
    expect(html).toContain("New holder");
    expect(html).toContain("Account open");
    expect(html).toContain("https://nearblocks.io/txns/G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD");
    expect(html).toMatch(/href="\/attack"/);
  });

  it("how it works: three foil steps with their copy, and the real key in the keyhole", () => {
    expect(html.match(/class="lp-step"/g)?.length).toBe(3);
    expect(html).toContain("One signature mints the key. A private account opens inside a TEE.");
    expect(html).toContain("Private swaps through NEAR Intents, with your limits, a freeze and a signed log.");
    expect(html).toContain("Send or sell the key. Control moves with it.");
    expect(html).toContain("/landing/keyhole-macro.webp");
  });

  it("pledge: contract-enforced states only, badged as not open for lending, with no rates or numbers", () => {
    expect(html).toContain("Not open for lending yet");
    expect(html).toContain("Transfer, sale and swaps are locked.");
    expect(html).toContain("The lock is released.");
    expect(html).toContain("The lender receives the key and everything in its vault, under the terms the borrower signed.");
  });

  it("live proof: the supply and the token reach are live, the worker hash is labelled build, and the mainnet panel is kept", () => {
    expect(html).toContain('data-testid="supply"');
    expect(html).toContain("Keys held by users");
    expect(html).toContain('data-testid="mainnet-stats"');
    expect(html).toContain("Worker code hash");
    expect(html).toContain("build");
  });

  it("trade reach: with a count it prints the count, without one it prints a dash and no number", () => {
    const counted = render({ tokens: 216, chains: 39, marks: [] });
    expect(counted).toMatch(/data-testid="reach-tokens">216</);
    expect(counted).toMatch(/data-testid="reach-chains">39</);
    expect(html).toMatch(/data-testid="reach-tokens">—</);
  });

  it("for builders: the read-only CLI command, the read-only MCP tool and the repo links", () => {
    expect(html).toContain("pledge status k5f4750858f328940");
    expect(html).toContain("pledge_status");
    expect(html).toContain("https://github.com/mohamedwael201193/keyhole/blob/main/SECURITY.md");
    expect(html).toContain("https://github.com/mohamedwael201193/keyhole/blob/main/VERIFY.md");
  });

  it("the closing band: mint a key and verify it yourself", () => {
    expect(html).toMatch(/data-testid="cta-get-key"[^>]*href="\/mint"|href="\/mint"[^>]*data-testid="cta-get-key"/);
    expect(html).toMatch(/data-testid="cta-proof"[^>]*href="\/verify"|href="\/verify"[^>]*data-testid="cta-proof"/);
    expect(html).toContain("Sell the key. The private account goes with it.");
  });

  it("the page never says judge in visible copy (the rule for this landing)", () => {
    const visible = html.replace(/<[^>]+>/g, " ");
    expect(visible).not.toMatch(/judge/i);
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

  it("uses no generated picture that is not in the USE list (11 and 12 are not used)", () => {
    expect(images.some((s) => s.includes("step-transfer") || s.includes("pledge-lock"))).toBe(false);
  });
});

describe("removed noise", () => {
  it("has no MetaMask note on the landing or in the source", () => {
    expect(html).not.toContain("metamask-note");
    expect(html).not.toContain("MetaMask says");
    expect(() => readFileSync(new URL("../components/MetaMaskNote.tsx", import.meta.url))).toThrow();
  });

  it("the motion module is client-only and guards the pin with reduced motion and ?static", () => {
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
