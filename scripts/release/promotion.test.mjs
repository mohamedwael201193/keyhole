import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACCOUNT,
  CANDIDATE,
  WORKER,
  b58,
  canonical,
  ROLLBACK,
  sha,
  validateBefore,
  validatePost,
  revalidatePost,
} from "./promotion-lib.mjs";
import {
  decodeDeployment,
  broadcastOnce,
  artifacts,
  workerPublication,
} from "./promote-v26.mjs";
import { promotedContract, promotedWorker } from "./identity-promotion.mjs";
import { clone, graph, signer } from "./fixtures.mjs";
const before = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/evidence/worker-provisioning/r3/before.json",
      import.meta.url,
    ),
  ),
);
function proof() {
  const after = clone(before);
  Object.assign(after.code, { sha256: CANDIDATE, bytes: 487260 });
  after.account.code_hash = b58(Buffer.from(CANDIDATE, "hex"));
  after.account.storage_usage += 1405;
  after.source.version = "2.6.0";
  after.block = {
    ...after.block,
    height: before.block.height + 5,
    hash: "fixture-after",
  };
  after.account.block_hash = after.block.hash;
  after.account.block_height = after.block.height;
  return {
    before: clone(before),
    after,
    deploy: graph(),
    deploy_hash: "fixture-deploy",
  };
}
test("exact public six-NFT snapshot passes and code-only upgrade preserves every raw row/view", () => {
  assert.equal(validateBefore(before), true);
  assert.equal(validatePost(proof()), true);
});
for (const field of [
  "state",
  "tokens",
  "controls",
  "credits",
  "config",
  "pledge",
  "metadata",
])
  test("post rejects changed " + field, () => {
    const e = proof();
    if (Array.isArray(e.after[field])) e.after[field].pop();
    else e.after[field].tamper = true;
    assert.throws(() => validatePost(e));
  });
for (const [name, mutate] of [
  ["missing receipt", (e) => (e.deploy.receipts_outcome = [])],
  [
    "orphan receipt",
    (e) =>
      e.deploy.receipts_outcome.push({
        ...clone(e.deploy.receipts_outcome[0]),
        id: "orphan",
      }),
  ],
  [
    "wrong code",
    (e) => (e.deploy.transaction.actions[0].DeployContract.code = "AA=="),
  ],
  [
    "migration action",
    (e) =>
      e.deploy.transaction.actions.push({
        FunctionCall: { method_name: "migrate_pledge" },
      }),
  ],
  ["wrong owner key", (e) => (e.deploy.transaction.signer_id = "wrong.near")],
  ["fake controls", (e) => (e.before.controls[0].token_id = "not-real")],
])
  test("post rejects " + name, () => {
    const e = proof();
    mutate(e);
    assert.throws(() => validatePost(e));
  });
const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  },
  str = (v) => Buffer.concat([u32(Buffer.byteLength(v)), Buffer.from(v)]);
