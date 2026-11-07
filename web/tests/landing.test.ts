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
  it("keeps the essentials in order: hero, live numbers, how it works, features, vault, proof, collection, CTA", () => {
    const ids = ["s01", "how-h", "feat-h", "priv-h", "encl-h", "gal-h", "cta-h"];
    const at = ids.map((id) => html.indexOf(`id="${id}"`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html.indexOf('aria-label="Live numbers"')).toBeGreaterThan(0);
    expect(html.indexOf('aria-label="Live numbers"')).toBeLessThan(at[1]);
  });

  it("the cut sections are gone: utility checks, agents, long proof list, chain medals, explore row", () => {
    expect(html).not.toContain('id="util-h"');
    expect(html).not.toContain('id="ag-h"');
    expect(html).not.toContain('id="proof-h"');
    expect(html).not.toContain('class="lp-chains"');
    expect(html).not.toContain('class="lp-explore"');
    expect(html).not.toContain("lp-more");
  });

  it("the enclave card keeps its structure and links to the verifier and the judge path", () => {
    expect(html).toMatch(/class="[^"]*attc/);
    expect(html).toContain('data-testid="verify-cta"');
    expect(html).toMatch(/href="\/judge"/);
  });

  it("the three how-it-works steps are rendered on the server, so the page works without JavaScript", () => {
    expect(html.match(/class="lp-step"/g)?.length).toBe(3);
    expect(html).toContain('data-testid="sealed-line"');
  });

  it("the live numbers are final values in the server markup", () => {
    expect(html).toContain('data-testid="checks-stat"');
    expect(html).toMatch(/data-testid="checks-stat"[^]*?>37</);
    expect(html).toContain('data-testid="supply"');
  });

  it("primary calls to action: Start, plus Mint as the secondary", () => {
    expect(html).toContain('data-testid="start-cta"');
    expect(html).toContain('href="/start"');
    expect(html).toContain('href="/mint"');
  });
});

describe("landing images", () => {
  const images = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]).concat([...html.matchAll(/srcSet="([^"]+)"/g)].map((m) => m[1]));

  it("no longer shows the glass chain picture", () => {
    expect(images.some((s) => s.includes("privacy-chain"))).toBe(false);
  });

  it("shows the sealed chest only once, and the chest it shows is the enclave image", () => {
    expect(images.some((s) => s.includes("privacy-chest"))).toBe(false);
    expect(images.filter((s) => s.includes("/heirloom/enclave")).length).toBeGreaterThan(0);
    expect(images.filter((s) => s.includes("/heirloom/privacy")).length).toBe(0);
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
