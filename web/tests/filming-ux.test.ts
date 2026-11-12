import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DevelopersView } from "@/app/developers/view";
import { ProofPanel } from "@/components/v7/ProofPanel";
import { OpNotSent } from "@/components/OpNotSent";
import { swapOutcome } from "@/components/swap/progress";
import { SwapFailed } from "@/components/swap/SwapProgress";
import { summaryOf, type OrderRow } from "@/components/activity/orders";
import { I18nProvider } from "@/lib/i18n";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const text = (html: string) => html.replace(/<[^>]*>/g, " ");
const withI18n = (el: ReturnType<typeof createElement>) => createElement(I18nProvider, null, el);
const ID = "1:" + "b".repeat(64);

describe("/developers holds the developer and verification material", () => {
  const m = renderToStaticMarkup(withI18n(createElement(DevelopersView)));
  it("lists the verification tools, the enclave facts, the Agent API demo, the APIs and MCP, the commands and the raw data", () => {
    for (const id of ["evidence", "path", "attack", "source", "atlas", "holders", "ask", "demo"]) expect(m, id).toContain(`data-testid="dev-tool-${id}"`);
    for (const id of ["dev-facts", "dev-build", "dev-endpoints", "dev-manifest"]) expect(m, id).toContain(`data-testid="${id}"`);
    expect(m).toContain("verify.sh");
    expect(m).toContain("MCP");
    expect(m).toContain("holder caps");
  });
  it("shows no visible word 'judge'", () => {
    expect(text(m).toLowerCase()).not.toContain("judge");
  });
  it("the Agent API panel never shows 'operational' beside a read that did not answer", () => {
    const a = src("../components/developers/AgentPanel.tsx");
    expect(a).toContain("{net && !notAnswering &&");
    expect(a).toContain('data-testid="agent-partial"');
  });
  it("is linked from the site bar, the footer and the app sidebar", () => {
    expect(src("../components/Nav.tsx")).toContain('"/developers"');
    expect(src("../components/Footer.tsx")).toContain('"/developers"');
    expect(src("../components/app/AppShell.tsx")).toContain('href="/developers"');
  });
});

describe("the holder dashboard no longer carries developer material", () => {
  it("Activity has no Agent API, quotas or holder-cap panel", () => {
    const v = src("../app/settle/view.tsx");
    expect(v).not.toContain("AgentPanel");
    expect(v).not.toContain("act-agent");
  });
  it("the proof card shows the status and the last call only, and its verify button is disabled with no call", () => {
    const none = renderToStaticMarkup(createElement(ProofPanel, { enclave: "checking", attestation: "unread", lastCall: null, verifyHref: "/dashboard#proof", compact: true, verifyTestId: "v" }));
    expect(none).toContain("disabled");
    expect(none).not.toContain('href="/dashboard#proof"');
    expect(none).not.toContain("Worker build");
    const some = renderToStaticMarkup(createElement(ProofPanel, { enclave: "checking", attestation: "verified", lastCall: "abcdef12-0000", verifyHref: "/dashboard#proof/abcdef12-0000", compact: true, verifyTestId: "v" }));
    expect(some).toContain('href="/dashboard#proof/abcdef12-0000"');
  });
});

describe("a result is never a dead UNKNOWN", () => {
  it("not-sent card: status, no hash, operation id, next step", () => {
    const m = renderToStaticMarkup(createElement(OpNotSent, { code: "admission_unknown", message: `admission not confirmed; reconcile operation ${ID}`, noun: "swap" }));
    expect(m).toContain("Swap not sent");
    expect(m).toContain("None was produced");
    expect(m).toContain(ID);
    expect(m).toContain("Next step");
  });
  it("a failed swap that was not admitted offers no Retry, only the way back", () => {
    const m = renderToStaticMarkup(createElement(SwapFailed, { steps: [], stoppedAt: "Settling on NEAR Intents", code: "admission_unknown", message: ID, onRetry: () => {}, onBack: () => {} }));
    expect(m).toContain('data-testid="swap-not-sent"');
    expect(m).not.toContain('data-testid="swap-retry"');
    expect(m).toContain('data-testid="swap-back"');
    const other = renderToStaticMarkup(createElement(SwapFailed, { steps: [], stoppedAt: "x", code: "over_cap_per_tx", onRetry: () => {}, onBack: () => {} }));
    expect(other).toContain('data-testid="swap-retry"');
  });
  it("a swap status of UNKNOWN says what to do", () => {
    const o = swapOutcome("UNKNOWN");
    expect(o.headline).toBe("Swap not confirmed");
    expect(o.where).toContain("Do not swap again");
    expect(o.where).toContain("Account operation recovery");
  });
});

