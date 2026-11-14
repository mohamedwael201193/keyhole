// Included in WASI host. Every write below is enclave storage or an explicitly
// holder-authorized production operation; native unit/sandbox tests never call it.
use keyhole_worker::collateral::{self, Prepared};
use keyhole_worker::collateral_evidence::{self as evidence, PreAudit};
fn provision_root(token: &str, epoch: u64) -> String {
    collateral::provision_root(token, epoch)
}
fn provision_idle(token: &str) -> Result<(), Error> {
    evidence::idle(&mut Host, token)?;
    collateral::assert_provision_idle(&mut Host, token, guard_control(token)?.epoch)
}
fn provision_auth(input: &Value, op: &str) -> Result<(Ctx, Control), Error> {
    if input.pointer("/auth/scheme").and_then(Value::as_str) != Some("nep413") {
        return Err(err(
            "no_auth",
            "fresh full-access NEP-413 signature required",
        ));
    }
    let c = authenticate(input, op, true)?;
    let control = guard_control(&c.token_id())?;
    if op != "reconcile_collateral" {
        control.admit()?;
    }
    guarded::signed_epoch(&c.req.params, control.epoch)?;
    guard_registry()?;
    if view(
        &keys_contract(),
        "get_loan",
        json!({"token_id":c.token_id()}),
    )? != Value::Null
    {
        return Err(err("collateral_ineligible", "loan exists"));
    }
    let cfg = view(&keys_contract(), "get_pledge_config", json!({}))?;
    if cfg["network"] != "mainnet" || cfg["custody_contract"] != "outlayer.near" {
        return Err(err("collateral_ineligible", "wrong custody domain"));
    }
    if view(
        &keys_contract(),
        "collateral_registration_protocol",
        json!({}),
    )? != json!(2)
    {
        return Err(err(
            "collateral_ineligible",
            "reviewed owner/epoch-CAS contract release required",
        ));
    }
    guarded_minter()?;
    Ok((c, control))
}
fn provision_unchanged(c: &Ctx, control: &Control) -> Result<(), Error> {
    if !owns(&c.token_id(), &c.account)? || guard_control(&c.token_id())? != *control {
        return Err(err(
            "epoch_changed",
            "title/control changed during provisioning",
        ));
    }
    guard_registry()
}
fn load_prepared(token: &str, epoch: u64) -> Result<Prepared, Error> {
    serde_json::from_slice(&Store::read(
        &mut Host,
        &format!("{}/prepared", provision_root(token, epoch)),
    )?)
    .map_err(|_| {
        err(
            "collateral_unknown",
            "no completed preparation; do not repeat a lost provider POST",
        )
    })
}
fn prepared_summary(p: &Prepared) -> Value {
    json!({"ok":true,"op":"prepare_collateral","provision_id":p.id(),"wallet_pubkey":p.wallet_pubkey,
    "token_id":p.token_id,"owner_epoch":p.owner_epoch.to_string(),"policy_hash":p.policy_hash(),"plaintext_hash":p.plaintext_hash,
    "version":p.version,"valid_until":p.valid_until,"authority_review_required":true})
}
fn op_prepare_collateral(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "prepare_collateral")?;
    let token = c.token_id();
    let k = provision_root(&token, control.epoch);
    if !Store::read(&mut Host, &format!("{k}/prepared"))?.is_empty() {
        let p = load_prepared(&token, control.epoch)?;
        if p.owner != c.account || p.owner_epoch != control.epoch {
            return Err(err(
                "epoch_changed",
                "preparation belongs to previous title",
            ));
        }
        let expected: Value =
            serde_json::from_slice(&Store::read(&mut Host, &format!("{k}/expected_policy"))?)
                .map_err(|_| err("evidence", "candidate missing"))?;
        let guardian = if let Some(a) = c.req.params.get("guardian_proof") {
            observe_guardian(&c, &control, &expected, &p.wallet_pubkey, a)?
        } else {
            serde_json::from_slice(&Store::read(&mut Host, &format!("{k}/guardian"))?)
                .map_err(|_| err("guardian", "original guardian missing"))?
        };
        provision_unchanged(&c, &control)?;
        return prepared_review_summary(&p, guardian);
    }
    let (key, id) = guarded_wallet(&token)?;
    let rec: Value = serde_json::from_slice(&Store::read(&mut Host, &tkey(&token, "wallet"))?)
        .map_err(|_| err("storage", "canonical wallet missing"))?;
    let wallet_id = guarded::text(&rec, "wallet_id")?;
    let approvers = c
        .req
        .params
        .get("approvers")
        .ok_or_else(|| err("bad_params", "approvers required"))?;
    let threshold = c.req.params["threshold"]
        .as_u64()
        .ok_or_else(|| err("bad_params", "threshold integer required"))?;
    let manifest = evidence_manifest(&token)?;
    let policy = evidence::admin_policy(wallet_id, &key, approvers, threshold)?;
    if manifest.owner != c.account
        || manifest.owner_epoch != control.epoch
        || manifest.wallet_pubkey != format!("ed25519:{id}")
        || manifest.api_key_sha256 != sha256_hex(&key)
    {
        return Err(err(
            "evidence",
            "fresh creation owner/epoch/custody mismatch",
        ));
    }
    let guardian = observe_guardian(
        &c,
        &control,
        &policy,
        &format!("ed25519:{id}"),
        &c.req.params["guardian_proof"],
    )?;
    if view(
        &keys_contract(),
        "get_collateral_binding",
        json!({"token_id":token}),
    )? != Value::Null
        || view(
            &keys_contract(),
            "get_pending_registration",
            json!({"token_id":token}),
        )? != Value::Null
        || view(
            "outlayer.near",
            "get_wallet_policy",
            json!({"wallet_pubkey":format!("ed25519:{id}")}),
        )? != Value::Null
    {
        return Err(err(
            "collateral_ineligible",
            "fresh unbound policy required; no update/backfill",
        ));
    }
    certificate_inventory(&key)?;
    provision_unchanged(&c, &control)?;
    // If a prior prepare already stored the ciphertext, reuse it and never
    // POST encrypt-policy again. A claimed marker with no ciphertext (live
    // call c797d97c: exact `ed25519:`+hex compare failed after a possible
    // 200) is hollow — clear it so one encrypt POST can run and be stored.
    // Already-journaled guardian / expected_policy are kept (put_once of a
    // new guardian nonce would conflict).
    let stored = Store::read(&mut Host, &format!("{k}/encrypted"))?;
    let encrypted = if collateral::reuse_encrypt_result(!stored.is_empty()) {
        serde_json::from_slice(&stored).map_err(|_| err("storage", "encrypted policy corrupt"))?
    } else {
        if collateral::hollow_encrypt_claim(
            !Store::read(&mut Host, &format!("{k}/claimed"))?.is_empty(),
            false,
        ) {
            Host.remove(&format!("{k}/claimed"))?;
        }
        if !Host.set_if_absent(&format!("{k}/claimed"), c.operation_id.as_bytes())? {
            return Err(err(
                "collateral_unknown",
                "preparation already dispatched; never repeat POST",
            ));
        }
        if let Err(e) = provision_unchanged(&c, &control) {
            if Store::read(&mut Host, &format!("{k}/claimed"))? == c.operation_id.as_bytes() {
                Host.remove(&format!("{k}/claimed"))?;
            }
            return Err(e);
        }
        if Store::read(&mut Host, &format!("{k}/guardian"))?.is_empty() {
            guarded::put_once(
                &mut Host,
                &format!("{k}/guardian"),
                guardian.to_string().as_bytes(),
            )?;
        }
        if Store::read(&mut Host, &format!("{k}/expected_policy"))?.is_empty() {
            guarded::put_once(
                &mut Host,
                &format!("{k}/expected_policy"),
                policy.to_string().as_bytes(),
            )?;
        } else {
            let expected: Value = serde_json::from_slice(&Store::read(
                &mut Host,
                &format!("{k}/expected_policy"),
            )?)
            .map_err(|_| err("evidence", "candidate missing"))?;
            if expected != policy {
                return Err(err(
                    "evidence",
                    "expected policy changed after a prior prepare",
                ));
            }
        }
        let (st, encrypted) = http(
            "POST",
            &format!("{OL}/wallet/v1/encrypt-policy"),
            Some(&key),
            Some(&policy),
        )?;
        let ciphertext_ok = guarded::text(&encrypted, "encrypted_base64")
            .ok()
            .is_some_and(|c| !c.is_empty() && c.len() <= 4096);
        let hash_ok = guarded::text(&encrypted, "policy_hash")
            .ok()
            .is_some_and(guarded::lower_hash);
        if st != 200
            || !(collateral::same_wallet_pubkey(&encrypted["wallet_pubkey"], &id)
                || collateral::wallet_pubkey_is_wallet_id(
                    &encrypted["wallet_pubkey"],
                    wallet_id,
                ))
            || !ciphertext_ok
            || !hash_ok
        {
            // Result was not kept. Release this claim so prepare can continue.
            if Store::read(&mut Host, &format!("{k}/claimed"))? == c.operation_id.as_bytes() {
                Host.remove(&format!("{k}/claimed"))?;
            }
            return Err(err(
                "collateral_unknown",
                collateral::public_encrypt_failure(st, &encrypted),
            ));
        }
        guarded::put_once(
            &mut Host,
            &format!("{k}/encrypted"),
            encrypted.to_string().as_bytes(),
        )?;
        encrypted
    };
    let ciphertext = guarded::text(&encrypted, "encrypted_base64")?.to_owned();
    let plaintext_hash = guarded::text(&encrypted, "policy_hash")?.to_owned();
    if ciphertext.is_empty() || ciphertext.len() > 4096 || !guarded::lower_hash(&plaintext_hash) {
        return Err(err("collateral_unknown", "invalid encryption response"));
    }
    // ROUND 9 tripwire correction: do NOT require
    // `canonical_hash(policy) == plaintext_hash` here. The provider's
    // plaintext_hash is over the STORED plaintext, which adds the `controller`
    // (the wallet's own public key) and meta fields the reviewed candidate
    // does not contain (experiment E0.1/E3; 23 candidate stored-forms across
    // 2 independent cases, 0 matches). Such a check would always trip and
    // block every provision. The pre-register gate is the provider's own
    // self-consistency below (sign-policy policy_hash == encrypt policy_hash)
    // plus the post-register GET /policy field diff in reconcile_provision,
    // which must be empty before finalize_collateral.
    provision_unchanged(&c, &control)?;
    let (st, signed) = http(
        "POST",
        &format!("{OL}/wallet/v1/sign-policy"),
        Some(&key),
        Some(&json!({"encrypted_data":ciphertext,"caller":keys_contract()})),
    )?;
    // First policies are signed immediately. A pending/unavailable answer never
    // becomes an eligibility row and never triggers a register transaction.
    if st != 200
        || signed.get("status").is_some()
        || signed["locked"] != true
        || signed["policy_hash"] != plaintext_hash
        || !collateral::same_wallet_pubkey(&signed["public_key_hex"], &id)
    {
        return Err(err(
            "collateral_unknown",
            "policy signature not terminal; wallet remains held",
        ));
    }
    let p = Prepared {
        token_id: token,
        owner: c.account.clone(),
        owner_epoch: control.epoch,
        worker_hash: cfg("GUARDED_WORKER_HASH", ""),
        wallet_pubkey: format!("ed25519:{id}"),
        plaintext_hash,
        encrypted_data: ciphertext,
        wallet_signature: guarded::text(&signed, "signature_hex")?.into(),
        version: signed["version"].as_u64().unwrap_or(0),
        valid_until: signed["valid_until"].as_u64().unwrap_or(0),
    };
    p.validate(&keys_contract(), chain_now_ms()? / 1000)?;
    provision_unchanged(&c, &control)?;
    guarded::put_once(
        &mut Host,
        &format!("{k}/prepared"),
        &serde_json::to_vec(&p).map_err(|_| err("storage", "plan encoding"))?,
    )?;
    prepared_review_summary(&p, guardian)
}
fn provision_identity(c: &Ctx, control: &Control, p: &Prepared) -> Result<(), Error> {
    if p.token_id != c.token_id()
        || !collateral::holder_plan_access(
            p,
            &c.account,
            control.epoch,
            c.req.op == "reconcile_collateral",
        )
        || p.worker_hash != cfg("GUARDED_WORKER_HASH", "")
        || c.req.params["provision_id"] != p.id()
    {
        return Err(err("collateral_audit", "plan/holder/epoch/build mismatch"));
    }
    Ok(())
}
fn op_provision_collateral(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "provision_collateral")?;
    let p = load_prepared(&c.token_id(), control.epoch)?;
    let k = provision_root(&p.token_id, p.owner_epoch);
    provision_identity(&c, &control, &p)?;
    // Once submission has been claimed, this entry point can only reconcile it.
    if !Store::read(&mut Host, &format!("{k}/submitted"))?.is_empty() {
        return reconcile_provision(&c, &control, &p);
    }
    let now = chain_now_ms()? / 1000;
    p.validate(&keys_contract(), now)?;
    let expected: Value =
        serde_json::from_slice(&Store::read(&mut Host, &format!("{k}/expected_policy"))?)
            .map_err(|_| err("evidence", "candidate policy missing"))?;
    let message = guarded::text(&c.req.params, "pre_audit_message")?;
    if message.len() > 32768 {
        return Err(err("evidence", "oversized pre-review"));
    }
    let proposed: PreAudit =
        serde_json::from_str(message).map_err(|_| err("evidence", "invalid pre-review"))?;
    if !guarded::lower_hash(&proposed.guardian_sha256) {
        return Err(err("guardian", "invalid guardian digest"));
    }
    let guardian: Value = serde_json::from_slice(&Store::read(
        &mut Host,
        &format!("{k}/guardians/{}", proposed.guardian_sha256),
    )?)
    .map_err(|_| err("evidence", "observed guardian proof missing"))?;
    let a = evidence::pre_audit(
        guarded::text(&c.req.params, "pre_audit_message")?,
        guarded::text(&c.req.params, "pre_audit_signature")?,
        &cfg_env_reviewer(),
        &p,
        &evidence_manifest(&p.token_id)?,
        &expected,
        &evidence::digest(&guardian)?,
        &keys_contract(),
        now,
    )?;
    let ga: Auth = serde_json::from_value(guardian["auth"].clone())
        .map_err(|_| err("guardian", "observed proof missing"))?;
    let (access, e) = rpc::view_access_key(&ga.account_id, &ga.public_key, "final");
    if !e.is_empty() {
        return Err(err("guardian", "current guardian unavailable"));
    }
    let access: Value =
        serde_json::from_str(&access).map_err(|_| err("guardian", "unknown guardian key"))?;
    let gp = evidence::guardian_params(
        &expected,
        &c.token_id(),
        &p.wallet_pubkey,
        &keys_contract(),
        &c.account,
        control.epoch,
        &p.worker_hash,
    )?;
    evidence::guardian(&ga, &gp, &expected, &access, &recipient(), chain_now_ms()?)?;
    let (key, id) = guarded_wallet(&p.token_id)?;
    if p.wallet_pubkey != format!("ed25519:{id}") {
        return Err(err("collateral_ineligible", "canonical wallet changed"));
    }
    certificate_inventory(&key)?;
    if view(
        &keys_contract(),
        "get_collateral_binding",
        json!({"token_id":p.token_id}),
    )? != Value::Null
        || view(
            &keys_contract(),
            "get_pending_registration",
            json!({"token_id":p.token_id}),
        )? != Value::Null
        || view(
            "outlayer.near",
            "get_wallet_policy",
            json!({"wallet_pubkey":p.wallet_pubkey}),
        )? != Value::Null
    {
        return Err(err(
            "collateral_ineligible",
            "binding/policy already exists",
        ));
    }
    let (mid, msk) = guarded_minter()?;
    if view(
        &keys_contract(),
        "payout_account_registered",
        json!({"account_id":mid}),
    )? != true
    {
        return Err(err(
            "minter_payout_unregistered",
            "sponsor minter slot first",
        ));
    }
    let q = view(
        "outlayer.near",
        "estimate_wallet_policy_cost",
        json!({"wallet_pubkey":p.wallet_pubkey,"encrypted_data":p.encrypted_data,"storage_refund_to":mid}),
    )?;
    let deposit = collateral::quote(&q, guarded::text(&c.req.params, "max_deposit_yocto")?)?;
    provision_unchanged(&c, &control)?;
    guarded::put_once(&mut Host,&format!("{k}/pre_signed"),json!({"message":guarded::text(&c.req.params,"pre_audit_message")?,"signature":guarded::text(&c.req.params,"pre_audit_signature")?}).to_string().as_bytes())?;
    let args = p.args().to_string();
    let seed = minter_secret(&msk)?;
    let outcome = native_send::execute(
        &mut Host,
        &mut NativeRpc {
            provision: Some((p.clone(), deposit, a)),
        },
        &p.id(),
        &c.account,
        &mid,
        &seed,
        &keys_contract(),
        &[Action::FunctionCall {
            method: "register_collateral",
            args: args.as_bytes(),
            gas: 200_000_000_000_000,
            deposit,
        }],
    );
    if let Err(e) = outcome {
        if Store::read(&mut Host, &format!("{k}/tx_hash"))?.is_empty() {
            return Err(e);
        }
    }
    reconcile_provision(&c, &control, &p)
}
fn provision_native_budget(mid: &str, deposit: u128) -> Result<(), Error> {
    // Round 4: the gas price is a protocol-level value, identical for the
    // whole run; cache it so a second provision in the same run does not
    // re-read it. The minter's view_account is NEVER cached (its balance
    // changes after every send, and the budget must be computed from the
    // live balance).
    // Round 8: the cache holds the PARSED u128 (gas_price_of), not the raw
    // host response — the host returns a bare string the old code could not
    // read (Run 14 S11).
    let price: u128 = match read_cache::get_gas_price() {
        Some(price) => price,
        None => {
            let (price, e) = rpc::gas_price("");
            if !e.is_empty() {
                return Err(err("rpc", "gas price unavailable"));
            }
            let price = gas_price_of(&price)?;
            read_cache::put_gas_price(price);
            price
        }
    };
    let (account, e) = rpc::view_account(mid, "final");
    if !e.is_empty() {
        return Err(err("rpc", "minter balance unavailable"));
    }
    native_budget_check(&account, deposit, price)
}

