import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { gateMessage } from "@/lib/holderGate";
import { payloadHash, toB64 } from "@/lib/nep413";

const SECRET = "route-test-secret";
const ACCOUNT = "holder.near";
const seed = new Uint8Array(32).fill(7);
const PK = "ed25519:" + bs58.encode(ed25519.getPublicKey(seed));

/** Loads a fresh route module so its per-process replay set and limiter start empty. */
async function load() {
  vi.resetModules();
  return await import("@/app/api/gate/route");
}
const get = (route: { GET: (r: NextRequest) => Promise<Response> }, account = ACCOUNT, ip = "198.51.100.1") =>
  route.GET(new NextRequest(`http://localhost/api/gate?account_id=${account}`, { headers: { "x-real-ip": ip } }));
const post = (route: { POST: (r: NextRequest) => Promise<Response> }, body: unknown, ip = "198.51.100.2") =>
  route.POST(new NextRequest("http://localhost/api/gate", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-real-ip": ip } }));

/** A real NEP-413 signature over the gate intent for this challenge, signed by the holder seed. */
function signed(challenge: string) {
  const ts = Date.now();
  const message = gateMessage(ACCOUNT, challenge, ts);
  const nonce = new Uint8Array(32).fill(5);
  const sig = ed25519.sign(payloadHash(message, nonce, "keyhole"), seed);
  return { account_id: ACCOUNT, public_key: PK, signature: toB64(sig), nonce: toB64(nonce), message, recipient: "keyhole" };
}

/** Answers the four chain reads the gate makes. `mode` picks the failure under test. */
function chainFetch(mode: "ok" | "unknown_key" | "down" | "http") {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { params: { request_type?: string; method_name?: string } };
    if (mode === "down") throw new Error("network down");
    if (mode === "http") return new Response("bad gateway", { status: 502 });
    const json = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "gate", result }), { status: 200, headers: { "content-type": "application/json" } });
    if (body.params.request_type === "view_access_key") {
      if (mode === "unknown_key") return new Response(JSON.stringify({ jsonrpc: "2.0", id: "gate", error: { cause: { name: "UNKNOWN_ACCESS_KEY" }, message: "unknown" } }), { status: 200 });
      return json({ permission: "FullAccess" });
    }
    const bytes = (v: unknown) => ({ result: Array.from(Buffer.from(JSON.stringify(v), "utf8")) });
    switch (body.params.method_name) {
      case "nft_supply_for_owner": return json(bytes("1"));
      case "holder_tier": return json(bytes(2));
      case "nft_tokens_for_owner": return json(bytes([{ token_id: "k5f4750858f328940" }]));
      default: throw new Error(`unexpected ${body.params.method_name}`);
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("gate route: configuration", () => {
  it("answers 503 in production when HOLDER_GATE_SECRET is unset, for GET and POST", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HOLDER_GATE_SECRET", "");
    const route = await load();
    expect((await get(route)).status).toBe(503);
    const r = await post(route, { challenge: "x.y", auth: {} });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ granted: false, reason: "unavailable" });
  });

  it("answers 503 on Vercel production with no secret, even under a non-production NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("HOLDER_GATE_SECRET", "");
    const route = await load();
    expect((await get(route)).status).toBe(503);
  });

  it("keeps a development fallback when the secret is unset outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("HOLDER_GATE_SECRET", "");
    const route = await load();
    expect((await get(route)).status).toBe(200);
  });

  it("issues a challenge when the secret is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HOLDER_GATE_SECRET", SECRET);
    const route = await load();
    const r = await get(route);
    expect(r.status).toBe(200);
    const j = await r.json() as { challenge: string; expires_ms: number };
    expect(j.challenge.split(".")).toHaveLength(2);
    expect(typeof j.expires_ms).toBe("number");
  });

  it("refuses a malformed account with 400", async () => {
    vi.stubEnv("HOLDER_GATE_SECRET", SECRET);
    const route = await load();
    expect((await get(route, "BAD ACCOUNT")).status).toBe(400);
  });

  it("rate-limits one client to 30 challenges a minute (429)", async () => {
    vi.stubEnv("HOLDER_GATE_SECRET", SECRET);
    const route = await load();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await get(route, ACCOUNT, "198.51.100.9")).status;
    expect(last).toBe(429);
  });
});

describe("gate route: verification", () => {
  it("grants a live holder with tier and key ids", async () => {
    vi.stubEnv("HOLDER_GATE_SECRET", SECRET);
    vi.stubGlobal("fetch", chainFetch("ok"));
    const route = await load();
    const { challenge } = await (await get(route)).json() as { challenge: string };
    const r = await post(route, { challenge, auth: signed(challenge) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ granted: true, tier: 2, account_id: ACCOUNT, key_count: 1, token_ids: ["k5f4750858f328940"] });
  });

  it("answers 503 when the chain cannot be reached, and does not call it not_full_access", async () => {
    vi.stubEnv("HOLDER_GATE_SECRET", SECRET);
    vi.stubGlobal("fetch", chainFetch("down"));
    const route = await load();
    const { challenge } = await (await get(route)).json() as { challenge: string };
    const r = await post(route, { challenge, auth: signed(challenge) });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ granted: false, reason: "unavailable" });
  });

  it("answers 503 on an RPC HTTP error too", async () => {
    vi.stubEnv("HOLDER_GATE_SECRET", SECRET);
    vi.stubGlobal("fetch", chainFetch("http"));
    const route = await load();
    const { challenge } = await (await get(route)).json() as { challenge: string };
    expect((await post(route, { challenge, auth: signed(challenge) })).status).toBe(503);
  });

  it("answers 403 not_full_access only for a key the chain says is not on the account", async () => {
    vi.stubEnv("HOLDER_GATE_SECRET", SECRET);
    const f = chainFetch("unknown_key");
    vi.stubGlobal("fetch", f);
    const route = await load();
    const { challenge } = await (await get(route)).json() as { challenge: string };
    const r = await post(route, { challenge, auth: signed(challenge) });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ granted: false, reason: "not_full_access" });
  });

  it("answers 403 bad_challenge for a challenge the server did not issue", async () => {
    vi.stubEnv("HOLDER_GATE_SECRET", SECRET);
    vi.stubGlobal("fetch", chainFetch("ok"));
    const route = await load();
    const r = await post(route, { challenge: "forged.deadbeef", auth: {} });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ granted: false, reason: "bad_challenge" });
  });

  it("refuses a replay of the same request with 403", async () => {
    vi.stubEnv("HOLDER_GATE_SECRET", SECRET);
    vi.stubGlobal("fetch", chainFetch("ok"));
    const route = await load();
    const { challenge } = await (await get(route)).json() as { challenge: string };
    const auth = signed(challenge);
    expect((await post(route, { challenge, auth })).status).toBe(200);
    const again = await post(route, { challenge, auth });
    expect(again.status).toBe(403);
    expect(await again.json()).toEqual({ granted: false, reason: "replayed" });
  });

  it("answers 413 for an oversized body", async () => {
    vi.stubEnv("HOLDER_GATE_SECRET", SECRET);
    const route = await load();
    expect((await post(route, { challenge: "x".repeat(9000) })).status).toBe(413);
  });
});