function signedDeployment(code = artifacts().wasm, action = 1) {
  const k = signer(),
    nonce = Buffer.alloc(8);
  nonce.writeBigUInt64LE(1n);
  const raw = Buffer.concat([
      str(ACCOUNT),
      Buffer.from([0]),
      k.raw,
      nonce,
      str(ACCOUNT),
      Buffer.alloc(32, 1),
      u32(1),
      Buffer.from([action]),
      u32(code.length),
      code,
    ]),
    digest = Buffer.from(sha(raw), "hex");
  return {
    signed_transaction_as_base64: Buffer.concat([
      raw,
      Buffer.from([0]),
      k.sign(digest),
    ]).toString("base64"),
  };
}
test("saved fixture transaction accepts only exact reviewed single DeployContract", () => {
  assert.match(
    decodeDeployment(signedDeployment()).hash,
    /^[1-9A-HJ-NP-Za-km-z]+$/,
  );
  assert.throws(() => decodeDeployment(signedDeployment(Buffer.alloc(487260))));
  assert.throws(() => decodeDeployment(signedDeployment(undefined, 2)));
  const r = signedDeployment();
  r.signed_transaction_as_base64 = Buffer.concat([
    Buffer.from(r.signed_transaction_as_base64, "base64"),
    Buffer.from([0]),
  ]).toString("base64");
  assert.throws(() => decodeDeployment(r));
});
test("fsynced exclusive handoff survives UNKNOWN and refuses any second broadcast", async () => {
  const d = mkdtempSync(join(tmpdir(), "keyhole-deploy-test-"));
  try {
    let sends = 0;
    const tx = decodeDeployment(signedDeployment()),
      call = async () => {
        sends++;
        throw Error("lost response");
      };
    assert.equal(
      (await broadcastOnce(join(d, "journal"), tx, before, call)).state,
      "UNKNOWN",
    );
    await assert.rejects(broadcastOnce(join(d, "journal"), tx, before, call));
    assert.equal(sends, 1);
    const j = JSON.parse(readFileSync(join(d, "journal")));
    assert.equal(j.hash, tx.hash);
    assert.equal(j.state, "DISPATCH_CLAIMED_UNKNOWN");
    assert.ok(!JSON.stringify(j).includes(tx.signed));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
test("real evidence revalidation never trusts supplied capture alone", async () => {
  await assert.rejects(
    revalidatePost(proof(), async () => ({
      header: { height: before.block.height + 10, hash: "wrong" },
    })),
  );
});
test("generator transition preserves historical migration, six owners and immutable configuration", () => {
  const id = JSON.parse(
      readFileSync(new URL("../../identity.json", import.meta.url)),
    ),
    old = clone(id),
    e = proof(),
    predecessor = clone(id);
  predecessor.contract = {
    ...predecessor.contract,
    version: "2.5.0",
    wasm_sha256: ROLLBACK,
    code_hash: b58(Buffer.from(ROLLBACK, "hex")),
  };
  assert.throws(() => promotedContract(id, e, artifacts().wasm), /identity continuity mismatch/);
  const k = promotedContract(predecessor, e, artifacts().wasm);
  assert.equal(k.version, "2.6.0");
  assert.equal(k.migrate_pledge_tx, id.contract.migrate_pledge_tx);
  assert.deepEqual(id, old);
  assert.deepEqual(e.before.tokens, e.after.tokens);
  assert.deepEqual(e.before.pledge, e.after.pledge);
  assert.throws(() => promotedContract(predecessor, e, Buffer.alloc(487260)));
  const live = { ...id, contract: k },
    w = promotedWorker(
      live,
      {
        ctx: {
          snapshot: {
            code: { sha256: CANDIDATE },
            config: { minter: k.minter },
          },
        },
        publication_tx: "fixture-publish",
      },
      { info: { call_id: "fixture-info" } },
    );
  assert.equal(w.info_call, "fixture-info");
  // The production identity may already be v2.6 after a real release.
  // Keep this negative case explicitly on the pre-upgrade contract identity.
  assert.throws(() =>
    promotedWorker(
      { ...id, contract: { ...id.contract, version: "2.5.0", wasm_sha256: e.before.code.sha256 } },
      {
        ctx: {
          snapshot: {
            code: { sha256: CANDIDATE },
            config: { minter: k.minter },
          },
        },
      },
      { info: { call_id: "x" } },
    ),
  );
});
test("worker promotion fails closed without genuine full execution evidence", async () => {
  await assert.rejects(
    workerPublication({}, {}, async () => {
      throw Error("no chain evidence");
    }),
  );
});
test("execute refuses missing approvals before any dispatch; malformed mode cannot weaken validation", async () => {
  const { main } = await import("./promote-v26.mjs");
  await assert.rejects(main(["--execute"]));
  await assert.rejects(main(["--post"]));
  await assert.rejects(main(["--dry-run", "--execute"]));
  await assert.rejects(main(["--unknown"]));
});
test("gen-identity rejects invented promotion evidence without mutating any live identity/bytes", async () => {
  const { writeFileSync } = await import("node:fs"),
    { execFileSync } = await import("node:child_process");
  const d = mkdtempSync(join(tmpdir(), "keyhole-identity-test-")),
    root = new URL("../../", import.meta.url),
    path = join(d, "invalid.json");
  try {
    writeFileSync(path, "{}");
    const prior = readFileSync(new URL("identity.json", root)),
      code = readFileSync(
        new URL("contracts/keys/deployed/keyhole_keys.wasm", root),
      );
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [
          new URL("../gen-identity.mjs", import.meta.url).pathname,
          "--promote-v26",
          path,
        ],
        { stdio: "pipe" },
      ),
    );
    assert.deepEqual(readFileSync(new URL("identity.json", root)), prior);
    assert.deepEqual(
      readFileSync(new URL("contracts/keys/deployed/keyhole_keys.wasm", root)),
      code,
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
// This server is a valueless synthetic RPC fixture, never a mainnet deployment.
test("full generator code-only promotion works through real RPC boundary and retains historical migration", async () => {
  const { createServer } = await import("node:http"),
    { mkdirSync, copyFileSync, writeFileSync } = await import("node:fs"),
    { execFile } = await import("node:child_process"),
    { promisify } = await import("node:util");
  const run = promisify(execFile),
    d = mkdtempSync(join(tmpdir(), "keyhole-post-rpc-test-")),
    e = proof(),
    idPath = new URL("../../identity.json", import.meta.url),
    original = readFileSync(idPath),
    root = new URL("../../", import.meta.url);
  let server,rollback=false;
  try {
    for (const p of [
      "identity.json",
      "README.md",
      "scripts/gen-identity.mjs",
      "judge/1-contract.sh",
      "scripts/release/promotion-lib.mjs",
      "scripts/release/identity-promotion.mjs",
      "contracts/keys/deployed/keyhole_keys.wasm",
      "contracts/keys/deployed/SHA256SUMS",
      "contracts/keys/release/SHA256SUMS",
      "contracts/keys/release/v2.5/keyhole_keys.wasm",
      "contracts/keys/release/v2.6/keyhole_keys.wasm",
    ]) {
      mkdirSync(join(d, p, ".."), { recursive: true });
      copyFileSync(new URL(p, root), join(d, p));
    }
    writeFileSync(join(d, "post.json"), JSON.stringify(e));
    const seeded = JSON.parse(readFileSync(join(d, "identity.json"), "utf8"));
    seeded.contract.version = "2.5.0";
    seeded.contract.wasm_sha256 = ROLLBACK;
    seeded.contract.code_hash = b58(Buffer.from(ROLLBACK, "hex"));
    writeFileSync(join(d, "identity.json"), JSON.stringify(seeded, null, 2) + "\n");
    server = createServer(async (req, res) => {
      try {
        let body = "";
        for await (const b of req) body += b;
        const { method, params } = JSON.parse(body);
        let result;
        if (method === "block") {
          if(rollback&&(params.finality||params.block_id==="fixture-rollback")){res.setHeader("content-type","application/json");res.end(JSON.stringify({jsonrpc:"2.0",id:"fixture",result:{header:{...e.after.block,hash:"fixture-rollback",height:e.after.block.height+5}}}));return;}
          let s =
            params.block_id === e.before.block.hash ||
            params.block_id === e.before.block.height
              ? e.before
              : e.after;
          result = { header: { ...s.block } };
          if (params.block_id === "fixture-block")
            result.header = {
              ...e.before.block,
              height: e.before.block.height + 2,
              hash: "fixture-block",
            };
        } else if (method === "tx") result = e.deploy;
        else if (method === "query") {
          const s =
            (params.block_id === e.before.block.hash||params.block_id==="fixture-rollback") ? e.before : e.after;
          if (params.request_type === "view_account")
            result = { ...s.account, block_hash: s.block.hash };
          else if (params.request_type === "view_code")
            result = {
              code_base64: readFileSync(
                new URL(
                  "contracts/keys/release/" +
                    (s === e.before ? "v2.5" : "v2.6") +
                    "/keyhole_keys.wasm",
                  root,
                ),
              ).toString("base64"),
            };
          else if (params.request_type === "view_state")
            result = { values: s.state };
          else {
            const p = JSON.parse(Buffer.from(params.args_base64, "base64")),
              views = {
                nft_tokens: s.tokens,
                nft_total_supply: "6",
                config: s.config,
                get_pledge_config: s.pledge,
                nft_metadata: s.metadata,
                contract_source_metadata: s.source,
                get_control_state: s.controls.find(
                  (c) => c.token_id === p.token_id,
                ),
                get_payout_credit: s.credits.find(
                  (c) => c.account === p.account_id,
                )?.available,
                get_pending_payout: s.credits.find(
                  (c) => c.account === p.account_id,
                )?.pending,
              };
            assert.ok(Object.hasOwn(views, params.method_name));
            result = {
              result: [
                ...Buffer.from(JSON.stringify(views[params.method_name])),
              ],
            };
          }
        } else throw Error("unexpected fixture RPC");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: "fixture", result }));
      } catch {
        res.statusCode = 500;
        res.end("{}");
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const env = {
      ...process.env,
      NEAR_RPC: `http://127.0.0.1:${server.address().port}`,
    };
    await run(
      process.execPath,
      [
        join(d, "scripts/gen-identity.mjs"),
        "--promote-v26",
        join(d, "post.json"),
      ],
      { env, timeout: 30000 },
    );
    await run(
      process.execPath,
      [join(d, "scripts/gen-identity.mjs"), "--check"],
      { env, timeout: 30000 },
    );
    const downstream = await run(
      "bash",
      [join(d, "judge/1-contract.sh"), "--strict"],
      { cwd: d, env, timeout: 30000 },
    );
    assert.match(downstream.stdout, /PASS strict online contract identity/);
    const out = JSON.parse(readFileSync(join(d, "identity.json"))),
      prior = JSON.parse(original);
    assert.equal(out.contract.wasm_sha256, CANDIDATE);
    assert.equal(
      out.contract.migrate_pledge_tx,
      prior.contract.migrate_pledge_tx,
    );
    assert.equal(out.worker.wasm_sha256, prior.worker.wasm_sha256);
    assert.equal(out.contract_candidate.status, "source-candidate-not-deployed");
    assert.equal(out.contract_candidate.version, "2.7.0");
    assert.notEqual(out.contract_candidate.wasm_sha256, out.contract.wasm_sha256);
    const readme = readFileSync(join(d, "README.md"), "utf8");
    assert.match(readme, /Live contract v2\.6/);
    assert.match(readme, /v2\.6 \(live\)/);
    assert.match(readme, /Contract source candidate \*\*2\.7\.0\*\*, staged for deploy, not live/);
    assert.match(
      readFileSync(join(d, "web/lib/identity.gen.ts"), "utf8"),
      new RegExp(CANDIDATE),
    );
    assert.deepEqual(readFileSync(idPath), original);
    rollback=true;await assert.rejects(run(process.execPath,[join(d,"scripts/gen-identity.mjs"),"--promote-v26",join(d,"post.json")],{env,timeout:30000}));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    rmSync(d, { recursive: true, force: true });
  }
});
test("post rejects unreviewed account code-storage growth", () => {
  const e = proof();
  e.after.account.storage_usage++;
  assert.throws(() => validatePost(e));
});

test("worker identity rotation preserves every prior build and remains idempotent", () => {
  const id = JSON.parse(readFileSync(new URL("../../identity.json", import.meta.url))),
    old = "d337e822544d31da644728ba794f444f7f3ef6c54a6ee7442ab22d07e049ae41",
    older = "cc8d2fa8e2e4cc3b05705c5b98ac7eaab0ad119fae1745458a3b733d6270ec4c",
    original = {...id, worker:{...id.worker,wasm_sha256:old,previous_wasm_sha256:older}},
    predecessor = {...original, contract:{...original.contract, version:"2.6.0", wasm_sha256:CANDIDATE}},
    proof = {ctx:{snapshot:{code:{sha256:CANDIDATE},config:{minter:id.contract.minter}}},publication_tx:"fixture-publish"},
    e = {info:{call_id:"fixture-info"}};
  assert.throws(() => promotedWorker(original, proof, e), /promote reviewed contract before worker/);
  const next = promotedWorker(predecessor, proof, e);
  assert.equal(next.wasm_sha256, WORKER);
  assert.equal(next.previous_wasm_sha256, old);
  assert.ok(next.historical_wasm_sha256.includes(older));
  for (const hash of original.worker.historical_wasm_sha256) {
    assert.ok([next.previous_wasm_sha256,...next.historical_wasm_sha256].includes(hash));
  }
  assert.deepEqual(promotedWorker({...predecessor,worker:next},proof,e),next);
  assert.equal(original.worker.wasm_sha256,old);
});
