// Included in WASI host. Every write below is enclave storage or an explicitly
// holder-authorized production operation; native unit/sandbox tests never call it.
use keyhole_worker::collateral::{self, AuthorityAudit, Prepared};
fn provision_root(token: &str) -> String {
    tkey(token, "collateral_provision_v1")
}
fn provision_idle(token: &str) -> Result<(), Error> {
    let k = provision_root(token);
    if !Store::read(&mut Host, &format!("{k}/claimed"))?.is_empty()
        && Store::read(&mut Host, &format!("{k}/complete"))?.is_empty()
    {
        return Err(err(
            "collateral_unknown",
            "collateral provisioning holds this wallet; reconcile original operation",
        ));
    }
    Ok(())
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
fn load_prepared(token: &str) -> Result<Prepared, Error> {
    serde_json::from_slice(&Store::read(
        &mut Host,
        &format!("{}/prepared", provision_root(token)),
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
    let k = provision_root(&token);
    if !Store::read(&mut Host, &format!("{k}/prepared"))?.is_empty() {
        let p = load_prepared(&token)?;
        if p.owner != c.account || p.owner_epoch != control.epoch {
            return Err(err(
                "epoch_changed",
                "preparation belongs to previous title",
            ));
        }
        return Ok(prepared_summary(&p));
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
    let policy = collateral::policy(wallet_id, &key, approvers, threshold)?;
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
    // Claim before any policy signature. A lost POST is deliberately not retried.
    if !Host.set_if_absent(&format!("{k}/claimed"), c.operation_id.as_bytes())? {
        return Err(err(
            "collateral_unknown",
            "preparation already dispatched; never repeat POST",
        ));
    }
    if let Err(e) = provision_unchanged(&c, &control) {
        // No external POST exists yet. Do not trap an already-admitted journal.
        if Store::read(&mut Host, &format!("{k}/claimed"))? == c.operation_id.as_bytes() {
            Host.remove(&format!("{k}/claimed"))?;
        }
        return Err(e);
    }
    guarded::put_once(
        &mut Host,
        &format!("{k}/expected_policy"),
        policy.to_string().as_bytes(),
    )?;
    let (st, encrypted) = http(
        "POST",
        &format!("{OL}/wallet/v1/encrypt-policy"),
        Some(&key),
        Some(&policy),
    )?;
    if st != 200 || encrypted["wallet_pubkey"] != format!("ed25519:{id}") {
        return Err(err(
            "collateral_unknown",
            "policy encryption unavailable; wallet remains held",
        ));
    }
    let ciphertext = guarded::text(&encrypted, "encrypted_base64")?.to_owned();
    let plaintext_hash = guarded::text(&encrypted, "policy_hash")?.to_owned();
    if ciphertext.is_empty() || ciphertext.len() > 4096 || !guarded::lower_hash(&plaintext_hash) {
        return Err(err("collateral_unknown", "invalid encryption response"));
    }
    guarded::put_once(
        &mut Host,
        &format!("{k}/encrypted"),
        encrypted.to_string().as_bytes(),
    )?;
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
        || signed["public_key_hex"] != id
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
    Ok(prepared_summary(&p))
}
fn provision_identity(c: &Ctx, control: &Control, p: &Prepared) -> Result<(), Error> {
    if p.token_id != c.token_id()
        || p.owner != c.account
        || p.owner_epoch != control.epoch
        || p.worker_hash != cfg("GUARDED_WORKER_HASH", "")
        || c.req.params["provision_id"] != p.id()
    {
        return Err(err("collateral_audit", "plan/holder/epoch/build mismatch"));
    }
    Ok(())
}
fn op_provision_collateral(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "provision_collateral")?;
    let p = load_prepared(&c.token_id())?;
    let k = provision_root(&p.token_id);
    provision_identity(&c, &control, &p)?;
    // Once submission has been claimed, this entry point can only reconcile it.
    if !Store::read(&mut Host, &format!("{k}/submitted"))?.is_empty() {
        return reconcile_provision(&c, &control, &p);
    }
    let now = chain_now_ms()? / 1000;
    p.validate(&keys_contract(), now)?;
    let a = collateral::audit(
        guarded::text(&c.req.params, "audit_message")?,
        guarded::text(&c.req.params, "audit_signature")?,
        &cfg("COLLATERAL_AUDITOR_PUBLIC_KEY", ""),
        &p,
        &keys_contract(),
        now,
    )?;
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
    // Construct and check native reserve before taking a persistent global latch.
    let (hash, signed) = provision_signed_tx(&mid, &msk, &p, deposit)?;
    provision_unchanged(&c, &control)?;
    // A global latch protects this minter nonce until exact FINAL reconciliation.
    if !Host.set_if_absent("w/collateral_minter_pending", p.id().as_bytes())? {
        return Err(err(
            "collateral_unknown",
            "minter has an unresolved provisioning send",
        ));
    }
    guarded::put_once(
        &mut Host,
        &format!("{k}/audit"),
        &serde_json::to_vec(&a).map_err(|_| err("storage", "audit encoding"))?,
    )?;
    guarded::put_once(
        &mut Host,
        &format!("{k}/deposit"),
        deposit.to_string().as_bytes(),
    )?;
    guarded::put_once(&mut Host, &format!("{k}/tx_hash"), hash.as_bytes())?;
    if !Host.set_if_absent(&format!("{k}/submitted"), b"1")? {
        return Err(err(
            "collateral_unknown",
            "original transaction already claimed",
        ));
    }
    provision_unchanged(&c, &control)?;
    // Persist original hash BEFORE broadcast; never resend, even on a transport error.
    let _ = rpc::send_tx(&signed, "FINAL");
    reconcile_provision(&c, &control, &p)
}
fn provision_signed_tx(
    mid: &str,
    msk: &str,
    p: &Prepared,
    deposit: u128,
) -> Result<(String, String), Error> {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let seed = minter_secret(msk)?;
    let pk = ed25519_dalek::SigningKey::from_bytes(&seed)
        .verifying_key()
        .to_bytes();
    let (raw, e) = rpc::view_access_key(
        mid,
        &format!("ed25519:{}", bs58::encode(pk).into_string()),
        "final",
    );
    if !e.is_empty() {
        return Err(err("rpc", "minter access key unavailable"));
    }
    let ak: Value = serde_json::from_str(&raw).map_err(|_| err("rpc", "invalid access key"))?;
    let nonce = ak["nonce"]
        .as_u64()
        .and_then(|n| n.checked_add(1))
        .ok_or_else(|| err("rpc", "invalid minter nonce"))?;
    let (b, e) = rpc::block("final");
    if !e.is_empty() {
        return Err(err("rpc", "final block unavailable"));
    }
    let b: Value = serde_json::from_str(&b).map_err(|_| err("rpc", "invalid final block"))?;
    let bh: [u8; 32] = bs58::decode(guarded::text(&b["header"], "hash")?)
        .into_vec()
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| err("rpc", "invalid block hash"))?;
    let (price, e) = rpc::gas_price("");
    if !e.is_empty() {
        return Err(err("rpc", "gas price unavailable"));
    }
    let price: Value = serde_json::from_str(&price).map_err(|_| err("rpc", "invalid gas price"))?;
    let fee = guarded::decimal(&price, "gas_price")?
        .checked_mul(240_000_000_000_000)
        .ok_or_else(|| err("collateral_quote", "gas overflow"))?;
    let (account, e) = rpc::view_account(mid, "final");
    if !e.is_empty() {
        return Err(err("rpc", "minter balance unavailable"));
    }
    let account: Value =
        serde_json::from_str(&account).map_err(|_| err("rpc", "invalid account"))?;
    let backing = (account["storage_usage"]
        .as_u64()
        .ok_or_else(|| err("rpc", "missing storage usage"))? as u128)
        * 10_000_000_000_000_000_000;
    if deposit + fee > 100_000_000_000_000_000_000_000
        || guarded::decimal(&account, "amount")?
            < backing + deposit + fee + 1_000_000_000_000_000_000_000
    {
        return Err(err(
            "collateral_quote",
            "minter reserve or transaction ceiling insufficient",
        ));
    }
    let args = p.args().to_string();
    let tx = encode_tx(
        mid,
        &pk,
        nonce,
        &keys_contract(),
        &bh,
        &[Action::FunctionCall {
            method: "register_collateral",
            args: args.as_bytes(),
            gas: 200_000_000_000_000,
            deposit,
        }],
    );
    let hash = bs58::encode(Sha256::digest(&tx)).into_string();
    let signed = sign_tx(&seed, &tx);
    Ok((
        hash,
        base64::engine::general_purpose::STANDARD.encode(signed),
    ))
}
fn op_reconcile_collateral(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "reconcile_collateral")?;
    let p = load_prepared(&c.token_id())?;
    provision_identity(&c, &control, &p)?;
    reconcile_provision(&c, &control, &p)
}
fn reconcile_provision(c: &Ctx, control: &Control, p: &Prepared) -> Result<Value, Error> {
    let k = provision_root(&p.token_id);
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
    let (r, e) = rpc::tx_status(&hash, &mid, "FINAL");
    let tx: Value = serde_json::from_str(&r).unwrap_or(Value::Null);
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
    if Store::read(&mut Host, "w/collateral_minter_pending")? == p.id().as_bytes() {
        Host.remove("w/collateral_minter_pending")?;
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
    if !collateral::effective_policy_matches(&expected, &effective, p, &keys_contract()) {
        return Err(err(
            "collateral_ineligible",
            "effective custody policy differs from reviewed restricted policy",
        ));
    }
    certificate_inventory(&key)?;
    provision_unchanged(c, control)?;
    let a: AuthorityAudit = serde_json::from_slice(&Store::read(&mut Host, &format!("{k}/audit"))?)
        .map_err(|_| err("storage", "approved audit missing"))?;
    collateral::seal_eligibility(&mut Host, p, &a, &b, &policy, &keys_contract(), terminal)?;
    guarded::put_once(&mut Host, &format!("{k}/complete"), hash.as_bytes())?;
    // Only this provisioner may release its global minter latch.
    if Store::read(&mut Host, "w/collateral_minter_pending")? == p.id().as_bytes() {
        Host.remove("w/collateral_minter_pending")?;
    }
    Ok(
        json!({"ok":true,"op":"reconcile_collateral","status":"success","provision_id":p.id(),"tx_hash":hash,"binding_ready":true,"eligibility_sealed":true,"deposit_yocto":deposit.to_string()}),
    )
}
/// Public output is a quote and non-reusable hashes, never the policy signature or API key.
fn op_collateral_quote(input: &Value) -> Result<Value, Error> {
    let (c, control) = provision_auth(input, "collateral_quote")?;
    let p = load_prepared(&c.token_id())?;
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
    let (key, _) = guarded_wallet(&c.token_id())?;
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
        "approval_and_cooldown_must_be_verified":true,"broadcast":false}),
    )
}
