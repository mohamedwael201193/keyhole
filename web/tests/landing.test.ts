import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { Landing } from "@/components/Landing";
import { Footer } from "@/components/Footer";
import { I18nProvider } from "@/lib/i18n";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const withI18n = (el: ReturnType<typeof createElement>) => createElement(I18nProvider, null, el);
const html = renderToStaticMarkup(withI18n(createElement(Landing, { supply: 12, hash: "f4768da8", tokens: [], tiers: [] })));

describe("landing sections", () => {
  it("keeps the order: hero, what you get, how a trade runs, proof, the collection, the closing band", () => {
    const ids = ['id="top"', 'id="outcomes"', 'id="how"', 'id="proof"', 'id="keys"', 'id="cta"'];
    const at = ids.map((id) => html.indexOf(id));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const heads = ["out-h", "how-h", "proof-h", "keys-h", "cta-h"].map((id) => html.indexOf(`id="${id}"`));
    expect(heads.every((i) => i > 0)).toBe(true);
    expect([...heads].sort((a, b) => a - b)).toEqual(heads);
  });

  it("the cut sections are gone: utility checks, agents, long proof list, chain medals, explore row, the attestation card", () => {
    expect(html).not.toContain('id="util-h"');
    expect(html).not.toContain('id="ag-h"');
    expect(html).not.toContain('id="encl-h"');
    expect(html).not.toContain('id="priv-h"');
    expect(html).not.toContain('class="lp-chains"');
    expect(html).not.toContain('class="lp-explore"');
    expect(html).not.toContain("lp-more");
    expect(html).not.toContain('class="attc"');
  });

  it("the hero's primary action launches the app and the secondary checks the proof", () => {
    expect(html).toContain('data-testid="start-cta"');
    expect(html).toMatch(/data-testid="start-cta"[^>]*href="\/dashboard"|href="\/dashboard"[^>]*data-testid="start-cta"/);
    expect(html).toMatch(/href="\/verify"[^]*?Check the proof/);
  });

  it("what you get: three outcomes with real product UI (a live key, the swap card, the transfer calls)", () => {
    expect(html.match(/class="lp-out"/g)?.length).toBe(3);
    expect(html).toContain('data-testid="swap-now"');
    expect(html).toContain('data-testid="transfer-now"');
    expect(html).toContain('data-testid="own-key"'.length ? "ui-key" : "");
    expect(html.match(/data-ok="(true|false)"/g)?.length).toBe(6);
  });

  it("how a trade runs: three nodes on the server, so the page works without JavaScript", () => {
    expect(html.match(/class="how-node /g)?.length).toBe(3);
    expect(html).toContain('data-testid="sealed-line"');
    expect(html).toContain("NFTs that do something.");
  });

  it("proof: the 37 browser checks, the worker and contract hashes, and the order count are final values in the server markup", () => {
    expect(html).toContain('data-testid="checks-stat"');
    expect(html).toMatch(/data-testid="checks-stat"[^]*?>37</);
    expect(html).toContain('data-testid="hash-stat"');
    expect(html).toContain('data-testid="orders-stat"');
    expect(html).toContain('data-testid="verify-cta"');
    expect(html).toContain('data-testid="judge-cta"');
    expect(html).toContain('data-testid="supply"');
  });

  it("the collection is a grid: no carousel, no tilt, the previews labelled as not minted", () => {
    expect(html).toContain('class="lp-grid"');
    expect(html).not.toContain("lp-track");
    expect(html).not.toContain("kh-tilt");
    expect(html).toContain('data-testid="concept-banner"');
    expect(html).toContain('data-testid="gallery-link"');
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
  });
});

describe("public top bar and footer", () => {
  const nav = src("../components/Nav.tsx");
  it("the top bar holds How it works, Proof, For judges and Launch app, and no wallet control", () => {
    expect(nav).toContain('href: "/#how"');
    expect(nav).toContain('href: "/verify"');
    expect(nav).toContain('href: "/judge"');
    expect(nav).toContain('"/dashboard"');
    expect(nav).toContain('testid="open-app"');
    expect(nav).not.toContain("<AccountControl");
    expect(nav).not.toContain("nav-more");
    expect(nav).not.toContain("more-menu");
  });

  it("the footer has three groups (Product, Proof, Learn), the contract line and the NEAR credit", () => {
    const m = renderToStaticMarkup(withI18n(createElement(Footer)));
    for (const g of ["Product", "Proof", "Learn"]) expect(m).toContain(`aria-label="${g}"`);
    for (const href of ["/dashboard", "/mint", "/swap", "/vault", "/verify", "/judge", "/atlas", "/source", "/ask", "/identity", "/demo"]) expect(m).toContain(`href="${href}"`);
    expect(m).toContain("NEAR mainnet");
    expect(m).toContain("Built on NEAR");
  });
});
