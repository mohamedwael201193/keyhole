import { describe, expect, it } from "vitest";
import { fundBody, FUND_ORIGINS, isNearAccount, refundOk } from "@/lib/oneclick";

const base = FUND_ORIGINS.find((a) => a.chain === "base")!.id;
const sol = "nep141:sol.omft.near";
const ok = { origin: base, dest: "usdc" as const, amount: "1000000", recipient: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789", refundTo: "0x1111111111111111111111111111111111111111" };

describe("fund from any chain (1Click executable quote)", () => {
  it("builds an executable quote to the vault deposit address", () => {
    const b = fundBody(ok, 0)!;
    expect(b).toMatchObject({ dry: false, depositType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", refundType: "ORIGIN_CHAIN", recipient: ok.recipient, refundTo: ok.refundTo, originAsset: base });
    expect(String(b.destinationAsset)).toContain("17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
  });
  it("caps the amount (~$5)", () => { expect(fundBody({ ...ok, amount: "5000001" })).toBeNull(); expect(fundBody({ ...ok, amount: "5000000" })).not.toBeNull(); expect(fundBody({ ...ok, origin: sol, amount: "30000001", refundTo: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" })).toBeNull(); });
  it("refuses zero and junk amounts", () => { expect(fundBody({ ...ok, amount: "0" })).toBeNull(); expect(fundBody({ ...ok, amount: "1e6" })).toBeNull(); });
  it("never funds NEAR-origin (that is a plain transfer)", () => { expect(fundBody({ ...ok, origin: "nep141:wrap.near" })).toBeNull(); });
  it("checks the recipient is a NEAR account and the refund matches the chain", () => {
    expect(fundBody({ ...ok, recipient: "Not Valid!" })).toBeNull();
    expect(fundBody({ ...ok, refundTo: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" })).toBeNull();
    expect(isNearAccount("alice.near")).toBe(true); expect(isNearAccount("Alice")).toBe(false);
    expect(refundOk("sol", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe(true); expect(refundOk("base", "0x12")).toBe(false);
  });
});
