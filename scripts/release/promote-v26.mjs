#!/usr/bin/env node
// DRY RUN DEFAULT. Future execution requires separately signed approval and a
// pre-signed single DeployContract; this program never loads or signs with a key.
import {
  readFileSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { createPublicKey, verify } from "node:crypto";
import {
  ACCOUNT,
  CANDIDATE,
  ROLLBACK,
  WORKER,
  sha,
  b58,
  canonical,
  capture,
  validateBefore,
  preserved,
  validatePost,
  revalidatePost,
  rpc,
  requireThat as must,
} from "./promotion-lib.mjs";
import {
  releaseGates,
  approval,
  fetchAttestation,
  attested,
  registry,
} from "./gates.mjs";
import {PHASES,seconds,makeCheckpoint,verifyCheckpoint} from "./lifecycle.mjs";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const load = (p) => JSON.parse(readFileSync(p, "utf8"));
export function artifacts() {
  const wasm = readFileSync(
      ROOT + "contracts/keys/release/v2.6/keyhole_keys.wasm",
    ),
    rollback = readFileSync(
      ROOT + "contracts/keys/release/v2.5/keyhole_keys.wasm",
    );
  must(
    sha(wasm) === CANDIDATE && wasm.length === 487260,
    "candidate bytes changed",
  );
  must(
    sha(rollback) === ROLLBACK && rollback.length === 485855,
    "rollback bytes changed",
  );
  return { wasm, rollback };
}
export function decodeDeployment(row) {
  const b = Buffer.from(row.signed_transaction_as_base64 || "", "base64");
  must(
    b.length > 487260 &&
      b.length <= 488000 &&
      b.toString("base64") === row.signed_transaction_as_base64,
    "invalid saved signed transaction",
  );
  let o = 0;
  const take = (n) => {
      must(n >= 0 && o + n <= b.length, "truncated signed transaction");
      let x = b.subarray(o, o + n);
      o += n;
      return x;
    },
    u32 = () => take(4).readUInt32LE(),
    text = () => {
      const n = u32();
      must(n <= 64, "account bound");
      return take(n).toString();
    };
  const signer = text();
  must(take(1)[0] === 0, "only V0 Ed25519");
  const pk = take(32),
    nonce = take(8).readBigUInt64LE().toString(),
    receiver = text(),
    block_hash = b58(take(32));
  must(
    u32() === 1 && take(1)[0] === 1,
    "exactly one DeployContract; no init or migration",
  );
  const n = u32();
  must(n === 487260, "wrong deployment size");
  const code = take(n);
  must(
    signer === ACCOUNT && receiver === ACCOUNT && sha(code) === CANDIDATE,
    "wrong signer/receiver/code",
  );
  const end = o;
  must(take(1)[0] === 0, "Ed25519 signature");
  const sig = take(64);
  must(o === b.length, "extra signed actions/data");
  const digest = Buffer.from(sha(b.subarray(0, end)), "hex");
  must(
    verify(
      null,
      digest,
      createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          pk,
        ]),
        format: "der",
        type: "spki",
      }),
      sig,
    ),
    "bad deployment signature",
  );
  return {
    hash: b58(digest),
    nonce,
    public_key: "ed25519:" + b58(pk),
    block_hash,
    signed: row.signed_transaction_as_base64,
  };
}
export async function context(e = {}, call = rpc, net = fetch, opts={}) {
  const s = await capture(call, opts.block, false),
    q = async (account, method, args = {}, block = s.block.hash) =>
      JSON.parse(
        Buffer.from(
          (
            await call("query", {
              request_type: "call_function",
              block_id: block,
              account_id: account,
              method_name: method,
              args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
            })
          ).result,
        ),
      );
  const project = await q("outlayer.near", "get_project", {
      project_id: ACCOUNT + "/keyhole",
    }),
    versions = await q("outlayer.near", "list_versions", {
      project_id: ACCOUNT + "/keyhole",
      from_index: 0,
      limit: 100,
    }),
    count = await q("outlayer.near", "get_version_count", {
      project_id: ACCOUNT + "/keyhole",
    });
  if(opts.phase==="predeploy")validateBefore(s);
  const tokenId = ["provision-pre","provision-post","pilot-post","all"].includes(opts.phase)?e.prepare?.output?.token_id:opts.phase==="restore"||!opts.phase ? e.restore&&JSON.parse(e.restore.input.auth.message).params.token_id:undefined;
  const ctx = {
    snapshot: s,
    phase:opts.phase||"predeploy", historical:opts.historical===true,
    now:opts.historical?seconds(s.block):Math.floor(Date.now()/1000),
    verifyCheckpoint:(cp,phase,trust)=>verifyCheckpoint(cp,phase,trust,call,net),
    verifyContractPost:proof=>revalidatePost(proof,call),
    token: s.tokens.find((t) => t.token_id === tokenId),
    control: s.controls.find((t) => t.token_id === tokenId),
    pledge: s.pledge,
    minter_account: s.config.minter,
    registry: { ...project, count, versions },
    fetchAttestation:async id=>{must(/^[0-9a-f-]{36}$/.test(id),"call ID");const r=await net("https://api.outlayer.ai/attestations/by-call/"+id,{signal:AbortSignal.timeout(30000)});must(r.ok,"attestation unavailable");return r.json();},
  };
  if(opts.phase==='predeploy'&&e.native_before){const before=await capture(call,e.native_before.block.hash);validateBefore(before);must(canonical(before)===canonical(e.native_before)&&before.block.height<=s.block.height&&s.block.height-before.block.height<=100,'invalid/stale approved before snapshot');preserved(before,s);ctx.approved_snapshot=before;}
  const minter = await call("query", {
    request_type: "view_account",
    block_id: s.block.hash,
    account_id: s.config.minter,
  });
  ctx.funding = {
    available_after_storage_and_liabilities: (
      BigInt(minter.amount) -
      BigInt(minter.storage_usage) * 10n ** 19n
    ).toString(),
  };
  ctx.gas_price = (await call("gas_price", [s.block.hash])).gas_price;
  const protocol = await call("EXPERIMENTAL_protocol_config", {
    block_id: s.block.hash,
  });
  must(
    protocol.runtime_config.storage_amount_per_byte === "10000000000000000000",
    "storage protocol changed; rereview required",
  );
  ctx.protocol_config_sha256 = sha(canonical(protocol));
  ctx.native_available_yocto = (
    BigInt(s.account.amount) -
    BigInt(s.account.storage_usage) * 10n ** 19n -
    BigInt(s.pledge.user_liabilities)
  ).toString();
  // Invalid JSON cannot reach worker submission, even if maintenance is absent.
  ctx.alias_checks = [];
  for (const path of opts.historical?[]:["/api/keyhole", "/api/worker"]) {
    const r = await net("https://www.getkeyhole.xyz" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
      signal: AbortSignal.timeout(30000),
    });
    ctx.alias_checks.push({
      path,
      status: r.status,
      cache_control: r.headers.get("cache-control"),
    });
  }
  if(opts.historical)ctx.alias_checks=e.barrier_observation;
  if(ctx.phase==="provision-pre"){
  const balance = await net(
    "https://api.outlayer.ai/public/payment-keys/" + ACCOUNT + "/1/balance",
    { signal: AbortSignal.timeout(30000) },
  );
  must(balance.ok, "compute balance unavailable");
  const v = await balance.json();
  must(v.owner === ACCOUNT && v.nonce === 1, "payment namespace mismatch");
  ctx.compute_balance = {
    available: Number(v.available),
    reserved: Number(v.reserved),
  };
  }
  if (e.prepare?.output && ["provision-pre","provision-post","pilot-post","all"].includes(ctx.phase)) {
    const p = e.prepare.output;
    ctx.binding = await q(ACCOUNT, "get_collateral_binding", {
      token_id: p.token_id,
    });
    ctx.lower_policy = await q(s.pledge.custody_contract, "get_wallet_policy", {
      wallet_pubkey: p.wallet_pubkey,
    });
  }
  const receipts = async (tx) => {
    const out = [];
    for (const n of tx.receipts_outcome || []) {
      const r = await call("EXPERIMENTAL_receipt", { receipt_id: n.id });
      must(r.receipt_id === n.id, "original receipt identity mismatch");
      out.push(r);
    }
    return out;
  };
  if (e.secret_merge && ctx.phase==="restore") {
    const z = e.secret_merge,
      tx = await call("tx", {
        tx_hash: z.hash,
        sender_account_id: ACCOUNT,
        wait_until: "FINAL",
      }),
      raw = await q("outlayer.near", "get_secrets", {
        accessor: { Project: { project_id: ACCOUNT + "/keyhole" } },
        profile: "default",
        owner: ACCOUNT,
      });
    must(raw, "default secret row missing");
    const bytes =
      typeof raw.encrypted_secrets === "string"
        ? Buffer.from(raw.encrypted_secrets, "base64")
        : Buffer.from(raw.encrypted_secrets);
    ctx.secret_merge = {
      hash: z.hash,
      tx,
      row: {
        storage_deposit: raw.storage_deposit,
        accessor: raw.accessor,
        access: raw.access,
        encrypted_sha256: sha(bytes),
      },
      receipts: await receipts(tx),
    };
  }
  if (e.freeze && ["pilot-post","all"].includes(ctx.phase)) {
    must(e.freeze.token_id===e.prepare?.output?.token_id,"foreign freeze token");
    ctx.freeze_loan = await q(ACCOUNT, "get_loan", {
      token_id: e.freeze.token_id,
    });
    ctx.freeze_binding = await q(ACCOUNT, "get_collateral_binding", {
      token_id: e.freeze.token_id,
    });
    ctx.frozen_policy = await q(
      s.pledge.custody_contract,
      "get_wallet_policy",
      { wallet_pubkey: ctx.freeze_binding.wallet_pubkey },
    );
    const c = e.certificate.output.certificate;
    const observed=BigInt(c.observed_at_ns);must(observed%1000000n===0n,'noncanonical observed timestamp');
    const candidates=[];for(let h=s.block.height, n=0;h>=0&&n<64;h--,n++){const b=(await call('block',{block_id:h})).header;const t=BigInt(b.timestamp)/1000000n*1000000n;if(t===observed)candidates.push({hash:b.hash,height:b.height,timestamp:b.timestamp});if(t<observed)break;}
    must(candidates.length===1,'certificate observation is not one unique canonical finalized block');ctx.certificate_block=candidates[0];
    must((await call('block',{block_id:ctx.certificate_block.height})).header.hash===ctx.certificate_block.hash,'certificate block reorg');
    ctx.certificate_template = await q(ACCOUNT, "loan_certificate_template", {token_id:e.freeze.token_id,observed_at_ns:c.observed_at_ns,expires_at_ns:c.expires_at_ns},ctx.certificate_block.hash);
    for(const [method,args,value] of [['get_loan',{token_id:e.freeze.token_id},ctx.freeze_loan],['get_collateral_binding',{token_id:e.freeze.token_id},ctx.freeze_binding],['get_control_state',{token_id:e.freeze.token_id},ctx.control]])must(canonical(await q(ACCOUNT,method,args,ctx.certificate_block.hash))===canonical(value),'certificate/current subject state diverged');
    e.freeze.tx = await call("tx", {
      tx_hash: e.freeze.hash,
      sender_account_id: e.freeze.signer_id,
      wait_until: "FINAL",
    });
    ctx.freeze_receipts = await receipts(e.freeze.tx);
    const heights=[];for(const n of [e.freeze.tx.transaction_outcome,...e.freeze.tx.receipts_outcome]){const b=(await call('block',{block_id:n.block_hash})).header;must((await call('block',{block_id:b.height})).header.hash===b.hash,'noncanonical freeze receipt block');heights.push(b.height);}ctx.freeze_start_height=Math.min(...heights);ctx.freeze_end_height=Math.max(...heights);
  }
  return ctx;
}
export function journal(path, value) {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const dir = openSync(dirname(path), "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
export async function broadcastOnce(path, tx, before, call = rpc) {
  journal(path, {
    schema: "keyhole-original-deploy-v1",
    hash: tx.hash,
    before_sha256: sha(canonical(before)),
    signed_sha256: sha(tx.signed),
    state: "DISPATCH_CLAIMED_UNKNOWN",
  });
  try {
    await call("send_tx", { signed_tx_base64: tx.signed, wait_until: "FINAL" });
    return { hash: tx.hash, state: "CHECK_ORIGINAL_FINAL" };
  } catch {
    return { hash: tx.hash, state: "UNKNOWN" };
  }
}
export async function workerPublication(e, trust, call = rpc, net = fetch, opts={}) {
  const ctx = opts.context||await context(e, call, net,{phase:"restore"}),
    g = await releaseGates(e, trust, ctx);
  must(g.ready_restore, "restore gates incomplete");
  must(
    ctx.snapshot.code.sha256 === CANDIDATE &&
      ctx.snapshot.pledge.lending_enabled === false,
    "reviewed contract and disabled lending required",
  );
  registry(ctx.registry);
  await attested(e.info, "info", ctx);
  must(
    e.info.output.minter_account === ctx.snapshot.config.minter &&
      Buffer.from(ctx.pledge.attestor_public_key, "base64").toString("hex") ===
        ctx.snapshot.config.minter,
    "minter/attestor changed",
  );
  const pub = e.publication,
    plan = load(ROOT + "docs/evidence/worker-provisioning/publish-plan.json");
  must(
    pub?.hashes?.length === 3 && new Set(pub.hashes).size === 3,
    "three original registry batches required",
  );
  const snap = await call("block", { block_id: pub.before_block }),
    fin = await call("block", { finality: "final" });
  must(
    snap.header.height <= fin.header.height &&
      (await call("block", { block_id: snap.header.height })).header.hash ===
        snap.header.hash,
    "registry capture not canonical finalized",
  );
  const versionQuery = {
    request_type: "call_function",
    block_id: snap.header.hash,
    account_id: "outlayer.near",
    method_name: "list_versions",
    args_base64: Buffer.from(
      JSON.stringify({
        project_id: ACCOUNT + "/keyhole",
        from_index: 0,
        limit: 100,
      }),
    ).toString("base64"),
  };
  const old = JSON.parse(
    Buffer.from((await call("query", versionQuery)).result),
  );
  const oldProject = JSON.parse(
    Buffer.from(
      (
        await call("query", {
          ...versionQuery,
          method_name: "get_project",
          args_base64: Buffer.from(
            JSON.stringify({ project_id: ACCOUNT + "/keyhole" }),
          ).toString("base64"),
        })
      ).result,
    ),
  );
  must(
    oldProject.uuid === "p000000000000004b" &&
      oldProject.active_version === plan.previous_active &&
      old.length === 22,
    "old project namespace/active changed",
  );
  must(
    canonical(old.map((v) => v.wasm_hash).sort()) ===
      canonical([...plan.retired].sort()),
    "publication snapshot drift",
  );
  const approved = approval(
    e.publication_approval,
    trust,
    "worker-publication",
    ctx.now,
  );
  must(
    approved.registry_before_sha256 === sha(canonical(old)),
    "registry snapshot not approved",
  );
  let added = 0,
    removed = [];
  const txs = [];
  for (const [batch, hash] of pub.hashes.entries()) {
    const tx = await call("tx", {
      tx_hash: hash,
      sender_account_id: ACCOUNT,
      wait_until: "FINAL",
    });
    const { finalGraph } = await import("./promotion-lib.mjs");
    finalGraph(tx, hash, "outlayer.near");
    must(
      tx.transaction.signer_id === ACCOUNT &&
        tx.transaction.actions.length === [5, 9, 9][batch],
      "publication signer/batch shape",
    );
    for (const a of tx.transaction.actions) {
      must(
        Object.keys(a).length === 1 && a.FunctionCall,
        "registry-only actions",
      );
      const f = a.FunctionCall,
        p = JSON.parse(Buffer.from(f.args, "base64"));
      must(p.project_name === "keyhole", "wrong project");
      if (f.method_name === "add_version") {
        added++;
        must(
          batch === 0 && f.deposit === plan.version_deposit_yocto,
          "wrong publication attachment",
        );
        must(
          p.set_active === true &&
            p.source?.WasmUrl?.hash === WORKER &&
            p.source.WasmUrl.url === plan.url &&
            p.source.WasmUrl.build_target === "wasm32-wasip2",
          "wrong publication source",
        );
      } else {
        must(
          f.method_name === "remove_version" && f.deposit === "0",
          "unexpected registry action",
        );
        removed.push(p.version_key);
      }
    }
    for (const n of [tx.transaction_outcome, ...tx.receipts_outcome]) {
      const b = await call("block", { block_id: n.block_hash });
      must(
        (await call("block",{block_id:b.header.height})).header.hash===b.header.hash && b.header.height > snap.header.height &&
          b.header.height <= ctx.snapshot.block.height,
        "registry transaction outside capture bounds",
      );
    }
    txs.push(tx);
  }
  must(
    added === 1 &&
      removed.length === 22 &&
      new Set(removed).size === 22 &&
      canonical(removed.sort()) === canonical([...plan.retired].sort()),
    "retirement set incomplete",
  );
  const r = await net(plan.url, { signal: AbortSignal.timeout(30000) });
  must(r.ok, "published bytes unavailable");
  const bytes = Buffer.from(await r.arrayBuffer());
  must(
    bytes.length === 1085333 && sha(bytes) === WORKER,
    "published byte mismatch",
  );
  return { ctx, publication_tx: txs[0].transaction.hash };
}
export async function main(argv) {
  const allowed = new Set([
    "--dry-run",
    "--execute",
    "--post",
    "--check-gates",
    "--before",
    "--out",
    "--signed",
    "--approval",
    "--evidence",
    "--trust",
    "--journal",
    "--hash",
    "--phase",
    "--observe",
  ]);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    must(allowed.has(k) && !Object.hasOwn(args, k), "unknown/duplicate flag");
    args[k] = ["--dry-run", "--execute", "--post", "--check-gates", "--observe"].includes(k)
      ? true
      : argv[++i];
    must(args[k] !== undefined, "missing flag value");
  }
  must(
    ["--dry-run", "--execute", "--post", "--check-gates", "--observe"].filter((k) => args[k])
      .length <= 1,
    "choose one mode",
  );
  artifacts();
  const e = args["--evidence"] ? load(args["--evidence"]) : {},
    trust = args["--trust"] ? load(args["--trust"]) : {};
  if(args["--before"]&&args["--check-gates"])e.native_before=load(args["--before"]);
  if (args["--post"]) {
    must(
      args["--before"] && args["--hash"] && args["--out"],
      "post needs original before/hash/out",
    );
    const before = load(args["--before"]),
      after = await capture(),
      deploy = await rpc("tx", {
        tx_hash: args["--hash"],
        sender_account_id: ACCOUNT,
        wait_until: "FINAL",
      });
    const proof = {
      schema: "keyhole-v26-code-only-post-v1",
      before,
      after,
      deploy_hash: args["--hash"],
      deploy,
    };
    await revalidatePost(proof);
    writeFileSync(args["--out"], JSON.stringify(proof, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(
      "PASS original FINAL code-only deploy, reviewed bytes and complete state preservation",
    );
    return;
  }
  if(args['--observe']){must(args['--out'],'observation output required');const c=await context(e,rpc,fetch,{phase:'predeploy'});journal(args['--out'],{block:c.snapshot.block,barrier_observation:c.alias_checks,barrier_sha256:sha(canonical(c.alias_checks))});console.log('READ ONLY observation saved; no approval or readiness implied');return;}
  if (args["--check-gates"]) {
    const phase=args['--phase']||'predeploy';must(PHASES.includes(phase)||phase==='all','unknown gate phase');
    let ctx={phase},contextOK=true;try{ctx=await context(e,rpc,fetch,{phase});}catch{contextOK=false;}
    const result=await releaseGates(e,trust,ctx);if(!contextOK)console.log('FAIL fresh_context_collection: required before execution');
    for(const r of result.rows)console.log(`${r.status} ${r.name}: ${r.when}`);
    console.log(`PHASE ${phase} ${result.phase_ready&&contextOK?'PASS':'FAIL'}; all_mainnet_gates=${result.all_mainnet_ready}`);
    must(result.phase_ready&&contextOK,'release gates remain NO-GO');
    if(phase==='restore')await workerPublication(e,trust,rpc,fetch,{context:ctx});
    if(args['--out'])journal(args['--out'],makeCheckpoint(phase,e,ctx));return;
  }
  if (args["--execute"]) {
    must(
      args["--before"] &&
        args["--signed"]?.endsWith(".signed.json") &&
        args["--approval"] &&
        args["--trust"] &&
        args["--journal"],
      "execution requires before, reviewed trust, signed approval, saved signature and NEW journal",
    );
    const before = load(args["--before"]);
    validateBefore(before);
    must(
      canonical(await capture(rpc, before.block.hash)) === canonical(before),
      "before differs from chain",
    );
    const current = await capture();
    validateBefore(current);
    preserved(before, current);
    must(
      current.block.height >= before.block.height &&
        (await rpc("block", { block_id: before.block.height })).header.hash ===
          before.block.hash &&
        current.block.height - before.block.height <= 100,
      "refresh before/signing context",
    );
    const a = approval(
      load(args["--approval"]),
      trust,
      "deploy-code-only-v26",
      Math.floor(Date.now() / 1000),
    );
    must(
      a.before_state_sha256 === sha(canonical(before)),
      "approval not exact before snapshot",
    );
    const gates = await releaseGates(
      { ...e, approval: load(args["--approval"]) },
      trust,
      await context({...e,native_before:before},rpc,fetch,{phase:"predeploy"}),
    );
    must(gates.ready_deploy, "maintenance/drain or native approval missing");
    const tx = decodeDeployment(load(args["--signed"]));
    must(
      tx.block_hash === before.block.hash,
      "signed block not recorded before snapshot",
    );
    const access = await rpc("query", {
      request_type: "view_access_key",
      account_id: ACCOUNT,
      public_key: tx.public_key,
      block_id: current.block.hash,
    });
    must(
      access.permission === "FullAccess" &&
        BigInt(tx.nonce) === BigInt(access.nonce) + 1n,
      "wrong key/nonce",
    );
    must(
      a.public_key === tx.public_key && a.nonce === tx.nonce,
      "approval not original key/nonce",
    );
    const gasPrice = BigInt(
        (await rpc("gas_price", [current.block.hash])).gas_price,
      ),
      bytePrice = 10n ** 19n,
      gasBound = 300000000000000n * gasPrice,
      need = 1405n * bytePrice + BigInt(a.max_gas_yocto);
    must(
      BigInt(a.max_gas_yocto) >= gasBound &&
        BigInt(a.max_storage_yocto) >= 1405n * bytePrice &&
        BigInt(current.account.amount) -
          BigInt(current.account.storage_usage) * bytePrice -
          BigInt(current.pledge.user_liabilities) >=
          need,
      "native all-in backing/ceiling insufficient",
    );
    const result = await broadcastOnce(args["--journal"], tx, before);
    console.log(
      result.state +
        " ORIGINAL_HASH " +
        tx.hash +
        "; resolve original using --post; never retry or automatically roll back",
    );
    if (result.state === "UNKNOWN") process.exitCode = 1;
    return;
  }
  const before = await capture();
  validateBefore(before);
  if (args["--out"])
    writeFileSync(args["--out"], JSON.stringify(before, null, 2) + "\n", {
      flag: "wx",
    });
  const gates = await releaseGates(e, trust, {phase:"predeploy"});
  console.log(`DRY_RUN ONLY account=${ACCOUNT}`);
  console.log("PASS candidate " + CANDIDATE + " bytes=487260");
  console.log(
    "PASS rollback contracts/keys/release/v2.5/keyhole_keys.wasm " + ROLLBACK,
  );
  console.log(
    `PASS finalized before block=${before.block.height} NFTs=${before.tokens.length} epochs=${before.controls.length} credit_accounts=${before.credits.length} raw_rows=${before.state.length}`,
  );
  console.log(
    "PLAN exactly 1 DeployContract; 0 new/migrate/migrate_pledge; no signing or broadcast",
  );
  console.log(
    "POST original FINAL receipt graph + exact code + all raw rows/NFTs/owners/epochs/credits/config equality",
  );
  for (const r of gates.rows) console.log(`${r.status} ${r.name}: ${r.when}`);
  console.log(
    "RESULT NOT_AUTHORIZED; mainnet readiness=false; candidates remain non-live",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch(() => {
    console.error(
      "FAIL promotion/check refused (details withheld); no automatic retry or rollback",
    );
    process.exitCode = 1;
  });
