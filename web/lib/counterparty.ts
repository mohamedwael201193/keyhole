// Counterparty check (KEYHOLE AI Security track). Scoring is pure; signal reads are read-only HTTP calls with timeouts.
// This exact file is also web/lib/counterparty.ts. cli/test/identity.test.ts fails if the two differ, so edit both by copying.
// No imports on purpose: it runs unchanged in Node 18+ and in the Next.js server runtime.
// Every failed read becomes an unknown signal, and an unknown signal is a WARN, never an ALLOW.

export type Verdict = "allow" | "warn" | "block";
export interface BlocklistEntry { account: string; reason: string; evidence_tx: string | null; added: string; demo?: boolean }

export const NO_CODE_HASH = "11111111111111111111111111111111";
export const DAY_MS = 86_400_000;
export const SIGNAL_TIMEOUT_MS = 5_000;
/** Receivers whose code is trusted: code-change rules are skipped for them. 1Click deposit addresses are per quote and cannot be listed. */
export const ALLOWLIST: readonly string[] = [
  "keyhole-devmo.near",
  "v1.signer",
  "wrap.near",
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
];
/** Current-state RPC first, then a second public node. */
export const RPC_NEAR: readonly string[] = ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"];
/** Historical reads (code 1 day and 7 days back). rpc.mainnet.near.org keeps about 120k blocks (under a day). */
export const RPC_ARCHIVAL: readonly string[] = ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"];
export const NEARBLOCKS = "https://api.nearblocks.io";

export interface Signals {
  receiver: string;
  agent: string | null;
  foreign: boolean;
  invalid: boolean;
  listed: BlocklistEntry | null;
  allowlisted: boolean;
  exists: boolean | null;
  is_contract: boolean | null;
  code_hash_now: string | null;
  code_changed_24h: boolean | null;
  code_changed_7d: boolean | null;
  account_age_days: number | null;
  /** Transactions in the last 30 days, counted from the newest 25. 25 means "25 or more". */
  txns_30d: number | null;
  /** Transactions between agent and receiver in the agent's newest 100. */
  prior_interactions: number | null;
  block_height: number | null;
  /** Names of signals that could not be read. Each one is a WARN. */
  unavailable: string[];
}
export interface Score { verdict: Verdict; reasons: string[] }
export interface CounterpartyResult extends Score {
  signals: Signals;
  sources: Record<string, string>;
  checked_at: string;
}
export interface CheckOptions {
  blocklist: readonly BlocklistEntry[];
  agent?: string | null;
  /** The receiver is on another chain (for example a withdraw to base). NEAR signals do not apply. */
  foreign?: boolean;
  now?: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
  nearblocksKey?: string;
}

export const isNearAccountId = (s: string): boolean =>
  s.length >= 2 && s.length <= 64 &&
  (/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s) || /^[0-9a-f]{64}$/.test(s) || /^0x[0-9a-f]{40}$/.test(s));

/** Pure rule set. BLOCK wins over WARN; WARN wins over ALLOW. Reason strings are stable codes for logs. */
export function score(s: Signals): Score {
  const block: string[] = [];
  const warn: string[] = [];
  if (s.listed) block.push(`blocklist: ${s.listed.reason}${s.listed.evidence_tx ? ` (evidence_tx ${s.listed.evidence_tx})` : ""}`);
  if (s.invalid) block.push("invalid_account_id");
  if (s.exists === false) block.push("receiver_missing");
  if (s.is_contract && !s.allowlisted && s.code_changed_24h === true) block.push("code_changed_within_24h");
  if (s.foreign) warn.push("foreign_destination: NEAR signals do not apply to this chain");
  if (s.account_age_days !== null && s.account_age_days < 7) warn.push(`account_age_days=${Math.floor(s.account_age_days)}<7`);
  if (s.agent && s.prior_interactions === 0) warn.push("no_prior_interactions");
  if (s.is_contract && !s.allowlisted && s.code_changed_7d === true) warn.push("code_changed_within_7d");
  if (s.txns_30d !== null && s.txns_30d < 5) warn.push(`low_activity: ${s.txns_30d} txns in 30d<5`);
  for (const n of s.unavailable) warn.push(`signal unavailable: ${n}`);
  const verdict: Verdict = block.length ? "block" : warn.length ? "warn" : "allow";
  return { verdict, reasons: [...block, ...warn] };
}

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" ? (x as Json) : {});
const list = (x: unknown): Json[] => (Array.isArray(x) ? x.map(obj) : []);
const str = (x: unknown): string | null => (typeof x === "string" ? x : typeof x === "number" ? String(x) : null);

