import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCounterparty, score, isNearAccountId, NO_CODE_HASH, DAY_MS, type BlocklistEntry, type Signals } from "../src/counterparty.ts";

const NOW = Date.parse("2026-11-07T00:00:00Z");
const BL: BlocklistEntry[] = [{ account: "bad-actor.near", reason: "test entry", evidence_tx: "7P9VFx4pz5oxyXpXkyDVE6SheDuTqHgQcEM2vgKFUAfK", added: "2026-11-07" }];
const base = (over: Partial<Signals> = {}): Signals => ({
  receiver: "alice.near", agent: "agent.near", foreign: false, invalid: false, listed: null, allowlisted: false, exists: true,
  is_contract: false, code_hash_now: NO_CODE_HASH, code_changed_24h: null, code_changed_7d: null, account_age_days: 400,
  txns_30d: 25, prior_interactions: 3, block_height: null, unavailable: [], ...over,
});

// ---- pure scoring ----------------------------------------------------------------------------------------------

test("a long-lived, active account with history is ALLOW", () => {
  assert.deepEqual(score(base()), { verdict: "allow", reasons: [] });
});

test("blocklist, missing account and invalid id are BLOCK", () => {
  const b = score(base({ listed: BL[0] }));
  assert.equal(b.verdict, "block");
  assert.match(b.reasons[0], /^blocklist: test entry \(evidence_tx 7P9V/);
  assert.equal(score(base({ exists: false, is_contract: false })).verdict, "block");
  assert.deepEqual(score(base({ invalid: true })).reasons, ["invalid_account_id"]);
});

test("contract code changed under 24 hours is BLOCK unless allowlisted", () => {
  const s = base({ is_contract: true, code_hash_now: "abc", code_changed_24h: true, code_changed_7d: true });
  assert.deepEqual(score(s).reasons.filter((r) => r.startsWith("code_changed")), ["code_changed_within_24h", "code_changed_within_7d"]);
  assert.equal(score(s).verdict, "block");
  assert.equal(score({ ...s, allowlisted: true }).verdict, "allow");
});

test("each WARN rule on its own", () => {
  assert.deepEqual(score(base({ account_age_days: 2.4 })), { verdict: "warn", reasons: ["account_age_days=2<7"] });
  assert.deepEqual(score(base({ prior_interactions: 0 })), { verdict: "warn", reasons: ["no_prior_interactions"] });
  assert.deepEqual(score(base({ agent: null, prior_interactions: null })).verdict, "allow", "no agent: the prior-interaction rule is not evaluated");
  assert.deepEqual(score(base({ is_contract: true, code_changed_7d: true })), { verdict: "warn", reasons: ["code_changed_within_7d"] });
  assert.deepEqual(score(base({ txns_30d: 4 })), { verdict: "warn", reasons: ["low_activity: 4 txns in 30d<5"] });
  assert.deepEqual(score(base({ txns_30d: 5 })).verdict, "allow");
});

test("an unknown signal is WARN, never ALLOW", () => {
  const s = score(base({ unavailable: ["account_age", "activity"] }));
  assert.equal(s.verdict, "warn");
  assert.deepEqual(s.reasons, ["signal unavailable: account_age", "signal unavailable: activity"]);
});

test("block beats warn, and every reason is kept", () => {
  const s = score(base({ listed: BL[0], account_age_days: 1, unavailable: ["activity"] }));
  assert.equal(s.verdict, "block");
  assert.equal(s.reasons.length, 3);
});

test("foreign destinations are WARN (NEAR signals do not apply)", () => {
  assert.deepEqual(score(base({ foreign: true })).reasons, ["foreign_destination: NEAR signals do not apply to this chain"]);
});

test("account id format", () => {
  for (const ok of ["alice.near", "keyhole-devmo.near", "a1.b2.c3", "0123456789abcdef".repeat(4), "0x" + "ab".repeat(20)]) assert.ok(isNearAccountId(ok), ok);
  for (const bad of ["", "a", "Alice.near", "-a.near", "a..near", "a".repeat(65), "0x" + "AB".repeat(20)]) assert.ok(!isNearAccountId(bad), bad);
});

// ---- signal adapters against a fake chain -----------------------------------------------------------------------

const H = 1_000_000;          // current block height
const MS_PER_BLOCK = 580;     // from block timestamps
const T_NS = NOW * 1e6;
type Hist = { d1: string | null | "GC"; d7: string | null | "GC" };
interface World {
  current?: string | "UNKNOWN" | "down";  // code_hash now, UNKNOWN_ACCOUNT, or the public RPC is down
  hist?: Hist;                            // archival code hashes 1 and 7 days ago (null = account absent, "GC" = pruned)
  archivalDown?: boolean;
  ageDays?: number | "none" | "down";
  txns?: { daysAgo: number; pred: string; recv: string }[] | "down";
  agentTxns?: { daysAgo: number; pred: string; recv: string }[] | "down";
  hang?: boolean;
}
function world(w: World, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const signal = init?.signal ?? undefined;
    if (w.hang) await new Promise((_, rej) => signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("archival")) {
      if (w.archivalDown) throw new Error("ECONNRESET");
      const body = JSON.parse(String(init?.body));
      const p = body.params;
      if (p.request_type === "view_account") {
        const daysAgo = ((H - p.block_id) * MS_PER_BLOCK) / DAY_MS;
        const v = w.hist ? (daysAgo < 2 ? w.hist.d1 : w.hist.d7) : "GC";
        if (v === "GC") return json({ jsonrpc: "2.0", id: 1, error: { cause: { name: "GARBAGE_COLLECTED_BLOCK" }, message: "gc" } });
        if (v === null) return json({ jsonrpc: "2.0", id: 1, error: { cause: { name: "UNKNOWN_ACCOUNT" }, message: "unknown" } });
        return json({ jsonrpc: "2.0", id: 1, result: { code_hash: v } });
      }
    }
    if (url.startsWith("https://rpc.mainnet.")) {
      const body = JSON.parse(String(init?.body));
      const p = body.params;
      if (w.current === "down") throw new Error("ECONNRESET");
      if (body.method === "block") {
        const h = p.finality === "final" ? H : p.block_id;
        return json({ jsonrpc: "2.0", id: 1, result: { header: { height: h, timestamp: String(T_NS - (H - h) * MS_PER_BLOCK * 1e6) } } });
      }
      if (body.method === "query" && p.request_type === "view_account") {
        if (w.current === "UNKNOWN") return json({ jsonrpc: "2.0", id: 1, error: { cause: { name: "UNKNOWN_ACCOUNT" }, message: "unknown" } });
        return json({ jsonrpc: "2.0", id: 1, result: { code_hash: w.current ?? NO_CODE_HASH } });
      }
    }
    if (url.startsWith("https://api.nearblocks.io/")) {
      if (url.includes("/txns")) {
        const agentCall = url.includes("per_page=100");
        const src = agentCall ? w.agentTxns : w.txns;
        if (src === "down" || src === undefined) throw new Error("429");
        return json({ txns: src.map((t, i) => ({ id: String(i), predecessor_account_id: t.pred, receiver_account_id: t.recv, block_timestamp: String((NOW - t.daysAgo * DAY_MS) * 1e6) })) });
      }
      if (w.ageDays === "down") throw new Error("ECONNRESET");
      if (w.ageDays === "none" || w.ageDays === undefined) return json({ account: [] });
      return json({ account: [{ created: { block_timestamp: String((NOW - w.ageDays * DAY_MS) * 1e6) } }] });
    }
    throw new Error("unexpected url " + url);
  }) as typeof fetch;
}
const recent = (n: number, pred = "x.near", recv = "y.near") => Array.from({ length: n }, (_, i) => ({ daysAgo: i, pred, recv }));
const opts = (w: World, extra: Partial<Parameters<typeof checkCounterparty>[1]> = {}) => ({ blocklist: BL, agent: "agent.near", now: NOW, fetch: world(w), timeoutMs: 2000, ...extra });

