import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { depositQuoteBody, isTerminalStatus, refundAddrOk, FUND_DEST } from "@/lib/oneclick";

const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const RECIPIENT = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const SOL_ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_ADDR = "0x1111111111111111111111111111111111111111";
const ok = { origin: SOL_USDC, originChain: "sol", dest: "usdc" as const, amount: "1000000", recipient: RECIPIENT, refundTo: SOL_ADDR };

describe("from another chain: executable quote body", () => {
  it("asks for an exact output into the vault target, with an ORIGIN_CHAIN deposit", () => {
    const b = depositQuoteBody(ok, 0)!;
    expect(b).toMatchObject({
      dry: false, swapType: "EXACT_OUTPUT", depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN",
      originAsset: SOL_USDC, destinationAsset: FUND_DEST.usdc, amount: "1000000", recipient: RECIPIENT, refundTo: SOL_ADDR,
    });
    expect(b.deadline).toBe(new Date(30 * 60_000).toISOString());
  });

  it("sends wNEAR as the destination when the vault asset is wNEAR", () => {
    expect(depositQuoteBody({ ...ok, dest: "wnear", amount: "1000000000000000000000000" })?.destinationAsset).toBe("nep141:wrap.near");
  });

  it("refuses NEAR origins, same-asset pairs and anything not an origin asset id", () => {
    expect(depositQuoteBody({ ...ok, origin: "nep141:wrap.near", originChain: "near" })).toBeNull();
    expect(depositQuoteBody({ ...ok, origin: FUND_DEST.usdc, originChain: "sol" })).toBeNull();
    expect(depositQuoteBody({ ...ok, origin: "x" })).toBeNull();
    expect(depositQuoteBody({ ...ok, origin: "nep141:bad id with spaces" })).toBeNull();
  });

  it("refuses zero, leading zeros and non-digit amounts", () => {
    expect(depositQuoteBody({ ...ok, amount: "0" })).toBeNull();
    expect(depositQuoteBody({ ...ok, amount: "01" })).toBeNull();
    expect(depositQuoteBody({ ...ok, amount: "1.5" })).toBeNull();
    expect(depositQuoteBody({ ...ok, amount: "" })).toBeNull();
  });

  it("requires a NEAR recipient (the vault target) and a refund address valid on the origin chain", () => {
    expect(depositQuoteBody({ ...ok, recipient: "Not Valid!" })).toBeNull();
    expect(depositQuoteBody({ ...ok, refundTo: EVM_ADDR })).toBeNull();
    expect(depositQuoteBody({ origin: BASE_USDC, originChain: "base", dest: "usdc", amount: "1000000", recipient: RECIPIENT, refundTo: EVM_ADDR })).not.toBeNull();
  });
});

describe("from another chain: refund address shape", () => {
  it("checks 0x for EVM chains, base58 for Solana, and a plain token-like string elsewhere", () => {
    expect(refundAddrOk("base", EVM_ADDR)).toBe(true);
    expect(refundAddrOk("base", "0x12")).toBe(false);
    expect(refundAddrOk("sol", SOL_ADDR)).toBe(true);
    expect(refundAddrOk("sol", EVM_ADDR)).toBe(false);
    expect(refundAddrOk("ton", "EQD4FPq-PRDieyQKkizFTRtSDyucUIqrj0v_zXJmqaDp6_0t")).toBe(true);
    expect(refundAddrOk("ton", "no spaces allowed here")).toBe(false);
  });
});

describe("from another chain: status stop rule", () => {
  it("stops polling only on a terminal status", () => {
    for (const s of ["SUCCESS", "FAILED", "REFUNDED", "INCOMPLETE_DEPOSIT"]) expect(isTerminalStatus(s), s).toBe(true);
    for (const s of ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SOMETHING_NEW", ""]) expect(isTerminalStatus(s), s).toBe(false);
    expect(isTerminalStatus(null)).toBe(false);
    expect(isTerminalStatus(undefined)).toBe(false);
  });
});

describe("/vault deposit sheet", () => {
  const view = readFileSync(new URL("../app/vault/view.tsx", import.meta.url), "utf8");
  const chain = readFileSync(new URL("../components/FundFromChain.tsx", import.meta.url), "utf8");

  it("has Direct and From another chain tabs and keeps the deposit testids", () => {
    expect(view).toContain('testid="deposit-tabs"');
    expect(view).toContain('{ id: "direct", label: "Direct" }');
    expect(view).toContain('{ id: "chain", label: "From another chain" }');
    for (const id of ["deposit-sheet", "fund-btn", "fund-asset", "fund-amt", "deposit", "account-btn", "confidential-id", "fac-quote"]) {
      expect(view + chain, id).toContain(`"${id}"`);
    }
  });

  it("asks for the same unlock as the top bar when the deposit target needs a signed read", () => {
    expect(view).toContain('testid="fac-unlock"');
    expect(view).toContain("onClick={() => void unlock()}");
  });

  it("polls status through the existing route and stops on a terminal status (in the saved-order hook)", () => {
    const hook = readFileSync(new URL("../lib/useFundOrder.ts", import.meta.url), "utf8");
    expect(hook).toContain("/api/oneclick?depositAddress=");
    expect(hook).toContain("isTerminalStatus(r.status)");
    expect(hook).toContain("halt()");
  });

  it("says only what the quote supports about routing", () => {
    expect(chain).toContain("Routed by NEAR Intents 1Click into this vault&apos;s deposit address. Small first? Try a small amount first.");
  });
});
