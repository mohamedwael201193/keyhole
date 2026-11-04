import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { authFromSignIn, reusable, signInRequest, SIGNIN_REUSE_MS } from "@/lib/nearConnect";
import { NEP413_RECIPIENT } from "@/lib/config";
import { checkBody } from "@/lib/gateway";

describe("near-connect sign-in + session (one popup)", () => {
  it("the sign-in message is the session request with a blank account", () => {
    const r = signInRequest(1234, new Uint8Array(32).fill(7));
    const m = JSON.parse(r.message);
    expect(m).toEqual({ op: "session", account_id: "", ts_ms: 1234, params: { ttl_ms: 1_800_000, max_usd_micro: 5_000_000 } });
    expect(r.recipient).toBe(NEP413_RECIPIENT);
    expect(r.nonce.length).toBe(32);
  });
  it("fresh nonce each time", () => { expect(signInRequest().nonce).not.toEqual(signInRequest().nonce); });
  it("maps the signed message to worker auth the gateway relays", () => {
    const r = signInRequest(1, new Uint8Array(32).fill(1));
    const a = authFromSignIn(r, { accountId: "alice.near", publicKey: "ed25519:abc", signature: "c2ln" });
    expect(a).toMatchObject({ account_id: "alice.near", public_key: "ed25519:abc", signature: "c2ln", message: r.message, recipient: NEP413_RECIPIENT });
    expect(Buffer.from(a.nonce, "base64")).toEqual(Buffer.from(r.nonce));
    expect(checkBody(JSON.stringify({ op: "session", auth: a })).ok).toBe(true);
  });
  it("a kept sign-in signature is reusable only inside the window", () => {
    const m = signInRequest(1_000_000).message;
    expect(reusable(m, 1_000_000 + SIGNIN_REUSE_MS - 1)).toBe(true);
    expect(reusable(m, 1_000_000 + SIGNIN_REUSE_MS)).toBe(false);
    expect(reusable("junk", 0)).toBe(false);
    expect(SIGNIN_REUSE_MS).toBeLessThan(5 * 60 * 1000); // inside the enclave's freshness window
  });
  it("cites the NEAR docs and the connector repo", () => {
    const src = readFileSync("lib/nearConnect.ts", "utf8");
    expect(src).toContain("https://docs.near.org/web3-apps/tutorials/wallet-login");
    expect(src).toContain("https://github.com/hot-dao/near-selector");
    expect(src).toContain("docs.near.org/web3-apps/backend/backend");
  });
  it("the wallet asks near-connect for sign-in-and-sign-message", () => {
    const w = readFileSync("lib/wallet.tsx", "utf8");
    expect(w).toMatch(/nc\.connect\(\{ signMessageParams: req \}\)/);
    expect(w).toContain("@hot-labs/near-connect");
  });
});