describe("issue 3: the wallet pop-up is explained before it opens", () => {
  it("the worker takes no session for reconcile_value_op, so the recovery card says so beside the button", () => {
    const worker = readFileSync(new URL("../../tee/worker/src/lib.rs", import.meta.url), "utf8");
    const line = worker.split("\n").find((l) => l.includes("pub const SESSION_OPS"))!;
    expect(line).not.toContain("reconcile_value_op");
    const v = src("../components/ValueRecovery.tsx");
    expect(v).toContain('data-testid="recovery-why"');
    expect(v).toContain("asks your wallet for one signature, even when this session is unlocked");
    expect(v).toContain("Operation id (not a transaction hash)");
  });
});

describe("issues 4 and 7: no stale quote", () => {
  const s = src("../app/swap/view.tsx");
  it("only one quote is in flight, and its answer is matched to the trade it was asked for", () => {
    expect(s).toContain("quoteBusy || quoteKey.current === tradeKey");
    expect(s).toContain("const quoteBusy = quote.busy;");
  });
  it("the old price is hidden and the swap cannot be sent while a new price is on its way", () => {
    expect(s).toContain('data-testid="swap-repricing"');
    expect(s).toContain('(step === "confirm" && repricing)');
    expect(s).toContain("dryKey === tradeKey ? dry : null");
  });
  it("a price check clears its result and error when an input changes, and drops an answer for old inputs", () => {
    const p = src("../app/settle/price.tsx");
    expect(p).toContain("const clearOut = () =>");
    expect(p).toContain("if (mine !== seq.current) return;");
    expect(p).toContain("{msg && units &&");
  });
});

describe("issue 5: value actions follow the lock", () => {
  it("withdraw, swap and the overview Withdraw are disabled while an earlier operation has no final answer", () => {
    const vault = src("../app/vault/view.tsx");
    expect(vault).toContain("disabled={lock.locked}");
    expect(vault).toContain("|| lock.locked}");
    expect(vault).toContain('data-testid="withdraw-locked"');
    expect(vault).toContain("if (!wUnits || !accountId || !wDest.ok || lock.locked) return;");
    const swap = src("../app/swap/view.tsx");
    expect(swap).toContain("gated");
    expect(swap).toContain("lock.locked || quote.busy");
    expect(src("../components/dashboard/Overview.tsx")).toContain("lock.locked");
  });
  it("the worker refuses too: value_op_pending, replay and admission_unknown are worker answers", () => {
    const g = readFileSync(new URL("../../tee/worker/src/guarded.rs", import.meta.url), "utf8");
    expect(g).toContain('err("value_op_pending"');
    expect(g).toContain('err("replay"');
    expect(g).toContain('err("admission_unknown"');
  });
});

describe("issue 9: public and example orders are labelled", () => {
  it("the example record carries no 'Executed at' line, and the details say it is not the holder's trade", () => {
    const row = { id: "x", kind: "vault", title: "t", settlement: null, read: { state: "idle" }, status: null } as unknown as OrderRow;
    const sum = summaryOf(row);
    expect(sum.updatedLabel).not.toBe("Executed at");
    expect(sum.updated).not.toBe("Not recorded here");
    const d = src("../components/activity/OrderDetails.tsx");
    expect(d).toContain("Public example · not your trade");
    expect(d).toContain("Public order · not yours");
  });
});

describe("extras", () => {
  it("a read inside the enclave shows a determinate progress bar", () => {
    const t = src("../components/TeeProgress.tsx");
    expect(t).toContain('role="progressbar"');
    expect(t).toContain("Math.min(95");
    expect(src("../app/vault/view.tsx")).toContain("<TeeProgress active={balance.busy}");
    expect(src("../components/dashboard/Overview.tsx")).toContain("<TeeProgress active={balance.busy}");
  });
  it("holders see the finish name, not 'Tier 1'", () => {
    const h = src("../app/holders/view.tsx");
    expect(h).toContain("tierName(visible.tier)");
    expect(h).not.toContain("Tier {visible.tier}");
  });
  it("a price that is missing on a later read never drops one already known", () => {
    for (const f of ["../app/dashboard/view.tsx", "../app/vault/view.tsx", "../app/swap/view.tsx"]) expect(src(f), f).toContain("setPrices((prev) => ({ ...prev, ...j.prices }))");
  });
  it("Identity says the Bronze card is a design specimen, matching the wallet layout's 'Preview, not minted'", () => {
    const i = src("../app/identity/view.tsx");
    expect(i).toContain("Design specimen");
    expect(i).not.toContain('t("land.attested")');
  });
});
