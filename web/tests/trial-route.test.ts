import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { KeyPairEd25519 } from "near-api-js";
import { POST as guest } from "@/app/api/trial/guest/route";
import { POST as mint } from "@/app/api/trial/mint/route";
import { readSponsor } from "@/lib/trialPolicy";
import { TRIAL_CONTRACT, TRIAL_SPONSOR } from "@/lib/trialPublic";

afterEach(() => { vi.unstubAllEnvs(); });

const IDEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

describe("trial sponsor API", () => {
  it("rejects a bad public key and a mainnet mint receiver", async () => {
    const bad = await guest(post("/api/trial/guest", { publicKey: "ed25519:nope", idempotencyKey: IDEM }));
    expect(bad.status).toBe(400);
    const mainnet = await mint(post("/api/trial/mint", { receiverId: "keyhole-devmo.near", idempotencyKey: IDEM }));
    expect(mainnet.status).toBe(400);
    expect(await mainnet.json()).toMatchObject({ error: "bad_request" });
  });

  it("does not trust x-forwarded-for, and a secret never leaves the response", async () => {
    const secret = `ed25519:${"b".repeat(88)}`;
    vi.stubEnv("KEYHOLE_TESTNET_SPONSOR_ACCOUNT", TRIAL_SPONSOR);
    vi.stubEnv("KEYHOLE_TESTNET_SPONSOR_SECRET", secret);
    const res = await guest(post("/api/trial/guest", { publicKey: "ed25519:nope", idempotencyKey: IDEM }, { "x-forwarded-for": "203.0.113.9" }));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(secret);
    const key = KeyPairEd25519.fromRandom().publicKey.toString();
    const unattested = await guest(post("/api/trial/guest", { publicKey: key, idempotencyKey: IDEM }, { "x-forwarded-for": "203.0.113.9" }));
    expect(unattested.status).toBe(503);
    const text = await unattested.text();
    expect(text).toContain("not attested");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("203.0.113.9");
  });

  it("the sponsor is the dedicated account, not the keys contract", () => {
    const secret = `ed25519:${"c".repeat(80)}`;
    expect(readSponsor({ KEYHOLE_TESTNET_SPONSOR_ACCOUNT: TRIAL_SPONSOR, KEYHOLE_TESTNET_SPONSOR_SECRET: secret })?.accountId).toBe(TRIAL_SPONSOR);
    expect(readSponsor({ KEYHOLE_TESTNET_SPONSOR_ACCOUNT: TRIAL_CONTRACT, KEYHOLE_TESTNET_SPONSOR_SECRET: secret })).toBeNull();
    expect(readSponsor({ KEYHOLE_TESTNET_SPONSOR_ACCOUNT: "keyhole-devmo.near", KEYHOLE_TESTNET_SPONSOR_SECRET: secret })).toBeNull();
  });
});
