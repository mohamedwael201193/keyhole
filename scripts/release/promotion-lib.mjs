// Public evidence only. No key lookup, signing, migration or automatic rollback.
import { createHash } from "node:crypto";
export const ACCOUNT = "keyhole-devmo.near";
export const CANDIDATE =
  "54ba51b3d7d256820e751c9fa4e0cda55c66b30111a186c6d9eff03b561b7b8a";
export const ROLLBACK =
  "28cbe755268145d1e675106c8b9834e2c2b05baafccd3296e894072ecdaa25ce";
export const WORKER =
  "62398a8aa0451ce58cb5ab814ad8dc7f4e2f3fc55ce874c7672ea986abcc307f";
export const sha = (b) => createHash("sha256").update(b).digest("hex");
export function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export function requireThat(x, m) {
  if (!x) throw Error(m);
}
export function b58(bytes) {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex")),
    s = "",
    a = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (n) {
    s = a[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}
export async function rpc(
  method,
  params,
  url = process.env.NEAR_RPC || "https://rpc.mainnet.fastnear.com",
) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "keyhole-release-read",
      method,
      params,
    }),
    signal: AbortSignal.timeout(30000),
  });
  requireThat(r.ok, "RPC HTTP failure");
  const v = await r.json();
  requireThat(!v.error, "RPC error (details withheld)");
  return v.result;
}
export async function capture(call = rpc, blockId, exactSix = true) {
  const block = await call(
      "block",
      blockId ? { block_id: blockId } : { finality: "final" },
    ),
    hash = block.header.hash;
  if(blockId!==undefined)requireThat(typeof blockId==="number"?block.header.height===blockId:block.header.hash===blockId,"RPC returned wrong pinned block");
  const query = (p) =>
    call("query", { block_id: hash, account_id: ACCOUNT, ...p });
  const view = async (method, args = {}) =>
    JSON.parse(
      Buffer.from(
        (
          await query({
            request_type: "call_function",
            method_name: method,
            args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
          })
        ).result,
      ),
    );
  const account = await query({ request_type: "view_account" }),
    code = Buffer.from(
      (await query({ request_type: "view_code" })).code_base64,
      "base64",
    );
  const rows = (
    await query({
      request_type: "view_state",
      prefix_base64: "",
      include_proof: false,
    })
  ).values;
  requireThat(
    Array.isArray(rows) && rows.length <= 4096,
    "bounded complete raw state required",
  );
  const tokens = await view("nft_tokens", { from_index: "0", limit: 100 });
  requireThat(
    Array.isArray(tokens) &&
      tokens.length >= 6 &&
      tokens.length <= 100 &&
      (!exactSix || tokens.length === 6) &&
      new Set(tokens.map((t) => t.token_id)).size === tokens.length &&
      String(await view("nft_total_supply")) === String(tokens.length),
    "complete distinct NFT capture required",
  );
  const config = await view("config"),
    pledge = await view("get_pledge_config");
  const controls = [];
  for (const t of tokens)
    controls.push(await view("get_control_state", { token_id: t.token_id }));
  const credits = [];
  for (const a of [
    ...new Set(
      [
        ...tokens.map((t) => t.owner_id),
        config.minter,
        config.treasury,
        pledge?.recovery_account,
      ].filter(Boolean),
    ),
  ].sort())
    credits.push({
      account: a,
      available: await view("get_payout_credit", { account_id: a }),
      pending: await view("get_pending_payout", { account_id: a }),
    });
  return {
    schema: "keyhole-code-only-snapshot-v1",
    account_id: ACCOUNT,
    block: {
      hash,
      height: block.header.height,
      timestamp: block.header.timestamp,
    },
    account,
    code: { sha256: sha(code), bytes: code.length },
    source: await view("contract_source_metadata"),
    state: rows
      .map(({ key, value }) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    tokens,
    controls,
    credits,
    config,
    pledge,
    metadata: await view("nft_metadata"),
  };
}
export function validateBefore(s) {
  requireThat(
    s?.schema === "keyhole-code-only-snapshot-v1" && s.account_id === ACCOUNT,
    "wrong capture schema/account",
  );
  requireThat(
    s.code?.sha256 === ROLLBACK &&
      s.code.bytes === 485855 &&
      s.account.code_hash === b58(Buffer.from(ROLLBACK, "hex")) &&
      s.source.version === "2.5.0",
    "before must be actual reviewed v2.5",
  );
  requireThat(
    s.tokens?.length === 6 &&
      new Set(s.tokens.map((t) => t.token_id)).size === 6 &&
      s.controls?.length === 6,
    "incomplete NFT/control capture",
  );
  requireThat(
    s.credits?.length >= 7 &&
      s.credits.every((c) => c.pending === null) &&
      s.state?.length > 0 &&
      s.pledge?.lending_enabled === false,
    "credits/state/disabled initialized Pledge missing",
  );
  requireThat(
    canonical(s.tokens.map((t) => t.token_id).sort()) ===
      canonical(s.controls.map((t) => t.token_id).sort()),
    "control IDs incomplete",
  );
  const accounts = [
    ...new Set(
      [
        ...s.tokens.map((t) => t.owner_id),
        s.config.minter,
        s.config.treasury,
        s.pledge.recovery_account,
      ].filter(Boolean),
    ),
  ].sort();
  requireThat(
    canonical(s.credits.map((c) => c.account).sort()) === canonical(accounts),
    "credit accounts incomplete",
  );
  requireThat(
    new Set(s.state.map((r) => r.key)).size === s.state.length,
    "duplicate raw state rows",
  );
  for (const c of s.controls)
    requireThat(
      c.pending_value_ops === "0" &&
        !c.transfer_pending &&
        !c.pledged &&
        !c.listed,
      "drain before code deployment",
    );
  requireThat(
    s.account.block_hash === s.block.hash &&
      s.account.block_height === s.block.height,
    "account capture not pinned",
  );
  requireThat(
    s.block?.hash && Number.isSafeInteger(s.block.height),
    "pinned block missing",
  );
  return true;
}
export function preserved(before, after) {
  for (const k of [
    "account_id",
    "state",
    "tokens",
    "controls",
    "credits",
    "config",
    "pledge",
    "metadata",
  ])
    requireThat(
      canonical(before[k]) === canonical(after[k]),
      "state preservation failed: " + k,
    );
  return true;
}
// Closed original graph, including return edges and executor expectations. Never use logs as proof.
export function finalGraph(tx, hash, receiver, extraExecutors = []) {
  requireThat(
    tx?.final_execution_status === "FINAL" &&
      tx.transaction?.hash === hash &&
      tx.transaction.receiver_id === receiver,
    "original FINAL transaction missing",
  );
  const nodes = [tx.transaction_outcome, ...(tx.receipts_outcome || [])];
  requireThat(
    nodes.length >= 2 && nodes.length <= 256,
    "receipt graph missing/bounded",
  );
  const map = new Map();
  for (const n of nodes) {
    requireThat(
      n?.id && !map.has(n.id) && n.outcome?.status,
      "duplicate/invalid node",
    );
    map.set(n.id, n);
  }
  requireThat(
    nodes[0].id === hash &&
      nodes[0].outcome.executor_id === tx.transaction.signer_id,
    "wrong transaction root",
  );
  const seen = new Set(),
    visiting = new Set(),
    parents = new Map();
  for (const n of nodes) {
    const ids = n.outcome.receipt_ids;
    requireThat(
      Array.isArray(ids) && new Set(ids).size === ids.length,
      "duplicate/missing children",
    );
    for (const id of ids) {
      parents.set(id, (parents.get(id) || 0) + 1);
      requireThat(parents.get(id) === 1, "ambiguous receipt parent");
    }
  }
  function walk(id) {
    requireThat(map.has(id) && !visiting.has(id), "missing/cyclic receipt");
    if (seen.has(id)) return;
    visiting.add(id);
    const o = map.get(id).outcome,
      s = o.status;
    requireThat(
      Object.keys(s).length === 1 &&
        (Object.hasOwn(s, "SuccessValue") ||
          Object.hasOwn(s, "SuccessReceiptId")),
      "failed/pending receipt",
    );
    requireThat(Array.isArray(o.receipt_ids), "missing generated children");
    if (id !== hash)
      requireThat(
        [
          receiver,
          tx.transaction.signer_id,
          "system",
          ...extraExecutors,
        ].includes(o.executor_id),
        "unexpected executor",
      );
    for (const child of o.receipt_ids) walk(child);
    if (s.SuccessReceiptId) {
      requireThat(
        o.receipt_ids.includes(s.SuccessReceiptId),
        "return edge not generated",
      );
      walk(s.SuccessReceiptId);
    }
    visiting.delete(id);
    seen.add(id);
  }
  walk(hash);
  requireThat(seen.size === map.size, "orphan receipt");
  let id = hash;
  for (let i = 0; i < 256; i++) {
    let s = map.get(id).outcome.status;
    if (s.SuccessReceiptId) {
      id = s.SuccessReceiptId;
      continue;
    }
    requireThat(
      map.get(id).outcome.executor_id === receiver &&
        canonical(s) === canonical(tx.status),
      "terminal return mismatch",
    );
    return true;
  }
  throw Error("unbounded return lineage");
}
export function validatePost(e) {
  validateBefore(e.before);
  preserved(e.before, e.after);
  const tx = e.deploy;
  finalGraph(tx, e.deploy_hash, ACCOUNT);
  requireThat(
    tx.transaction.signer_id === ACCOUNT &&
      tx.transaction.actions?.length === 1,
    "code-only self deployment required",
  );
  const d = tx.transaction.actions[0].DeployContract;
  requireThat(
    d && Object.keys(tx.transaction.actions[0]).length === 1,
    "no init/migrate actions allowed",
  );
  const code = Buffer.from(d.code, "base64"); // NEAR RPC represents DeployContract.code by its SHA256, not the full wasm.
  requireThat(
    code.toString("hex") === CANDIDATE || sha(code) === CANDIDATE,
    "wrong deployed code",
  );
  requireThat(
    e.after.code.sha256 === CANDIDATE &&
      e.after.code.bytes === 487260 &&
      e.after.account.code_hash === b58(Buffer.from(CANDIDATE, "hex")) &&
      e.after.source.version === "2.6.0",
    "post code/version mismatch",
  );
  requireThat(
    e.after.block.height > e.before.block.height,
    "reversed/same blocks",
  );
  requireThat(
    BigInt(e.after.account.storage_usage) ===
      BigInt(e.before.account.storage_usage) + 1405n,
    "unexpected code-storage delta",
  );
  return true;
}

export async function revalidatePost(e, call = rpc) {
  validatePost(e);
  const final = await call("block", { finality: "final" });
  for (const s of [e.before, e.after]) {
    const b = await call("block", { block_id: s.block.height });
    requireThat(
      b.header.hash === s.block.hash && s.block.height <= final.header.height,
      "snapshot not canonical finalized",
    );
  }
  const before = await capture(call, e.before.block.hash),
    after = await capture(call, e.after.block.hash),
    deploy = await call("tx", {
      tx_hash: e.deploy_hash,
      sender_account_id: ACCOUNT,
      wait_until: "FINAL",
    });
  requireThat(
    canonical(before) === canonical(e.before) &&
      canonical(after) === canonical(e.after) &&
      canonical(deploy) === canonical(e.deploy),
    "capture differs from actual pinned chain",
  );
  for (const n of [deploy.transaction_outcome, ...deploy.receipts_outcome]) {
    const b = await call("block", { block_id: n.block_hash });
    requireThat(
      b.header.height > before.block.height &&
        b.header.height <= after.block.height,
      "deploy outside capture interval",
    );
  }
  validatePost({ before, after, deploy, deploy_hash: e.deploy_hash });
  const current=await capture(call,final.header.hash,false);requireThat(current.code.sha256===CANDIDATE&&current.source.version==='2.6.0'&&current.config.minter===after.config.minter,'historical proof is not current live code/authority');for(const k of ['attestor_public_key','custody_contract','network','recovery_account'])requireThat(current.pledge[k]===after.pledge[k],'current immutable pledge configuration drift');
  return true;
}
