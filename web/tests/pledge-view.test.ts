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
import { PLEDGE_CTA_DISABLED, PLEDGE_PREVIEW_LABEL } from "@/lib/pledgeClient";

describe("PledgeView preview (flag OFF)", () => {
  it("renders labelled preview, locked USDC/NEAR chips, warn copy, caps, disabled audit CTA", () => {
    const html = renderToStaticMarkup(createElement(PledgeView));
    expect(html).toContain('data-testid="pledge-page"');
    expect(html).toContain('data-live="0"');
    expect(html).toContain(PLEDGE_PREVIEW_LABEL);
    expect(html).toContain(PLEDGE_CTA_DISABLED);
    expect(html).toContain("Borrow NEAR without publishing your");
    expect(html).toContain("full balance");
    expect(html).not.toContain("never your balance");
    expect(html).toContain("Whole account is collateral");
    expect(html).toContain('data-testid="pledge-warn"');
    expect(html).toContain('data-testid="pledge-caps"');
    expect(html).toContain("exit caps");
    expect(html).toContain("Certified USDC minimum");
    expect(html).toContain("Entire account is collateral");
    expect(html).toContain("Lender preview never requests your holder balance");
    expect(html).toContain("/tokens/usdc.svg");
    expect(html).toContain("/tokens/near.svg");
    expect(html).toContain("/heirloom/keys/k03.webp");
    // Locked chips — no fake caret / multi-asset picker affordance in form rows
    expect(html).toContain("NEAR · only");
    expect(html).toContain("USDC");
    expect(html).toContain("Due date comes from on-chain loan state");
    expect(html).not.toMatch(/Nov 12, 2026/);
    expect(html).not.toMatch(/lender-demo\.near/);
  });

  it("ships reduced-motion rules and float-key overflow-safe stage CSS", () => {
    const css = readFileSync(new URL("../app/pledge/pledge.css", import.meta.url), "utf8");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("plg-float-key");
    expect(css).toContain("overflow: visible");
    expect(css).toContain("plg-warn");
  });

  it("source never names a competitor product", () => {
    const view = readFileSync(new URL("../app/pledge/view.tsx", import.meta.url), "utf8");
    const client = readFileSync(new URL("../lib/pledgeClient.ts", import.meta.url), "utf8");
    const banned = /\b(hyperliquid|aave|compound|morpho|euler|venus|benqi)\b/i;
    expect(view).not.toMatch(banned);
    expect(client).not.toMatch(banned);
  });
});
