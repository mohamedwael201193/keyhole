import "server-only";
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";
import {
  CREATE_GAS, GUEST_DEPOSIT_YOCTO, MINT_DEPOSIT_YOCTO, MINT_GAS, PRACTICE_TIER,
  TRIAL_DAY_MS, TRIAL_HOUR_MS, accountIdForIdempotency, isEd25519PublicKey, isTrialReceiver, readSponsor, scrubSecret, tokenIdForIdempotency,
  type Sponsor,
} from "./trialPolicy";
import { countCreates, judgeQuota, QUOTA_STORE_VARS, upstashConfig, upstashGet, upstashIncr, type IndexedCreate, type QuotaFacts } from "./trialQuota";
import { isTestnetRpc, TESTNET_INDEXERS, TESTNET_RPCS, TRIAL_CONTRACT } from "./trialPublic";

export type TrialOk = { ok: true; txHash: string; accountId?: string; tokenId?: string; tier?: number; replayed?: boolean };
export type TrialFail = { ok: false; status: number; error: "rate_limited" | "bad_request" | "unavailable"; message: string; retryAfter?: number };
export type TrialResult = TrialOk | TrialFail;

const REFUSE: TrialFail = { ok: false, status: 503, error: "unavailable", message: "The shared trial quota is unavailable." };
const MINTER_MISMATCH: TrialFail = { ok: false, status: 503, error: "unavailable", message: "The configured sponsor is not the trial contract minter." };

let queue: Promise<unknown> = Promise.resolve();
/** One signer at a time in this process. Reserve and send share this queue so two requests cannot both pass a ceiling. */
export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

type LocalSpend = { hash: string; atMs: number; method: "create_account" | "nft_mint" };
const localSpends: LocalSpend[] = [];

