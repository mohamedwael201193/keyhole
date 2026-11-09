import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("/settle (Activity): public settlements on the v7 system", () => {
  // The page is split across the route files and components/activity; the testids and copy live in these.
  const v = [
    "../app/settle/view.tsx", "../app/settle/price.tsx", "../components/activity/ActivityList.tsx",
    "../components/activity/OrderDetails.tsx", "../components/activity/ActivityStats.tsx", "../components/activity/useOrderReads.ts",
  ].map(src).join("\n");

  it("keeps the testids the e2e flows and the unit tests read", () => {
    for (const id of [
      "dry", "dry-btn", "dry-msg", "dry-out", "dry-badge", "dry-tag", "settlement", "funds-path", "st-updated", "st-badge",
      "vault-trade", "vault-trade-verify", "recorded-failed", "act-row", "act-filters", "act-range", "act-search", "act-list",
    ]) {
      expect(v, id).toContain(`"${id}"`);
    }
    expect(v).toContain('data-deposit={row.kind === "live" ? row.id : undefined}');
    expect(v).toContain("data-step={tl.step}");
  });

  it("the dry-quote card is honest: a price only, labelled, and built from the kit", () => {
    expect(v).toContain("Price only · nothing moves");
    expect(v).toContain("TokenSelect");
    expect(v).toContain("AmountInput");
    expect(v).toContain('"/api/oneclick"');
    expect(v).toContain("Nothing was signed and no funds moved.");
  });

  it("reads each listed order's live status from 1Click, one read per order", () => {
    expect(v).toContain("/api/oneclick?depositAddress=");
  });

  it("filters are All, Settled, Refunded and Failed, with counts from the rows", () => {
    for (const label of ["All activity", "Settled", "Refunded", "Failed"]) expect(v, label).toContain(`label: "${label}"`);
    // Counts come from the rows, and a status count waits until no order is still loading (the intent of the old check).
    expect(v).toContain("count: reading ? undefined : counts.settled");
    expect(v).toContain("count: counts.total");
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
