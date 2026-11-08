import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("/vault v3 layout", () => {
  const v = src("../app/vault/view.tsx");

  it("opens with a balance hero that is sealed until a signed read", () => {
    expect(v).toContain('testid="balance-card"');
    expect(v).toContain('t("vault.sealed")');
    expect(v).toContain('testid="balance-btn"');
    expect(v).toContain('"Unlock to read"');
  });

  it("keeps the asset list, deposit and withdraw as sheets", () => {
    expect(v).toContain('data-testid="asset-list"');
    expect(v).toContain('<Sheet open={depOpen}');
    expect(v).toContain('<Sheet open={wOpen}');
    for (const id of ["fund-btn", "fund-asset", "fund-amt", "withdraw-btn", "w-asset", "w-amt", "withdraw-out", "cooldown-note", "withdraw-pending"]) expect(v, id).toContain(`"${id}"`);
  });

  it("the withdraw sheet uses a fresh signature (useSigned withdraw) and resumes a redirect", () => {
    expect(v).toContain('useSigned("withdraw")');
    expect(v).toContain('if (ctx.op === "withdraw") { setDoneWithdraw({ amount: ctx.amount, to: ctx.to }); setWOpen(true); }');
  });

  it("settings is one card with three tabs: limits, session, lock", () => {
    expect(v).toContain('testid="settings-card"');
    expect(v).toContain('<Tabs id="vset"');
    for (const tab of ["limits", "session", "lock"]) expect(v).toContain(`id: "${tab}"`);
    expect(v).toContain('data-testid="vault-session"');
    expect(v).toContain('"session-unlock"');
    expect(v).not.toContain("<SessionCard");
  });

  it("trading is a link to /swap, not a form on the vault", () => {
    expect(v).toContain('href="/swap"');
    expect(v).toContain('testid="vault-swap-link"');
    expect(v).not.toContain('useSigned("quote")');
    expect(v).not.toContain('useSigned("swap")');
  });

  it("uses the kit: Card, Button, Sheet, Tabs, AmountInput, TokenSelect, TokenMark", () => {
    expect(v).toContain('from "@/components/ui"');
    expect(v).toContain("TokenMark");
    expect(v).toContain("TokenSelect");
    expect(v).toContain("AmountInput");
  });

  it("the key art and traits stay", () => {
    expect(v).toContain('data-testid="vault-traits"');
    expect(v).toContain("<FoilCard");
    expect(v).toContain("<KeyArt");
  });
});

describe("/swap is the trade screen", () => {
  it("the sidebar Swap goes to /swap", () => {
    expect(src("../components/app/AppShell.tsx")).toContain('href: "/swap"');
  });
});

describe("/vault uses the shared key store and the tokens-only design", () => {
  it("reads the holder key from the store, not its own lookup", () => {
    const v = src("../app/vault/view.tsx");
    expect(v).toContain("useKeyStore()");
    expect(v).toContain("heldFrom(store, accountId)");
    expect(v).not.toContain("useHeldKey");
    expect(v).not.toContain("tokensFor(");
  });
  it("the vault stylesheet uses no !important and no literal colours (tokens only)", () => {
    const css = src("../app/vault/vault.css");
    expect(css).not.toContain("!important");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
