import { describe, expect, it } from "vitest";
import { assetRows, fromBaseUnits, priceToMicro, totalOf, tradeSummary, valueMicro, withdrawSummary } from "@/lib/amount";
import { intentTx } from "@/lib/config";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WNEAR = "nep141:wrap.near";
const OUT = "4484263051703687050358";

describe("token amounts", () => {
  it("turns base units into the human amounts from the mainnet read", () => {
    expect(fromBaseUnits("40000", 6)).toBe("0.04");
    expect(fromBaseUnits("20000", 6)).toBe("0.02");
    expect(fromBaseUnits("10000", 6)).toBe("0.01");
    expect(fromBaseUnits(OUT, 24)).toBe("0.004484");
  });

  it("maps known tokens to symbol, name, logo and amount, and leaves unknown tokens raw", () => {
    const rows = assetRows([
      { token: USDC, balance: "40000" },
      { token: WNEAR, balance: OUT },
      { token: "nep141:unknown-token.near", balance: "7" },
    ]);
    expect(rows[0]).toMatchObject({ known: true, logo: "usdc", symbol: "USDC", name: "USD Coin", amountLabel: "0.04 USDC", usdMicro: 40000 });
    expect(rows[1]).toMatchObject({ known: true, logo: "near", symbol: "wNEAR", name: "Wrapped NEAR", amountLabel: "0.004484 wNEAR", usdMicro: null });
    expect(rows[2]).toMatchObject({ known: false, logo: null, amountLabel: "7" });
    expect(rows[2].symbol).not.toBe("NEAR");
    expect(rows[2].symbol.length).toBeLessThan("nep141:unknown-token.near".length);
  });

  it("prices a mixed USDC and wNEAR balance from the token list", () => {
    expect(priceToMicro("4.45")).toBe(4_450_000);
    expect(priceToMicro(0.999469)).toBe(999469);
    const prices = {
      [USDC]: { priceMicro: 1_000_000, decimals: 6, symbol: "USDC" },
      [WNEAR]: { priceMicro: 2_000_000, decimals: 24, symbol: "wNEAR" },
    };
    const wnear = valueMicro(OUT, 24, 2_000_000);
    expect(wnear).toBeGreaterThan(0);
    const rows = assetRows([{ token: USDC, balance: "20000" }, { token: WNEAR, balance: OUT }], prices);
    expect(totalOf(rows)).toEqual({ kind: "usd", micro: 20000 + (wnear as number) });
  });

  it("names an unpriced holding instead of dropping it from the total", () => {
    const rows = assetRows([{ token: USDC, balance: "20000" }, { token: WNEAR, balance: OUT }]);
    expect(rows.find((r) => r.symbol === "wNEAR")?.usdMicro).toBeNull();
    expect(totalOf(rows)).toEqual({ kind: "partial", micro: 20000, unpriced: ["0.004484 wNEAR"] });
  });

  it("shows a dollar total after a read, and $0.00 only when empty", () => {
    expect(totalOf(null)).toEqual({ kind: "unread" });
    expect(totalOf([])).toEqual({ kind: "empty" });
    expect(totalOf(assetRows([{ token: WNEAR, balance: OUT }]))).toEqual({ kind: "amounts", text: "0.004484 wNEAR" });
  });
});

describe("trade and withdraw results", () => {
  it("states the trade in human amounts and links the intent hash", () => {
    expect(tradeSummary("0.02 USDC", OUT, 24, "wNEAR")).toBe("Traded 0.02 USDC → 0.004484 wNEAR");
    const hash = "4qAnExampleIntentHash";
    expect(intentTx(hash)).toBe(`https://explorer.near-intents.org/transactions/${hash}`);
  });

  it("states the withdraw with the destination and the request", () => {
    expect(withdrawSummary("0.01 USDC", "0xf76e…71a3")).toBe("Withdrawn 0.01 USDC to 0xf76e…71a3");
  });
});
