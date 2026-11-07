import { describe, expect, it, vi } from "vitest";
import { startStep, START_STEPS } from "@/lib/start";
import { accountState, formatNear } from "@/lib/nearAccount";
import { isImplicit } from "@/lib/privySigner";
import { readFileSync } from "node:fs";

const base = { connected: true, holder: false, unlocked: false, limitsDone: false, funded: false };

describe("/start with Google / email (Privy)", () => {
  it("orders topup before mint", () => {
    expect(START_STEPS.indexOf("topup")).toBe(1);
    expect(START_STEPS.indexOf("topup")).toBeLessThan(START_STEPS.indexOf("mint"));
  });
  it("an unfunded implicit account goes to topup, even if it would otherwise mint", () => {
    expect(startStep({ ...base, exists: false })).toBe("topup");
    expect(startStep({ ...base, exists: false, holder: null })).toBe("topup");
  });
  it("once on chain (or unknown, e.g. wallet users / RPC down) the flow is unchanged", () => {
    expect(startStep({ ...base, exists: true })).toBe("mint");
    expect(startStep({ ...base, exists: null })).toBe("mint");
    expect(startStep({ ...base })).toBe("mint");
    expect(startStep({ ...base, exists: true, holder: true })).toBe("unlock");
  });
  it("not connected is always the Get started step", () => {
    expect(startStep({ ...base, connected: false, exists: false })).toBe("connect");
  });
  it("implicit ids are 64 lowercase/uppercase hex", () => {
    expect(isImplicit("a".repeat(64))).toBe(true);
    expect(isImplicit("keyhole.near")).toBe(false);
    expect(isImplicit("a".repeat(63))).toBe(false);
  });
  it("formats yoctoNEAR", () => {
    expect(formatNear(BigInt(0))).toBe("0.0000");
    expect(formatNear(BigInt("10000000000000000000000"))).toBe("0.0100");
    expect(formatNear(BigInt("1234500000000000000000000"))).toBe("1.2345");
  });
  it("view_account: UNKNOWN_ACCOUNT -> not on chain; amount -> balance; errors -> next RPC / null", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ error: { cause: { name: "UNKNOWN_ACCOUNT" } } }) })
      .mockResolvedValueOnce({ json: async () => ({ result: { amount: "5" } }) })
      .mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(new Error("down"));
    vi.stubGlobal("fetch", f);
    expect(await accountState("x", ["u"])).toEqual({ exists: false, yocto: BigInt(0) });
    expect(await accountState("x", ["u"])).toEqual({ exists: true, yocto: BigInt(5) });
    expect(await accountState("x", ["u", "v"])).toBeNull();
    vi.unstubAllGlobals();
  });
  it("the email card opens the Privy modal email-only; Google keeps the default modal", () => {
    const b = readFileSync(new URL("../lib/privyBridge.tsx", import.meta.url), "utf8");
    expect(b).toContain('login(method === "email" ? { loginMethods: ["email"] } : undefined)');
    const v = readFileSync(new URL("../app/start/view.tsx", import.meta.url), "utf8");
    expect(v).toContain('connectSocial("email")');
    expect(v).toContain('connectSocial("google")');
  });
  it("/start keeps its testids and the step order", () => {
    const v = readFileSync(new URL("../app/start/view.tsx", import.meta.url), "utf8");
    for (const id of ["start", "start-dots", "start-social", "start-email", "start-connect", "start-near", "start-finishing", "start-creating", "start-mint", "start-mint-result", "start-limits", "start-limits-skip", "start-fund", "start-check", "start-go", "start-unlocked", "start-mint-tx", "account-ready", "account-balance", "topup", "topup-address"]) {
      expect(v, id).toMatch(new RegExp(`(?:data-)?testid="${id}"`));
    }
    expect(START_STEPS).toEqual(["connect", "topup", "mint", "unlock", "limits", "fund", "done"]);
  });
  it("Privy signs NEP-413 in-page through near-api-js (no third-party executor, no /sign page)", () => {
    const w = readFileSync(new URL("../lib/wallet.tsx", import.meta.url), "utf8");
    expect(w).toContain("signNep413Message(accountId, { message, recipient: NEP413_RECIPIENT, nonce: nonceBytes })");
    const b = readFileSync(new URL("../lib/privyBridge.tsx", import.meta.url), "utf8");
    expect(b).toContain('createWallet({ chainType: "near" })');
    expect(b).toContain('loginMethods: ["google", "email"]');
    expect(b).not.toMatch(/executor\.js|raw\.githubusercontent/);
  });
});