/** Test hook. Production does not call this. */
export function resetTrialQueueForTests(): void {
  localSpends.length = 0;
  queue = Promise.resolve();
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
type KeyView = { nonce?: number | string; permission?: unknown };
type KeyRow = { public_key?: string; access_key?: { permission?: unknown } };
type KeyList = { keys?: KeyRow[] };

function sponsorPublicKey(secret: string): string {
  return KeyPair.fromString(secret as KeyPairString).getPublicKey().toString();
}

function isFullAccess(permission: unknown): boolean {
  if (permission === "FullAccess") return true;
  return !!permission && typeof permission === "object" && "FullAccess" in permission;
}

/** Liquid balance, and the nonce of the secret's own access key. https://docs.near.org/api/rpc/access-keys#view-access-key */
async function chainBudget(sponsor: Sponsor, fetchImpl: typeof fetch): Promise<{ liquid: bigint; nonce: bigint } | null> {
  try {
    const publicKey = sponsorPublicKey(sponsor.secret);
    return await withRpc(async (url) => {
      const account = await rpc<AccountView>(url, "query", { request_type: "view_account", finality: "final", account_id: sponsor.accountId }, fetchImpl);
      const key = await rpc<KeyView>(url, "query", {
        request_type: "view_access_key", finality: "final", account_id: sponsor.accountId, public_key: publicKey,
      }, fetchImpl);
      const amount = BigInt(account.amount ?? "0");
      const locked = BigInt(account.storage_usage ?? 0) * 10_000_000_000_000_000_000n;
      if (typeof key.nonce !== "number" && typeof key.nonce !== "string") throw new Error("nonce");
      return { liquid: amount - locked, nonce: BigInt(key.nonce) };
    }, fetchImpl);
  } catch {
    return null;
  }
}

type V3Tx = { transaction_hash?: string; signer_account_id?: string; block_timestamp?: string; outcomes?: { status?: boolean }; actions?: { method?: string | null }[] };
type V3Page = { data?: V3Tx[]; meta?: { next_page?: string } };

async function indexedTrial(sponsor: Sponsor, fetchImpl: typeof fetch): Promise<{ rows: (IndexedCreate & { hash: string; method: "create_account" | "nft_mint" })[]; complete: boolean } | null> {
  const hosts = TESTNET_INDEXERS;
  for (const host of hosts) {
    try {
      const rows: (IndexedCreate & { hash: string; method: "create_account" | "nft_mint" })[] = [];
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
          const status = tx.outcomes?.status;
          if (method !== "create_account" && method !== "nft_mint") continue;
          if (status !== true && status !== false) continue;
          if (!/^\d+$/.test(tx.block_timestamp ?? "") || !tx.transaction_hash) continue;
          rows.push({ atMs: Number(BigInt(tx.block_timestamp!) / 1_000_000n), ok: true, hash: tx.transaction_hash, method });
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

/** Sends this process signed that the indexer has not listed yet. Hashes already in `seen` are not counted twice. */
function unindexed(seen: Set<string>, now: number): { hour: number; day: number; life: number; creates: number } {
  let hour = 0;
  let day = 0;
  let life = 0;
  let creates = 0;
  for (const spend of localSpends) {
    if (seen.has(spend.hash)) continue;
    life += 1;
    if (spend.method === "create_account") creates += 1;
    if (now - spend.atMs <= TRIAL_DAY_MS) day += 1;
    if (now - spend.atMs <= TRIAL_HOUR_MS) hour += 1;
  }
  return { hour, day, life, creates };
}

async function reserve(sponsor: Sponsor, ip: string, purpose: "create" | "mint", fetchImpl: typeof fetch, env: Record<string, string | undefined>): Promise<TrialFail | null> {
  const budget = await chainBudget(sponsor, fetchImpl);
  if (!budget) return REFUSE;
  const store = upstashConfig(env);
  if (store === "invalid") {
    return { ok: false, status: 503, error: "unavailable", message: `The shared quota store needs ${QUOTA_STORE_VARS}. Set both, or leave both unset to use the on-chain ceiling.` };
  }
  let facts: QuotaFacts;
  if (store) {
    try {
      const [ipN, hourN, dayN, lifeN] = await Promise.all([
        upstashIncr(store.url, store.token, `trial:ip:${ip}:h`, 3600, fetchImpl),
        upstashIncr(store.url, store.token, "trial:global:h", 3600, fetchImpl),
        upstashIncr(store.url, store.token, "trial:global:d", 86400, fetchImpl),
        purpose === "create"
          ? upstashIncr(store.url, store.token, "trial:create:life", 86400 * 365, fetchImpl)
          : upstashGet(store.url, store.token, "trial:create:life", fetchImpl),
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
    const indexed = await indexedTrial(sponsor, fetchImpl);
    if (!indexed) return REFUSE;
    const now = Date.now();
    const counted = countCreates(indexed.rows, now, indexed.complete);
    const createsOnly = countCreates(indexed.rows.filter((row) => row.method === "create_account"), now, indexed.complete);
    const extra = unindexed(new Set(indexed.rows.map((row) => row.hash)), now);
    facts = {
      liquidYocto: budget.liquid, nonce: budget.nonce,
      createsLastHour: counted.hour + extra.hour, createsLastDay: counted.day + extra.day, lifetimeCreates: createsOnly.life + extra.creates,
      ipCreatesLastHour: null, ipStore: "chain", indexerComplete: indexed.complete, countsIncludeThis: false,
    };
  }
  const decision = judgeQuota(facts);
  if (!decision.ok) return { ok: false, status: decision.status, error: decision.status === 429 ? "rate_limited" : "unavailable", message: decision.message, retryAfter: decision.retryAfter };
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

export class BroadcastError extends Error {}

/**
 * Probe each RPC, then sign once. A failure after the probe is an on-chain or post-broadcast error and is not sent again.
 * Only a failed probe moves to the next URL.
 */
export async function sponsorSend<T>(
  env: Record<string, string | undefined>,
  probe: (url: string) => Promise<void>,
  fn: (sponsor: Sponsor, url: string) => Promise<T>,
): Promise<T> {
  const sponsor = readSponsor(env);
  if (!sponsor) throw new Error("sponsor unavailable");
  let last = "testnet rpc failed";
  for (const url of TESTNET_RPCS) {
    if (!isTestnetRpc(url)) throw new Error("refusing rpc");
    try { await probe(url); }
    catch (e) { last = scrubSecret(e instanceof Error ? e.message : "rpc", sponsor.secret); continue; }
    try { return await fn(sponsor, url); }
    catch (e) { throw new BroadcastError(scrubSecret(e instanceof Error ? e.message : "rpc", sponsor.secret)); }
  }
  throw new Error(last);
}

async function probeRpc(url: string): Promise<void> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "probe", method: "status", params: [] }),
    cache: "no-store",
    signal: AbortSignal.timeout(4_000),
  });
  if (!r.ok) throw new Error("rpc");
}

function spendId(e: unknown): string {
  const text = e instanceof Error ? `${e.message} ${e.stack ?? ""}` : String(e);
  const hash = text.match(/[1-9A-HJ-NP-Za-km-z]{43,44}/)?.[0];
  return hash ?? `failed:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function noteSpend(method: "create_account" | "nft_mint", hash: string | null, err?: unknown): void {
  localSpends.push({ hash: hash ?? (err ? spendId(err) : spendId(new Error("unsigned"))), atMs: Date.now(), method });
}

async function signCreate(accountId: string, publicKey: string, env: Record<string, string | undefined>): Promise<string> {
  if (!accountId.endsWith(".testnet")) throw new Error("refusing account");
  return sponsorSend(env, probeRpc, async (sponsor, url) => {
    const account = new Account(sponsor.accountId, new JsonRpcProvider({ url }), sponsor.secret as KeyPairString);
    let noted = false;
    try {
      const out = await account.callFunctionRaw({
        contractId: "testnet", methodName: "create_account",
        args: { new_account_id: accountId, new_public_key: publicKey },
        deposit: GUEST_DEPOSIT_YOCTO, gas: CREATE_GAS, waitUntil: "FINAL",
      });
      const hash = hashOf(out);
      noteSpend("create_account", hash);
      noted = true;
      if (!hash) throw new Error("create_account returned no hash");
      return hash;
    } catch (e) {
      if (!noted) noteSpend("create_account", null, e);
      throw e;
    }
  });
}

async function signMint(receiverId: string, tokenId: string, env: Record<string, string | undefined>, fetchImpl: typeof fetch): Promise<string> {
  if (!isTrialReceiver(receiverId)) throw new Error("refusing receiver");
  return sponsorSend(env, probeRpc, async (sponsor, url) => {
    const config = await viewCall<{ minter?: string }>(url, TRIAL_CONTRACT, "config", {}, fetchImpl);
    if (config.minter !== sponsor.accountId) throw new Error("sponsor is not the contract minter");
    const account = new Account(sponsor.accountId, new JsonRpcProvider({ url }), sponsor.secret as KeyPairString);
    let noted = false;
    try {
      const out = await account.callFunctionRaw({
        contractId: TRIAL_CONTRACT, methodName: "nft_mint",
        args: {
          token_id: tokenId, receiver_id: receiverId, tier: PRACTICE_TIER,
          metadata: { title: "KEYHOLE practice key", description: "Testnet practice key. Not real money.", copies: 1 },
        },
        deposit: MINT_DEPOSIT_YOCTO, gas: MINT_GAS, waitUntil: "FINAL",
      });
      const hash = hashOf(out);
      noteSpend("nft_mint", hash);
      noted = true;
      if (!hash) throw new Error("nft_mint returned no hash");
      return hash;
    } catch (e) {
      if (!noted) noteSpend("nft_mint", null, e);
      throw e;
    }
  });
}

export async function sendCreateAccount(accountId: string, publicKey: string, env: Record<string, string | undefined> = process.env): Promise<string> {
  return enqueue(() => signCreate(accountId, publicKey, env));
}

export async function sendMint(receiverId: string, tokenId: string, env: Record<string, string | undefined> = process.env): Promise<string> {
  return enqueue(() => signMint(receiverId, tokenId, env, fetch));
}

function fail(e: unknown, secret: string, fallback: string): TrialFail {
  return { ok: false, status: 503, error: "unavailable", message: scrubSecret(e instanceof Error ? e.message : fallback, secret) || fallback };
}

type GuestGate = "ready" | "missing" | "bad_key" | "holds" | "unknown";

/** The guest the server created: it exists, has exactly one full-access key, and holds no practice key. */
async function guestGate(accountId: string, fetchImpl: typeof fetch): Promise<GuestGate> {
  try {
    return await withRpc(async (url) => {
      try {
        await rpc(url, "query", { request_type: "view_account", finality: "final", account_id: accountId }, fetchImpl);
      } catch (e) {
        if ((e as Error).message === "UNKNOWN_ACCOUNT") return "missing" as const;
        throw e;
      }
      const keys = await rpc<KeyList>(url, "query", { request_type: "view_access_key_list", finality: "final", account_id: accountId }, fetchImpl);
      const list = keys.keys ?? [];
      if (list.length !== 1 || !isFullAccess(list[0].access_key?.permission)) return "bad_key" as const;
      const owned = await viewCall<unknown>(url, TRIAL_CONTRACT, "nft_tokens_for_owner", { account_id: accountId, from_index: "0", limit: 2 }, fetchImpl);
      if (!Array.isArray(owned)) return "unknown" as const;
      if (owned.length > 0) return "holds" as const;
      return "ready" as const;
    }, fetchImpl);
  } catch {
    return "unknown";
  }
}

export async function createGuest(publicKey: string, idempotencyKey: string, ip: string | null, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<TrialResult> {
  if (!isEd25519PublicKey(publicKey)) return { ok: false, status: 400, error: "bad_request", message: "Send the guest's ed25519 public key. The secret stays in the browser." };
  const accountId = accountIdForIdempotency(idempotencyKey);
  if (!accountId) return { ok: false, status: 400, error: "bad_request", message: "Send the same idempotency key again to retry this guest. A new key would fund another account." };
  if (!ip) return { ok: false, status: 503, error: "unavailable", message: "The client address is not attested by the platform." };
  const sponsor = readSponsor(env);
  if (!sponsor) return { ok: false, status: 503, error: "unavailable", message: "The testnet sponsor is not configured on this server." };
  return enqueue(async () => {
    const minter = await assertMinter(sponsor, fetchImpl);
    if (minter) return minter;
    const existing = await accountHasKey(accountId, publicKey, fetchImpl);
    if (existing === "match") return { ok: true, accountId, txHash: "", replayed: true };
    if (existing === "other") return { ok: false, status: 409, error: "bad_request", message: "That trial key already belongs to a different guest." };
    if (existing === "unknown") return REFUSE;
    const gate = await reserve(sponsor, ip, "create", fetchImpl, env);
    if (gate) return gate;
    try {
      const txHash = await signCreate(accountId, publicKey, env);
      return { ok: true, txHash, accountId };
    } catch (e) {
      const again = await accountHasKey(accountId, publicKey, fetchImpl);
      if (again === "match") return { ok: true, accountId, txHash: "", replayed: true };
      return fail(e, sponsor.secret, "The testnet account was not created.");
    }
  });
}

export async function mintPracticeKey(idempotencyKey: string, ip: string | null, hintedReceiver: string | null, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<TrialResult> {
  const receiverId = accountIdForIdempotency(idempotencyKey);
  const tokenId = tokenIdForIdempotency(idempotencyKey);
  if (!receiverId || !tokenId) return { ok: false, status: 400, error: "bad_request", message: "Send the guest idempotency key from the account this server created." };
  if (hintedReceiver && hintedReceiver !== receiverId) return { ok: false, status: 400, error: "bad_request", message: "A practice key is minted only to the guest this server created." };
  if (!ip) return { ok: false, status: 503, error: "unavailable", message: "The client address is not attested by the platform." };
  const sponsor = readSponsor(env);
  if (!sponsor) return { ok: false, status: 503, error: "unavailable", message: "The testnet sponsor is not configured on this server." };
  return enqueue(async () => {
    const minter = await assertMinter(sponsor, fetchImpl);
    if (minter) return minter;
    let existing: { owner_id?: string } | null = null;
    try {
      existing = await withRpc((url) => viewCall<{ owner_id?: string } | null>(url, TRIAL_CONTRACT, "nft_token", { token_id: tokenId }, fetchImpl), fetchImpl);
    } catch { return REFUSE; }
    if (existing && typeof existing === "object") {
      const owner = typeof existing.owner_id === "string" ? existing.owner_id : receiverId;
      return { ok: true, tokenId, tier: PRACTICE_TIER, accountId: owner, txHash: "", replayed: true };
    }
    const guest = await guestGate(receiverId, fetchImpl);
    if (guest === "missing") return { ok: false, status: 400, error: "bad_request", message: "Create the guest before minting a practice key." };
    if (guest === "bad_key") return { ok: false, status: 400, error: "bad_request", message: "The guest account must have exactly one full-access key." };
    if (guest === "holds") return { ok: false, status: 409, error: "bad_request", message: "That guest already holds a practice key." };
    if (guest === "unknown") return REFUSE;
    const gate = await reserve(sponsor, ip, "mint", fetchImpl, env);
    if (gate) return gate;
    try {
      const txHash = await signMint(receiverId, tokenId, env, fetchImpl);
      return { ok: true, txHash, tokenId, tier: PRACTICE_TIER, accountId: receiverId };
    } catch (e) {
      return fail(e, sponsor.secret, "The practice key was not minted.");
    }
  });
}
