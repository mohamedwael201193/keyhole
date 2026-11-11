import "server-only";
import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";
import {
  CREATE_GAS, GUEST_DEPOSIT_YOCTO, LIFETIME_TX, MINT_DEPOSIT_YOCTO, MINT_GAS, PRACTICE_TIER,
  MIN_LIQUID_YOCTO, accountIdForIdempotency, isEd25519PublicKey, isTrialReceiver, readSponsor, scrubSecret, tokenIdForIdempotency,
  type Sponsor,
} from "./trialPolicy";
import { countCreates, judgeQuota, upstashConfig, upstashIncr, type IndexedCreate, type QuotaFacts } from "./trialQuota";
import { isTestnetRpc, TESTNET_INDEXERS, TESTNET_RPCS, TRIAL_CONTRACT } from "./trialPublic";

export type TrialOk = { ok: true; txHash: string; accountId?: string; tokenId?: string; tier?: number; replayed?: boolean };
export type TrialFail = { ok: false; status: number; error: "rate_limited" | "bad_request" | "unavailable"; message: string };
export type TrialResult = TrialOk | TrialFail;

const REFUSE: TrialFail = { ok: false, status: 503, error: "unavailable", message: "The shared trial quota is unavailable." };
const MINTER_MISMATCH: TrialFail = { ok: false, status: 503, error: "unavailable", message: "The configured sponsor is not the trial contract minter." };

let queue: Promise<unknown> = Promise.resolve();
/** One signer at a time in this process, so two trials cannot spend the same nonce. */
export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function hashOf(out: { transaction?: { hash?: string } } | undefined): string | null {
  const hash = out?.transaction?.hash;
  return typeof hash === "string" && hash.length > 0 ? hash : null;
}

async function rpc<T>(url: string, method: string, params: unknown, fetchImpl: typeof fetch): Promise<T> {
  const r = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "trial", method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const j = await r.json() as { error?: { cause?: { name?: string }; message?: string }; result?: T };
  if (!r.ok || j.error) {
    const name = j.error?.cause?.name || j.error?.message || "rpc";
    throw new Error(name);
  }
  return j.result as T;
}

async function withRpc<T>(fn: (url: string) => Promise<T>, fetchImpl: typeof fetch): Promise<T> {
  let last = "testnet rpc failed";
  for (const url of TESTNET_RPCS) {
    if (!isTestnetRpc(url)) throw new Error("refusing rpc");
    try { return await fn(url); }
    catch (e) { last = e instanceof Error ? e.message : last; }
  }
  throw new Error(last);
}

async function viewCall<T>(url: string, contract: string, method: string, args: Record<string, unknown>, fetchImpl: typeof fetch): Promise<T> {
  const result = await rpc<{ result: number[] }>(url, "query", {
    request_type: "call_function", finality: "final", account_id: contract, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  }, fetchImpl);
  return JSON.parse(Buffer.from(result.result).toString("utf8")) as T;
}

async function assertMinter(sponsor: Sponsor, fetchImpl: typeof fetch): Promise<TrialFail | null> {
  try {
    const config = await withRpc((url) => viewCall<{ minter?: string }>(url, TRIAL_CONTRACT, "config", {}, fetchImpl), fetchImpl);
    if (config.minter !== sponsor.accountId) return MINTER_MISMATCH;
    return null;
  } catch {
    return REFUSE;
  }
}

type AccountView = { amount?: string; storage_usage?: number };
type KeyList = { keys?: { access_key?: { nonce?: number } }[] };

async function chainBudget(sponsor: Sponsor, fetchImpl: typeof fetch): Promise<{ liquid: bigint; nonce: bigint } | null> {
  try {
    return await withRpc(async (url) => {
      const account = await rpc<AccountView>(url, "query", { request_type: "view_account", finality: "final", account_id: sponsor.accountId }, fetchImpl);
      const keys = await rpc<KeyList>(url, "query", { request_type: "view_access_key_list", finality: "final", account_id: sponsor.accountId }, fetchImpl);
      const amount = BigInt(account.amount ?? "0");
      const locked = BigInt(account.storage_usage ?? 0) * 10_000_000_000_000_000_000n;
      const nonce = (keys.keys ?? []).reduce((max, key) => {
        const n = BigInt(key.access_key?.nonce ?? 0);
        return n > max ? n : max;
      }, 0n);
      return { liquid: amount - locked, nonce };
    }, fetchImpl);
  } catch {
    return null;
  }
}

type V3Tx = { signer_account_id?: string; block_timestamp?: string; outcomes?: { status?: boolean }; actions?: { method?: string | null }[] };
type V3Page = { data?: V3Tx[]; meta?: { next_page?: string } };

