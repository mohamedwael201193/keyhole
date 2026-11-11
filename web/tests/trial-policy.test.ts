import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KeyPairEd25519 } from "near-api-js";
import {
  guestAccountId, isEd25519PublicKey, isTrialReceiver, practiceTokenId, readSponsor, scrubSecret,
} from "@/lib/trialPolicy";
import { TESTNET_INDEXERS, TRIAL_CODE_HASH, TRIAL_CONTRACT, TRIAL_SPONSOR, TRIAL_WASM_SHA256, isTestnetRpc } from "@/lib/trialPublic";

describe("guest account policy", () => {
  it("accepts a real ed25519 public key and rejects secrets and junk", () => {
    const key = KeyPairEd25519.fromRandom();
    expect(isEd25519PublicKey(key.publicKey.toString())).toBe(true);
    expect(isEd25519PublicKey(key.toString())).toBe(false);
    expect(isEd25519PublicKey("ed25519:not-a-key")).toBe(false);
    expect(isEd25519PublicKey("")).toBe(false);
  });

  it("names a testnet guest and refuses a mainnet receiver", () => {
    expect(guestAccountId("ab12cd34ef56")).toBe("khab12cd34ef56.testnet");
    expect(guestAccountId("ABC")).toBeNull();
    expect(isTrialReceiver("khab12cd34ef56.testnet")).toBe(true);
    expect(isTrialReceiver("keyhole-devmo.near")).toBe(false);
    expect(isTrialReceiver("alice.near")).toBe(false);
    expect(practiceTokenId("ab12cd34ef567890")).toBe("kab12cd34ef567890");
  });

  it("the sponsor is the dedicated account, not the keys contract", () => {
    const secret = `ed25519:${"a".repeat(80)}`;
    expect(readSponsor({ KEYHOLE_TESTNET_SPONSOR_ACCOUNT: TRIAL_SPONSOR, KEYHOLE_TESTNET_SPONSOR_SECRET: secret })?.accountId).toBe(TRIAL_SPONSOR);
    expect(readSponsor({ KEYHOLE_TESTNET_SPONSOR_ACCOUNT: TRIAL_CONTRACT, KEYHOLE_TESTNET_SPONSOR_SECRET: secret })).toBeNull();
    expect(readSponsor({ KEYHOLE_TESTNET_SPONSOR_ACCOUNT: "keyhole-devmo.near", KEYHOLE_TESTNET_SPONSOR_SECRET: secret })).toBeNull();
    expect(readSponsor({})).toBeNull();
    expect(scrubSecret(`failed ${secret} at rpc`, secret)).not.toContain(secret);
  });

  it("RPC allowlist is testnet only", () => {
    expect(isTestnetRpc("https://rpc.testnet.near.org")).toBe(true);
    expect(isTestnetRpc("https://test.rpc.fastnear.com")).toBe(true);
    expect(isTestnetRpc("https://rpc.mainnet.near.org")).toBe(false);
    expect(isTestnetRpc("https://rpc.mainnet.fastnear.com")).toBe(false);
    expect(TESTNET_INDEXERS).toEqual(["https://api-testnet.nearblocks.io"]);
    expect(TESTNET_INDEXERS.join(" ")).not.toContain("api.nearblocks.io");
  });

  it("the pinned contract is the committed v2.7 wasm", () => {
    const id = JSON.parse(readFileSync(new URL("../../contracts/keys/release/v2.7/identity.json", import.meta.url), "utf8")) as { code_hash: string; wasm_sha256: string };
    const deployed = JSON.parse(readFileSync(new URL("../../docs/trial/testnet.json", import.meta.url), "utf8")) as { account: string; code_hash: string; wasm_sha256: string; network: string };
    expect(deployed.network).toBe("testnet");
    expect(deployed.account).toBe(TRIAL_CONTRACT);
    expect(deployed.code_hash).toBe(id.code_hash);
    expect(deployed.code_hash).toBe(TRIAL_CODE_HASH);
    expect(deployed.wasm_sha256).toBe(id.wasm_sha256);
    expect(deployed.wasm_sha256).toBe(TRIAL_WASM_SHA256);
    expect(TRIAL_CONTRACT.endsWith(".testnet")).toBe(true);
  });
});
