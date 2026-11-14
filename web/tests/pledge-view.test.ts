import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("next/navigation", () => ({ usePathname: () => "/pledge" }));
vi.mock("@/lib/wallet", () => ({
  useWallet: () => ({ accountId: null, connect: () => {}, disconnect: async () => {}, restoring: false, mismatch: null }),
}));
vi.mock("@/lib/keyStore", () => ({
  useKeyStore: () => ({ status: "ready", keys: [], primary: null, tier: null, refresh: async () => {} }),
  KeyStoreProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/lib/config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/config")>("@/lib/config");
  return { ...actual, PLEDGE_LIVE: false };
});

import { PledgeView } from "@/app/pledge/view";

describe("PledgeView Loans showcase (flag OFF)", () => {
  it("shows the two settled mainnet loans, timelines, costs, and no preview copy", () => {
    const html = renderToStaticMarkup(createElement(PledgeView));
    expect(html).toContain('data-testid="pledge-page"');
    expect(html).toContain('data-live="0"');
    expect(html).toContain("Borrow against your key");
    expect(html).toContain("Two real loans on NEAR mainnet: one repaid, one defaulted.");
    expect(html).toContain("NEAR mainnet");
    expect(html).toContain("2 loans settled");
    expect(html).toContain('data-testid="loan-card-a"');
    expect(html).toContain("REPAID");
    expect(html).toContain('data-testid="loan-card-b"');
    expect(html).toContain("DEFAULTED");
    expect(html).toContain("Key transferred to lender");
    expect(html).toContain("owner_epoch 0 → 1");
    expect(html).toContain("Fund — first try failed");
    expect(html).toContain("BSkutP…");
    expect(html).toContain("CiPpm7…");
    expect(html).toContain("Costs — measured, not estimated");
    expect(html).toContain("0.1 NEAR");
    expect(html).toContain("0.009 NEAR per loan");
    expect(html).toContain("0.0001 NEAR on a 0.01 NEAR principal");
    expect(html).toContain("0.0032 NEAR");
    expect(html).toContain("Historical attested reads");
    expect(html).toContain("0.213652 USDC");
    expect(html).toContain("0.113652 USDC");
    expect(html).toContain("not trading profit");
    expect(html).toContain("not a live on-chain balance");
    expect(html).toContain("0.899818 USDC");
    expect(html).toContain('data-testid="loans-live-state"');
    expect(html).toContain("Reading the chain…");
    expect(html).toContain("Loans ran through the KEYHOLE worker on mainnet");
    expect(html).toContain("Borrowing from the browser opens in a later release");
    // Fix B: no preview copy survives on /pledge.
    expect(html).not.toContain("Example — preview");
    expect(html).not.toContain("lender-demo.near");
    expect(html).not.toContain("Pledge launches after audit");
    expect(html).not.toContain("Eligible when Pledge goes live");
    expect(html).not.toContain("not yet verified");
    expect(html).not.toContain("Example key");
    expect(html).not.toContain("preview");
  });

  it("CSS keeps float-key, ambient blobs, airy howto, and reduced-motion", () => {
    const css = readFileSync(new URL("../app/pledge/pledge.css", import.meta.url), "utf8");
    expect(css).toContain("plg-float-key");
    expect(css).toContain("plg-blob");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("plg-cap-row");
    expect(css).not.toContain(".plg-howto { display: none");
    expect(css).not.toContain(".plg-float-key { display: none");
  });

  it("loans CSS clips horizontally and respects reduced motion", () => {
    const css = readFileSync(new URL("../app/pledge/loans.css", import.meta.url), "utf8");
    expect(css).toContain("overflow-x: clip");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("loans-timeline");
    expect(css).toContain("loans-keymove");
  });

  it("source never names a competitor product", () => {
    for (const f of ["../app/pledge/view.tsx", "../app/pledge/LoansShowcase.tsx", "../lib/loans.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src).not.toMatch(/\b(hyperliquid|aave|compound|morpho|euler|venus|benqi)\b/i);
      expect(src).not.toMatch(/\bjudge\b/i);
      expect(src).not.toContain("viewing key");
      expect(src).not.toContain("lender-demo");
    }
  });
});

it("the live loan UI still carries the honest floor language (no certified unsigned floor, no browser clock)", () => {
  const live = readFileSync(new URL("../app/pledge/LivePledge.tsx", import.meta.url), "utf8");
  expect(live).toContain("FLOOR_NOTE");
  expect(live).not.toContain("ms - Date.now()");
  const disclosure = readFileSync(new URL("../lib/pledgeDisclosure.ts", import.meta.url), "utf8");
  expect(disclosure).toContain("not a USD value, not LTV, not solvency, not a ZK proof");
  const showcase = readFileSync(new URL("../app/pledge/LoansShowcase.tsx", import.meta.url), "utf8");
  expect(showcase).not.toContain("ms - Date.now()");
  expect(showcase).toContain("not a live on-chain balance");
});