async function indexedCreates(sponsor: Sponsor, fetchImpl: typeof fetch): Promise<{ rows: IndexedCreate[]; complete: boolean } | null> {
  const hosts = TESTNET_INDEXERS;
  for (const host of hosts) {
    try {
      const rows: IndexedCreate[] = [];
      let cursor = "";
      let complete = true;
      for (let page = 0; page < 4; page++) {
        const q = new URL(`${host}/v3/accounts/${sponsor.accountId}/txns`);
        q.searchParams.set("limit", "25");
        if (cursor) q.searchParams.set("next", cursor);
        const r = await fetchImpl(q.toString(), { cache: "no-store", signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } });
        if (!r.ok) throw new Error("indexer");
        const body = await r.json() as V3Page;
        if (!Array.isArray(body.data)) throw new Error("indexer");
        for (const tx of body.data) {
          const method = tx.actions?.find((a) => a.method)?.method;
          if (tx.signer_account_id !== sponsor.accountId) continue;
          if (method !== "create_account" || tx.outcomes?.status !== true) continue;
          if (!/^\d+$/.test(tx.block_timestamp ?? "")) continue;
          rows.push({ atMs: Number(BigInt(tx.block_timestamp!) / 1_000_000n), ok: true });
        }
        cursor = body.meta?.next_page ?? "";
        if (!cursor) break;
        if (page === 3) complete = false;
      }
      return { rows, complete };
    } catch { /* try the other host */ }
  }
  return null;
}

async function reserve(sponsor: Sponsor, ip: string, fetchImpl: typeof fetch, env: Record<string, string | undefined>): Promise<TrialFail | null> {
  const budget = await chainBudget(sponsor, fetchImpl);
  if (!budget) return REFUSE;
  const store = upstashConfig(env);
  let facts: QuotaFacts;
  if (store) {
    try {
      const [ipN, hourN, dayN, lifeN] = await Promise.all([
        upstashIncr(store.url, store.token, `trial:ip:${ip}:h`, 3600, fetchImpl),
        upstashIncr(store.url, store.token, "trial:global:h", 3600, fetchImpl),
        upstashIncr(store.url, store.token, "trial:global:d", 86400, fetchImpl),
        upstashIncr(store.url, store.token, "trial:global:life", 86400 * 365, fetchImpl),
      ]);
      facts = {
        liquidYocto: budget.liquid, nonce: budget.nonce,
        createsLastHour: hourN, createsLastDay: dayN, lifetimeCreates: lifeN,
        ipCreatesLastHour: ipN, ipStore: "upstash", indexerComplete: true, countsIncludeThis: true,
      };
    } catch {
      return REFUSE;
    }
  } else {
    const indexed = await indexedCreates(sponsor, fetchImpl);
    if (!indexed) return REFUSE;
    const counted = countCreates(indexed.rows, Date.now(), indexed.complete);
    facts = {
      liquidYocto: budget.liquid, nonce: budget.nonce,
      createsLastHour: counted.hour, createsLastDay: counted.day, lifetimeCreates: counted.life,
      ipCreatesLastHour: null, ipStore: "chain", indexerComplete: counted.complete && indexed.complete, countsIncludeThis: false,
    };
  }
  const decision = judgeQuota(facts);
  if (!decision.ok) return { ok: false, status: decision.status, error: decision.status === 429 ? "rate_limited" : "unavailable", message: decision.message };
  return null;
}

async function accountHasKey(accountId: string, publicKey: string, fetchImpl: typeof fetch): Promise<"match" | "missing" | "other" | "unknown"> {
  try {
    return await withRpc(async (url) => {
      try {
        await rpc(url, "query", { request_type: "view_account", finality: "final", account_id: accountId }, fetchImpl);
      } catch (e) {
        if ((e as Error).message === "UNKNOWN_ACCOUNT") return "missing" as const;
        throw e;
      }
      const keys = await rpc<KeyList>(url, "query", { request_type: "view_access_key_list", finality: "final", account_id: accountId }, fetchImpl);
      const list = (keys as { keys?: { public_key?: string }[] }).keys ?? [];
      return list.some((k) => k.public_key === publicKey) ? "match" as const : "other" as const;
    }, fetchImpl);
  } catch {
    return "unknown";
  }
}

async function withSponsor<T>(fn: (sponsor: Sponsor, url: string) => Promise<T>, env: Record<string, string | undefined>): Promise<T> {
  const sponsor = readSponsor(env);
  if (!sponsor) throw new Error("sponsor unavailable");
  let last = "testnet rpc failed";
  for (const url of TESTNET_RPCS) {
    if (!isTestnetRpc(url)) throw new Error("refusing rpc");
    try { return await fn(sponsor, url); }
    catch (e) { last = scrubSecret(e instanceof Error ? e.message : "rpc", sponsor.secret); }
  }
  throw new Error(last);
}

export async function sendCreateAccount(accountId: string, publicKey: string, env: Record<string, string | undefined> = process.env): Promise<string> {
  if (!accountId.endsWith(".testnet")) throw new Error("refusing account");
  return enqueue(() => withSponsor(async (sponsor, url) => {
    const account = new Account(sponsor.accountId, new JsonRpcProvider({ url }), sponsor.secret as KeyPairString);
    const out = await account.callFunctionRaw({
      contractId: "testnet", methodName: "create_account",
      args: { new_account_id: accountId, new_public_key: publicKey },
      deposit: GUEST_DEPOSIT_YOCTO, gas: CREATE_GAS, waitUntil: "FINAL",
    });
    const hash = hashOf(out);
    if (!hash) throw new Error("create_account returned no hash");
    return hash;
  }, env));
}

