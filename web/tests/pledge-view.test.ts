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
import { PLEDGE_CTA_DISABLED } from "@/lib/pledgeClient";

describe("PledgeView preview (flag OFF)", () => {
  it("shows labelled Example terms (v5 soul), locked chips, calm warn, caps row, disabled CTA", () => {
    const html = renderToStaticMarkup(createElement(PledgeView));
    expect(html).toContain('data-testid="pledge-page"');
    expect(html).toContain('data-live="0"');
    expect(html).toContain("Example — preview · not live");
    expect(html).toContain(PLEDGE_CTA_DISABLED);
    expect(html).toContain("Borrow NEAR without publishing your");
    expect(html).not.toContain("never your balance");
    expect(html).toContain("Whole account is collateral");
    expect(html).toContain('data-testid="pledge-warn"');
    expect(html).toContain('data-testid="pledge-caps"');
    expect(html).toContain("exit caps");
    expect(html).toContain(">0.50<");
    expect(html).toContain('value="0.01"');
    expect(html).toContain("0.0101");
    expect(html).toContain("lender-demo.near");
    expect(html).toContain("example");
    expect(html).toContain("/tokens/usdc.svg");
    expect(html).toContain("/tokens/near.svg");
    expect(html).toContain("/heirloom/keys/k03.webp");
    expect(html).toContain("You pledge");
    expect(html).toContain("You borrow");
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

  it("source never names a competitor product", () => {
    const view = readFileSync(new URL("../app/pledge/view.tsx", import.meta.url), "utf8");
    expect(view).not.toMatch(/\b(hyperliquid|aave|compound|morpho|euler|venus|benqi)\b/i);
  });
});

it("never labels an unsigned live floor certified or turns a zero due into an expired browser clock",()=>{const src=readFileSync(new URL("../app/pledge/view.tsx",import.meta.url),"utf8");expect(src).toContain("Awaiting confirmed native delivery · no debt clock");expect(src).toContain("Declared minimum · not yet verified");expect(src).toContain("client.chainNowNs()");expect(src).not.toContain("ms - Date.now()");});
