import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dashHref, navSectionOf, parseSectionHash, sectionFromSearch, sectionHref, walletCallbackUrl } from "@/lib/dashboardSections";
import { isNotSent, notSentView, opIdFrom } from "@/lib/opResult";
import { OP_WORDS, opWord, readMyCalls, rememberCall } from "@/lib/myCalls";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ID = "1:" + "a".repeat(64);
const CALL = "eb1170ca-5481-44ab-952b-2da48b58d0ff";
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe("dashboard sections", () => {
  it("the hash picks the section; nothing or anything unknown is the overview", () => {
    expect(parseSectionHash("")).toEqual({ section: "overview", arg: null });
    expect(parseSectionHash("#swap")).toEqual({ section: "swap", arg: null });
    expect(parseSectionHash("#proof/" + CALL)).toEqual({ section: "proof", arg: CALL });
    expect(parseSectionHash("#signature=abc&accountId=x").section).toBe("overview");
    expect(parseSectionHash("#nonsense").section).toBe("overview");
    expect(navSectionOf("mint")).toBe("keys");
  });

  it("an in-app link to an old route becomes the section address, so ordinary work never leaves /dashboard", () => {
    expect(dashHref("/vault")).toBe("/dashboard#vault");
    expect(dashHref("/swap")).toBe("/dashboard#swap");
    expect(dashHref("/settle")).toBe("/dashboard#activity");
    expect(dashHref("/mint")).toBe("/dashboard#mint");
    expect(dashHref("/keys")).toBe("/dashboard#keys");
    expect(dashHref(`/verify?call=${CALL}`)).toBe(`/dashboard#proof/${CALL}`);
    expect(dashHref("/verify")).toBe("/dashboard#proof");
    expect(dashHref("/demo")).toBe("/demo");
    expect(sectionHref("overview")).toBe("/dashboard");
  });

  it("a redirect wallet returns to the same section: it travels as ?section=, never in the hash the wallet owns", () => {
    expect(walletCallbackUrl("https://keyhole.test/dashboard#swap")).toBe("https://keyhole.test/dashboard?section=swap");
    expect(walletCallbackUrl("https://keyhole.test/dashboard")).toBe("https://keyhole.test/dashboard");
    expect(walletCallbackUrl("https://keyhole.test/vault#x")).toBe("https://keyhole.test/vault");
    expect(sectionFromSearch("?section=vault")).toBe("vault");
    expect(sectionFromSearch("?section=bogus")).toBe("");
    expect(sectionFromSearch("")).toBe("");
  });

  it("the Workspace shows one section at a time and loads the others on first use", () => {
    const w = src("../components/dashboard/Workspace.tsx");
    for (const v of ["SwapView", "VaultView", "GalleryView", "PledgeView", "SettleView", "MyProof", "DashboardView"]) expect(w).toContain(v);
    expect(w).toContain('section === "swap" && <SwapView />');
    expect(src("../app/dashboard/page.tsx")).toContain("<Workspace />");
  });
});

describe("not-sent states", () => {
  it("an unconfirmed or refused value operation is a not-sent state with the original id and one next step", () => {
    for (const c of ["admission_unknown", "value_op_pending", "replay"]) expect(isNotSent(c), c).toBe(true);
    for (const c of ["over_cap_per_tx", "wallet_rejected", "network", null, undefined]) expect(isNotSent(c as string), String(c)).toBe(false);
    const v = notSentView("admission_unknown", `admission not confirmed; reconcile operation ${ID}`, "swap");
    expect(v.opId).toBe(ID);
    expect(v.headline).toBe("Swap not sent");
    expect(v.detail).toContain("No transaction hash exists");
    expect(v.nextStep).toContain("Check the original operation");
    expect(v.nextStep).toContain("Do not try again");
    expect(notSentView("admission_unknown", "no confirmed matching pending admission; do not dispatch", "withdrawal", ID).opId).toBe(ID);
    expect(opIdFrom("nothing here")).toBeNull();
  });
});

describe("my calls", () => {
  it("keeps only the call id, the op and the time, newest first, deduplicated, and ignores anything that is not a call id", () => {
    const s = memory();
    rememberCall("balance", CALL, 1, s);
    rememberCall("swap", "not-a-call-id", 2, s);
    rememberCall("history", "11111111-2222-4333-8444-555555555555", 3, s);
    rememberCall("quote", CALL, 4, s);
    const rows = readMyCalls(s);
    expect(rows.map((r) => [r.op, r.call_id, r.ts_ms])).toEqual([["quote", CALL, 4], ["history", "11111111-2222-4333-8444-555555555555", 3]]);
    expect(JSON.stringify(rows)).not.toMatch(/amount|signature|token/);
    expect(opWord("exact_near_exit_v1")).toBe("Withdrawal");
    expect(opWord("some_new_op")).toBe("some new op");
    expect(Object.keys(OP_WORDS)).toContain("reconcile_value_op");
  });
});
