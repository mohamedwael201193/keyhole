import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InCardFailure, InCardProgress, InCardSuccess, stepFraction } from "@/components/InCard";
import { SwapDone } from "@/components/swap/SwapDone";
import { SwapFailed } from "@/components/swap/SwapProgress";
import { swapOutcome, swapSteps } from "@/components/swap/progress";
import { LOCK_LABEL } from "@/lib/valueLock";
import { withdrawResultView } from "@/lib/opResult";
import { chainSaysNonePending } from "@/components/ValueRecovery";
import { OpNotSent } from "@/components/OpNotSent";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const BANNED = /journal|UNKNOWN|admission|admitted|operation id|worker|session check|judge/i;

describe("the recovery card is gone from every page", () => {
  it("the app shell no longer mounts it, and no page-level 'Account operation recovery' title exists", () => {
    expect(src("../components/app/AppShell.tsx")).not.toContain("ValueRecovery");
    const rec = src("../components/ValueRecovery.tsx");
    expect(rec).not.toContain("Account operation recovery");
    expect(rec).not.toContain("<h2");
    expect(rec).toContain("Confirming an earlier deposit… no funds at risk");
    expect(rec).toContain(">Confirm</Button>");
  });
  it("it is rendered only inside the card of the operation that waits (swap, withdraw sheet, overview vault)", () => {
    expect(src("../app/swap/view.tsx")).toContain("<ValueRecovery");
    expect(src("../app/vault/view.tsx")).toContain("<ValueRecovery");
  });
});

describe("the swap button never says 'Locked until...'", () => {
  it("shows 'Confirming earlier deposit…' with a spinner while an earlier operation is pending", () => {
    expect(LOCK_LABEL).toBe("Confirming earlier deposit…");
    const s = src("../app/swap/view.tsx");
    expect(s).toContain("const ctaLabel = gated ? LOCK_LABEL");
    expect(s).toContain("unlocking || gated}");
    expect(s).not.toContain("Locked until");
    expect(src("../app/vault/view.tsx")).not.toContain("Locked until the earlier");
  });
});

describe("results show in place inside their own card", () => {
  it("progress: a title, a bar that moves with the real steps", () => {
    const steps = swapSteps({ stage: "enclave", viaWallet: false });
    expect(stepFraction(steps)).toBeGreaterThan(0.3);
    expect(stepFraction(steps)).toBeLessThan(1);
    const m = renderToStaticMarkup(createElement(InCardProgress, { title: "Swapping…", steps }));
    expect(m).toContain('role="progressbar"');
    expect(m).toContain("Swapping…");
  });
  it("success: check mark, amount, the word Settled and a transaction link", () => {
    const m = renderToStaticMarkup(createElement(SwapDone, { outcome: swapOutcome("success"), summary: "Traded 0.02 USDC → 0.004 wNEAR", status: "success", intentHash: "4qAbc", onAgain: () => {} }));
    const t = text(m);
    expect(t).toContain("Traded 0.02 USDC → 0.004 wNEAR");
    expect(t).toContain("Settled");
    expect(m).toContain("https://explorer.near-intents.org/transactions/4qAbc");
    expect(m).toContain("View transaction");
    expect(m).toContain("<svg");
  });
  it("failure: one plain line, one button, the code only in Details", () => {
    const m = renderToStaticMarkup(createElement(SwapFailed, { steps: [], stoppedAt: "Enclave runs the swap", code: "over_cap_per_tx", onRetry: () => {}, onBack: () => {} }));
    expect(m).toContain('role="alert"');
    expect(m).toContain('data-testid="swap-retry"');
    expect((m.match(/<details/g) ?? []).length).toBe(1);
    const visible = text(m.replace(/<details[\s\S]*?<\/details>/g, ""));
    expect(visible).not.toMatch(BANNED);
    expect(visible).not.toContain("over_cap_per_tx");
  });
  it("the generic pieces carry no internal terms", () => {
    const ok = text(renderToStaticMarkup(createElement(InCardSuccess, { amount: "Withdrawn 1 USDC", link: { href: "https://nearblocks.io/txns/x" } })));
    const bad = text(renderToStaticMarkup(createElement(InCardFailure, { reason: "That amount is above the limit.", action: { label: "Back", onClick: () => {} } })));
    expect(ok).not.toMatch(BANNED);
    expect(bad).not.toMatch(BANNED);
  });
  it("the withdraw sheet swaps the form for in-card progress, success and failure", () => {
    const v = src("../app/vault/view.tsx");
    for (const id of ["withdraw-pending", "withdraw-out", "withdraw-failed"]) expect(v).toContain(`"${id}"`);
    expect(v).toContain("InCardSuccess");
    expect(v).not.toContain("TeeProgress active={withdraw.busy}");
  });
});

describe("a lock clears only when the chain says nothing is pending", () => {
  it("a pending count above zero, a non-numeric answer or a failed read all keep the lock", async () => {
    expect(await chainSaysNonePending("0", async () => "0")).toBe(true);
    expect(await chainSaysNonePending("0", async () => 0)).toBe(true);
    expect(await chainSaysNonePending("0", async () => "1")).toBe(false);
    expect(await chainSaysNonePending("0", async () => 2)).toBe(false);
    expect(await chainSaysNonePending("0", async () => null)).toBe(false);
    expect(await chainSaysNonePending("0", async () => { throw new Error("rpc"); })).toBe(false);
  });
  it("uses the row's own token, re-checks on a timer and on focus, and asks the public view", () => {
    const r = src("../components/ValueRecovery.tsx");
    expect(r).toContain("forgetResolved(accountId, tokenId, r.output)");
    expect(r).not.toContain("forgetResolved(accountId, typeof");
    expect(r).toContain("pending_value_op_count");
    expect(r).toContain('addEventListener("focus"');
    expect(r).toContain("setInterval");
  });
});

describe("a withdrawal is Settled only with a terminal status and a transaction hash", () => {
  it("no hash: Sent, confirming, no link", () => {
    expect(withdrawResultView({ status: "success" })).toEqual({ settled: false, title: "Sent · confirming…", hash: null });
    expect(withdrawResultView({ status: "pending", tx_hash: "abc" }).settled).toBe(false);
    expect(withdrawResultView({ status: "pending", tx_hash: "abc" }).hash).toBeNull();
    expect(withdrawResultView(null).settled).toBe(false);
  });
  it("status and hash: Settled with the hash", () => {
    expect(withdrawResultView({ status: "success", tx_hash: "b5ea" })).toEqual({ settled: true, title: "Settled", hash: "b5ea" });
  });
  it("the vault shows no account link as a transaction link", () => {
    const v = src("../app/vault/view.tsx");
    expect(v).toContain("withdrawResultView(withdraw.res.output)");
    expect(v).not.toContain("Open your account on NearBlocks");
  });
  it("a swap with no intent hash shows no link", () => {
    const m = renderToStaticMarkup(createElement(SwapDone, { outcome: swapOutcome("success"), summary: "Traded 1 A → 2 B", status: "success", onAgain: () => {} }));
    expect(m).not.toContain("View transaction");
  });
  it("the not-sent card uses plain words", () => {
    const html = renderToStaticMarkup(createElement(OpNotSent, { code: "admission_unknown", noun: "swap" }));
    const m = text(html.split("<details>")[0]);
    expect(m).not.toMatch(BANNED);
  });
});
