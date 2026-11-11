import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { pledgeStatus, renderPledgeStatus, LIEN_REFUSALS, DEFAULT_PATH, type View, type Loan, type Control } from "../src/pledge.ts";
// The web copy of the table. lib/lien.ts has only type imports, so it loads without the web toolchain.
import { LIEN_REFUSALS as WEB_REFUSALS, DEFAULT_PATH_RULES as WEB_DEFAULT_RULES } from "../../web/lib/lien.ts";

const TOKEN = "k5f4750858f328940";
const LENDER = "lender.near";
const root = (rel: string) => new URL(`../../${rel}`, import.meta.url);
const src = (rel: string) => readFileSync(root(rel), "utf8");
const loan = (state: string): Loan => ({
  token_id: TOKEN, nonce: "1", borrower: "borrower.near", owner_epoch: "3",
  terms: { lender: LENDER, principal: "10000000000000000000000", repayment: "10100000000000000000000", duration_sec: "7200", grace_sec: "900", floor_raw: "500000", funding_deadline_ns: "1" },
  state, due_ns: "1000000000000000", resolution: null,
});
const control = (over: Partial<Control> = {}): Control => ({ token_id: TOKEN, owner_epoch: "3", pending_value_ops: "0", listed: false, transfer_pending: false, pledged: false, value_op_nonce: "0", ...over });
/** A fake contract: the view answers exactly the methods pledgeStatus calls, and records them. */
function fakeView(answers: { loan?: Loan | null; control?: Control | null; config?: unknown }, calls: string[] = []): View {
  return async <T>(method: string, args: Record<string, unknown>) => {
    calls.push(method);
    if (method === "nft_token") return { owner_id: "owner.near" } as T;
    if (method === "get_control_state") { assert.equal(args.token_id, TOKEN); return (answers.control === undefined ? control() : answers.control) as T; }
    if (method === "get_loan") return (answers.loan ?? null) as T;
    if (method === "get_pledge_config") return (answers.config === undefined ? config : answers.config) as T;
    throw new Error(`unexpected view ${method}`);
  };
}
const config = { network: "mainnet", lending_enabled: false, next_loan_nonce: "1" };

test("a key with no lien is not locked and has no default path", async () => {
  const s = await pledgeStatus(TOKEN, fakeView({ loan: null, control: control(), config }));
  assert.equal(s.locked, false);
  assert.deepEqual(s.refused_while_locked, []);
  assert.equal(s.default_path, null);
  assert.equal(s.owner, "owner.near");
});

test("an Active loan locks the key, lists every refused action, and shows the lender default path", async () => {
  const s = await pledgeStatus(TOKEN, fakeView({ loan: loan("Active"), control: control({ pledged: true }), config }));
  assert.equal(s.locked, true);
  assert.deepEqual(s.refused_while_locked.map((r) => r.action), ["transfer", "list", "buy", "sale", "withdraw", "swap", "copy", "withdraw_dry_run"]);
  assert.equal(s.default_path?.lender, LENDER);
  assert.equal(s.default_path?.due_ns, "1000000000000000");
  assert.equal(s.default_path?.grace_sec, "900");
});

test("an Offered loan locks the key but has no default path yet", async () => {
  const s = await pledgeStatus(TOKEN, fakeView({ loan: loan("Offered"), control: control({ pledged: true }), config }));
  assert.equal(s.locked, true);
  assert.equal(s.default_path, null);
});

test("a null control state is refused, not reported as unlocked", async () => {
  await assert.rejects(pledgeStatus(TOKEN, fakeView({ loan: null, control: null, config })), /control state not read/);
});

test("a loan record with no pledge flag is still locked and shows the refusals", async () => {
  const s = await pledgeStatus(TOKEN, fakeView({ loan: loan("Active"), control: control({ pledged: false }), config }));
  assert.equal(s.locked, true);
  assert.equal(s.refused_while_locked.length, 8);
});

test("lending off is reported honestly, with the network the contract names", async () => {
  const s = await pledgeStatus(TOKEN, fakeView({ loan: null, control: control(), config }));
  assert.equal(s.lending_enabled, false);
  assert.equal(s.note, "Lending is off on mainnet.");
  const t = await pledgeStatus(TOKEN, fakeView({ loan: null, control: control(), config: { network: "testnet", lending_enabled: false, next_loan_nonce: "1" } }));
  assert.equal(t.note, "Lending is off on testnet.");
});

test("a missing pledge config is reported, not guessed", async () => {
  const s = await pledgeStatus(TOKEN, fakeView({ loan: null, control: control(), config: null }));
  assert.equal(s.lending_enabled, null);
  assert.match(s.note, /not present/);
});

