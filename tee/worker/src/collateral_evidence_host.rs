// Included in the WASI host. No initialization, credential export, policy-update probe or
// alternate certificate signer. The existing sealed namespace and minter are preserved.
fn evidence_manifest(token: &str) -> Result<evidence::FreshManifest, Error> {
    serde_json::from_slice(&Store::read(
        &mut Host,
        &format!("{}/manifest", evidence::root(token)),
    )?)
    .map_err(|_| {
        err(
            "evidence",
            "fresh wallet provenance missing; no legacy enrollment",
        )
    })
}
fn evidence_inventory(key: &str) -> Result<Value, Error> {
    let mut pages = Vec::new();
    for offset in (0..1000).step_by(100) {
        let page = custody_get(
            key,
            &format!("/wallet/v1/requests?limit=100&offset={offset}"),
        )?;
        let total = page["total"]
            .as_u64()
            .ok_or_else(|| err("evidence", "unknown request inventory"))?;
        pages.push(page);
        if total <= offset + 100 {
            break;
        }
    }
    evidence::authority_inventory(&pages)?;
    let orders = custody_get(key, "/wallet/v1/limit-orders?open=true&limit=1&offset=0")?;
    let approvals = custody_get(key, "/wallet/v1/pending_approvals")?;
    if !orders.as_array().is_some_and(Vec::is_empty)
        || !approvals["approvals"].as_array().is_some_and(Vec::is_empty)
    {
        return Err(err("evidence", "pending authority inventory"));
    }
    Ok(json!({"pages":pages,"orders":orders,"approvals":approvals}))
}
fn op_create_collateral_wallet(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "create_collateral_wallet")?;
    if c.req.params["fresh_only"] != true {
        return Err(err("evidence", "fresh_only required"));
    }
    let token = c.token_id();
    let r = evidence::root(&token);
    if !Store::read(&mut Host, &format!("{r}/manifest"))?.is_empty() {
        let m = evidence_manifest(&token)?;
        let (key, id) = guarded_wallet(&token)?;
        if m.wallet_pubkey != format!("ed25519:{id}") || m.api_key_sha256 != sha256_hex(&key) {
            return Err(err("evidence", "canonical provenance mismatch"));
        }
        let inv: Value =
            serde_json::from_slice(&Store::read(&mut Host, &format!("{r}/initial_inventory"))?)
                .map_err(|_| err("evidence", "sealed initial inventory unavailable"))?;
        if evidence::digest(&inv)? != m.initial_inventory_sha256 {
            return Err(err("evidence", "sealed initial inventory digest mismatch"));
        }
        return Ok(
            json!({"ok":true,"op":"create_collateral_wallet","manifest":m,"manifest_sha256":evidence::digest(&m)?,"creation_inventory":inv}),
        );
    }
    let absent = evidence::fresh_namespaces(&token, &c.account);
    if !view(
        &keys_contract(),
        "get_collateral_binding",
        json!({"token_id":token}),
    )?
    .is_null()
        || !view(
            &keys_contract(),
            "get_pending_registration",
            json!({"token_id":token}),
        )?
        .is_null()
    {
        return Err(err("evidence", "token already bound or registering"));
    }
    provision_unchanged(&c, &control)?;
    let claim = json!({"owner":c.account,"epoch":control.epoch,"operation_id":c.operation_id,"worker_hash":cfg("GUARDED_WORKER_HASH","")});
    let j = evidence::register_fresh(
        &mut Host,
        &mut FreshRegister {
            c: &c,
            control: &control,
        },
        &token,
        &c.account,
        &claim,
    )?;
    let key = guarded::text(&j, "api_key")?;
    let id = guarded::text(&j, "near_account_id")?;
    let wallet_id = guarded::text(&j, "wallet_id")?;
    if !view(
        "outlayer.near",
        "get_wallet_policy",
        json!({"wallet_pubkey":format!("ed25519:{id}")}),
    )?
    .is_null()
    {
        return Err(err("evidence", "fresh wallet has an existing policy"));
    }
    let mut inv = evidence_inventory(key)?;
    let balances = custody_get(key, "/wallet/v1/confidential/balance")?;
    evidence::fresh_balances(&balances, id)?;
    inv["initial_balances"] = balances;
    guarded::put_once(
        &mut Host,
        &format!("{r}/initial_inventory"),
        inv.to_string().as_bytes(),
    )?;
    if inv["pages"][0]["total"] != 0 {
        return Err(err("evidence", "fresh wallet has historical jobs"));
    }
    provision_unchanged(&c, &control)?;
    let m = evidence::FreshManifest {
        domain: "KEYHOLE_FRESH_WALLET_V2".into(),
        project_uuid: guarded::PROJECT_UUID.into(),
        contract: keys_contract(),
        token_id: token,
        owner: c.account.clone(),
        owner_epoch: control.epoch,
        worker_hash: cfg("GUARDED_WORKER_HASH", ""),
        wallet_id: wallet_id.into(),
        wallet_pubkey: format!("ed25519:{id}"),
        api_key_sha256: sha256_hex(key),
        register_operation_id: c.operation_id.clone(),
        created_at_ms: chain_now_ms()?,
        namespace_absence_sha256: evidence::digest(&absent)?,
        registration_sha256: evidence::digest(
            &json!({"wallet_id":wallet_id,"near_account_id":id,"api_key_sha256":sha256_hex(key),"anonymous_request":{}}),
        )?,
        initial_inventory_sha256: evidence::digest(&inv)?,
        authority_scope: evidence::SCOPE.into(),
    };
    guarded::put_once(
        &mut Host,
        &format!("{r}/manifest"),
        &serde_json::to_vec(&m).map_err(|_| err("evidence", "manifest encoding"))?,
    )?;
    Ok(
        json!({"ok":true,"op":"create_collateral_wallet","manifest":m,"manifest_sha256":evidence::digest(&m)?,"creation_inventory":inv,"authority_scope":evidence::SCOPE}),
    )
}
fn candidate_policy(c: &Ctx) -> Result<Value, Error> {
    let m = evidence_manifest(&c.token_id())?;
    let (key, id) = guarded_wallet(&c.token_id())?;
    if m.wallet_pubkey != format!("ed25519:{id}")
        || m.api_key_sha256 != sha256_hex(&key)
        || m.owner != c.account
        || c.req.params["owner_epoch"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
            != Some(m.owner_epoch)
    {
        return Err(err("evidence", "fresh wallet owner/epoch/custody changed"));
    }
    evidence::admin_policy(
        &m.wallet_id,
        &key,
        &c.req.params["approvers"],
        c.req.params["threshold"].as_u64().unwrap_or(0),
    )
}
fn op_collateral_candidate(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "collateral_candidate")?;
    let p = if c.req.params.get("provision_id").is_some() {
        let prepared = load_plan_for_review(&c, &control)?;
        serde_json::from_slice(&Store::read(
            &mut Host,
            &format!(
                "{}/expected_policy",
                provision_root(&prepared.token_id, prepared.owner_epoch)
            ),
        )?)
        .map_err(|_| err("evidence", "original candidate missing"))?
    } else {
        candidate_policy(&c)?
    };
    let m = evidence_manifest(&c.token_id())?;
    evidence::validate_policy(&p, &m)?;
    let challenge = evidence::guardian_params(
        &p,
        &c.token_id(),
        &m.wallet_pubkey,
        &keys_contract(),
        &c.account,
        control.epoch,
        &cfg("GUARDED_WORKER_HASH", ""),
    )?;
    provision_unchanged(&c, &control)?;
    Ok(
        json!({"ok":true,"op":"collateral_candidate","candidate_policy":p,"candidate_policy_sha256":evidence::digest(&p)?,"manifest":m,"manifest_sha256":evidence::digest(&m)?,"guardian_message_template":{"op":"collateral_guardian","account_id":p["approval"]["approvers"][0]["id"],"ts_ms":chain_now_ms()?,"params":challenge},"reviewer_label":"team reviewer, not independent auditor"}),
    )
}
fn observe_guardian(
    c: &Ctx,
    control: &Control,
    policy: &Value,
    wallet: &str,
    value: &Value,
) -> Result<Value, Error> {
    let a: Auth = serde_json::from_value(value.clone())
        .map_err(|_| err("guardian", "guardian_proof auth required"))?;
    let (raw, e) = rpc::view_access_key(&a.account_id, &a.public_key, "final");
    if !e.is_empty() {
        return Err(err("guardian", "guardian access key unavailable"));
    }
    let access: Value =
        serde_json::from_str(&raw).map_err(|_| err("guardian", "malformed guardian access key"))?;
    let expected = evidence::guardian_params(
        policy,
        &c.token_id(),
        wallet,
        &keys_contract(),
        &c.account,
        control.epoch,
        &cfg("GUARDED_WORKER_HASH", ""),
    )?;
    let now = chain_now_ms()?;
    let nonce = evidence::guardian(&a, &expected, policy, &access, &recipient(), now)?;
    evidence::consume_guardian(&mut Host, &a.account_id, &nonce, &c.operation_id)?;
    Ok(json!({"auth":value,"access_key":access,"observed_at_ms":now}))
}
fn load_plan_for_review(c: &Ctx, control: &Control) -> Result<Prepared, Error> {
    let epoch = c
        .req
        .params
        .get("provision_owner_epoch")
        .map(|v| guarded::decimal(&json!({"e":v}), "e"))
        .transpose()?
        .unwrap_or(control.epoch as u128);
    let epoch = u64::try_from(epoch).map_err(|_| err("evidence", "invalid original epoch"))?;
    let p = load_prepared(&c.token_id(), epoch)?;
    if p.token_id != c.token_id()
        || p.worker_hash != cfg("GUARDED_WORKER_HASH", "")
        || c.req.params["provision_id"] != p.id()
    {
        return Err(err("evidence", "wrong original plan"));
    }
    Ok(p)
}
fn op_collateral_report(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "collateral_report")?;
    let p = load_plan_for_review(&c, &control)?;
    if let Some(out) = sealed_enrollment_status(&c, &control, &p)? {
        return Ok(out);
    }
    reconcile_provision(&c, &control, &p)
}
fn op_finalize_collateral(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "finalize_collateral")?;
    let p = load_plan_for_review(&c, &control)?;
    let k = provision_root(&p.token_id, p.owner_epoch);
    if let Some(out) = sealed_enrollment_status(&c, &control, &p)? {
        return Ok(out);
    }
    let report_hash = guarded::text(&c.req.params, "report_sha256")?;
    if !guarded::lower_hash(report_hash) {
        return Err(err("evidence", "invalid report digest"));
    }
    let signed: evidence::SignedReport = serde_json::from_slice(&Store::read(
        &mut Host,
        &format!("{}/reports/{report_hash}", evidence::root(&p.token_id)),
    )?)
    .map_err(|_| err("evidence", "original report missing"))?;
    let expected: Value =
        serde_json::from_slice(&Store::read(&mut Host, &format!("{k}/expected_policy"))?)
            .map_err(|_| err("evidence", "candidate missing"))?;
    let cfg = view(&keys_contract(), "get_pledge_config", json!({}))?;
    let attestor = guarded::text(&cfg, "attestor_public_key")?;
    let r = evidence::report(
        &signed,
        attestor,
        &p,
        &expected,
        &keys_contract(),
        chain_now_ms()? / 1000,
        true,
    )?;
    // Re-read the original FINAL install and the exact public/private policy, not a caller assertion.
    // NONE, never FINAL: the OutLayer host caps every near:rpc call at 30 s,
    // so a FINAL wait that outlasts 30 s errors even when the tx was
    // accepted. Finality is read from the response body instead
    // (final_registration requires final_execution_status == "FINAL").
    let (mid, _) = guarded_minter()?;
    let (raw, e) = rpc::tx_status(&r.installed_tx, &mid, "NONE");
    let tx: Value = serde_json::from_str(&raw).map_err(|_| err("rpc_unavailable", "malformed RPC response"))?;
    let deposit = String::from_utf8(Store::read(&mut Host, &format!("{k}/deposit"))?)
        .ok()
        .and_then(|s| s.parse::<u128>().ok())
        .ok_or_else(|| err("evidence", "missing original deposit"))?;
    if !e.is_empty()
        || !collateral::final_registration(
            &tx,
            &r.installed_tx,
            &mid,
            &keys_contract(),
            &p,
            deposit,
        )
    {
        return Err(err("evidence", "original install not FINAL successful"));
    }
    let b = view(
        &keys_contract(),
        "get_collateral_binding",
        json!({"token_id":p.token_id}),
    )?;
    let public = view(
        "outlayer.near",
        "get_wallet_policy",
        json!({"wallet_pubkey":p.wallet_pubkey}),
    )?;
    let (key, _) = guarded_wallet(&p.token_id)?;
    let effective = custody_get(&key, "/wallet/v1/policy")?;
    if !collateral::binding_matches(&p, &b, &public, &keys_contract())
        || !collateral::effective_policy_matches(&expected, &effective, &p, &keys_contract())
    {
        return Err(err("evidence", "installed policy changed since review"));
    }
    evidence_inventory(&key)?;
    let auth: Auth = serde_json::from_value(r.guardian_auth.clone())
        .map_err(|_| err("guardian", "proof missing"))?;
    let (raw, e) = rpc::view_access_key(&auth.account_id, &auth.public_key, "final");
    let access: Value = serde_json::from_str(&raw).map_err(|_| err("rpc_unavailable", "malformed RPC response"))?;
    if !e.is_empty() {
        return Err(err("guardian", "guardian key unavailable"));
    }
    let challenge = evidence::guardian_params(
        &expected,
        &c.token_id(),
        &p.wallet_pubkey,
        &keys_contract(),
        &c.account,
        control.epoch,
        &p.worker_hash,
    )?;
    evidence::guardian(
        &auth,
        &challenge,
        &expected,
        &access,
        &recipient(),
        chain_now_ms()?,
    )?;
    let a: evidence::PreAudit =
        serde_json::from_slice(&Store::read(&mut Host, &format!("{k}/audit"))?)
            .map_err(|_| err("evidence", "pre-review missing"))?;
    let pre: Value = serde_json::from_slice(&Store::read(&mut Host, &format!("{k}/pre_signed"))?)
        .map_err(|_| err("evidence", "pre-review signature missing"))?;
    let proof = evidence::Proof {
        prepared: p.clone(),
        manifest: evidence_manifest(&p.token_id)?,
        expected_policy: expected,
        pre_message: guarded::text(&pre, "message")?.into(),
        pre_signature: guarded::text(&pre, "signature")?.into(),
        report: signed,
        post_message: guarded::text(&c.req.params, "post_audit_message")?.into(),
        post_signature: guarded::text(&c.req.params, "post_audit_signature")?.into(),
    };
    if evidence::digest(&a)? != r.pre_audit_sha256 {
        return Err(err("evidence", "original pre-review mismatch"));
    }
    provision_unchanged(&c, &control)?;
    guarded::put_once(
        &mut Host,
        &format!("{k}/complete"),
        r.installed_tx.as_bytes(),
    )?;
    evidence::finalize(
        &mut Host,
        &proof,
        &cfg_env_reviewer(),
        attestor,
        &keys_contract(),
        &c.account,
        control.epoch,
        chain_now_ms()? / 1000,
    )?;
    Ok(
        json!({"ok":true,"op":"finalize_collateral","provision_id":p.id(),"report_sha256":report_hash,"eligibility_sealed":true,"reviewer_label":"team reviewer, not independent auditor","authority_scope":evidence::SCOPE}),
    )
}
fn cfg_env_reviewer() -> String {
    cfg("COLLATERAL_AUDITOR_PUBLIC_KEY", "")
}
// Funding precedes install: documented deposit-family policy type is `call`, intentionally
// NOT allowed by confinement. Never broaden policy to arbitrary calls just to fund it.
fn op_collateral_funding_quote(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "collateral_funding_quote")?;
    let m = evidence_manifest(&c.token_id())?;
    let (key, id) = guarded_wallet(&c.token_id())?;
    if m.owner != c.account
        || m.owner_epoch != control.epoch
        || m.wallet_pubkey != format!("ed25519:{id}")
        || m.api_key_sha256 != sha256_hex(&key)
    {
        return Err(err("evidence", "fresh canonical funding only"));
    }
    if c.req.params["chain"] != "base"
        || c.req.params["token"] != "USDC"
        || c.req.params["amount"] != "900000"
        || c.req.params["min_credit_raw"] != "800000"
    {
        return Err(err(
            "evidence",
            "reviewed Base USDC 0.90 source / 0.80 minimum only",
        ));
    }
    if !view(
        "outlayer.near",
        "get_wallet_policy",
        json!({"wallet_pubkey":m.wallet_pubkey}),
    )?
    .is_null()
    {
        return Err(err(
            "evidence",
            "fund fresh wallet BEFORE installing locked policy; no call-capability expansion",
        ));
    }
    let r = evidence::root(&c.token_id());
    let body = json!({"chain":"base","token":"USDC","amount":"900000","destination_asset":USDC});
    provision_unchanged(&c, &control)?;
    if !Host.set_if_absent(&format!("{r}/funding_claim"), c.operation_id.as_bytes())? {
        return Err(err(
            "collateral_unknown",
            "original funding quote already claimed; poll original, never repeat POST",
        ));
    }
    let (status, q) = http(
        "POST",
        &format!("{OL}/wallet/v1/confidential/deposit/cross-chain"),
        Some(&key),
        Some(&body),
    )
    .map_err(|_| {
        err(
            "collateral_unknown",
            "original funding quote unknown; never retry POST",
        )
    })?;
    if status != 200 {
        return Err(err(
            "collateral_unknown",
            "funding quote unavailable; no public fallback or retry",
        ));
    }
    guarded::put_once(
        &mut Host,
        &format!("{r}/funding_quote"),
        q.to_string().as_bytes(),
    )?;
    let quote_now = chain_now_ms()?;
    let address = guarded::text(&q, "deposit_address")?;
    let min = q["min_amount_out"]
        .as_str()
        .and_then(|s| s.parse::<u128>().ok())
        .unwrap_or(0);
    let amount = q["amount_out"]
        .as_str()
        .and_then(|s| s.parse::<u128>().ok())
        .unwrap_or(0);
    let intent = guarded::text(&q, "intent_id")?;
    if q["amount"] != "900000"
        || min < 800_000
        || amount < min
        || !q["expires_at"]
            .as_str()
            .and_then(evidence::quote_expiry_ms)
            .is_some_and(|expiry| expiry > quote_now.saturating_add(60_000))
        || address.len() != 42
        || !address.starts_with("0x")
        || !address[2..].bytes().all(|b| b.is_ascii_hexdigit())
        || intent.is_empty()
        || intent.len() > 128
        || !intent
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    {
        return Err(err(
            "evidence",
            "unknown/unsafe deposit quote or missing actual credit floor/deadline; DO NOT FUND",
        ));
    }
    provision_unchanged(&c, &control)?;
    Ok(
        json!({"ok":true,"op":"collateral_funding_quote","quote":q,"source_asset":"Base native USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","destination_asset":USDC,"canonical_wallet_pubkey":m.wallet_pubkey,"request_body_sha256":evidence::digest(&body)?,"source_amount_max":"900000","minimum_credit":"800000","confidential":true}),
    )
}
fn op_collateral_funding_status(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "collateral_funding_status")?;
    let q: Value = serde_json::from_slice(&Store::read(
        &mut Host,
        &format!("{}/funding_quote", evidence::root(&c.token_id())),
    )?)
    .map_err(|_| {
        err(
            "evidence",
            "original quote missing; no automatic replacement",
        )
    })?;
    let id = guarded::text(&q, "intent_id")?;
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    {
        return Err(err("evidence", "unknown original provider identifier"));
    }
    let (key, wallet) = guarded_wallet(&c.token_id())?;
    // Official cross-chain endpoint documents this original intent identifier for request polling.
    let request = custody_get(&key, &format!("/wallet/v1/requests/{id}"))?;
    let balance = custody_get(
        &key,
        &format!(
            "/wallet/v1/confidential/balance?token=nep141%3A{}",
            USDC.trim_start_matches("nep141:")
        ),
    )?;
    if request["status"] != "success"
        || balance["account_id"] != wallet
        || balance["token"] != USDC
        || balance["balance"]
            .as_str()
            .and_then(|s| s.parse::<u128>().ok())
            .unwrap_or(0)
            < 800_000
    {
        return Ok(
            json!({"ok":false,"op":"collateral_funding_status","status":request["status"],"credit_verified":false,"original_intent_id":id,"automatic_retry":false}),
        );
    }
    let inventory = evidence_inventory(&key)?;
    provision_unchanged(&c, &control)?;
    Ok(
        json!({"ok":true,"op":"collateral_funding_status","credit_verified":true,"request":request,"balance":balance,"inventory_sha256":evidence::digest(&inventory)?,"canonical_wallet_pubkey":format!("ed25519:{wallet}")}),
    )
}
fn op_claim_minter_credit(input: &Value) -> Result<Value, Error> {
    if input.pointer("/auth/scheme").and_then(Value::as_str) != Some("nep413") {
        return Err(err("no_auth", "fresh owner NEP-413 required"));
    }
    let c = authenticate(input, "claim_minter_credit", false)?;
    guard_registry()?;
    if view(&keys_contract(), "config", json!({}))?["owner"] != c.account {
        return Err(err("not_owner", "contract owner only"));
    }
    let (mid, msk) = guarded_minter()?;
    let credit = view(
        &keys_contract(),
        "get_payout_credit",
        json!({"account_id":mid}),
    )?;
    let amount = credit
        .as_str()
        .and_then(|s| s.parse::<u128>().ok())
        .unwrap_or(0);
    if amount == 0
        || amount > 100_000_000_000_000_000_000_000
        || !view(
            &keys_contract(),
            "get_pending_payout",
            json!({"account_id":mid}),
        )?
        .is_null()
    {
        return Err(err("evidence", "no bounded idle minter credit"));
    }
    let seed = minter_secret(&msk)?;
    let out = native_send::execute(
        &mut Host,
        &mut NativeRpc { provision: None },
        &c.operation_id,
        &c.account,
        &mid,
        &seed,
        &keys_contract(),
        &[Action::FunctionCall {
            method: "claim_payout",
            args: b"{}",
            gas: 70_000_000_000_000,
            deposit: 1,
        }],
    )?;
    Ok(
        json!({"ok":true,"op":"claim_minter_credit","tx_hash":out.0,"native_status":out.1["status"],"amount_yocto":amount.to_string(),"receiver":mid}),
    )
}