type Fetch = typeof fetch;

/**
 * Runs one read (request + body) with a hard deadline. The abort signal stops a real fetch; the race also ends a
 * read whose fetch ignores the signal. The timer is a normal (ref'd) timer, so the deadline fires even when nothing
 * else keeps the event loop alive.
 */
async function timed<T>(timeoutMs: number, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { ac.abort(); reject(new Error("timeout")); }, timeoutMs);
  });
  try {
    return await Promise.race([read(ac.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(f: Fetch, urls: readonly string[], method: string, params: Json, timeoutMs: number): Promise<{ ok: true; result: Json } | { ok: false; code: string }> {
  let code = "unreachable";
  for (const url of urls) {
    try {
      const res = await timed(timeoutMs, async (signal) => {
        const r = await f(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "keyhole", method, params }),
          signal,
        });
        return r.ok ? { ok: true as const, body: await r.json() } : { ok: false as const, status: r.status };
      });
      if (!res.ok) { code = `http_${res.status}`; continue; }
      const j = obj(res.body);
      if (j.error) {
        const s = JSON.stringify(j.error);
        if (/UNKNOWN_ACCOUNT/.test(s)) return { ok: false, code: "UNKNOWN_ACCOUNT" };
        code = (/GARBAGE_COLLECTED_BLOCK|UNKNOWN_BLOCK/.exec(s) ?? ["error"])[0];
        continue;
      }
      return { ok: true, result: obj(j.result) };
    } catch {
      code = "timeout_or_network";
    }
  }
  return { ok: false, code };
}

async function nearblocks(f: Fetch, path: string, key: string | undefined, timeoutMs: number): Promise<unknown> {
  try {
    return await timed(timeoutMs, async (signal) => {
      const r = await f(NEARBLOCKS + path, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal });
      return r.ok ? await r.json() : null;
    });
  } catch {
    return null;
  }
}

