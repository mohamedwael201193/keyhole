import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { swapOutcome, swapSteps } from "@/components/swap/progress";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const states = (s: ReturnType<typeof swapSteps>) => Object.fromEntries(s.map((x) => [x.id, x.state]));

describe("swap progress follows the real stage", () => {
  it("a wallet-signed swap runs wallet, enclave, settling in order; the price is always locked", () => {
    expect(states(swapSteps({ stage: "wallet", viaWallet: true }))).toEqual({ price: "done", wallet: "active", enclave: "pending", settling: "pending" });
    expect(states(swapSteps({ stage: "enclave", viaWallet: true }))).toEqual({ price: "done", wallet: "done", enclave: "active", settling: "pending" });
    expect(states(swapSteps({ stage: "settling", viaWallet: true }))).toEqual({ price: "done", wallet: "done", enclave: "done", settling: "active" });
  });

  it("a live-session swap has no wallet step", () => {
    const s = swapSteps({ stage: "enclave", viaWallet: false });
    expect(s.map((x) => x.id)).toEqual(["price", "enclave", "settling"]);
    expect(states(s)).toEqual({ price: "done", enclave: "active", settling: "pending" });
  });

  it("a failure marks the step that stopped as error, the earlier ones as done and the later ones as never run", () => {
    expect(states(swapSteps({ stage: "idle", viaWallet: true, failedAt: "wallet" }))).toEqual({ price: "done", wallet: "error", enclave: "pending", settling: "pending" });
    expect(states(swapSteps({ stage: "idle", viaWallet: true, failedAt: "enclave" }))).toEqual({ price: "done", wallet: "done", enclave: "error", settling: "pending" });
    expect(states(swapSteps({ stage: "idle", viaWallet: true, failedAt: "settling" }))).toEqual({ price: "done", wallet: "done", enclave: "done", settling: "error" });
  });

  it("a wallet failure in a session swap, or a failure with no known stage, is reported at the enclave step", () => {
    expect(states(swapSteps({ stage: "idle", viaWallet: false, failedAt: "wallet" }))).toEqual({ price: "done", enclave: "error", settling: "pending" });
    expect(states(swapSteps({ stage: "idle", viaWallet: true, failedAt: "idle" }))).toEqual({ price: "done", wallet: "done", enclave: "error", settling: "pending" });
  });

  it("the price step names the minimum received when the quote gave one, and nothing when it did not", () => {
    expect(swapSteps({ stage: "enclave", viaWallet: true, minOut: "0.013 wNEAR" })[0].detail).toBe("Minimum received 0.013 wNEAR");
    expect(swapSteps({ stage: "enclave", viaWallet: true })[0].detail).toBeUndefined();
  });

  it("step labels are plain words, never internal names", () => {
    for (const s of swapSteps({ stage: "settling", viaWallet: true })) {
      expect(`${s.label} ${s.detail ?? ""}`).not.toMatch(/TEE|nonce|NEP|1Click|intent_hash|worker/i);
    }
  });
});

describe("swap outcome words follow the status the enclave returns", () => {
  it("success is settled, lowercase or not", () => {
    expect(swapOutcome("success")).toMatchObject({ tone: "success", chip: "Settled", headline: "Swap settled", icon: "check" });
    expect(swapOutcome("SUCCESS").tone).toBe("success");
  });

  it("pending, processing and submitted are in progress", () => {
    for (const s of ["pending", "processing", "submitted"]) expect(swapOutcome(s), s).toMatchObject({ tone: "warn", chip: "In progress" });
  });

  it("refunded and failed have their own words; error counts as failed", () => {
    expect(swapOutcome("refunded")).toMatchObject({ tone: "warn", chip: "Refunded" });
    expect(swapOutcome("failed")).toMatchObject({ tone: "error", chip: "Failed", headline: "Swap failed" });
    expect(swapOutcome("error").tone).toBe("error");
  });

  it("an unknown word keeps its own text in a neutral chip, and no status is said so", () => {
    expect(swapOutcome("queued")).toMatchObject({ tone: "neutral", chip: "queued", headline: "Swap submitted" });
    expect(swapOutcome(null)).toMatchObject({ tone: "neutral", chip: "Status not shown" });
    expect(swapOutcome("  ")).toMatchObject({ chip: "Status not shown" });
  });
});