fn prepared_review_summary(p: &Prepared, guardian: Value) -> Result<Value, Error> {
    let k = provision_root(&p.token_id, p.owner_epoch);
    let expected: Value =
        serde_json::from_slice(&Store::read(&mut Host, &format!("{k}/expected_policy"))?)
            .map_err(|_| err("evidence", "candidate missing"))?;
    let m = evidence_manifest(&p.token_id)?;
    let gh = evidence::digest(&guardian)?;
    guarded::put_once(
        &mut Host,
        &format!("{k}/guardians/{gh}"),
        guardian.to_string().as_bytes(),
    )?;
    let mut out = prepared_summary(p);
    out["candidate_policy"] = expected.clone();
    out["candidate_policy_sha256"] = json!(evidence::digest(&expected)?);
    out["manifest"] = json!(m);
    out["manifest_sha256"] = json!(evidence::digest(&m)?);
    out["guardian"] = guardian;
    out["guardian_sha256"] = json!(gh);
    out["audit_domain"] = json!(evidence::PRE);
    out["post_review_required"] = json!(true);
    Ok(out)
}

struct FreshRegister<'a> {
    c: &'a Ctx,
    control: &'a Control,
}
impl evidence::RegisterTransport for FreshRegister<'_> {
    fn register(&mut self) -> Result<Value, Error> {
        provision_unchanged(self.c, self.control)?;
        let (status, j) =
            http("POST", &format!("{OL}/register"), None, Some(&json!({}))).map_err(|_| {
                err(
                    "collateral_unknown",
                    "registration outcome unknown; never retry POST",
                )
            })?;
        if status != 200 {
            return Err(err(
                "collateral_unknown",
                "registration not terminal; never retry POST",
            ));
        }
        Ok(j)
    }
}

fn sealed_enrollment_status(
    c: &Ctx,
    control: &Control,
    p: &Prepared,
) -> Result<Option<Value>, Error> {
    if Store::read(&mut Host, &tkey(&p.token_id, "confinement_v1"))?.is_empty() {
        return Ok(None);
    }
    let proof = evidence::load_proof(&mut Host, &p.token_id)?;
    let cfg = view(&keys_contract(), "get_pledge_config", json!({}))?;
    evidence::verify_proof(
        &proof,
        &cfg_env_reviewer(),
        guarded::text(&cfg, "attestor_public_key")?,
        &keys_contract(),
    )?;
    if proof.prepared.id() != p.id() {
        return Err(err("evidence", "committed different enrollment"));
    }
    provision_unchanged(c, control)?;
    Ok(Some(
        json!({"ok":true,"op":c.req.op,"eligibility_sealed":true,"already_committed":true,"provision_id":p.id(),"report":proof.report,"report_sha256":evidence::digest(&proof.report)?}),
    ))
}
