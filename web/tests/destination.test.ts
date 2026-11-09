import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { chainOfAsset, defaultDestination, validDestination } from "@/lib/destination";
import { withdrawParams } from "@/lib/trade";
import { ASSETS } from "@/lib/assets";

const SOL_KEY = bs58.encode(new Uint8Array(32).fill(7));

describe("the chain a token pays out on", () => {
  it("reads an omft token's chain from its id, and treats every other NEAR asset as near", () => {
    expect(chainOfAsset("nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near")).toBe("base");
    expect(chainOfAsset("nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near")).toBe("eth");
    expect(chainOfAsset(ASSETS.usdc.id)).toBe("near");
    expect(chainOfAsset(ASSETS.wnear.id)).toBe("near");
    expect(chainOfAsset("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1")).toBe("near");
  });
});

describe("the default destination", () => {
  it("is the signed-in account on NEAR, and empty on any other chain", () => {
    expect(defaultDestination("near", "alice.near")).toBe("alice.near");
    expect(defaultDestination("near", "")).toBe("");
    expect(defaultDestination("base", "alice.near")).toBe("");
    expect(defaultDestination("near", "Not An Account")).toBe("");
  });
});

describe("validating a destination per chain", () => {
  it("NEAR: a named or implicit account id", () => {
    expect(validDestination("near", "alice.near")).toEqual({ ok: true });
    expect(validDestination("near", "a".repeat(64))).toEqual({ ok: true });
    for (const bad of ["Alice.near", "alice..near", "x", "alice near", "0x" + "a".repeat(63) + "b"]) {
      expect(validDestination("near", bad), bad).toMatchObject({ ok: false });
    }
  });
  it("EVM chains: 0x and exactly 40 hex digits", () => {
    const addr = "0xf76e4b0a4c2d9a1e8b3f5c7d9e1a2b3c4d5e71a3";
    expect(validDestination("base", addr)).toEqual({ ok: true });
    expect(validDestination("eth", addr.toUpperCase().replace("0X", "0x"))).toEqual({ ok: true });
    expect(validDestination("arb", addr.slice(0, -1))).toMatchObject({ ok: false });
    expect(validDestination("base", addr + "0")).toMatchObject({ ok: false });
    expect(validDestination("base", "alice.near")).toMatchObject({ ok: false });
    expect(validDestination("base", "0xg" + "0".repeat(39))).toMatchObject({ ok: false });
  });
  it("Solana: a 32-byte base58 key", () => {
    expect(validDestination("sol", SOL_KEY)).toEqual({ ok: true });
    expect(validDestination("sol", "0x" + "1".repeat(40))).toMatchObject({ ok: false });
    expect(validDestination("sol", "0OIl" + "1".repeat(30))).toMatchObject({ ok: false });
    expect(validDestination("sol", bs58.encode(new Uint8Array(20).fill(7)))).toMatchObject({ ok: false });
  });
  it("an empty address and an unknown chain are refused with a reason", () => {
    expect(validDestination("near", "  ")).toEqual({ ok: false, reason: "Enter the address to withdraw to." });
    expect(validDestination("zzz", "anything")).toMatchObject({ ok: false });
  });
});

describe("withdraw params carry the destination", () => {
  it("default to the account on the token's chain, and take a chosen address on that chain", () => {
    expect(withdrawParams("you.near", "usdc", "1")).toMatchObject({ chain: "near", to: "you.near" });
    expect(withdrawParams("you.near", "usdc", "1", { chain: "near", to: "bob.near" })).toMatchObject({ chain: "near", to: "bob.near" });
  });
});
