import { describe, expect, it } from "vitest";
import { fundParams, swapParams, withdrawParams } from "@/lib/trade";

/** The literals cli/src/cli.ts sends. Swap defaults `--from` to this USDC id and `--to` to wrap.near. Withdraw passes `--token <id>`. */
const CLI_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const CLI_WNEAR = "nep141:wrap.near";

describe("site trade params match the CLI", () => {
  it("swap uses asset ids and a base-unit amount, the same shape as `keyhole swap`", () => {
    expect(swapParams("usdc", "wnear", "10000")).toEqual({
      token_in: CLI_USDC,
      token_out: CLI_WNEAR,
      amount_in: "10000",
    });
    expect(swapParams("wnear", "usdc", "10000000000000000000000", "46")).toEqual({
      token_in: CLI_WNEAR,
      token_out: CLI_USDC,
      amount_in: "10000000000000000000000",
      min_amount_out: "46",
    });
  });

  it("sends a floor only when it is a positive integer; zero is left for the enclave to derive", () => {
    expect(swapParams("wnear", "usdc", "1", "0")).not.toHaveProperty("min_amount_out");
    expect(swapParams("wnear", "usdc", "1", "")).not.toHaveProperty("min_amount_out");
    expect(swapParams("wnear", "usdc", "1", "007")).not.toHaveProperty("min_amount_out");
    expect(swapParams("wnear", "usdc", "1", "1")).toHaveProperty("min_amount_out", "1");
  });

  it("withdraw uses the asset id, the same shape as `keyhole withdraw --token <id>`", () => {
    expect(withdrawParams("you.near", "usdc", "10000")).toEqual({
      chain: "near",
      to: "you.near",
      token: CLI_USDC,
      amount: "10000",
    });
    expect(withdrawParams("you.near", "wnear", "1").token).toBe(CLI_WNEAR);
    expect(withdrawParams("you.near", "usdc", "1").token).not.toBe("USDC");
  });

  it("fund keeps the deposit-API symbol, which is not the withdraw id", () => {
    expect(fundParams("usdc", "1000000")).toEqual({ chain: "near", token: "USDC", amount: "1000000" });
    expect(fundParams("usdc", "1").token).not.toBe(CLI_USDC);
  });
});
