// The v7 key screens: the details panel, the grid tile, the sale states, and the mint stepper, tiers and preview.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The screens read the language and the money format from the i18n context; the test supplies the few strings they use.
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (k: string, v?: Record<string, string | number>) => (k === "gallery.key" ? `KEYHOLE Key #${v?.id}` : k === "gallery.tokenId" ? `Token ${v?.id}` : k),
    fmtUsd: (micro: number) => `$${micro / 1e6}`,
  }),
}));

import { KeyDetails } from "@/components/keys/KeyDetails";
import { KeyTile } from "@/components/keys/KeyTile";
import { MintStepper, PreviewCarousel, TierOption } from "@/components/keys/MintParts";
import { SaleListState } from "@/app/gallery/sale";
import { keyState, type Token } from "@/lib/near";

const TID = "k5f4750858f328940";
const OWNER = "alice.near";
const NEAR = 10n ** 24n;
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const noop = () => {};

describe("KEY DETAILS panel", () => {
  const base = { tokenId: TID, owner: OWNER, tier: 1, proofHref: `/key?id=${TID}`, saleHref: `/key?id=${TID}#sale-card` };

  it("the holder sees Open in vault and List for sale, and no transfer action", () => {
    const m = html(createElement(KeyDetails, { ...base, viewer: OWNER, sale: null }));
    expect(m).toContain('data-testid="kd-open-vault"');
    expect(m).toContain('data-testid="kd-sale-link"');
    expect(m).toContain("List for sale");
    expect(m).toContain('data-testid="kd-proof"');
    expect(m).not.toMatch(/transfer/i);
  });

  it("a listed key shows Manage sale to the holder, and View and buy to anyone else", () => {
    const listing = { token_id: TID, seller: OWNER, price: (5n * NEAR).toString() };
    expect(html(createElement(KeyDetails, { ...base, viewer: OWNER, sale: listing }))).toContain("Manage sale");
    const other = html(createElement(KeyDetails, { ...base, viewer: "bob.near", sale: listing }));
    expect(other).toContain('data-testid="kd-buy-link"');
    expect(other).toContain("For sale for 5 NEAR");
    expect(other).not.toContain('data-testid="kd-open-vault"');
  });

  it("a visitor who holds nothing gets no owner action, and an unread sale says so", () => {
    const m = html(createElement(KeyDetails, { ...base, viewer: null, sale: undefined }));
    expect(m).not.toContain('data-testid="kd-open-vault"');
    expect(m).not.toContain('data-testid="kd-sale-link"');
    expect(m).toContain("Reading the sale status");
  });

  it("the title is the same short name the grid and the vault use", () => {
    expect(html(createElement(KeyDetails, { ...base, viewer: null, sale: null }))).toContain("KEYHOLE Key #5f47");
  });

  it("an unreadable tier is shown as such, never as a guessed finish", () => {
    expect(html(createElement(KeyDetails, { ...base, tier: null, viewer: null, sale: null }))).toContain("Tier not read");
  });
});

describe("gallery tile", () => {
  const token: Token = { token_id: TID, owner_id: OWNER, metadata: null };
  const tile = (over: Partial<Parameters<typeof KeyTile>[0]> = {}) => html(createElement(KeyTile, {
    token, tier: 1, index: 1, viewer: null, sale: null, selected: false, onSelect: noop, ...over,
  }));

  it("keeps the testids the e2e flows read: key-nft, key-link to the history, key-tid, mint-no", () => {
    const m = tile();
    expect(m).toContain('data-testid="key-nft"');
    expect(m).toContain(`href="/key?id=${TID}"`);
    expect(m).toContain('data-testid="key-link"');
    expect(m).toContain('data-testid="key-tid"');
    expect(m).toContain('data-testid="mint-no"');
    expect(m).toContain(`Token ${TID}`);
  });

  it("the holder's key says You own it, a listed key says For sale with its price", () => {
    expect(tile({ viewer: OWNER })).toContain("You own it");
    expect(tile({ sale: { token_id: TID, seller: OWNER, price: (5n * NEAR).toString() } })).toContain("For sale · 5 NEAR");
  });

  it("the state attribute still follows the chain (locked for anyone else)", () => {
    expect(tile()).toContain(`data-state="${keyState(token, 1, null)}"`);
    expect(tile()).toContain('data-state="locked"');
  });

  it("a key whose tier failed to read shows the honest label, not a finish", () => {
    expect(tile({ tier: null })).toContain("Tier not read");
  });
});

describe("sale states on the For sale tab", () => {
  it("contract v2.4 and a failed check each say what happened; a list shows nothing here", () => {
    expect(html(createElement(SaleListState, { support: "v23", read: { status: "loading" }, retrySupport: noop, reload: noop }))).toContain("sale-list-v23");
    expect(html(createElement(SaleListState, { support: "unknown", read: { status: "loading" }, retrySupport: noop, reload: noop }))).toContain("sale-list-unknown");
    expect(html(createElement(SaleListState, { support: "open", read: { status: "error" }, retrySupport: noop, reload: noop }))).toContain("sale-list-retry-read");
    expect(html(createElement(SaleListState, { support: "open", read: { status: "ready", items: [] }, retrySupport: noop, reload: noop }))).toContain("sale-list-empty");
    expect(SaleListState({ support: "open", read: { status: "ready", items: [{ token_id: TID, seller: OWNER, price: "1" }] }, retrySupport: noop, reload: noop })).toBeNull();
  });
});

describe("mint screen parts", () => {
  it("the stepper states come from the caller and the label is always printed", () => {
    const m = html(createElement(MintStepper, { steps: [
      { id: "tier", label: "Choose tier", state: "done" },
      { id: "sign", label: "Sign once", state: "current" },
      { id: "mint", label: "Mint & receive", state: "todo" },
    ] }));
    const tag = (id: string) => m.match(new RegExp(`<li[^>]*${id}[^>]*>`))?.[0] ?? "";
    expect(tag("mint-step-sign")).toContain('data-state="current"');
    expect(tag("mint-step-tier")).toContain('data-state="done"');
    expect(tag("mint-step-mint")).toContain('data-state="todo"');
    expect(m).toContain("Mint &amp; receive");
  });

  it("only Bronze is mintable; the others show their rule and no control", () => {
    const bronze = html(createElement(TierOption, { finish: "Bronze", mintable: true, rule: "r" }));
    expect(bronze).toContain('data-mintable="true"');
    expect(bronze).toContain("$1 / trade");
    const silver = html(createElement(TierOption, { finish: "Silver", mintable: false, rule: "Earned by trading: 10 settled swaps and $5 of volume on the key." }));
    expect(silver).toContain('data-mintable="false"');
    expect(silver).toContain("10 settled swaps and $5 of volume");
    expect(silver).not.toContain("<button");
  });

  it("the preview counts its slides and says which is mintable", () => {
    const m = html(createElement(PreviewCarousel, { slides: [
      { finish: "Bronze", art: 3, mintable: true },
      { finish: "Silver", art: 4, mintable: false },
    ] }));
    expect(m).toContain("1 of 2");
    expect(m).toContain("Mintable today");
    expect(m).toContain('aria-label="Next key"');
  });
});