test("blocklisted receiver is refused without any network call", async () => {
  const calls: string[] = [];
  const r = await checkCounterparty("bad-actor.near", { ...opts({}), fetch: world({}, calls) });
  assert.equal(r.verdict, "block");
  assert.equal(calls.length, 0);
});

test("a missing account is BLOCK", async () => {
  const r = await checkCounterparty("ghost.near", opts({ current: "UNKNOWN" }));
  assert.equal(r.verdict, "block");
  assert.deepEqual(r.reasons, ["receiver_missing"]);
});

test("an established account with history and a prior agent relationship is ALLOW", async () => {
  const r = await checkCounterparty("alice.near", opts({ current: NO_CODE_HASH, ageDays: 400, txns: recent(25, "alice.near", "x.near"),
    agentTxns: [{ daysAgo: 1, pred: "agent.near", recv: "alice.near" }] }));
  assert.deepEqual([r.verdict, r.reasons], ["allow", []]);
  assert.equal(r.signals.prior_interactions, 1);
  assert.equal(r.signals.txns_30d, 25);
});

test("a contract whose code changed within 24 hours is BLOCK", async () => {
  const r = await checkCounterparty("token.near", opts({ current: "NEWHASH", hist: { d1: "OLDHASH", d7: "OLDHASH" }, ageDays: 400, txns: recent(25, "a.near", "token.near"),
    agentTxns: recent(1, "agent.near", "token.near") }));
  assert.equal(r.verdict, "block");
  assert.ok(r.reasons.includes("code_changed_within_24h"));
});

test("a contract with unchanged code over a week is ALLOW", async () => {
  const r = await checkCounterparty("app.near", opts({ current: "SAME", hist: { d1: "SAME", d7: "SAME" }, ageDays: 400, txns: recent(25, "a.near", "app.near"),
    agentTxns: recent(1, "agent.near", "app.near") }));
  assert.deepEqual([r.verdict, r.reasons], ["allow", []]);
});

test("a contract deployed since 7 days ago shows a 7-day change (WARN), not a 24-hour one", async () => {
  const r = await checkCounterparty("app.near", opts({ current: "NEW", hist: { d1: "NEW", d7: null }, ageDays: 400, txns: recent(25, "a.near", "app.near"),
    agentTxns: recent(1, "agent.near", "app.near") }));
  assert.equal(r.verdict, "warn");
  assert.deepEqual(r.reasons, ["code_changed_within_7d"]);
});

