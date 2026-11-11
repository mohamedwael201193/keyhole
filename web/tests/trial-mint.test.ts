import { afterEach, describe, expect, it } from "vitest";
import { KeyPairEd25519 } from "near-api-js";
import { accountIdForIdempotency } from "@/lib/trialPolicy";
import { mintPracticeKey, resetTrialQueueForTests } from "@/lib/trialSend";
import { GUEST_PER_IP_HOUR } from "@/lib/trialPolicy";
import { SPONSOR_NONCE_BASE, TRIAL_SPONSOR } from "@/lib/trialPublic";

const IDEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "khzzzzzzzzzzzz.testnet";
const secret = KeyPairEd25519.fromRandom().toString();
const env = { KEYHOLE_TESTNET_SPONSOR_ACCOUNT: TRIAL_SPONSOR, KEYHOLE_TESTNET_SPONSOR_SECRET: secret };
const guest = accountIdForIdempotency(IDEM)!;

afterEach(() => { resetTrialQueueForTests(); });

function rpcBytes(value: unknown): number[] {
  return Array.from(Buffer.from(JSON.stringify(value)));
}

function mockFetch(opt: {
  missing?: boolean;
  keys?: { access_key?: { permission?: unknown } }[];
  owned?: unknown[];
  token?: { owner_id?: string } | null;
  mints?: number;
  creates?: number;
  delayMs?: number;
  overlap?: { n: number; max: number };
} = {}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const track = opt.overlap;
    if (track) { track.n += 1; track.max = Math.max(track.max, track.n); }
    if (opt.delayMs) await new Promise((r) => setTimeout(r, opt.delayMs));
    try {
      const u = String(url);
      if (u.includes("api-testnet.nearblocks.io")) {
        const now = BigInt(Date.now()) * 1_000_000n;
        const rows = [
          ...Array.from({ length: opt.mints ?? 0 }, (_, i) => ({ transaction_hash: `m${i}m${i}m${i}m${i}m${i}m${i}m`, signer_account_id: TRIAL_SPONSOR, block_timestamp: String(now), outcomes: { status: true }, actions: [{ method: "nft_mint" }] })),
          ...Array.from({ length: opt.creates ?? 0 }, (_, i) => ({ transaction_hash: `c${i}c${i}c${i}c${i}c${i}c${i}c`, signer_account_id: TRIAL_SPONSOR, block_timestamp: String(now), outcomes: { status: true }, actions: [{ method: "create_account" }] })),
        ];
        return Response.json({ data: rows, meta: {} });
      }
      const params = (JSON.parse(String(init?.body)) as { params: { request_type?: string; method_name?: string; account_id?: string } }).params;
      if (params.request_type === "view_account" && opt.missing && params.account_id === guest) {
        return Response.json({ error: { cause: { name: "UNKNOWN_ACCOUNT" } } });
      }
      if (params.request_type === "view_account") {
        return Response.json({ result: { amount: "10000000000000000000000000", storage_usage: 100 } });
      }
      if (params.request_type === "view_access_key") {
        return Response.json({ result: { nonce: Number(SPONSOR_NONCE_BASE + 4n), permission: "FullAccess" } });
      }
      if (params.request_type === "view_access_key_list") {
        const keys = opt.keys ?? [{ access_key: { permission: "FullAccess" } }];
        return Response.json({ result: { keys } });
      }
      if (params.request_type === "call_function") {
        let value: unknown = { minter: TRIAL_SPONSOR };
        if (params.method_name === "nft_token") value = opt.token === undefined ? null : opt.token;
        if (params.method_name === "nft_tokens_for_owner") value = opt.owned ?? [];
        return Response.json({ result: { result: rpcBytes(value) } });
      }
      return Response.json({ error: { message: "unexpected" } });
    } finally {
      if (track) track.n -= 1;
    }
  }) as typeof fetch;
}

describe("practice mint", () => {
  it("refuses a receiver that is not the guest named by the idempotency key", async () => {
    const r = await mintPracticeKey(IDEM, "198.51.100.8", OTHER, env, mockFetch());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("requires the created guest, one full-access key, and no practice key yet", async () => {
    const missing = await mintPracticeKey(IDEM, "198.51.100.8", null, env, mockFetch({ missing: true }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toMatch(/Create the guest/);

    const two = await mintPracticeKey(IDEM, "198.51.100.8", null, env, mockFetch({ keys: [{ access_key: { permission: "FullAccess" } }, { access_key: { permission: "FullAccess" } }] }));
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.message).toMatch(/exactly one full-access key/);

    const limited = await mintPracticeKey(IDEM, "198.51.100.8", null, env, mockFetch({ keys: [{ access_key: { permission: { FunctionCall: { receiver_id: "x" } } } }] }));
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.status).toBe(400);

    const holds = await mintPracticeKey(IDEM, "198.51.100.8", null, env, mockFetch({ owned: [{ token_id: "kother" }] }));
    expect(holds.ok).toBe(false);
    if (!holds.ok) expect(holds.status).toBe(409);
  });

  it("replays the same token and counts sponsor mints and creates against the ceiling", async () => {
    const replay = await mintPracticeKey(IDEM, "198.51.100.8", guest, env, mockFetch({ token: { owner_id: guest } }));
    expect(replay).toMatchObject({ ok: true, replayed: true, accountId: guest });

    const minted = await mintPracticeKey(IDEM, "198.51.100.8", null, env, mockFetch({ mints: GUEST_PER_IP_HOUR }));
    expect(minted.ok).toBe(false);
    if (!minted.ok) expect(minted.status).toBe(429);

    const created = await mintPracticeKey(IDEM, "198.51.100.8", null, env, mockFetch({ creates: GUEST_PER_IP_HOUR }));
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.status).toBe(429);
  });

  it("serializes reserve so two mints cannot pass the ceiling together", async () => {
    const overlap = { n: 0, max: 0 };
    const fetchImpl = mockFetch({ missing: true, delayMs: 30, overlap });
    await Promise.all([
      mintPracticeKey(IDEM, "198.51.100.8", null, env, fetchImpl),
      mintPracticeKey(IDEM, "198.51.100.8", null, env, fetchImpl),
    ]);
    expect(overlap.max).toBe(1);
  });
});
