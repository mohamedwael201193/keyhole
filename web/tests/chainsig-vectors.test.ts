import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { keyEvmAddress, TEE_MINTER, ROOT_PK, derive, parsePk, fmtPk, pathFor } from "@/lib/chainsig";

// The derivation vectors that the browser code is checked against. They are the same strings that
// tee/worker/src/chainsig.rs asserts (mainnet v1.signer.derived_public_key, 2026-11-03). This test fails if either side drops one.
const rust = readFileSync(new URL("../../tee/worker/src/chainsig.rs", import.meta.url), "utf8");
const root = parsePk(ROOT_PK)!;

describe("chainsig derivation test vectors match the enclave's Rust tests", () => {
  it("the Rust test file carries the same root key and minter", () => {
    expect(rust).toContain(ROOT_PK);
    expect(rust).toContain(TEE_MINTER);
  });
  it.each([
    [TEE_MINTER, "keyhole/key/k5f4750858f328940", "secp256k1:419SnrLvBuvGG69PxtC13uQGotdkjipAPFJr19goK2hbL9SQL3NsRmYp9cLHpuCMuhb2pebXgSQZXgBcpcppBvrx"],
    [TEE_MINTER, "keyhole/key/k0000000000000001", "secp256k1:27kJ38Z3jQ7oENoWxa3N3j7AJZ6ZqfdGsQWirmWeG7ZNF9nubGydYVYYmwRXcewT41SvBi1BvUfPPiU8CaQGS8d4"],
    ["keyhole-devmo.near", "keyhole", "secp256k1:3ZdTLPEJ9R1mMtpdjY6dYJpuWNn26PkgBz3Q5cc1UEtcHqZYG9Y7pytJNvA44d3aXMMvXdzKpcahqdDB4fVPbLhT"],
  ])("vector %s / %s is in the Rust tests and derives in the browser", (pred, path, want) => {
    expect(rust).toContain(want);
    expect(fmtPk(derive(root, pred, path))).toBe(want);
  });
  it("the path rule is the same as the enclave's (k + 16 lowercase hex only)", () => {
    expect(pathFor("k5f4750858f328940")).toBe("keyhole/key/k5f4750858f328940");
    expect(pathFor("K5f4750858f328940")).toBeNull();
    // Rust: len 17, leading 'k', rest ASCII hex and not uppercase. The browser regex /^k[0-9a-f]{16}$/ is the same rule.
    expect(rust).toContain("token_id.len() == 17");
    expect(rust).toContain("is_ascii_hexdigit() && !b.is_ascii_uppercase()");
  });
  it("the key's EVM address matches the address the enclave returned live (call 3d81f582)", () => {
    expect(keyEvmAddress("k5f4750858f328940")).toBe("0xe39C947d5AAC2F9560b690E6f9a8B5d349f4f063");
  });
});
