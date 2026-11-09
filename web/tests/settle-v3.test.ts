import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("/settle v3: public settlements on the kit", () => {
  const v = src("../app/settle/view.tsx");

  it("keeps the testids the e2e flows read", () => {
    for (const id of ["dry", "dry-btn", "dry-msg", "dry-out", "settlement", "funds-path", "st-updated", "st-badge", "vault-trade", "vault-trade-verify", "recorded-failed"]) {
      expect(v, id).toContain(`"${id}"`);
    }
    expect(v).toContain("data-deposit={s.depositAddress}");
    expect(v).toContain('data-step={f.step}');
  });

  it("the dry-quote card is honest: a price only, labelled, and built from the kit", () => {
    expect(v).toContain("Price only · nothing moves");
    expect(v).toContain("TokenSelect");
    expect(v).toContain("AmountInput");
    expect(v).toContain('"/api/oneclick"');
    expect(v).toContain("Nothing was signed and no funds moved.");
  });

  it("the swap entry in the sidebar goes to /swap, and Activity goes to /settle", () => {
    const shell = src("../components/app/AppShell.tsx");
    expect(shell).toContain('{ id: "swap", label: "Swap", href: "/swap", icon: "swap", match: ["/swap"] }');
    expect(shell).toContain('{ id: "activity", label: "Activity", href: "/settle", icon: "activity", match: ["/settle"] }');
  });

  it("the settle page keeps the agent panel and the recorded-failed example", () => {
    expect(v).toContain("<AgentPanel />");
    expect(v).toContain("RECORDED_FAILED");
  });
});
