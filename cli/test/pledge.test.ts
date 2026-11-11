import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pledgeStatus, renderPledgeStatus, LIEN_REFUSALS, DEFAULT_PATH, type View, type Loan, type Control } from "../src/pledge.ts";

const TOKEN = "k5f4750858f328940";
const LENDER = "lender.near";
const loan = (state: string): Loan => ({
  token_id: TOKEN, nonce: "1", borrower: "borrower.near", owner_epoch: "3",
  terms: { lender: LENDER, principal: "10000000000000000000000", repayment: "10100000000000000000000", duration_sec: "7200", grace_sec: "900", floor_raw: "500000", funding_deadline_ns: "1" },
  state, due_ns: "1000000000000000", resolution: null,
});
const control = (over: Partial<Control> = {}): Control => ({ token_id: TOKEN, owner_epoch: "3", pending_value_ops: "0", listed: false, transfer_pending: false, pledged: false, value_op_nonce: "0", ...over });
/** A fake contract: the view answers exactly the methods pledgeStatus calls, and records them. */
function fakeView(answers: { loan: Loan | null; control: Control; config: unknown }, calls: string[] = []): View {
  return async <T>(method: string, args: Record<string, unknown>) => {
    calls.push(method);
    if (method === "nft_token") return { owner_id: "owner.near" } as T;
    if (method === "get_control_state") { assert.equal(args.token_id, TOKEN); return answers.control as T; }
    if (method === "get_loan") return answers.loan as T;
    if (method === "get_pledge_config") return answers.config as T;
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
  assert.deepEqual(s.refused_while_locked.map((r) => r.action), ["transfer", "list", "sale", "withdraw", "swap", "copy", "withdraw_dry_run"]);
  assert.equal(s.default_path?.lender, LENDER);
  assert.equal(s.default_path?.due_ns, "1000000000000000");
  assert.equal(s.default_path?.grace_sec, "900");
});

test("an Offered loan locks the key but has no default path yet", async () => {
  const s = await pledgeStatus(TOKEN, fakeView({ loan: loan("Offered"), control: control({ pledged: true }), config }));
  assert.equal(s.locked, true);
  assert.equal(s.default_path, null);
});

test("lending off is reported honestly", async () => {
  const s = await pledgeStatus(TOKEN, fakeView({ loan: null, control: control(), config }));
  assert.equal(s.lending_enabled, false);
  assert.match(s.note, /Lending is off/);
});

test("a missing pledge config is reported, not guessed", async () => {
  const s = await pledgeStatus(TOKEN, fakeView({ loan: null, control: control(), config: null }));
  assert.equal(s.lending_enabled, null);
  assert.match(s.note, /not present/);
});

test("invalid key ids are refused before any view call", async () => {
  const calls: string[] = [];
  for (const bad of ["", "../x", "K5f4750858f328940", "k5f47 50", "keyhole"]) {
    await assert.rejects(pledgeStatus(bad, fakeView({ loan: null, control: control(), config }, calls)), /bad key id/);
  }
  assert.deepEqual(calls, []);
});

test("only read-only views are called", async () => {
  const calls: string[] = [];
  await pledgeStatus(TOKEN, fakeView({ loan: loan("Active"), control: control({ pledged: true }), config }, calls));
  assert.deepEqual([...calls].sort(), ["get_control_state", "get_loan", "get_pledge_config", "nft_token"]);
});

test("the rendered text names the refusals and the default path", async () => {
  const s = await pledgeStatus(TOKEN, fakeView({ loan: loan("Active"), control: control({ pledged: true }), config }));
  const text = renderPledgeStatus(s);
  assert.match(text, /LOCKED/);
  assert.match(text, /withdraw: pledged \(enclave\)/);
  assert.match(text, /transfer: pledged: ownership and value operations locked \(contract\)/);
  assert.match(text, /default: the lender/);
});

test("every refusal string the table names is present in the source it cites", () => {
  const contract = readFileSync(new URL("../../contracts/keys/src/pledge.rs", import.meta.url), "utf8");
  const enclave = readFileSync(new URL("../../tee/worker/src/guarded.rs", import.meta.url), "utf8");
  const host = readFileSync(new URL("../../tee/worker/src/guarded_host.rs", import.meta.url), "utf8");
  for (const r of LIEN_REFUSALS) {
    if (r.refused_by === "contract") assert.ok(contract.includes(r.code), `${r.code} missing from pledge.rs`);
    else assert.ok((enclave + host).includes(`"${r.code}"`), `${r.code} missing from the enclave`);
  }
  for (const r of DEFAULT_PATH.refusals) assert.ok(contract.includes(r.code), `${r.code} missing from pledge.rs`);
});

test("the MCP server exposes pledge_status and it is read-only in its name and code", async () => {
  const { buildServer } = await import("../src/mcp.ts");
  const server = buildServer() as unknown as { _registeredTools: Record<string, unknown> };
  const names = Object.keys(server._registeredTools);
  assert.ok(names.includes("pledge_status"));
  const src = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");
  const block = src.slice(src.indexOf('"pledge_status"'), src.indexOf('s.tool("copy"'));
  assert.doesNotMatch(block, /guardedRun|callWorker|signRequest|loadKey\(\)\s*,\s*"(withdraw|swap)/);
});
