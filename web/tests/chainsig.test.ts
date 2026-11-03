import { describe, it, expect } from "vitest";
import { parsePk, fmtPk, derive, evmAddress, keyEvmAddress, pathFor, ROOT_PK, TEE_MINTER } from "../lib/chainsig";
import { secp256k1 } from "@noble/curves/secp256k1.js";

const root = parsePk(ROOT_PK)!;
// Same golden vectors as tee/worker/src/chainsig.rs (mainnet v1.signer.derived_public_key, 2026-11-03).
describe("Chain Signatures derivation (TS = Rust = v1.signer)", () => {
  it.each([
    [TEE_MINTER, "keyhole/key/k5f4750858f328940", "secp256k1:419SnrLvBuvGG69PxtC13uQGotdkjipAPFJr19goK2hbL9SQL3NsRmYp9cLHpuCMuhb2pebXgSQZXgBcpcppBvrx"],
    [TEE_MINTER, "keyhole/key/k0000000000000001", "secp256k1:27kJ38Z3jQ7oENoWxa3N3j7AJZ6ZqfdGsQWirmWeG7ZNF9nubGydYVYYmwRXcewT41SvBi1BvUfPPiU8CaQGS8d4"],
    ["keyhole-devmo.near", "keyhole", "secp256k1:3ZdTLPEJ9R1mMtpdjY6dYJpuWNn26PkgBz3Q5cc1UEtcHqZYG9Y7pytJNvA44d3aXMMvXdzKpcahqdDB4fVPbLhT"],
  ])("%s / %s", (pred, path, want) => expect(fmtPk(derive(root, pred, path))).toBe(want));
  it("matches the address the enclave returned live (call 3d81f582)", () => expect(keyEvmAddress("k5f4750858f328940")).toBe("0xe39C947d5AAC2F9560b690E6f9a8B5d349f4f063"));
  it("EIP-55 known vector: private key 1", () => expect(evmAddress(secp256k1.Point.BASE)).toBe("0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"));
  it("root key round-trips", () => expect(fmtPk(root)).toBe(ROOT_PK));
  it.each(["", "k5f47", "K5f4750858f328940", "k5F4750858f328940", "k5f4750858f32894g"])("no address for bad token id %j", (t) => { expect(pathFor(t)).toBeNull(); expect(keyEvmAddress(t)).toBeNull(); });
  it.each(["ed25519:abc", "secp256k1:111", "secp256k1:" + "1".repeat(80)])("refuses bad public key %s", (s) => expect(parsePk(s)).toBeNull());
});