test("pruned history (GC) makes the code signal unknown: WARN, never ALLOW", async () => {
  const r = await checkCounterparty("app.near", opts({ current: "SAME", hist: { d1: "GC", d7: "GC" }, ageDays: 400, txns: recent(25, "a.near", "app.near"),
    agentTxns: recent(1, "agent.near", "app.near") }));
  assert.equal(r.verdict, "warn");
  assert.deepEqual(r.reasons, ["signal unavailable: code_history"]);
});

test("archival node down: WARN, never ALLOW", async () => {
  const r = await checkCounterparty("app.near", opts({ current: "SAME", archivalDown: true, ageDays: 400, txns: recent(25, "a.near", "app.near"),
    agentTxns: recent(1, "agent.near", "app.near") }));
  assert.equal(r.verdict, "warn");
  assert.ok(r.reasons.includes("signal unavailable: code_history"));
});

test("allowlisted contract skips the code reads entirely", async () => {
  const calls: string[] = [];
  const r = await checkCounterparty("keyhole-devmo.near", { ...opts({}), fetch: world({ current: "SAME", ageDays: 400, txns: recent(25, "a.near", "keyhole-devmo.near"), agentTxns: recent(1, "agent.near", "keyhole-devmo.near") }, calls) });
  assert.equal(r.verdict, "allow");
  assert.ok(!calls.some((u) => u.includes("archival")), "no archival call for an allowlisted contract");
});

test("Nearblocks down: age and activity are unknown, so WARN", async () => {
  const r = await checkCounterparty("alice.near", opts({ current: NO_CODE_HASH, ageDays: "down", txns: "down", agentTxns: "down" }));
  assert.equal(r.verdict, "warn");
  assert.deepEqual(r.reasons.sort(), ["signal unavailable: account_age", "signal unavailable: activity", "signal unavailable: prior_interactions"]);
});

test("account with no creation record and no txns is WARN (age unknown, activity 0)", async () => {
  const r = await checkCounterparty("alice.near", opts({ current: NO_CODE_HASH, ageDays: "none", txns: [], agentTxns: [] }));
  assert.equal(r.verdict, "warn");
  assert.ok(r.reasons.includes("signal unavailable: account_age"));
  assert.ok(r.reasons.includes("low_activity: 0 txns in 30d<5"));
  assert.ok(r.reasons.includes("no_prior_interactions"));
});

test("RPC down: existence unknown, so WARN and no contract assumptions", async () => {
  const r = await checkCounterparty("alice.near", opts({ current: "down", ageDays: 400, txns: recent(25, "a.near", "alice.near"), agentTxns: recent(1, "agent.near", "alice.near") }));
  assert.equal(r.verdict, "warn");
  assert.deepEqual(r.reasons, ["signal unavailable: exists"]);
});

test("a hanging endpoint hits the timeout and becomes WARN", async () => {
  const t0 = Date.now();
  const r = await checkCounterparty("alice.near", opts({ current: NO_CODE_HASH, hang: true }, { timeoutMs: 50 }));
  assert.equal(r.verdict, "warn");
  assert.ok(r.reasons.includes("signal unavailable: exists"));
  assert.ok(Date.now() - t0 < 2000, "returned after the timeout, not after the hang");
});

test("foreign destination: no network, WARN; blocklist still applies", async () => {
  const calls: string[] = [];
  const f = await checkCounterparty("0x" + "ab".repeat(20), { ...opts({}, { foreign: true }), fetch: world({}, calls) });
  assert.equal(f.verdict, "warn");
  assert.equal(calls.length, 0);
  const l = await checkCounterparty("BAD-ACTOR.near", { ...opts({}, { foreign: true }), fetch: world({}, calls) });
  assert.equal(l.verdict, "block");
});

test("an invalid receiver is BLOCK without a network call", async () => {
  const calls: string[] = [];
  const r = await checkCounterparty("Not A NEAR ID", { ...opts({}), fetch: world({}, calls) });
  assert.equal(r.verdict, "block");
  assert.equal(calls.length, 0);
});

test("the result carries the signals, sources and a check time", async () => {
  const r = await checkCounterparty("alice.near", opts({ current: NO_CODE_HASH, ageDays: 3, txns: recent(2, "a.near", "alice.near") }));
  assert.equal(r.checked_at, new Date(NOW).toISOString());
  assert.equal(r.signals.account_age_days, 3);
  assert.ok(r.sources.account_age?.includes("Nearblocks"));
});

test("web and CLI copies of the scoring module and blocklist are byte-identical", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const same = (a: string, b: string) => assert.equal(readFileSync(join(root, a), "utf8"), readFileSync(join(root, b), "utf8"), `${a} differs from ${b}`);
  same("cli/src/counterparty.ts", "web/lib/counterparty.ts");
  same("security/blocklist.json", "cli/src/blocklist.json");
  same("security/blocklist.json", "web/lib/blocklist.json");
});
