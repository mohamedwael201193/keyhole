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
    expect(v).toContain('useSigned("exact_near_exit_v1")');
    expect(v).toContain('if (ctx.op === "withdraw") { setDoneWithdraw({ amount: ctx.amount, to: ctx.to }); setWOpen(true); }');
  });

  it("settings is one card of real controls: limits, session, withdraw and fund from another chain", () => {
    expect(v).toContain('testid="settings-card"');
    for (const id of ["settings-limits", "settings-session", "settings-withdraw", "settings-fund-chain"]) expect(v).toContain(`testid="${id}"`);
    expect(v).not.toContain('<Tabs id="vset"');
    expect(v).toContain('data-testid="vault-session"');
    expect(v).toContain('"session-unlock"');
    expect(v).not.toContain("<SessionCard");
  });

  it("the listed-key freeze and the withdraw cooldown stay visible under the balance", () => {
    expect(v).toContain('data-testid="lock-note"');
    expect(v).toContain('data-testid="lock-cooldown"');
    expect(v).toContain('data-testid="balance-card"');
  });

  it("trading is a link to /swap, not a form on the vault", () => {
    expect(v).toContain('href={dashHref("/swap")}');
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
  it("the sidebar Swap opens the Swap section of the dashboard", () => {
    expect(src("../components/app/AppShell.tsx")).toContain('id: "swap", label: "Swap", href: sectionHref("swap")');
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

describe("holder-only withdrawal UI", () => {
  it("has no editable receiver or destination-chain selector", () => {
    const v = src("../app/vault/view.tsx");
    expect(v).not.toContain('<input id="w-dest"');
    expect(v).not.toContain("setWTo");
    expect(v).not.toContain("wChain");
    expect(v).toContain('data-testid="w-dest"');
    expect(v).toContain("withdrawParams(accountId, wAsset, wUnits)");
    expect(v).toContain('title="Withdraw to your NEAR account"');
  });
});

describe("held vault shows the top-up code when the account is not on chain yet (F-3R)", () => {
  it("mounts TopupQr in the held body as well as the holder-only branch, and nowhere else", () => {
    const v = src("../app/vault/view.tsx");
    // Exactly two mounts, one per mutually exclusive branch: no key held (holder-only) and key held.
    expect(v.match(/<TopupQr accountId=\{accountId\} \/>/g)?.length).toBe(2);
    // The held body is the final `else` after the keyMiss branch; it holds the balance hero.
    const keyMissAt = v.indexOf("} else if (keyMiss) {");
    expect(keyMissAt).toBeGreaterThan(-1);
    const heldAt = v.indexOf("} else {", keyMissAt);
    expect(heldAt).toBeGreaterThan(keyMissAt);
    const heldBody = v.slice(heldAt);
    expect(heldBody).toContain('testid="balance-card"');
    const topupAt = heldBody.indexOf("<TopupQr accountId={accountId} />");
    expect(topupAt).toBeGreaterThan(-1);
    // Above the columns, directly under the balance hero, so an unfunded holder sees it first.
    expect(topupAt).toBeLessThan(heldBody.indexOf('className="vlt-cols"'));
  });

  it("TopupQr only renders its vault-topup marker for an account that does not exist yet", () => {
    const v = src("../app/vault/view.tsx");
    // The gate is the component's own: an account that exists on chain — funded, locked or sealed —
    // never sees the code, so the held-body mount cannot duplicate it for funded accounts.
    expect(v).toContain("if (!acct || acct.exists) return null;");
    expect(v).toContain('data-testid="vault-topup"');
    expect(v).toContain("Your account is not on chain yet.");
  });
});
