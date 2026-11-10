// Synthetic evidence ONLY: generated ephemeral test keys are never on-chain keys.
import { generateKeyPairSync, sign } from "node:crypto";
import {
  ACCOUNT,
  CANDIDATE,
  WORKER,
  canonical,
  sha,
} from "./promotion-lib.mjs";
import { certificateBytes } from "./gates.mjs";
import { readFileSync } from "node:fs";
export const clone = (x) => structuredClone(x);
export function signer() {
  const k = generateKeyPairSync("ed25519"),
    raw = k.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    pk: raw.toString("base64"),
    raw,
    sign: (m) => sign(null, Buffer.from(m), k.privateKey),
  };
}
export function graph(
  hash = "fixture-deploy",
  receiver = ACCOUNT,
  signerId = ACCOUNT,
) {
  return {
    final_execution_status: "FINAL",
    transaction: {
      hash,
      receiver_id: receiver,
      signer_id: signerId,
      actions: [
        {
          DeployContract: {
            code: Buffer.from(CANDIDATE, "hex").toString("base64"),
          },
        },
      ],
    },
    transaction_outcome: {
      id: hash,
      block_hash: "fixture-block",
      outcome: {
        executor_id: signerId,
        receipt_ids: ["r"],
        status: { SuccessReceiptId: "r" },
      },
    },
    receipts_outcome: [
      {
        id: "r",
        block_hash: "fixture-block",
        outcome: {
          executor_id: receiver,
          receipt_ids: [],
          status: { SuccessValue: "" },
        },
      },
    ],
    status: { SuccessValue: "" },
  };
}
export function fixtures() {
  const now = Math.floor(Date.now() / 1000),
    auditor = signer(),
    release = signer(),
    submitter = signer(),
    attestor = signer(),
    byId = new Map();
  let n = 0;
  const row = (op, params, output, outputOp = op) => {
    const v = {
      call_id: `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`,
      input: {
        op,
        auth: {
          scheme: "nep413",
          message: JSON.stringify({ op, account_id: "alice.near", params }),
        },
      },
      output: { ok: true, op: outputOp, ...output },
    };
    byId.set(v.call_id, v);
    return v;
  };
  const ctx = {
    now,
    minter_account: "minter.near",
    gas_price: "100000000",
    protocol_config_sha256: "3".repeat(64),
    native_available_yocto: String(2n * 10n ** 24n),
    fetchAttestation: async (id) => {
      const r = byId.get(id);
      return {
        call_id: id,
        project_id: ACCOUNT + "/keyhole",
        wasm_hash: WORKER,
        executed_wasm_sha256: WORKER,
        timestamp: now,
        tdx_quote: "mock-unit-quote".repeat(20),
        worker_measurement: "0".repeat(96),
        input_hash: sha(canonical(r.input)),
        output_hash: sha(canonical(r.output)),
      };
    },
    registry: {
      uuid: "p000000000000004b",
      project_id: ACCOUNT + "/keyhole",
      active_version: WORKER,
      count: 1,
      versions: [
        {
          wasm_hash: WORKER,
          is_active: true,
          source: { WasmUrl: { hash: WORKER } },
        },
      ],
    },
    token: { token_id: "pilot", owner_id: "alice.near" },
    control: {
      token_id: "pilot",
      owner_epoch: "3",
      pending_value_ops: "0",
      transfer_pending: false,
      pledged: false,
      listed: false,
    },
    alias_checks: ["/api/keyhole", "/api/worker"].map((path) => ({
      path,
      status: 503,
      cache_control: "no-store",
    })),
    funding: { available_after_storage_and_liabilities: String(10n ** 24n) },
    compute_balance: { available: 514657, reserved: 0 },
    pledge: {
      custody_contract: "outlayer.near",
      attestor_public_key: attestor.pk,
    },
  };
  const authParams = { token_id: "pilot", owner_epoch: "3" },
    id = "7".repeat(64),
    wallet = "ed25519:" + "8".repeat(64),
    encrypted = "synthetic encrypted policy",
    policyHash = Buffer.from(sha(encrypted), "hex").toString("base64");
  const prepare = row(
    "prepare_collateral",
    { ...authParams, approvers: [{ id: "reviewer.near" }], threshold: 1 },
    {
      provision_id: id,
      wallet_pubkey: wallet,
      token_id: "pilot",
      owner_epoch: "3",
      policy_hash: policyHash,
      plaintext_hash: "9".repeat(64),
      version: 1,
      valid_until: now + 600,
      authority_review_required: true,
    },
  );
  const a = {
      domain: "KEYHOLE_COLLATERAL_AUDIT_V1",
      project_uuid: "p000000000000004b",
      contract: ACCOUNT,
      provision_id: id,
      authority_audit_sha256: sha("synthetic report"),
      issued_at_sec: now - 1,
      expires_at_sec: now + 600,
      no_presigned_authorities: true,
      all_aliases_reviewed: true,
      old_jobs_drained: true,
      external_chain_authorities_reviewed: true,
      effective_policy_reviewed: true,
      reachable_quorum_verified: true,
    },
    msg = JSON.stringify(a),
    audit = {
      provision_id: id,
      audit_message: msg,
      audit_signature: auditor
        .sign("KEYHOLE_COLLATERAL_AUDIT_V1\n" + msg)
        .toString("base64"),
      report: "synthetic report",
    };
  const Q = 1523n * 10n ** 19n,
    D = Q + 2n * 10n ** 22n,
    quote = row(
      "collateral_quote",
      { ...authParams, provision_id: id },
      {
        provision_id: id,
        wallet_pubkey: wallet,
        ciphertext_bytes: 1000,
        provider_quote_yocto: String(Q),
        binding_deposit_yocto: String(D),
        storage_refund_to: "minter.near",
      },
    ),
    out = {
      status: "success",
      provision_id: id,
      tx_hash: "fixture-binding",
      binding_ready: true,
      eligibility_sealed: true,
      deposit_yocto: String(D),
    },
    install = row(
      "provision_collateral",
      {
        ...authParams,
        provision_id: id,
        audit_message: msg,
        audit_signature: audit.audit_signature,
        max_deposit_yocto: String(D),
      },
      out,
      "reconcile_collateral",
    ),
    provision = row(
      "reconcile_collateral",
      { ...authParams, provision_id: id },
      out,
    );
  const restore = row(
    "withdraw_dry_run",
    {
      ...authParams,
      chain: "near",
      token: "usdc",
      amount: "100000",
      to: "alice.near",
    },
    {
      to: "alice.near",
      amount: "100000",
      token: "usdc",
      chain: "near",
      amount_out: "99000",
      min_amount_out: "98000",
      deadline: new Date((now + 300) * 1000).toISOString(),
      estimated_fee: "0.001",
      fee_token: "usdc",
      approval_and_cooldown_must_be_verified: true,
      broadcast: false,
    },
  );
  const approve = (action, extra = {}) => {
    const payload = {
      action,
      account: ACCOUNT,
      contract_sha256: CANDIDATE,
      worker_sha256: WORKER,
      expires_at: now + 600,
      ...extra,
    };
    return {
      payload,
      signature: release
        .sign("KEYHOLE_RELEASE_APPROVAL_V1\n" + canonical(payload))
        .toString("base64"),
    };
  };
  const e = {
    prepare,
    quote,
    install,
    provision,
    restore,
    audit,
    maintenance: approve("maintenance-and-drain", {
      gateway_aliases: ["/api/keyhole", "/api/worker"],
      direct_submitters: ["unit"],
      old_jobs: 0,
      unknown_native: 0,
      unknown_provider: 0,
    }),
    approval: approve("deploy-code-only-v26", {
      before_state_sha256: "1".repeat(64),
      protocol_config_sha256: "3".repeat(64),
      public_key: "ed25519:" + "2".repeat(44),
      nonce: "1",
      max_storage_yocto: "14050000000000000000000",
      max_gas_yocto: "30000000000000000000000",
      max_all_in_yocto: "44050000000000000000000",
    }),
    pilot_approval: approve("pilot-budget", {
      max_calls: 20,
      max_micro_usd: 230000,
      max_binding_yocto: String(D),
    }),
  };
  e.pause_acknowledgements = [
    {
      id: "unit",
      signature: submitter
        .sign("KEYHOLE_PAUSE_V1\n" + sha(canonical(e.maintenance.payload)))
        .toString("base64"),
    },
  ];
  ctx.binding = {
    ready: true,
    wallet_pubkey: wallet,
    encrypted_policy_hash: policyHash,
    policy_version: "1",
  };
  ctx.lower_policy = {
    owner: ACCOUNT,
    version: 1,
    locked: true,
    frozen: true,
    encrypted_data: encrypted,
  };
  const c = JSON.parse(
    readFileSync(
      new URL(
        "../../protocol/loan-certificate-v3-delivery.json",
        import.meta.url,
      ),
    ),
  ).certificate;
  Object.assign(c, {
    contract: ACCOUNT,
    network: "mainnet",
    token_id: "pilot",
    borrower: "alice.near",
    owner_epoch: "3",
    loan_nonce: "5",
    wallet_pubkey: wallet,
    policy_hash: policyHash,
    observed_at_ns: String(BigInt(now) * 1000000000n),
    expires_at_ns: String(BigInt(now + 25) * 1000000000n),
  });
  ctx.certificate_template = c;
  ctx.freeze_loan = {
    token_id: "pilot",
    borrower: "alice.near",
    terms: c.terms,
    nonce: "5",
    state: "Offered",
    policy_busy: false,
    policy_sequence: "1",
  };
  ctx.freeze_binding = { wallet_pubkey: wallet, policy_generation: "1" };
  ctx.frozen_policy = { frozen: true };
  e.certificate = row("loan_certificate", authParams, {
    certificate: c,
    signature: attestor.sign(certificateBytes(c)).toString("base64"),
  });
  const tx = graph("fixture-freeze", ACCOUNT, "alice.near");
  tx.transaction.actions = [
    {
      FunctionCall: {
        method_name: "open_loan",
        args: Buffer.from(
          JSON.stringify({ token_id: "pilot", terms: c.terms }),
        ).toString("base64"),
      },
    },
  ];
  const methods = [
    ["outlayer.near", "freeze_wallet", { wallet_pubkey: wallet }],
    [
      ACCOUNT,
      "on_policy_action",
      { token_id: "pilot", nonce: "5", sequence: "1" },
    ],
    [
      ACCOUNT,
      "on_loan_policy",
      { token_id: "pilot", nonce: "5", sequence: "1" },
    ],
  ];
  ctx.freeze_receipts = [];
  let parent = tx.receipts_outcome[0];
  for (let i = 0; i < methods.length; i++) {
    const [receiver, method, args] = methods[i],
      rid = "freeze" + i;
    parent.outcome.receipt_ids = [rid];
    parent.outcome.status = { SuccessReceiptId: rid };
    const node = {
      id: rid,
      block_hash: "fixture-block",
      outcome: {
        executor_id: receiver,
        receipt_ids: [],
        status: { SuccessValue: "" },
      },
    };
    tx.receipts_outcome.push(node);
    ctx.freeze_receipts.push({
      receipt_id: rid,
      receiver_id: receiver,
      receipt: {
        Action: {
          actions: [
            {
              FunctionCall: {
                method_name: method,
                args: Buffer.from(JSON.stringify(args)).toString("base64"),
              },
            },
          ],
        },
      },
    });
    parent = node;
  }
  e.freeze = { tx, hash: "fixture-freeze", token_id: "pilot" };
  const args = {
    accessor: { Project: { project_id: ACCOUNT + "/keyhole" } },
    profile: "default",
    encrypted_secrets_base64: Buffer.from(
      "synthetic secret ciphertext",
    ).toString("base64"),
    access: { Whitelist: { accounts: [ACCOUNT] } },
    vault_id: null,
  };
  const z = graph("fixture-secret", "outlayer.near");
  z.transaction.actions = [
    {
      FunctionCall: {
        method_name: "store_secrets",
        args: Buffer.from(JSON.stringify(args)).toString("base64"),
        deposit: String(10n ** 23n),
      },
    },
  ];
  z.receipts_outcome[0].outcome.receipt_ids = ["refund"];
  z.receipts_outcome.push({
    id: "refund",
    block_hash: "fixture-block",
    outcome: {
      executor_id: ACCOUNT,
      receipt_ids: [],
      status: { SuccessValue: "" },
    },
  });
  const S = 11n * 10n ** 21n,
    old = 1091n * 10n ** 19n,
    refund = 10n ** 23n + old - S;
  ctx.secret_merge = {
    hash: "fixture-secret",
    tx: z,
    row: {
      storage_deposit: String(S),
      accessor: args.accessor,
      access: args.access,
      encrypted_sha256: sha(
        Buffer.from(args.encrypted_secrets_base64, "base64"),
      ),
    },
    receipts: [
      {
        receipt_id: "refund",
        predecessor_id: "outlayer.near",
        receiver_id: ACCOUNT,
        receipt: {
          Action: { actions: [{ Transfer: { deposit: String(refund) } }] },
        },
      },
    ],
  };
  e.publication_approval = approve("worker-publication", {
    secret_args_sha256: sha(canonical(args)),
    previous_secret_deposit_yocto: String(old),
    max_secret_storage_yocto: String(S),
    expected_secret_refund_yocto: String(refund),
  });
  e.inventory = row("pledge_inventory", authParams, {
    account: "alice.near",
    token_id: "pilot",
    owner_epoch: "3",
    complete: true,
    eligible_pending_zero: true,
    obligations: [],
    withdraw_cooldown_until_ms: null,
    observed_at_ns: String(BigInt(now) * 1000000000n),
  });
  ctx.snapshot = {
    code: { sha256: CANDIDATE },
    config: { minter: attestor.raw.toString("hex") },
    pledge: { ...ctx.pledge, lending_enabled: false },
  };
  e.info = row("info", {}, { minter_account: ctx.snapshot.config.minter });
  e.compute_ledger = [
    e.info,
    e.inventory,
    prepare,
    quote,
    install,
    provision,
    restore,
    e.certificate,
  ].map((r) => ({
    call_id: r.call_id,
    op: r.input.op,
    limit_micro_usd: 10000,
    status: "SUCCESS",
  }));
  return {
    e,
    ctx,
    trust: {
      auditor_public_key: auditor.pk,
      release_public_key: release.pk,
      direct_submitters: [{ id: "unit", public_key: submitter.pk }],
    },
    row,
    approve,
  };
}
