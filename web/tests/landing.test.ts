import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { Landing } from "@/components/Landing";
import { Footer } from "@/components/Footer";
import { I18nProvider } from "@/lib/i18n";
import { curatedMarks } from "@/lib/landing";
import { CAPS } from "@/lib/traits";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const withI18n = (el: ReturnType<typeof createElement>) => createElement(I18nProvider, null, el);
const render = (reach: { tokens: number; chains: number; marks: never[] } | null) =>
  renderToStaticMarkup(withI18n(createElement(Landing, { supply: 12, hash: "f4768da8", reach })));
const html = render(null);

describe("landing sections (DESIGN_PLAN_V2)", () => {
  it("keeps the order: hero, problem, how it works, the lock-out, pledge, the keys, tokens and live, builders, close", () => {
    const ids = ['id="top"', 'id="private"', 'id="handover"', 'id="lockout"', 'id="pledge"', 'id="keys"', 'id="proof"', 'id="builders"', 'id="cta"'];
    const at = ids.map((id) => html.indexOf(id));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("the headings are present, in the same order", () => {
    const heads = ["hero-h", "problem-h", "how-h", "lockout-h", "pledge-h", "keys-h", "builders-h", "cta-h"].map((id) => html.indexOf(`id="${id}"`));
    expect(heads.every((i) => i > 0)).toBe(true);
    expect([...heads].sort((a, b) => a - b)).toEqual(heads);
  });

  it("the hero: the headline, the body, the two actions, the testnet trial link and the feature strip", () => {
    expect(html).toContain("Sell a trading account");
    expect(html).toContain("like an NFT.");
    expect(html).toContain("Your key is an NFT on NEAR. Behind it sits a private trading account inside a sealed enclave (TEE).");
    expect(html).toMatch(/data-testid="start-cta"[^>]*href="\/dashboard"|href="\/dashboard"[^>]*data-testid="start-cta"/);
    expect(html).toMatch(/data-testid="watch-cta"[^>]*href="\/attack"|href="\/attack"[^>]*data-testid="watch-cta"/);
    expect(html).toMatch(/data-testid="try-free-cta"[^>]*href="\/try\?start=1"|href="\/try\?start=1"[^>]*data-testid="try-free-cta"/);
    for (const label of ["TEE secured", "NEAR Intents", "Transferable", "Locks while pledged"]) expect(html).toContain(label);
    for (const href of ["#private", "#handover", "#lockout", "#pledge"]) expect(html).toContain(`href="${href}"`);
  });

  it("the hero art carries the REAL key art (k03, k04, k02) over the arch and three tier plaques", () => {
    expect(html).toContain("/landing/hero-arch.webp");
    for (const n of ["k03", "k04", "k02"]) expect(html).toContain(`/heirloom/keys/${n}.webp`);
    for (const t of ["hero-key-bronze", "hero-key-silver", "hero-key-gold"]) expect(html).toContain(`data-testid="${t}"`);
    for (const tier of ["lp-plaque--bronze", "lp-plaque--silver", "lp-plaque--gold"]) expect(html).toContain(tier);
  });

  it("the problem: the golden keyhole banner with its copy", () => {
    expect(html).toContain("/landing/problem-keyhole.webp");
    expect(html).toContain("Private accounts can&#x27;t be handed over.");
    expect(html).toContain("Keys, secrets and history stay with the old owner.");
  });

  it("how it works: three cards, the real Bronze FoilCard, and the chevrons", () => {
    expect(html.match(/class="lp-card lp-step"/g)?.length).toBe(3);
    for (const s of ["Mint the key", "Use the account", "Transfer the key"]) expect(html).toContain(s);
    expect(html).toContain("Trade privately, set limits, freeze when needed, and keep a signed log.");
    expect(html).toMatch(/class="foil-card[^"]*lp-s1-card"/);
    expect(html.match(/class="lp-chev"/g)?.length).toBe(2);
  });

  it("the lock-out: the previous holder is refused with not_owner, the new holder has access, and both proofs are linked", () => {
    expect(html).toContain("Control moves on-chain.");
    expect(html).toContain("Previous holder");
    expect(html).toContain("Refused");
    expect(html).toContain("not_owner");
    expect(html).toContain("New holder");
    expect(html).toContain("Access granted");
    expect(html).toContain("Holds the key");
    expect(html).toContain("Waiting");
    expect(html).toMatch(/data-testid="lock-verify"[^>]*href="\/verify\?call=e805f050-d416-4a04-9b12-270adbe02068"|href="\/verify\?call=e805f050-d416-4a04-9b12-270adbe02068"[^>]*data-testid="lock-verify"/);
    expect(html).toContain("https://nearblocks.io/txns/BbTs3JZaxdrgwPu6SjZQwjpuXk7wAxizeVqzKrS2pxNp");
    expect(html).toContain("/landing/arch-teal.webp");
  });

  it("pledge: contract-enforced states only, badged as not open for lending, no rates and no trophy", () => {
    expect(html).toContain("Not open for lending yet");
    expect(html).toContain("Use your key as collateral.");
    expect(html).toContain("Transfer, sale and swaps are off");
    expect(html).toContain("Lender receives the key");
    expect(html).toContain("How pledge works");
    expect(html).toMatch(/href="\/pledge"/);
    expect(src("../components/landing/icons.tsx")).not.toMatch(/trophy/i);
  });

  it("the keys: the four real foil cards with the real limits from CAPS, limits only", () => {
    expect(html.match(/class="lp-fcard"/g)?.length).toBe(4);
    for (const f of ["bronze", "silver", "gold", "legendary"]) expect(html).toContain(`data-finish="${f}"`);
    for (const n of ["k03", "k04", "k02", "k01"]) expect(html).toContain(`/heirloom/keys/${n}.webp`);
    expect(CAPS.Bronze).toEqual({ perTx: 1, daily: 5, perMin: 6 });
    const visible = html.replace(/<[^>]+>/g, "");
    expect(visible).toContain("$1 / trade · $5 a day");
    expect(visible).toContain("$10 / trade · $50 a day");
    expect(visible).toContain("$100 / trade · $500 a day");
    expect(html).toContain("Every key is one of one.");
    expect(html).toContain("Base art comes from the tier collection.");
    expect(html).toMatch(/data-testid="keys-mint-cta"/);
  });

  it("supported tokens and live: live numbers only, no number from the mockup", () => {
    expect(html).toContain('data-testid="supply"');
    expect(html).toContain("Keys held by users");
    expect(html).toContain('data-testid="mainnet-stats"');
    expect(html).toContain("Live on mainnet");
    expect(html).toMatch(/data-testid="verify-cta"[^>]*href="\/verify"|href="\/verify"[^>]*data-testid="verify-cta"/);
    for (const mock of ["12,430", "1,284", "Verified TEE Proofs"]) expect(html).not.toContain(mock);
  });

  it("the token count: with a live count it prints +N more (the count minus the six shown), without one it hides it", () => {
    const counted = render({ tokens: 216, chains: 39, marks: [] });
    expect(counted).toMatch(/data-testid="reach-tokens">\+210 more</);
    expect(html).not.toContain('data-testid="reach-tokens"');
  });

  it("for builders: the read-only CLI command, the read-only MCP tool, the repo links, the build hash and the order census", () => {
    expect(html).toContain("pledge status k5f4750858f328940");
    expect(html).toContain("pledge_status");
    expect(html).toContain("https://github.com/mohamedwael201193/keyhole/blob/main/SECURITY.md");
    expect(html).toContain("https://github.com/mohamedwael201193/keyhole/blob/main/VERIFY.md");
    expect(html).toMatch(/data-testid="hash-stat"[^>]*>f4768da8</);
    expect(html).toContain('data-testid="orders-stat"');
  });

  it("the closing card shows the three real keys on the arch", () => {
    const close = html.slice(html.indexOf('id="cta"'));
    for (const n of ["k03", "k04", "k02"]) expect(close).toContain(`/heirloom/keys/${n}.webp`);
  });

  it("the closing card: launch the app or mint a key", () => {
    expect(html).toMatch(/data-testid="cta-launch"[^>]*href="\/dashboard"|href="\/dashboard"[^>]*data-testid="cta-launch"/);
    expect(html).toMatch(/data-testid="cta-get-key"[^>]*href="\/mint"|href="\/mint"[^>]*data-testid="cta-get-key"/);
    expect(html).toContain("Sell the key. The private account goes with it.");
  });

  it("the copy rules: no judge, no competitor names, no value words about a tier", () => {
    const visible = html.replace(/<[^>]+>/g, " ");
    expect(visible).not.toMatch(/judge/i);
    expect(visible).not.toMatch(/\b(rare|valuable|worth|price|profit|investment)\b/i);
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
  const publicFile = (url: string) => new URL(`../public${url}`, import.meta.url);

  it("every landing image on the page exists on disk", () => {
    const local = images.filter((s) => s.startsWith("/landing/") || s.startsWith("/heirloom/"));
    expect(local.length).toBeGreaterThan(6);
    for (const s of local) expect(existsSync(publicFile(s)), s).toBe(true);
  });

  it("the two generated pictures are within their size budgets (hero art 350 KB, problem banner 300 KB)", () => {
    expect(statSync(publicFile("/landing/hero-arch.webp")).size).toBeLessThanOrEqual(350 * 1024);
    expect(statSync(publicFile("/landing/problem-keyhole.webp")).size).toBeLessThanOrEqual(300 * 1024);
  });

  it("has no v1 picture left (video, glass chain, chests, stone and foil textures)", () => {
    for (const gone of ["hero-loop", "hero-vault", "keyhole-macro", "lockout-left", "lockout-right", "stone-texture", "foil-texture", "privacy-chain", "privacy-chest", "/heirloom/enclave"]) {
      expect(html).not.toContain(gone);
    }
    expect(html).not.toContain("<video");
  });
});

describe("removed noise", () => {
  it("has no MetaMask note on the landing or in the source", () => {
    expect(html).not.toContain("metamask-note");
    expect(html).not.toContain("MetaMask says");
    expect(() => readFileSync(new URL("../components/MetaMaskNote.tsx", import.meta.url))).toThrow();
  });

  it("the motion module is client-only, has no scroll pin, and guards every effect with reduced motion and ?static", () => {
    const m = src("../components/LandingMotion.tsx");
    expect(m).toContain('"use client"');
    expect(m).toContain("(prefers-reduced-motion: reduce)");
    expect(m).toContain("?static".replace("?", "")); // the `static` search param
    expect(m).toContain("no-motion");
    expect(m).not.toContain("gsap");
    expect(m).not.toContain("ScrollTrigger");
  });

  it("every loop longer than five seconds has a pause control", () => {
    expect(src("../components/landing/Lockout.tsx")).toContain("<LoopControl");
    expect(src("../components/landing/Pledge.tsx")).toContain("<LoopControl");
    expect(src("../components/landing/LandingHero.tsx")).toContain("<LoopControl");
  });
});

describe("public top bar and footer", () => {
  const nav = src("../components/Nav.tsx");
  it("the top bar holds How it works, Proof, Verification path and Launch app, the mainnet pill, and no wallet control", () => {
    expect(nav).toContain('href: "/#handover"');
    expect(nav).toContain('href: "/verify"');
    expect(nav).toContain('href: "/attack"');
    expect(nav).toContain('href: "/verify/path"');
    expect(nav).toContain('"/dashboard"');
    expect(nav).toContain('testid="open-app"');
    expect(nav).toContain("NEAR Mainnet");
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