export async function sendMint(receiverId: string, tokenId: string, env: Record<string, string | undefined> = process.env): Promise<string> {
  if (!isTrialReceiver(receiverId)) throw new Error("refusing receiver");
  return enqueue(() => withSponsor(async (sponsor, url) => {
    const config = await viewCall<{ minter?: string }>(url, TRIAL_CONTRACT, "config", {}, fetch);
    if (config.minter !== sponsor.accountId) throw new Error("sponsor is not the contract minter");
    const account = new Account(sponsor.accountId, new JsonRpcProvider({ url }), sponsor.secret as KeyPairString);
    const out = await account.callFunctionRaw({
      contractId: TRIAL_CONTRACT, methodName: "nft_mint",
      args: {
        token_id: tokenId, receiver_id: receiverId, tier: PRACTICE_TIER,
        metadata: { title: "KEYHOLE practice key", description: "Testnet practice key. Not real money.", copies: 1 },
      },
      deposit: MINT_DEPOSIT_YOCTO, gas: MINT_GAS, waitUntil: "FINAL",
    });
    const hash = hashOf(out);
    if (!hash) throw new Error("nft_mint returned no hash");
    return hash;
  }, env));
}

function fail(e: unknown, secret: string, fallback: string): TrialFail {
  return { ok: false, status: 503, error: "unavailable", message: scrubSecret(e instanceof Error ? e.message : fallback, secret) || fallback };
}

export async function createGuest(publicKey: string, idempotencyKey: string, ip: string | null, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<TrialResult> {
  if (!isEd25519PublicKey(publicKey)) return { ok: false, status: 400, error: "bad_request", message: "Send the guest's ed25519 public key. The secret stays in the browser." };
  const accountId = accountIdForIdempotency(idempotencyKey);
  if (!accountId) return { ok: false, status: 400, error: "bad_request", message: "Send the same idempotency key again to retry this guest. A new key would fund another account." };
  if (!ip) return { ok: false, status: 503, error: "unavailable", message: "The client address is not attested by the platform." };
  const sponsor = readSponsor(env);
  if (!sponsor) return { ok: false, status: 503, error: "unavailable", message: "The testnet sponsor is not configured on this server." };
  const minter = await assertMinter(sponsor, fetchImpl);
  if (minter) return minter;
  const existing = await accountHasKey(accountId, publicKey, fetchImpl);
  if (existing === "match") return { ok: true, accountId, txHash: "", replayed: true };
  if (existing === "other") return { ok: false, status: 409, error: "bad_request", message: "That trial key already belongs to a different guest." };
  if (existing === "unknown") return REFUSE;
  const gate = await reserve(sponsor, ip, fetchImpl, env);
  if (gate) return gate;
  try {
    const txHash = await sendCreateAccount(accountId, publicKey, env);
    return { ok: true, txHash, accountId };
  } catch (e) {
    const again = await accountHasKey(accountId, publicKey, fetchImpl);
    if (again === "match") return { ok: true, accountId, txHash: "", replayed: true };
    return fail(e, sponsor.secret, "The testnet account was not created.");
  }
}

export async function mintPracticeKey(receiverId: string, idempotencyKey: string, ip: string | null, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<TrialResult> {
  if (!isTrialReceiver(receiverId)) return { ok: false, status: 400, error: "bad_request", message: "A practice key can only be minted to a testnet account." };
  const tokenId = tokenIdForIdempotency(idempotencyKey);
  if (!tokenId) return { ok: false, status: 400, error: "bad_request", message: "Send the same idempotency key again to retry this mint." };
  if (!ip) return { ok: false, status: 503, error: "unavailable", message: "The client address is not attested by the platform." };
  const sponsor = readSponsor(env);
  if (!sponsor) return { ok: false, status: 503, error: "unavailable", message: "The testnet sponsor is not configured on this server." };
  const minter = await assertMinter(sponsor, fetchImpl);
  if (minter) return minter;
  try {
    const token = await withRpc((url) => viewCall<{ owner_id?: string } | null>(url, TRIAL_CONTRACT, "nft_token", { token_id: tokenId }, fetchImpl), fetchImpl);
    if (token?.owner_id === receiverId) return { ok: true, tokenId, tier: PRACTICE_TIER, accountId: receiverId, txHash: "", replayed: true };
  } catch { return REFUSE; }
  const budget = await chainBudget(sponsor, fetchImpl);
  if (!budget || budget.liquid < MIN_LIQUID_YOCTO) return { ok: false, status: 503, error: "unavailable", message: "The sponsor balance is below the trial floor." };
  if (budget.nonce >= BigInt(LIFETIME_TX)) return { ok: false, status: 429, error: "rate_limited", message: "The trial lifetime ceiling is spent." };
  try {
    const txHash = await sendMint(receiverId, tokenId, env);
    return { ok: true, txHash, tokenId, tier: PRACTICE_TIER, accountId: receiverId };
  } catch (e) {
    return fail(e, sponsor.secret, "The practice key was not minted.");
  }
}