/** Read-only check of one receiver. Never throws; a failed read is recorded as unavailable (WARN). */
export async function checkCounterparty(receiver: string, opt: CheckOptions): Promise<CounterpartyResult> {
  const now = opt.now ?? Date.now();
  const f: Fetch = opt.fetch ?? fetch;
  const t = opt.timeoutMs ?? SIGNAL_TIMEOUT_MS;
  const id = receiver.trim().toLowerCase();
  const agent = opt.agent && isNearAccountId(opt.agent) ? opt.agent : null;
  const s: Signals = {
    receiver: id, agent, foreign: !!opt.foreign, invalid: false, listed: null, allowlisted: ALLOWLIST.includes(id),
    exists: null, is_contract: null, code_hash_now: null, code_changed_24h: null, code_changed_7d: null,
    account_age_days: null, txns_30d: null, prior_interactions: null, block_height: null, unavailable: [],
  };
  const sources: Record<string, string> = {};
  const done = (): CounterpartyResult => ({ ...score(s), signals: s, sources, checked_at: new Date(now).toISOString() });

  s.listed = opt.blocklist.find((e) => e.account.toLowerCase() === id) ?? null;
  if (s.listed) { sources.blocklist = "security/blocklist.json"; return done(); }
  if (s.foreign) return done();
  if (!isNearAccountId(id)) { s.invalid = true; return done(); }

  // 1. Does the account exist, and is it a contract? (current state)
  const view = await rpc(f, RPC_NEAR, "query", { request_type: "view_account", finality: "final", account_id: id }, t);
  sources.exists = "NEAR RPC view_account, final";
  if (view.ok) {
    s.exists = true;
    s.code_hash_now = str(view.result.code_hash);
    s.is_contract = s.code_hash_now !== null && s.code_hash_now !== NO_CODE_HASH;
  } else if (view.code === "UNKNOWN_ACCOUNT") {
    s.exists = false;
    s.is_contract = false;
  } else {
    s.unavailable.push("exists");
  }
  if (s.exists === false) return done();

  // 2. Parallel reads: code history (contracts only), account age, activity, prior interactions.
  const needCode = s.is_contract === true && !s.allowlisted;
  const [codeRes, ageRes, txRes, priorRes] = await Promise.all([
    needCode ? codeWindows(f, id, s.code_hash_now, t) : Promise.resolve(null),
    nearblocks(f, `/v1/account/${id}`, opt.nearblocksKey, t),
    nearblocks(f, `/v1/account/${id}/txns?per_page=25`, opt.nearblocksKey, t),
    agent ? nearblocks(f, `/v1/account/${agent}/txns?per_page=100`, opt.nearblocksKey, t) : Promise.resolve(undefined),
  ]);
  if (needCode) {
    sources.code = "NEAR RPC block height from block times, view_account at that block (archival)";
    s.block_height = codeRes?.height ?? null;
    if (codeRes && codeRes.ok) { s.code_changed_24h = codeRes.changed24; s.code_changed_7d = codeRes.changed7; }
    else s.unavailable.push("code_history");
  }

  sources.account_age = "Nearblocks /v1/account/{id} created.block_timestamp";
  const createdNs = str(obj(list(obj(ageRes).account)[0]?.created).block_timestamp);
  if (createdNs && Number(createdNs) > 0) s.account_age_days = Math.max(0, (now - Number(createdNs) / 1e6) / DAY_MS);
  else s.unavailable.push("account_age");

  sources.activity = "Nearblocks /v1/account/{id}/txns (newest 25)";
  const txs = list(obj(txRes).txns);
  if (txRes !== null) s.txns_30d = txs.filter((x) => Number(str(x.block_timestamp) ?? 0) / 1e6 >= now - 30 * DAY_MS).length;
  else s.unavailable.push("activity");

  if (agent) {
    sources.prior_interactions = "Nearblocks /v1/account/{agent}/txns (newest 100), filtered to the receiver";
    if (priorRes === undefined || priorRes === null) s.unavailable.push("prior_interactions");
    else {
      s.prior_interactions = list(obj(priorRes).txns).filter((x) =>
        (x.predecessor_account_id === agent && x.receiver_account_id === id) || (x.predecessor_account_id === id && x.receiver_account_id === agent)).length;
    }
  }
  return done();
}

/** Code hash now versus 1 and 7 days ago. Block times give the height; the archival node answers the old state. */
async function codeWindows(f: Fetch, id: string, hashNow: string | null, t: number) {
  const latest = await rpc(f, RPC_NEAR, "block", { finality: "final" }, t);
  if (!latest.ok) return null;
  const header = obj(latest.result.header);
  const h = Number(header.height);
  const tsNs = Number(header.timestamp);
  const older = await rpc(f, RPC_NEAR, "block", { block_id: h - 1000 }, t);
  if (!older.ok) return null;
  const msPerBlock = (tsNs - Number(obj(older.result.header).timestamp)) / 1e6 / 1000;
  if (!(msPerBlock > 0) || !Number.isFinite(h)) return null;
  const hashAgo = async (days: number): Promise<{ ok: true; hash: string | null } | { ok: false }> => {
    const at = h - Math.round((days * DAY_MS) / msPerBlock);
    const r = await rpc(f, RPC_ARCHIVAL, "query", { request_type: "view_account", block_id: at, account_id: id }, t);
    if (r.ok) return { ok: true, hash: str(r.result.code_hash) };
    if (r.code === "UNKNOWN_ACCOUNT") return { ok: true, hash: null };
    return { ok: false };
  };
  const [a, b] = await Promise.all([hashAgo(1), hashAgo(7)]);
  if (!a.ok || !b.ok) return null;
  // An account absent at that height was created since: its code is new.
  const changed = (old: string | null) => (old === null ? true : old !== hashNow);
  return { ok: true as const, height: h, changed24: changed(a.hash), changed7: changed(b.hash) };
}
