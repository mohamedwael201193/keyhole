import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { keyFromString, guardedRun, guardTarget, operatorGate, loadBlocklist, run, GuardError, type GuardDeps, type Terminal } from "../src/core.ts";
import { copyTrade } from "../src/mcp.ts";
import type { CounterpartyResult, Verdict } from "../src/counterparty.ts";

const key = keyFromString("alice.near", "ed25519:" + bs58.encode(new Uint8Array(32).fill(1)));

const result = (verdict: Verdict, reasons: string[] = []): CounterpartyResult =>
  ({ verdict, reasons, signals: {} as CounterpartyResult["signals"], sources: {}, checked_at: "2026-11-07T00:00:00.000Z" });

/** Records every call so a test can prove that nothing was signed. */
function spyDeps(verdict: Verdict, reasons: string[] = [], gateAnswer: boolean | "throw" = true) {
  const calls = { check: 0, gate: 0, execute: [] as string[], audit: [] as Record<string, unknown>[] };
  const deps: GuardDeps = {
    check: async () => { calls.check++; return result(verdict, reasons); },
    gate: async () => { calls.gate++; if (gateAnswer === "throw") throw new Error("gate must not run"); return gateAnswer; },
    execute: async (op) => { calls.execute.push(op); return { output: { ok: true } }; },
    audit: (l) => { calls.audit.push(l); },
  };
  return { deps, calls };
}

test("block: nothing is signed and the operator is not asked", async () => {
  const { deps, calls } = spyDeps("block", ["blocklist: test"], "throw");
  await assert.rejects(guardedRun(key, "withdraw", { chain: "near", to: "bad.near", amount: "1" }, {}, deps), (e: unknown) => e instanceof GuardError && e.code === "blocked");
  assert.deepEqual(calls.execute, []);
  assert.equal(calls.gate, 0);
  assert.equal(calls.audit.at(-1)?.decision, "refused_block");
  assert.equal(calls.audit.at(-1)?.signed, false);
});

test("warn: runs only after the operator confirms", async () => {
  const yes = spyDeps("warn", ["account_age_days=2<7"], true);
  await guardedRun(key, "withdraw", { chain: "near", to: "new.near" }, {}, yes.deps);
  assert.equal(yes.calls.gate, 1);
  assert.deepEqual(yes.calls.execute, ["withdraw"]);

  const no = spyDeps("warn", ["account_age_days=2<7"], false);
  await assert.rejects(guardedRun(key, "withdraw", { chain: "near", to: "new.near" }, {}, no.deps), (e: unknown) => e instanceof GuardError && e.code === "not_confirmed");
  assert.deepEqual(no.calls.execute, []);
  assert.equal(no.calls.audit.at(-1)?.decision, "refused_no_operator_confirmation");
});

test("allow: runs without asking", async () => {
  const { deps, calls } = spyDeps("allow");
  await guardedRun(key, "withdraw", { chain: "near", to: "fine.near" }, {}, deps);
  assert.equal(calls.gate, 0);
  assert.deepEqual(calls.execute, ["withdraw"]);
  assert.equal(calls.audit.at(-1)?.signed, true);
});

test("alwaysConfirm asks even on allow", async () => {
  const { deps, calls } = spyDeps("allow", [], true);
  await guardedRun(key, "copy", { amount_in: "1" }, { alwaysConfirm: true, receiver: key.accountId }, deps);
  assert.equal(calls.gate, 1);
});

test("guardTarget names the receiver of each guarded op", () => {
  assert.deepEqual(guardTarget("withdraw", { chain: "near", to: "bob.near" }, "alice.near"), { receiver: "bob.near", foreign: false });
  assert.deepEqual(guardTarget("withdraw", { chain: "base", to: "0xabc" }, "alice.near"), { receiver: "0xabc", foreign: true });
  assert.deepEqual(guardTarget("withdraw", { to: "x.near" }, "alice.near")?.foreign, true, "no chain given is treated as foreign");
  assert.deepEqual(guardTarget("quote", { execute: true }, "alice.near"), { receiver: "alice.near", foreign: false });
  assert.deepEqual(guardTarget("quote", { execute: true, recipient: "bob.near" }, "alice.near"), { receiver: "bob.near", foreign: false });
  assert.equal(guardTarget("quote", { execute: false }, "alice.near"), null, "a quote without execute moves nothing");
  assert.deepEqual(guardTarget("chain_sign", { receiver: "0xdef", chain: "base" }, "alice.near"), { receiver: "0xdef", foreign: true });
  assert.deepEqual(guardTarget("copy", {}, "alice.near"), { receiver: "alice.near", foreign: false });
  assert.equal(guardTarget("swap", {}, "alice.near"), null);
});

test("the shipped blocklist loads and every entry has the required fields", () => {
  const list = loadBlocklist();
  assert.ok(list.length >= 1);
  for (const e of list) {
    assert.equal(typeof e.account, "string");
    assert.equal(typeof e.reason, "string");
    assert.ok("evidence_tx" in e);
    assert.equal(typeof e.added, "string");
  }
  assert.ok(list.some((e) => e.account === "keyhole-demo-blocked.near" && e.demo === true), "the labelled demo entry is present");
});