fn op_reconcile_collateral(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "reconcile_collateral")?;
    let plan_epoch = c
        .req
        .params
        .get("provision_owner_epoch")
        .map(|v| guarded::decimal(&json!({"e":v}), "e"))
        .transpose()?
        .map(|v| u64::try_from(v).map_err(|_| err("bad_params", "bad provision epoch")))
        .transpose()?
        .unwrap_or(control.epoch);
    let p = load_prepared(&c.token_id(), plan_epoch)?;
    provision_identity(&c, &control, &p)?;
    reconcile_provision(&c, &control, &p)
}
fn reconcile_provision(c: &Ctx, control: &Control, p: &Prepared) -> Result<Value, Error> {
    let k = provision_root(&p.token_id, p.owner_epoch);
    let hash = String::from_utf8(Store::read(&mut Host, &format!("{k}/tx_hash"))?)
        .map_err(|_| err("storage", "invalid transaction identity"))?;
    if hash.is_empty() || Store::read(&mut Host, &format!("{k}/submitted"))?.is_empty() {
        return Err(err(
            "collateral_unknown",
            "original send not recorded; no automatic resend",
        ));
    }
    let deposit = String::from_utf8(Store::read(&mut Host, &format!("{k}/deposit"))?)
        .ok()
        .and_then(|s| s.parse::<u128>().ok())
        .ok_or_else(|| err("storage", "missing quoted deposit"))?;
    let (mid, _) = guarded_minter()?;
    // NONE, never FINAL: the OutLayer host caps every near:rpc call at 30 s,
    // so a FINAL wait that outlasts 30 s errors even when the tx was
    // accepted. Finality is read from the response body instead
    // (registration_terminal requires final_execution_status == "FINAL");
    // a tx that is not FINAL yet returns None → UNKNOWN with the hash.
    let (r, e) = rpc::tx_status(&hash, &mid, "NONE");
    let tx: Value = serde_json::from_str(&r).map_err(|_| err("rpc_unavailable", "malformed RPC response"))?;
    let result = if e.is_empty() {
        collateral::registration_terminal(&tx, &hash, &mid, &keys_contract(), p, deposit)
    } else {
        None
    };
    let Some(terminal) = result else {
        return Ok(
            json!({"ok":false,"op":"reconcile_collateral","status":"UNKNOWN","provision_id":p.id(),"tx_hash":hash}),
        );
    };
    // The original native nonce is now FINAL, even if the provider store failed.
    // Release only this plan's latch; never strand another value journal's finish.
    if let Some(t) = native_send::current(&mut Host)? {
        if t.id == p.id() {
            native_send::reconcile(&mut Host, &mut NativeRpc { provision: None }, &t)?;
        }
    }
    if !terminal {
        return Ok(
            json!({"ok":false,"op":"reconcile_collateral","status":"FAILED_LOCKED","provision_id":p.id(),"tx_hash":hash,"automatic_retry":false}),
        );
    }
    control.admit()?;
    let b = view(
        &keys_contract(),
        "get_collateral_binding",
        json!({"token_id":p.token_id}),
    )?;
    let pending = view(
        &keys_contract(),
        "get_pending_registration",
        json!({"token_id":p.token_id}),
    )?;
    let policy = view(
        "outlayer.near",
        "get_wallet_policy",
        json!({"wallet_pubkey":p.wallet_pubkey}),
    )?;
    let (key, id) = guarded_wallet(&p.token_id)?;
    if p.wallet_pubkey != format!("ed25519:{id}") || !pending.is_null() {
        return Err(err(
            "collateral_unknown",
            "registration/custody still unresolved",
        ));
    }
    let expected: Value =
        serde_json::from_slice(&Store::read(&mut Host, &format!("{k}/expected_policy"))?)
            .map_err(|_| err("collateral_audit", "prepared policy missing"))?;
    let effective = custody_get(&key, "/wallet/v1/policy")?;
    // ROUND 9: field-level diff (names only). The controller is the wallet's
    // own public key (experiment E7/E8); the old bool check compared it to
    // the contract and was the single failing field in S11. A diff that is
    // only a provider-sync artifact (policy/version not yet visible, or the
    // provider view lagging the chain freeze state) is retryable, not a hard
    // mismatch: the operator waits and repeats the SAME reconcile (or a
    // single invalidate-cache). Anything else is a real mismatch: the token
    // is dead, capture the diff, do NOT re-register.
    let diff = collateral::policy_diff(&expected, &effective, p, &keys_contract());
    if !diff.is_empty() {
        let chain_frozen = policy["frozen"].as_bool();
        let observed_frozen = effective["frozen"].as_bool();
        if collateral::policy_diff_is_sync_only(&diff, chain_frozen, observed_frozen) {
            return Ok(json!({"ok":false,"op":"reconcile_collateral","status":"PENDING_PROVIDER_SYNC","provision_id":p.id(),"tx_hash":hash,"policy_diff":diff,"observed_shape":collateral::observed_shape(&effective)}));
        }
        return Err(err(
            "collateral_ineligible",
            format!(
                "effective custody policy differs from reviewed restricted policy {} (shape: {})",
                collateral::policy_diff_message(&diff),
                collateral::observed_shape(&effective)
            ),
        ));
    }
    certificate_inventory(&key)?;
    provision_unchanged(c, control)?;
    if !collateral::binding_matches(p, &b, &policy, &keys_contract()) {
        return Err(err(
            "evidence",
            "binding/public policy differs from installed artifact",
        ));
    }
    let inv = evidence_inventory(&key)?;
    let a: PreAudit = serde_json::from_slice(&Store::read(&mut Host, &format!("{k}/audit"))?)
        .map_err(|_| err("evidence", "pre-review missing"))?;
    let manifest = evidence_manifest(&p.token_id)?;
    manifest.validate(p, &keys_contract())?;
    evidence::validate_policy(&expected, &manifest)?;
    guarded::put_once(&mut Host, &format!("{k}/installed"), hash.as_bytes())?;
    if c.req.params.get("guardian_proof").is_none() {
        return Ok(
            json!({"ok":true,"op":"reconcile_collateral","status":"installed","provision_id":p.id(),"tx_hash":hash,"binding_ready":true,"eligibility_sealed":false,"post_review_required":true,"fresh_guardian_required":true}),
        );
    }
    let guardian = observe_guardian(
        c,
        control,
        &expected,
        &p.wallet_pubkey,
        &c.req.params["guardian_proof"],
    )?;
    provision_unchanged(c, control)?;
    let now = chain_now_ms()? / 1000;
    let r = evidence::EffectiveReport {
        domain: evidence::REPORT.into(),
        project_uuid: guarded::PROJECT_UUID.into(),
        contract: keys_contract(),
        provision_id: p.id(),
        token_id: p.token_id.clone(),
        current_owner: c.account.clone(),
        current_epoch: control.epoch,
        worker_hash: p.worker_hash.clone(),
        wallet_pubkey: p.wallet_pubkey.clone(),
        policy_hash: p.policy_hash(),
        policy_version: p.version,
        manifest_sha256: evidence::digest(&manifest)?,
        pre_audit_sha256: evidence::digest(&a)?,
        guardian_sha256: evidence::digest(&guardian["auth"])?,
        guardian_auth: guardian["auth"].clone(),
        guardian_access_key: guardian["access_key"].clone(),
        candidate_policy_sha256: evidence::digest(&expected)?,
        installed_tx: hash.clone(),
        final_receipts_sha256: evidence::digest(&tx)?,
        public_policy_sha256: evidence::digest(&policy)?,
        inventory_sha256: evidence::digest(&inv)?,
        effective_policy: effective,
        authority_scope: evidence::SCOPE.into(),
        issued_at_sec: now,
        expires_at_sec: now.saturating_add(900),
    };
    let (_, msk) = guarded_minter()?;
    let seed = minter_secret(&msk)?;
    use base64::Engine;
    let public = base64::engine::general_purpose::STANDARD.encode(
        ed25519_dalek::SigningKey::from_bytes(&seed)
            .verifying_key()
            .to_bytes(),
    );
    if view(&keys_contract(), "get_pledge_config", json!({}))?["attestor_public_key"] != public {
        return Err(err("evidence", "immutable attestor mismatch"));
    }
    let signed = evidence::signed(evidence::REPORT, &r, &seed)?;
    evidence::report(&signed, &public, p, &expected, &keys_contract(), now, true)?;
    provision_unchanged(c, control)?;
    let report_hash = evidence::digest(&signed)?;
    guarded::put_once(
        &mut Host,
        &format!("{}/reports/{report_hash}", evidence::root(&p.token_id)),
        &serde_json::to_vec(&signed).map_err(|_| err("evidence", "report encoding"))?,
    )?;
    Ok(
        json!({"ok":true,"op":"collateral_report","status":"post_review_required","provision_id":p.id(),"tx_hash":hash,"binding_ready":true,"eligibility_sealed":false,"post_review_required":true,"report":signed,"report_sha256":report_hash,"candidate_policy":expected,"manifest":manifest,"inventory":inv,"original_installation":tx,"attestor_public_key":public,"authority_scope":evidence::SCOPE}),
    )
}
/// ROUND 9: read-only custody probe (S10). Verifies the funded wallet's
/// provider state BEFORE prepare_collateral, so a bad request type, leftover
/// key, or unexpected policy shape stops the run with only the 0.90 USDC and
/// the token committed. Sends nothing. Names and types only: no hashes, keys,
/// balances or ciphertext in the output. The expected policy exists only
/// after prepare; before prepare the probe verifies the policy endpoint shows
/// `policy:"none"` (nothing installed) and the inventory verdicts run on the
/// real funded rows.
fn op_custody_probe(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "custody_probe")?;
    let token = c.token_id();
    let (key, id) = guarded_wallet(&token)?;
    let k = provision_root(&token, control.epoch);
    let expected: Option<Value> = serde_json::from_slice(
        &Store::read(&mut Host, &format!("{k}/expected_policy"))?,
    )
    .ok();
    let prepared: Option<Prepared> = load_prepared(&token, control.epoch).ok();
    // GET one endpoint; record the HTTP status and the type skeleton (no
    // values). A transport failure is recorded, never fatal to the probe.
    let probe_get = |path: &str| -> (Value, Value) {
        match http("GET", &format!("{OL}{path}"), Some(&key), None) {
            Ok((st, body)) => (json!(st), body),
            Err(e) => (json!("error"), json!({"error": e.code})),
        }
    };
    let (policy_status, policy_body) = probe_get("/wallet/v1/policy");
    let mut pages: Vec<Value> = Vec::new();
    let mut req_status = Value::Null;
    for offset in (0..1000).step_by(100) {
        let (st, page) = probe_get(&format!("/wallet/v1/requests?limit=100&offset={offset}"));
        if req_status.is_null() {
            req_status = st.clone();
        }
        if st.as_u64() != Some(200) {
            break;
        }
        let total = page["total"].as_u64();
        pages.push(page);
        match total {
            Some(t) if t <= (offset as u64) + 100 => break,
            Some(_) => continue,
            None => break,
        }
    }
    let (orders_status, orders_body) =
        probe_get("/wallet/v1/limit-orders?open=true&limit=1&offset=0");
    let (approvals_status, approvals_body) = probe_get("/wallet/v1/pending_approvals");
    let (bal_status, bal_body) = probe_get("/wallet/v1/confidential/balance");
    let (bal_tok_status, bal_tok_body) = probe_get(&format!(
        "/wallet/v1/confidential/balance?token=nep141%3A{}",
        guarded::ASSET.trim_start_matches("nep141:")
    ));
    let (intents_status, intents_body) = probe_get(&format!(
        "/wallet/v1/balance?chain=near&token={}&source=intents&account=executor",
        guarded::ASSET
    ));
    let settled = match guarded::settled_inventory(&pages) {
        Ok(()) => json!({"verdict": "pass"}),
        Err(e) => json!({"verdict": "fail", "code": e.code}),
    };
    let authority = match evidence::authority_inventory(&pages) {
        Ok(()) => json!({"verdict": "pass"}),
        Err(e) => json!({"verdict": "fail", "code": e.code, "message": e.message}),
    };
    let floor_shape = match guarded::fixed_floor_shape(&bal_tok_body, &id) {
        Ok(()) => json!({"verdict": "pass"}),
        Err(e) => json!({"verdict": "fail", "code": e.code}),
    };
    let (policy_diff, policy_expected) = match (&expected, &prepared) {
        (Some(exp), Some(p)) => (
            json!(collateral::policy_diff(exp, &policy_body, p, &keys_contract())),
            json!(true),
        ),
        _ => (Value::Null, json!(false)),
    };
    let policy_none = policy_body.get("policy").and_then(Value::as_str) == Some("none");
    Ok(json!({"ok":true,"op":"custody_probe","token_id":token,"owner_epoch":control.epoch.to_string(),
        "endpoints":{
            "policy":{"status":policy_status,"shape":collateral::observed_shape(&policy_body)},
            "requests":{"status":req_status,"pages":pages.len(),"shape":collateral::observed_shape(&json!(pages))},
            "limit_orders":{"status":orders_status,"shape":collateral::observed_shape(&orders_body)},
            "pending_approvals":{"status":approvals_status,"shape":collateral::observed_shape(&approvals_body)},
            "confidential_balance":{"status":bal_status,"shape":collateral::observed_shape(&bal_body)},
            "confidential_balance_token":{"status":bal_tok_status,"shape":collateral::observed_shape(&bal_tok_body)},
            "balance_intents":{"status":intents_status,"shape":collateral::observed_shape(&intents_body)}},
        "policy_diff":policy_diff,"policy_expected":policy_expected,"policy_none":policy_none,
        "settled_inventory":settled,"authority_inventory":authority,"fixed_floor_shape":floor_shape}))
}
/// Public output is a quote and non-reusable hashes, never the policy signature or API key.
fn op_collateral_quote(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "collateral_quote")?;
    let p = load_prepared(&c.token_id(), control.epoch)?;
    provision_identity(&c, &control, &p)?;
    p.validate(&keys_contract(), chain_now_ms()? / 1000)?;
    let (mid, _) = guarded_minter()?;
    if !view(
        "outlayer.near",
        "get_wallet_policy",
        json!({"wallet_pubkey":p.wallet_pubkey}),
    )?
    .is_null()
    {
        return Err(err(
            "collateral_ineligible",
            "fresh policy required for quote",
        ));
    }
    let q = view(
        "outlayer.near",
        "estimate_wallet_policy_cost",
        json!({"wallet_pubkey":p.wallet_pubkey,"encrypted_data":p.encrypted_data,"storage_refund_to":mid}),
    )?;
    let d = collateral::quote(
        &q,
        &(collateral::BINDING_DEPOSIT + collateral::MAX_QUOTE).to_string(),
    )?;
    provision_unchanged(&c, &control)?;
    Ok(
        json!({"ok":true,"op":"collateral_quote","provision_id":p.id(),"wallet_pubkey":p.wallet_pubkey,"ciphertext_bytes":p.encrypted_data.len(),
        "provider_quote_yocto":q,"binding_deposit_yocto":d.to_string(),"storage_refund_to":mid,"observed_at_ns":(chain_now_ms()?*1_000_000).to_string()}),
    )
}
/// A custody route preview only: same holder-only destination and canonical token
/// wallet. Never begins a value operation, signs a withdrawal or consumes spend caps.
fn op_withdraw_dry_run(input: &Value) -> Result<Value, Error> {
    let c = authenticate(input, "withdraw_dry_run", true)?;
    let control = guard_preflight(&c)?;
    let p = &c.req.params;
    let chain = s(p, "chain").unwrap_or_else(|| "near".into());
    let to = self_withdraw_destination(
        &c.account,
        &chain,
        s(p, "to").as_deref(),
        input
            .pointer("/auth/scheme")
            .and_then(Value::as_str)
            .unwrap_or("nep413"),
    )?;
    let token = s(p, "token").ok_or_else(|| err("bad_params", "token required"))?;
    let amount = digits(p, "amount")?;
    if amount.parse::<u128>().unwrap_or(0) == 0 {
        return Err(err("bad_params", "positive amount required"));
    }
    let (key, wallet_id) = guarded_wallet(&c.token_id())?;
    if p["exit_mode"]==exact_exit::MODE {
        let plan=exact_exit::Plan::signed(p,c.now_ms,&c.account)?;
        exact_exit_policy(&c.token_id(),&key,&wallet_id)?;
        let obs=exact_exit_observation(&wallet_id,&plan,&key)?;
        let v=serde_json::to_value(&obs).map_err(|_|err("exit_readback","encode preview"))?;
        if guarded::decimal(&v,"confidential")?<plan.units()? || guarded::decimal(&v,"storage_min")?>exact_exit::STORAGE_MAX || (!obs.registered && guarded::decimal(&v,"native")?<exact_exit::NATIVE_MAX) {
            return Err(err("exit_budget","exact exit collateral/storage/native reserve unavailable"));
        }
        provision_unchanged(&c,&control)?;
        return Ok(json!({"ok":true,"op":"withdraw_dry_run","to":to,"amount":amount,"token":token,"chain":chain,
            "amount_out":amount,"min_amount_out":amount,"exit_mode":exact_exit::MODE,"execution_supported":true,
            "requires_unshield_readback":true,"broadcast":false,"advisory_only":true,
            "native_budget_max":exact_exit::NATIVE_MAX.to_string(),"deadline_ms":plan.deadline_ms,
            "privacy_notice":"Unshield reveals this wallet and asset on the public chain; no quote/minimum is sent to the confidential withdrawal endpoint."}));
    }
    let (st, q) = http(
        "POST",
        &format!("{OL}/wallet/v1/confidential/withdraw/dry-run"),
        Some(&key),
        Some(&json!({"chain":chain,"token":token,"amount":amount,"to":to})),
    )?;
    if st != 200 {
        return Err(err(
            "exit_quote_unavailable",
            "provider refused route preview",
        ));
    }
    provision_unchanged(&c, &control)?;
    // Provider's documented SwapQuoteResponse has no would_succeed Boolean.
    let positive = |k: &str| {
        q[k].as_str()
            .and_then(|s| s.parse::<u128>().ok())
            .is_some_and(|n| n > 0)
    };
    if !positive("amount_out") || !positive("min_amount_out") {
        return Err(err(
            "exit_quote_unavailable",
            "no positive route minimum; do not withdraw",
        ));
    }
    Ok(
        json!({"ok":true,"op":"withdraw_dry_run","to":to,"amount":amount,"token":token,"chain":chain,
        "amount_out":q["amount_out"],"min_amount_out":q["min_amount_out"],"deadline":q["deadline"],"time_estimate_seconds":q["time_estimate_seconds"],
        "estimated_fee":q["estimated_fee"],"fee_token":q["fee_token"],"hint":q["hint"],
        "approval_and_cooldown_must_be_verified":true,"broadcast":false,"advisory_only":true,"minimum_bound_to_execution":false,"execution_supported":false}),
    )
}
