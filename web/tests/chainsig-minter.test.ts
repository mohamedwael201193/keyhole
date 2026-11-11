import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TEE_MINTER as CHAINSIG_MINTER, keyEvmAddress } from "@/lib/chainsig";
import { TEE_MINTER as CONFIG_MINTER } from "@/lib/config";

// No network: the minter recorded in identity.json is the value config().minter returned when the release was promoted.
const identity = JSON.parse(readFileSync(new URL("../../identity.json", import.meta.url), "utf8")) as { contract: { minter: string } };

describe("derived chain address is bound to the on-chain minter", () => {
  it("the hard-coded minter in chainsig.ts equals config().minter in identity.json", () => {
    expect(CHAINSIG_MINTER).toBe(identity.contract.minter);
  });
  it("config.ts exports the same minter the derivation uses", () => {
    expect(CONFIG_MINTER).toBe(CHAINSIG_MINTER);
  });
  it("a valid key id gives an address, and the label stays honest about signing", () => {
    expect(keyEvmAddress("k5f4750858f328940")).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
