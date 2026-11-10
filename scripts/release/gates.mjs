// Fail-closed evidence validators. Missing execution-time evidence is FAIL, never PASS.
import {PHASES,PREVIOUS,approvedSubject} from './lifecycle.mjs';
import { createPublicKey, verify } from "node:crypto";
import {
  canonical,
  sha,
  requireThat as must,
  ACCOUNT,
  WORKER,
  finalGraph,
} from "./promotion-lib.mjs";
export const EXECUTION =
  "satisfied at execution time, verified by the post-check";
const key = (b) => {
  must(b?.length === 32, "public key required");
  return createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), b]),
    format: "der",
    type: "spki",
  });
};
export function signature(publicKey, message, sig) {
  return verify(
    null,
    Buffer.from(message),
    key(Buffer.from(publicKey || "", "base64")),
    Buffer.from(sig || "", "base64"),
  );
}
export async function attested(
  row,
  op,
  { now = Math.floor(Date.now() / 1000), fetchAttestation } = {},
  outputOp = op,
  requireSuccess = true,
) {
  must(
    row?.input?.op === op &&
      row.output?.op === outputOp &&
      (requireSuccess
        ? row.output.ok === true
        : typeof row.output.ok === "boolean"),
    "wrong or failed guarded operation",
  );
  must(/^[0-9a-f-]{36}$/.test(row.call_id || ""), "call ID missing");
  const a = await fetchAttestation(row.call_id);
  must(
    a.call_id === row.call_id &&
      a.project_id === ACCOUNT + "/keyhole" &&
      a.wasm_hash === WORKER &&
      a.executed_wasm_sha256 === WORKER,
    "wrong measured worker/project",
  );
  must(
    a.timestamp <= now + 30 &&
      now - a.timestamp <= 300 &&
      a.tdx_quote?.length > 100 &&
      /^[0-9a-f]{96}$/.test(a.worker_measurement || ""),
    "stale/missing attestation",
  );
  must(
    a.input_hash === sha(canonical(row.input)) &&
      a.output_hash === sha(canonical(row.output)),
    "attested input/output hash mismatch",
  );
  return a;
}
export function registry(s) {
  must(
    s?.uuid === "p000000000000004b" &&
      s.project_id === ACCOUNT + "/keyhole" &&
      s.active_version === WORKER &&
      s.count === 1 &&
      s.versions?.length === 1,
    "registry not singleton/pinned",
  );
  const v = s.versions[0];
  must(
    v.wasm_hash === WORKER &&
      v.is_active === true &&
      v.source?.WasmUrl?.hash === WORKER,
    "registry source hash mismatch",
  );
}
export async function restoreProbe(p, ctx) {
  registry(ctx.registry);
  await attested(p, "withdraw_dry_run", ctx);
  must(p.input.auth?.scheme === "nep413", "fresh NEP-413 probe required");
  const message = JSON.parse(p.input.auth.message),
    params = message.params,
    o = p.output;
  must(
    message.op === "withdraw_dry_run" &&
      params.token_id === ctx.token.token_id &&
      message.account_id === ctx.token.owner_id &&
      params.owner_epoch === ctx.control.owner_epoch,
    "holder/epoch mismatch",
  );
  must(
    params.chain === "near" &&
      params.to === ctx.token.owner_id &&
      o.to === params.to &&
      o.chain === "near" &&
      o.token === params.token &&
      o.amount === params.amount,
    "self-route/request mismatch",
  );
  must(
    /^[1-9][0-9]*$/.test(params.amount) &&
      BigInt(o.amount_out) > 0n &&
      BigInt(o.min_amount_out) > 0n &&
      o.broadcast === false &&
      o.approval_and_cooldown_must_be_verified === true,
    "not a positive read-only preview",
  );
  must(
    ctx.control.pending_value_ops === "0" &&
      !ctx.control.transfer_pending &&
      !ctx.control.pledged &&
      !ctx.control.listed,
    "control not idle",
  );
  // Success from these exact measured bytes implies BOTH guard_preflight and strict
  // guarded_wallet ran; an account/info result can never be substituted.
  return true;
}
export function auditEvidence(e, trust, now) {
  const a = JSON.parse(e.audit_message);
  must(
    trust?.auditor_public_key &&
      signature(
        trust.auditor_public_key,
        "KEYHOLE_COLLATERAL_AUDIT_V1\n" + e.audit_message,
        e.audit_signature,
      ),
    "unapproved audit signature",
  );
  must(
    a.domain === "KEYHOLE_COLLATERAL_AUDIT_V1" &&
      a.project_uuid === "p000000000000004b" &&
      a.contract === ACCOUNT &&
      a.provision_id === e.provision_id,
    "audit context mismatch",
  );
  must(
    sha(e.report) === a.authority_audit_sha256 && e.report.length > 0,
    "actual audit report missing",
  );
  must(
    Object.keys(a).length === 13 && Buffer.byteLength(e.audit_message) <= 4096,
    "audit schema",
  );
  must(
    a.issued_at_sec <= now &&
      a.expires_at_sec > now &&
      a.expires_at_sec - a.issued_at_sec <= 900,
    "stale audit",
  );
  for (const f of [
    "no_presigned_authorities",
    "all_aliases_reviewed",
    "old_jobs_drained",
    "external_chain_authorities_reviewed",
    "effective_policy_reviewed",
    "reachable_quorum_verified",
  ])
    must(a[f] === true, "audit incomplete");
  return true;
}
// The artifact/signature stays SEALED. Attested preparation proves the reviewed
// worker validated the real caller-bound provider signature; never export it here.
export async function policyArtifact(e, ctx) {
  await attested(e, "prepare_collateral", ctx);
  const p = e.output,
    message = JSON.parse(e.input.auth.message),
    params = message.params;
  must(
    p.token_id === ctx.token.token_id &&
      message.account_id === ctx.token.owner_id &&
      p.owner_epoch === ctx.control.owner_epoch,
    "stale artifact holder/epoch",
  );
  must(
    e.input.auth.scheme === "nep413" &&
      /^[0-9a-f]{64}$/.test(p.provision_id) &&
      /^ed25519:[0-9a-f]{64}$/.test(p.wallet_pubkey),
    "missing real sealed artifact commitment",
  );
  must(
    p.version === 1 &&
      p.valid_until > (ctx.now ?? Math.floor(Date.now() / 1000)) + 60 &&
      /^[0-9a-f]{64}$/.test(p.plaintext_hash) &&
      Buffer.from(p.policy_hash, "base64").length === 32 &&
      p.authority_review_required === true,
    "invalid/stale artifact",
  );
  must(
    params.token_id === p.token_id &&
      String(params.owner_epoch) === p.owner_epoch &&
      params.approvers?.length > 0 &&
      Number.isInteger(params.threshold) &&
      params.threshold > 0 &&
      params.threshold <= params.approvers.length &&
      new Set(params.approvers.map((a) => a.id)).size ===
        params.approvers.length,
    "unreachable quorum",
  );
  return p;
}
export function approval(e, trust, action, now) {
  const p = e?.payload;
  must(
    p?.action === action &&
      p.account === ACCOUNT &&
      p.contract_sha256 ===
        "54ba51b3d7d256820e751c9fa4e0cda55c66b30111a186c6d9eff03b561b7b8a" &&
      p.worker_sha256 === WORKER &&
      p.expires_at > now &&
      p.expires_at - now <= 900,
    "wrong/stale approval",
  );
  must(
    signature(
      trust?.release_public_key,
      "KEYHOLE_RELEASE_APPROVAL_V1\n" + canonical(p),
      e.signature,
    ),
    "separate release approval missing",
  );
  return p;
}
export async function releaseGates(e = {}, trust = {}, ctx = {}) {
  const now = ctx.now ?? Math.floor(Date.now() / 1000), rows=[];
  const phase=ctx.phase||"all";must(phase==="all"||PHASES.includes(phase),"unknown release phase");
  if(phase==='all'){
   const combined=[];for(const stage of PHASES){try{if(stage==='pilot-post'){const r=await releaseGates(e,trust,{...ctx,phase:stage});combined.push(...r.rows);}else{const v=await ctx.verifyCheckpoint(e.checkpoints?.[stage],stage,trust);const r=await releaseGates(v.evidence,trust,{...v.ctx,phase:stage});combined.push(...r.rows);}}catch{combined.push({name:stage+'_checkpoint',phase:stage,status:'FAIL',when:stage==='predeploy'?'required before execution':EXECUTION});}}
   return {ready:combined.every(r=>r.status==='PASS'),phase_ready:combined.every(r=>r.status==='PASS'),all_mainnet_ready:combined.every(r=>r.status==='PASS'),ready_deploy:false,ready_restore:false,rows:combined};
  }
  const add = async (name, rowPhase, f) => {
    if(phase!=="all"&&rowPhase!==phase)return;
    const phaseName=rowPhase;
    try {
      await f();
      rows.push({
        name,
        status: "PASS",
        phase:phaseName,
        when: phaseName === "predeploy" ? "required before execution" : EXECUTION,
      });
    } catch {
      rows.push({
        name,
        status: "FAIL",
        phase:phaseName,
        when: phaseName === "predeploy" ? "required before execution" : EXECUTION,
      });
    }
  };
  if(PREVIOUS[phase])await add('original_'+PREVIOUS[phase]+'_checkpoint',phase,async()=>{const previous=await ctx.verifyCheckpoint(e.checkpoints?.[PREVIOUS[phase]],PREVIOUS[phase],trust);must(previous.block.height<=ctx.snapshot.block.height,'phase replay/reversed block');ctx.previous=previous;if(['provision-post','pilot-post'].includes(phase)){const old=approvedSubject(previous.evidence,previous.ctx);const current=approvedSubject(e,ctx,phase==='pilot-post');approval(e.pilot_approval,trust,'pilot-budget',now);must(canonical(old)===canonical(current),'foreign/replayed pilot checkpoint');}});
  await add('code_only_deployment_postcheck','deploy-post',async()=>{await ctx.verifyContractPost(e.contract_post);must(e.contract_post.after.block.height<=ctx.snapshot.block.height,'deployment checkpoint interval');});
  await add("maintenance_and_submitter_drain", phase==="restore"?"restore":"predeploy", () => {
    const p = approval(e.maintenance, trust, "maintenance-and-drain", now),
      aliases = ["/api/keyhole", "/api/worker"];
    must(
      canonical(p.gateway_aliases) === canonical(aliases) &&
        p.old_jobs === 0 &&
        p.unknown_native === 0 &&
        p.unknown_provider === 0,
      "pause/drain missing",
    );
    must(
      trust.direct_submitters?.length > 0 &&
        canonical([...p.direct_submitters].sort()) ===
          canonical(trust.direct_submitters.map((x) => x.id).sort()),
      "every reviewed submitter required",
    );
    for (const t of trust.direct_submitters) {
      const a = e.pause_acknowledgements?.find((x) => x.id === t.id);
      must(
        signature(
          t.public_key,
          "KEYHOLE_PAUSE_V1\n" + sha(canonical(p)),
          a?.signature,
        ),
        "submitter acknowledgement missing",
      );
    }
    must(ctx.alias_checks?.length === 2, "fresh alias checks missing");
    must(p.barrier_sha256===sha(canonical(ctx.alias_checks))&&canonical(e.barrier_observation)===canonical(ctx.alias_checks),"signed barrier observation mismatch");
    for (let i = 0; i < 2; i++)
      must(
        ctx.alias_checks[i].path === aliases[i] &&
          ctx.alias_checks[i].status === 503 &&
          ctx.alias_checks[i].cache_control === "no-store",
        "admission barrier failed",
      );
  });
  await add("native_all_in_approval", "predeploy", () => {
    const a = approval(e.approval, trust, "deploy-code-only-v26", now);
    must(
      /^[0-9a-f]{64}$/.test(a.protocol_config_sha256 || "") &&
        a.protocol_config_sha256 === ctx.protocol_config_sha256,
      "unreviewed protocol fees",
    );
    must(
      a.before_state_sha256===sha(canonical(ctx.approved_snapshot||ctx.snapshot)) &&
        /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(a.public_key || "") &&
        /^[1-9][0-9]*$/.test(a.nonce || ""),
      "native approval lacks exact snapshot/key/nonce",
    );
    must(
      BigInt(a.max_storage_yocto) >= 1405n * 10n ** 19n &&
        BigInt(a.max_gas_yocto) >= 300000000000000n * BigInt(ctx.gas_price) &&
        BigInt(a.max_all_in_yocto) >=
          BigInt(a.max_storage_yocto) + BigInt(a.max_gas_yocto) &&
        BigInt(ctx.native_available_yocto) >= BigInt(a.max_all_in_yocto),
      "native ceiling/backing",
    );
  });
  if(['provision-pre','provision-post','pilot-post'].includes(phase))await add('current_release_authority',phase,()=>{registry(ctx.registry);must(ctx.snapshot.code.sha256==='54ba51b3d7d256820e751c9fa4e0cda55c66b30111a186c6d9eff03b561b7b8a'&&ctx.pledge.network==='mainnet'&&Buffer.from(ctx.pledge.attestor_public_key,'base64').toString('hex')===ctx.snapshot.config.minter,'live code/immutable authority mismatch');});
  await add("reviewer_audit_report_quorum", "provision-pre", () => {
    auditEvidence(e.audit, trust, now);approvedSubject(e,ctx);
    must(
      e.audit.provision_id === e.prepare.output.provision_id,
      "audit not sealed artifact",
    );
  });
  await add("provider_policy_artifact", "provision-pre", () =>
    policyArtifact(e.prepare, ctx),
  );
  await add("funding_and_actual_Q", "provision-pre", async () => {
    await attested(e.quote, "collateral_quote", ctx);
    const q = e.quote.output,
      p = e.prepare.output,
      a = approval(e.pilot_approval, trust, "pilot-budget", now);
    must(
      q.provision_id === p.provision_id &&
        q.wallet_pubkey === p.wallet_pubkey &&
        Number.isSafeInteger(q.ciphertext_bytes) &&
        q.ciphertext_bytes > 0 &&
        q.ciphertext_bytes <= 4096,
      "quote not actual artifact",
    );
    const Q = (BigInt(q.ciphertext_bytes) + 523n) * 10n ** 19n,
      D = Q + 2n * 10n ** 22n;
    must(
      BigInt(q.provider_quote_yocto) === Q &&
        BigInt(q.binding_deposit_yocto) === D &&
        D <= BigInt(a.max_binding_yocto) &&
        q.storage_refund_to === ctx.minter_account &&
        a.max_binding_yocto && ctx.binding===null,
      "Q or approved D mismatch",
    );
    const f = ctx.funding;
    must(
      f &&
        BigInt(f.available_after_storage_and_liabilities) >=
          D + 10n ** 23n,
      "unbacked minter reserve",
    );
    must(
      Number.isInteger(a.max_calls) &&
        a.max_calls > 0 &&
        a.max_calls <= 20 &&
        Number.isInteger(a.max_micro_usd) &&
        a.max_micro_usd > 0 &&
        a.max_micro_usd <= 230000 &&
        e.compute_ledger?.length <= a.max_calls,
      "compute cap missing",
    );
    let total = 0,
      index = 0;
    const ids = new Set();
    for (const r of e.compute_ledger) {
      must(
        /^[0-9a-f-]{36}$/.test(r.call_id || "") &&
          !ids.has(r.call_id) &&
          ["SUCCESS", "FAIL", "UNKNOWN"].includes(r.status),
        "unique original compute ledger required",
      );
      ids.add(r.call_id);
      must(
        Number.isSafeInteger(r.limit_micro_usd) &&
          r.limit_micro_usd > 0 &&
          r.limit_micro_usd <=
            (index++ === 0 && r.op === "info" ? 40000 : 10000),
        "per-call cap",
      );
      total += r.limit_micro_usd;
    }
    for (const r of [
      e.prepare,
      e.quote,
      e.install,
      e.provision,
      e.restore,
      e.inventory,
      e.certificate,
      e.info,
    ].filter(Boolean))
      must(ids.has(r.call_id), "omitted call ledger");
    must(
      total <= a.max_micro_usd &&
        ctx.compute_balance?.available >= a.max_micro_usd &&
        ctx.compute_balance.reserved === 0,
      "compute money/cap missing",
    );
  });
  await add(
    "configured_auditor_and_sealed_eligibility",
    "provision-post",
    async () => {
      must(
        ["provision_collateral", "reconcile_collateral"].includes(
          e.provision?.input?.op,
        ),
        "not provisioning",
      );
      const completed=await attested(
        e.provision,
        e.provision.input.op,
        ctx,
        "reconcile_collateral",
      );
      must(
        e.provision.output.provision_id === e.audit.provision_id &&
          e.provision.output.eligibility_sealed === true &&
          e.provision.output.binding_ready === true &&
          e.provision.output.status === "success",
        "key/seal not proved",
      );
      const preview=await attested(e.restore,"withdraw_dry_run",ctx),inventory=await attested(e.inventory,"pledge_inventory",ctx);must(preview.timestamp>=completed.timestamp&&inventory.timestamp>=completed.timestamp,"exit/inventory predates completed provision");
      // Include the original attested provision request even if read-only reconcile completed later.
      await attested(
        e.install,
        "provision_collateral",
        ctx,
        "reconcile_collateral",
        false,
      );
      must(
        e.install.output.ok === true || e.install.output.status === "UNKNOWN",
        "original provisioning did not reach dispatch",
      );
      const p = JSON.parse(e.install.input.auth.message).params;
      must(
        p.audit_message === e.audit.audit_message &&
          p.audit_signature === e.audit.audit_signature &&
          p.provision_id === e.audit.provision_id,
        "configured auditor not tied to actual request",
      );
    },
  );
  await add("singleton_registry_and_guarded_restore", phase==="provision-post"?"provision-post":"restore", () =>
    restoreProbe(e.restore, ctx),
  );
  await add("lower_policy_and_binding", "provision-post", () => {
    const b = ctx.binding,
      p = e.prepare.output,
      o = ctx.lower_policy;
    must(
      b?.ready === true &&
        b.wallet_pubkey === p.wallet_pubkey &&
        b.encrypted_policy_hash === p.policy_hash &&
        b.policy_version === "1",
      "binding mismatch",
    );
    must(
      o?.owner === ACCOUNT &&
        o.version === 1 &&
        o.locked === true &&
        o.frozen === false &&
        Buffer.from(sha(o.encrypted_data), "hex").toString("base64") ===
          p.policy_hash,
      "fresh lower policy mismatch",
    );
  });
  await add(
    "genuine_freeze_and_attestor_continuity",
    "pilot-post",
    async () => {
      const f = e.freeze;
      const target=approvedSubject(e,ctx,true),certificate=e.certificate.output.certificate;must(e.freeze.token_id===target.token_id&&ctx.freeze_loan.token_id===target.token_id&&ctx.control.pledged===true,'not the approved Offered pilot');must(ctx.freeze_loan.owner_epoch===target.owner_epoch&&ctx.freeze_binding.wallet_pubkey===target.wallet_pubkey&&ctx.freeze_binding.encrypted_policy_hash===target.policy_hash&&ctx.freeze_binding.policy_version===target.policy_version,'foreign loan binding/epoch');must(ctx.freeze_start_height>ctx.previous.block.height&&ctx.freeze_end_height<=ctx.certificate_block.height&&ctx.certificate_block.height<=ctx.snapshot.block.height,'phase/freeze/certificate block interval');must(canonical(e.certificate.block)===canonical(ctx.certificate_block)&&BigInt(ctx.certificate_block.timestamp)/1000000n*1000000n===BigInt(certificate.observed_at_ns),'certificate not bound to exact observed block');must(certificate.token_id===target.token_id&&certificate.wallet_pubkey===target.wallet_pubkey&&certificate.owner_epoch===target.owner_epoch&&certificate.borrower===target.owner&&certificate.policy_hash===target.policy_hash&&certificate.policy_version===target.policy_version&&certificate.contract===target.contract&&certificate.network===target.network&&certificate.domain==='KEYHOLE_SEALED_LOAN_V3_DELIVERY'&&certificate.loan_nonce===target.loan_nonce&&canonical(certificate.terms)===canonical(target.terms),'foreign certificate/approved terms');must(e.certificate.input.params?.token_id===target.token_id&&e.certificate.input.params.loan_nonce===target.loan_nonce&&Object.keys(e.certificate.input.params).length===2,'wrong certificate request');must(ctx.frozen_policy.owner===ACCOUNT&&ctx.frozen_policy.locked===true&&ctx.frozen_policy.version===Number(target.policy_version)&&Buffer.from(sha(ctx.frozen_policy.encrypted_data),'hex').toString('base64')===target.policy_hash,'foreign frozen policy');
      finalGraph(f.tx, f.hash, ACCOUNT, [ctx.pledge.custody_contract]);
      const a = f.tx.transaction.actions;
      must(
        a?.length === 1 && a[0].FunctionCall?.method_name === "open_loan",
        "not an original loan",
      );
      const p = JSON.parse(Buffer.from(a[0].FunctionCall.args, "base64")),
        loan = ctx.freeze_loan;
      must(
        p.token_id === loan.token_id &&
          canonical(p.terms) === canonical(target.terms) && canonical(loan.terms)===canonical(target.terms) &&
          f.tx.transaction.signer_id === loan.borrower,
        "wrong loan",
      );
      must(
        loan.state === "Offered" &&
          loan.policy_busy === false &&
          BigInt(loan.policy_sequence) > 0n &&
          ctx.freeze_binding.policy_generation === loan.policy_sequence &&
          ctx.frozen_policy.frozen === true,
        "freeze not confirmed",
      );
      const bodies = ctx.freeze_receipts;
      must(Array.isArray(bodies), "original freeze receipt bodies required");
      for (const r of bodies)
        must(
          f.tx.receipts_outcome.some((n) => n.id === r.receipt_id),
          "unrelated freeze receipt",
        );
      let froze = 0,
        callbacks = new Set();
      for (const r of bodies)
        for (const a of r.receipt?.Action?.actions || []) {
          const v = a.FunctionCall;
          if (!v) continue;
          const args = JSON.parse(Buffer.from(v.args, "base64"));
          if (
            r.receiver_id === ctx.pledge.custody_contract &&
            v.method_name === "freeze_wallet"
          ) {
            must(
              args.wallet_pubkey === ctx.freeze_binding.wallet_pubkey,
              "wrong frozen wallet",
            );
            froze++;
          }
          if (
            r.receiver_id === ACCOUNT &&
            ["on_policy_action", "on_loan_policy"].includes(v.method_name)
          ) {
            must(
              args.token_id === loan.token_id &&
                args.nonce === loan.nonce &&
                args.sequence === loan.policy_sequence,
              "wrong original freeze callback generation",
            );
            callbacks.add(v.method_name);
          }
        }
      must(
        froze === 1 && callbacks.size === 2,
        "original lower freeze/callback lineage missing",
      );
      await attested(e.certificate, "loan_certificate", ctx);
      const c = e.certificate.output.certificate;
      must(
        canonical(c) === canonical(ctx.certificate_template) &&
          c.contract === ACCOUNT &&
          c.loan_nonce === loan.nonce &&
          c.frozen === true &&
          c.floor_met === true &&
          c.pending_value_ops === "0" &&
          BigInt(c.observed_at_ns) <= BigInt(ctx.snapshot.block.timestamp) &&
          BigInt(c.expires_at_ns) > BigInt(ctx.historical?now:Math.floor(Date.now()/1000)) * 1000000000n,
        "certificate not current loan",
      );
      must(
        signature(
          ctx.pledge.attestor_public_key,
          certificateBytes(c),
          e.certificate.output.signature,
        ),
        "attestor continuity missing",
      );
    },
  );
  await add("complete_inventory_and_exit_cooldown", phase==="provision-post"?"provision-post":"provision-pre", async () => {
    await attested(e.inventory, "pledge_inventory", ctx);
    const o = e.inventory.output;
    must(
      o.token_id === ctx.token.token_id &&
        o.account === ctx.token.owner_id &&
        o.owner_epoch === ctx.control.owner_epoch &&
        o.complete === true &&
        o.eligible_pending_zero === true &&
        o.obligations?.length === 0,
      "incomplete/pending inventory",
    );
    must(
      o.withdraw_cooldown_until_ms === null ||
        (Number.isSafeInteger(o.withdraw_cooldown_until_ms) &&
          o.withdraw_cooldown_until_ms <= now * 1000),
      "exit cooldown active/unknown",
    );
    must(
      BigInt(o.observed_at_ns) <= BigInt(now + 30) * 1000000000n &&
        BigInt(o.observed_at_ns) >= BigInt(now - 300) * 1000000000n,
      "stale inventory",
    );
  });
  await add("exit_route_fee_deadline", phase==="provision-post"?"provision-post":"restore", async () => {
    await restoreProbe(e.restore, ctx);
    must(
      Date.parse(e.restore.output.deadline) > now * 1000 &&
        e.restore.output.estimated_fee != null &&
        e.restore.output.fee_token,
      "real exit fee/deadline absent",
    );
  });
  await add("secret_storage_and_actual_refund", "restore", () => {
    const z = ctx.secret_merge,
      a = approval(e.publication_approval, trust, "worker-publication", now);
    finalGraph(z.tx, z.hash, "outlayer.near");
    const actions = z.tx.transaction.actions;
    must(
      z.tx.transaction.signer_id === ACCOUNT &&
        actions.length === 1 &&
        actions[0].FunctionCall.method_name === "store_secrets",
      "not secret merge",
    );
    const f = actions[0].FunctionCall,
      p = JSON.parse(Buffer.from(f.args, "base64"));
    must(
      canonical(p.accessor) ===
        canonical({ Project: { project_id: ACCOUNT + "/keyhole" } }) &&
        p.profile === "default" &&
        sha(canonical(p)) === a.secret_args_sha256,
      "unapproved secret slot/arguments",
    );
    must(
      canonical(z.row.accessor) === canonical(p.accessor) &&
        canonical(z.row.access) === canonical(p.access) &&
        canonical(p.access) ===
          canonical({ Whitelist: { accounts: [ACCOUNT] } }) &&
        z.row.encrypted_sha256 ===
          sha(Buffer.from(p.encrypted_secrets_base64, "base64")),
      "current secret row differs from approved original",
    );
    for (const r of z.receipts)
      must(
        z.tx.receipts_outcome.some((n) => n.id === r.receipt_id),
        "unrelated refund receipt",
      );
    const S = BigInt(z.row.storage_deposit),
      expected =
        BigInt(f.deposit) + BigInt(a.previous_secret_deposit_yocto) - S;
    must(
      S <= BigInt(a.max_secret_storage_yocto) &&
        expected >= 0n &&
        expected === BigInt(a.expected_secret_refund_yocto),
      "storage/refund ceiling",
    );
    const refunds = z.receipts
      .filter(
        (r) =>
          r.predecessor_id === "outlayer.near" &&
          r.receiver_id === ACCOUNT &&
          r.receipt?.Action?.actions?.length === 1 &&
          r.receipt.Action.actions[0].Transfer,
      )
      .map((r) => BigInt(r.receipt.Action.actions[0].Transfer.deposit));
    must(
      (expected === 0n && refunds.length === 0) ||
        (refunds.length === 1 && refunds[0] === expected),
      "actual original refund not proved",
    );
  });
  const pass=rows.length>0&&rows.every(r=>r.status==='PASS');return {ready:pass,phase_ready:pass,all_mainnet_ready:phase==='pilot-post'&&pass,ready_deploy:phase==='predeploy'&&pass,ready_restore:phase==='restore'&&pass,phase,rows};
}