test("invalid key ids are refused before any view call", async () => {
  const calls: string[] = [];
  for (const bad of ["", "../x", "K5f4750858f328940", "k5f47 50", "keyhole", "k5f4750858f32894g"]) {
    await assert.rejects(pledgeStatus(bad, fakeView({ loan: null, control: control(), config }, calls)), /bad key id/);
  }
  assert.deepEqual(calls, []);
});

test("only read-only views are called", async () => {
  const calls: string[] = [];
  await pledgeStatus(TOKEN, fakeView({ loan: loan("Active"), control: control({ pledged: true }), config }, calls));
  assert.deepEqual([...calls].sort(), ["get_control_state", "get_loan", "get_pledge_config", "nft_token"]);
});

test("the rendered text names the refusals as source-read and the default path", async () => {
  const s = await pledgeStatus(TOKEN, fakeView({ loan: loan("Active"), control: control({ pledged: true }), config }));
  const text = renderPledgeStatus(s);
  assert.match(text, /LOCKED/);
  assert.match(text, /withdraw: pledged \(enclave\)/);
  assert.match(text, /transfer: pledged: ownership and value operations locked \(contract\)/);
  assert.match(text, /not a full audit/);
  assert.match(text, /default: the lender/);
});

test("the CLI and web refusal tables are identical", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(LIEN_REFUSALS)), JSON.parse(JSON.stringify(WEB_REFUSALS)));
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULT_PATH.refusals.map((r) => r.code))), WEB_DEFAULT_RULES.map((r) => r.code));
});

test("every refusal string the table names is present in the source it cites", () => {
  const contract = ["contracts/keys/src/pledge.rs", "contracts/keys/src/lib.rs", "contracts/keys/src/sale.rs"].map(src).join("\n");
  const enclave = ["tee/worker/src/guarded.rs", "tee/worker/src/guarded_host.rs"].map(src).join("\n");
  for (const r of LIEN_REFUSALS) {
    if (r.refused_by === "contract") assert.ok(contract.includes(r.code), `${r.code} missing from the contract source`);
    else assert.ok(enclave.includes(`"${r.code}"`) || enclave.includes(r.message), `${r.code} missing from the enclave source`);
  }
  for (const r of DEFAULT_PATH.refusals) assert.ok(contract.includes(r.code), `${r.code} missing from the contract source`);
});

test("cited line numbers point at the function each row names", () => {
  const lines = (rel: string) => src(rel).split("\n");
  const at = (rel: string, n: number) => { const l = lines(rel); return l[n - 1] ?? ""; };
  assert.match(at("tee/worker/src/guarded.rs", 35), /fn admit\(/);
  assert.match(at("contracts/keys/src/sale.rs", 49), /assert_can_change_owner/);
  assert.match(at("contracts/keys/src/lib.rs", 511), /assert_can_change_owner/);
  assert.match(at("contracts/keys/src/lib.rs", 738), /assert_can_change_owner/);
  assert.match(at("contracts/keys/src/lib.rs", 749), /assert_can_change_owner/);
  assert.match(at("contracts/keys/src/lib.rs", 467), /assert_token_idle/);
  assert.match(at("contracts/keys/src/pledge.rs", 423), /fn assert_token_idle/);
  assert.match(at("contracts/keys/src/pledge.rs", 581), /fn claim_default/);
  assert.match(at("tee/worker/src/main.rs", 557), /guard_preflight/);
  assert.match(at("tee/worker/src/main.rs", 508), /guard_preflight/);
  assert.match(at("tee/worker/src/guarded_host.rs", 24), /admit|guard_preflight|provision_idle/);
  for (const r of LIEN_REFUSALS) {
    for (const m of r.source.matchAll(/((?:contracts|tee)\/[\w/.-]+\.rs):(\d+)/g)) {
      assert.ok(existsSync(root(m[1])), `${m[1]} does not exist`);
    }
  }
});

test("the MCP server exposes pledge_status and it is read-only in its name and code", async () => {
  const { buildServer } = await import("../src/mcp.ts");
  const server = buildServer() as unknown as { _registeredTools: Record<string, unknown> };
  const names = Object.keys(server._registeredTools);
  assert.ok(names.includes("pledge_status"));
  const s = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");
  const block = s.slice(s.indexOf('"pledge_status"'), s.indexOf('s.tool("copy"'));
  assert.doesNotMatch(block, /guardedRun|callWorker|signRequest|loadKey\(\)\s*,\s*"(withdraw|swap)/);
});