describe("/swap phases and their real sources (source contract)", () => {
  const view = src("../app/swap/view.tsx");
  const done = src("../components/swap/SwapDone.tsx");
  const prog = src("../components/swap/SwapProgress.tsx");
  const about = src("../components/swap/SwapAbout.tsx");

  it("the card has four phases from the real swap state: running, failed, done, and the form", () => {
    expect(view).toContain(`const phase: "form" | "running" | "failed" | "done" = swap.busy ? "running" : swapDone ? "done" : swapFailed ? "failed" : "form";`);
    expect(view).toContain("const swapFailed = !swap.busy && !!swap.res?.error && done != null;");
    expect(view).toContain('phase === "running" && <SwapRunning');
    expect(view).toContain('phase === "failed" && swap.res?.error && (');
    expect(view).toContain('phase === "done" && done && swap.res?.output && (');
  });

  it("the live steps come from the real stage, and the failed step is the last real stage", () => {
    expect(view).toContain("swapSteps({ stage: swap.stage, viaWallet, minOut: minOutText })");
    expect(view).toContain("swapSteps({ stage: lastStage, viaWallet, failedAt: lastStage, minOut: minOutText })");
    expect(view).toContain('useEffect(() => { if (swap.stage !== "idle") setLastStage(swap.stage); }, [swap.stage]);');
    expect(view).toContain('const viaWallet = swap.via === "signature";');
    expect(prog).toContain('testid="trade-pending"');
    expect(src("../components/InCard.tsx")).toContain('stepsTestid = "trade-steps"');
  });

  it("Retry runs the same trade when its quote is fresh, and asks for a new price otherwise", () => {
    expect(view).toContain("if (quoteFresh) confirm(); else review();");
    expect(prog).toContain('testid: "swap-retry"');
    expect(prog).toContain('data-testid="swap-back"');
    expect(prog).toContain("errorText(code");
  });

  it("the success state keeps the trade line, the status word and the call link the e2e flows read", () => {
    expect(done).toContain("summary || outcome.headline");
    expect(done).toContain("{status ?? \"not shown\"}");
    expect(done).toContain("intentTx(intentHash)");
    expect(done).toContain("View transaction");
    expect(done).toContain("`/verify?call=${encodeURIComponent(callId)}`");
    expect(view).toContain("const summary = done && out ? tradeSummary(done.give, String(out.amount_out ?? \"0\"), done.decimals, done.symbol) : \"\";");
  });

  it("the About card links to the real section on the landing page", () => {
    expect(about).toContain('href="/#private"');
    expect(src("../components/Landing.tsx")).toContain('id="private"');
  });

  it("the recent swaps read only from the verified signed history, and show a real link to Activity", () => {
    expect(view).toContain("useLogVerified(history.res)");
    expect(view).toContain('href={dashHref("/settle")}');
    expect(view).toContain("const signedMine = hist && historyOk === true ? [...hist].reverse().filter((e) => e.kind === \"swap\") : [];");
    // A refused swap has no signed-history entry, so its Failed row comes from this browser's own record instead —
    // with the failed attempt's own call id linking to its proof. The signed rows still need the verified log.
    expect(view).toContain("listFailedSwaps(accountId)");
    expect(view).toContain("dashHref(`/verify?call=${encodeURIComponent(e.callId)}`)");
  });

  it("no literal href placeholder and no hard-coded figures on the page or in the new components", () => {
    for (const f of [view, done, prog, about, src("../components/swap/SwapFeatures.tsx")]) {
      expect(f).not.toContain('href="#"');
    }
    expect(src("../components/swap/SwapFeatures.tsx")).not.toMatch(/(title|text): "[^"]*\d/);
  });
});