// Exact Rust Borsh schema; vector-tested against the existing certificate fixture.
export function certificateBytes(c) {
  const out = [];
  const n = (v, w) => {
    must(typeof v === "string" && /^\d+$/.test(v), "exact integer");
    let x = BigInt(v);
    must(x < 1n << BigInt(w * 8), "overflow");
    for (let i = 0; i < w; i++) {
      out.push(Number(x & 255n));
      x >>= 8n;
    }
  };
  const bytes = (b) => {
    n(String(b.length), 4);
    out.push(...b);
  };
  const text = (s) => {
    must(typeof s === "string", "text");
    bytes(Buffer.from(s));
  };
  for (const v of [c.domain, c.network, c.contract, c.token_id]) text(v);
  n(c.loan_nonce, 8);
  text(c.borrower);
  n(c.owner_epoch, 8);
  text(c.terms.lender);
  for (const [v, w] of [
    [c.terms.principal, 16],
    [c.terms.repayment, 16],
    [c.terms.duration_sec, 8],
    [c.terms.grace_sec, 8],
    [c.terms.floor_raw, 16],
    [c.terms.funding_deadline_ns, 8],
  ])
    n(v, w);
  text(c.asset);
  text(c.wallet_pubkey);
  n(c.policy_version, 8);
  const h = Buffer.from(c.policy_hash, "base64");
  must(h.length === 32, "digest");
  bytes(h);
  n(c.observed_at_ns, 8);
  n(c.expires_at_ns, 8);
  for (const b of [c.floor_met, c.frozen]) {
    must(typeof b === "boolean", "boolean");
    out.push(b ? 1 : 0);
  }
  n(c.pending_value_ops, 8);
  return Buffer.from(out);
}
export async function fetchAttestation(id) {
  must(/^[0-9a-f-]{36}$/.test(id), "call ID");
  const r = await fetch("https://api.outlayer.ai/attestations/by-call/" + id, {
    signal: AbortSignal.timeout(30000),
  });
  must(r.ok, "attestation unavailable");
  return r.json();
}