// ---- operator gate: the code lives on the operator's terminal only ------------------------------------------------

function fakeTerminal(answer: (prompt: string) => string | null) {
  const writes: string[] = [];
  let closed = false;
  const term: Terminal = {
    write: (s) => { writes.push(s); },
    readLine: async () => answer(writes.join("")),
    close: () => { closed = true; },
  };
  return { term, writes, get closed() { return closed; } };
}
const codeIn = (prompt: string) => /Type ([0-9a-f]{6}) /.exec(prompt)?.[1] ?? "";
const req = { op: "withdraw", receiver: "new.near", verdict: "warn" as Verdict, reasons: ["account_age_days=2<7"], summary: "params: {}" };

test("operator gate: no terminal means refuse (fail closed)", async () => {
  assert.equal(await operatorGate(req, () => null), false);
});

test("operator gate: the typed code allows, anything else refuses, and the code is only written to the terminal", async () => {
  const ok = fakeTerminal((p) => codeIn(p));
  assert.equal(await operatorGate(req, () => ok.term), true);
  assert.equal(ok.closed, true);
  assert.match(ok.writes.join(""), /account_age_days=2<7/);

  const wrong = fakeTerminal(() => "000000");
  assert.equal(await operatorGate(req, () => wrong.term), false);

  const silent = fakeTerminal(() => null);
  assert.equal(await operatorGate(req, () => silent.term), false, "timeout or closed terminal refuses");
});

// ---- MCP copy: the code never reaches the tool result ----------------------------------------------------------------

let gateway: Server;
let gatewayUrl = "";
const seen: string[] = [];
before(async () => {
  gateway = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const op = (JSON.parse(body) as { op: string }).op;
      seen.push(op);
      const output = op === "quote"
        ? { ok: true, usd_micro: 10000, quote: { amountOutFormatted: "0.001" } }
        : { ok: true, intent: "copied" };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ output }));
    });
  });
  await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", () => r()));
  const port = (gateway.address() as { port: number }).port;
  gatewayUrl = `http://127.0.0.1:${port}/api`;
  process.env.KEYHOLE_GATEWAY = gatewayUrl;
});
after(() => { delete process.env.KEYHOLE_GATEWAY; gateway.close(); });

const copyArgs = { amount: "10000", token_in: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", token_out: "nep141:wrap.near" };
const liveish = (verdict: Verdict, gate: GuardDeps["gate"]): GuardDeps => ({
  check: async () => result(verdict, verdict === "allow" ? [] : ["account_age_days=1<7"]),
  gate,
  execute: (op, params) => run(key, op, params),
  audit: () => {},
});

test("copy with no operator terminal is refused and nothing is copied", async () => {
  seen.length = 0;
  const text = await copyTrade(key, copyArgs, liveish("allow", (r) => operatorGate(r, () => null)));
  assert.match(text, /^not executed \(not_confirmed\)/);
  assert.ok(!seen.includes("copy"), "the copy op was never sent");
});

test("copy: the operator types the code on their terminal; the result never contains it", async () => {
  seen.length = 0;
  const t = fakeTerminal((p) => codeIn(p));
  const text = await copyTrade(key, copyArgs, liveish("allow", (r) => operatorGate(r, () => t.term)));
  const code = codeIn(t.writes.join(""));
  assert.match(code, /^[0-9a-f]{6}$/, "the terminal showed a code");
  assert.ok(!text.includes(code), "the tool result does not contain the code");
  assert.match(text, /"intent": "copied"/);
  assert.deepEqual(seen.filter((o) => o === "copy"), ["copy"]);
});

test("copy: a wrong typed code copies nothing and the result has no code", async () => {
  seen.length = 0;
  const t = fakeTerminal(() => "ffffff");
  const text = await copyTrade(key, copyArgs, liveish("allow", (r) => operatorGate(r, () => t.term)));
  assert.match(text, /^not executed/);
  assert.ok(!seen.includes("copy"));
  assert.ok(!text.includes(codeIn(t.writes.join(""))));
});

test("copy: a blocked receiver is refused before the operator is asked", async () => {
  seen.length = 0;
  let asked = false;
  const text = await copyTrade(key, copyArgs, liveish("block", async () => { asked = true; return true; }));
  assert.equal(asked, false);
  assert.match(text, /^not executed \(blocked\)/);
  assert.ok(!seen.includes("copy"));
});

test("copy without an amount asks for one and makes no call", async () => {
  seen.length = 0;
  assert.equal(await copyTrade(key, { token_in: "a", token_out: "b" }), "amount is required");
  assert.deepEqual(seen, []);
});

test("the MCP source no longer returns or stores a confirmation code", () => {
  const src = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /confirm_code|makeConfirm|takeConfirm/);
});
