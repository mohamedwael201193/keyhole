// An optional signed locator is an untrusted search hint, never receipt proof.
thread_local! {static EXIT_DELIVERY_LOCATOR:std::cell::RefCell<Option<Value>>=const{std::cell::RefCell::new(None)};}
// Production adapter; no arbitrary calls, keys, signing, destination or token selectors.
impl exact_exit::Host for Host {
    fn original_delivery(&mut self,j:&Journal,intent:&str)->Result<Value,Error>{
        let hint=EXIT_DELIVERY_LOCATOR.with(|p|p.borrow().clone());
        let (hash,signer)=if let Some(v)=hint {
            (guarded::text(&v,"tx_hash")?.to_owned(),guarded::text(&v,"signer_id")?.to_owned())
        }else{
            // Documented read-only resolver. Intent identifiers are never treated as
            // transaction hashes. This key is read-only relay auth, not custody auth.
            let key=cfg("INTENTS_READ_API_KEY","");
            if key.is_empty(){return Err(err("exit_receipt","original locator or configured read-only relay credential required"));}
            let body=json!({"jsonrpc":"2.0","id":"keyhole-original","method":"get_status","params":[{"intent_hash":intent}]}).to_string();
            let resp=wasi_http_client::Client::new().post("https://solver-relay-v2.chaindefuser.com/rpc").header("X-API-Key",key.as_str()).header("Content-Type","application/json").body(body.as_bytes()).connect_timeout(std::time::Duration::from_secs(20)).send().map_err(|_|err("exit_receipt","original intent lookup unavailable"))?;
            let status=resp.status();
            let v:Value=serde_json::from_slice(&resp.body().unwrap_or_default()).map_err(|_|err("exit_receipt","invalid relay reply"))?;
            if status!=200 || v.get("error").is_some() || v["result"]["intent_hash"]!=intent || v["result"]["status"]!="SETTLED" {return Err(err("exit_receipt","original intent not settled"));}
            (guarded::text(&v["result"]["data"],"hash")?.to_owned(),"intents.near".into())
        };
        if bs58::decode(&hash).into_vec().ok().is_none_or(|b|b.len()!=32)||!is_valid_account_id(&signer){return Err(err("exit_receipt","invalid original transaction locator"));}
        let (raw,e)=rpc::tx_status(&hash,&signer,"FINAL");
        if !e.is_empty(){return Err(err("exit_receipt","original FINAL receipt unavailable; supply original signer locator"));}
        let v:Value=serde_json::from_str(&raw).map_err(|_|err("exit_receipt","invalid original receipt"))?;
        let r=v.get("result").unwrap_or(&v);
        if r["transaction"]["hash"]!=hash{return Err(err("exit_receipt","RPC returned wrong original transaction"));}
        exact_receipt::verify(j,intent,&v)?;Ok(v)
    }
    fn now_ms(&mut self) -> Result<u64, Error> {
        chain_now_ms()
    }
    fn post_step(
        &mut self,
        key: &str,
        idempotency: &str,
        step: exact_exit::Step,
        body: &Value,
    ) -> Result<(u16, Value), Error> {
        http_idempotent(
            "POST",
            &format!("{OL}{}", step.path()),
            Some(key),
            Some(body),
            Some(idempotency),
        )
    }
    fn observe(&mut self, j: &Journal, key: &str) -> Result<exact_exit::Observation, Error> {
        let plan = exact_exit::Plan::journal(j)?;
        exact_exit_observation(&j.wallet_id, &plan, key)
    }
}
fn exact_exit_observation(
    wallet_id: &str,
    plan: &exact_exit::Plan,
    key: &str,
) -> Result<exact_exit::Observation, Error> {
    let private = custody_get(
        key,
        &format!("/wallet/v1/confidential/balance?token={USDC}"),
    )?;
    let public = custody_get(
        key,
        &format!("/wallet/v1/balance?chain=near&token={USDC}&source=intents&account=executor"),
    )?;
    let intents = view(
        "intents.near",
        "mt_balance_of",
        json!({"account_id":wallet_id,"token_id":USDC}),
    )?;
    let recipient = view(
        exact_exit::TOKEN,
        "ft_balance_of",
        json!({"account_id":plan.to}),
    )?;
    let storage = view(
        exact_exit::TOKEN,
        "storage_balance_of",
        json!({"account_id":plan.to}),
    )?;
    let bounds = view(exact_exit::TOKEN, "storage_balance_bounds", json!({}))?;
    let (native, e) = rpc::view_account(wallet_id, "final");
    if !e.is_empty() {
        return Err(err("exit_readback", "native reserve unavailable"));
    }
    let native: Value = serde_json::from_str(&native)
        .map_err(|_| err("exit_readback", "invalid native reserve"))?;
    exact_exit::decode_readbacks(
        wallet_id,
        exact_exit::Readbacks {
            private: &private,
            public: &public,
            intents: &intents,
            recipient: &recipient,
            storage: &storage,
            bounds: &bounds,
            native: &native,
        },
    )
}

// Fail before unshield/spend when the installed policy is still the old template.
// An on-chain lock/readback alone is not proof of the separately reviewed policy.
fn exact_exit_policy(token: &str, key: &str, wallet_id: &str) -> Result<(), Error> {
    // Collateral flows keep the reviewed-confinement gate. A plain holder vault (no confinement
    // marker, no pledge, no loan, no collateral binding) takes the standard self-exit: the
    // three journaled hops, FINAL readbacks and the holder-only recipient still apply, and the
    // provider's own wallet policy still decides what the wallet may do.
    if Store::read(&mut Host, &tkey(token, "confinement_v1"))?.is_empty() {
        let control = guard_control(token)?;
        let loan = view(&keys_contract(), "get_loan", json!({"token_id":token}))?;
        let binding = view(&keys_contract(), "get_collateral_binding", json!({"token_id":token}))?;
        if control.pledged || !loan.is_null() || !binding.is_null() {
            return Err(err(
                "exit_not_enrolled",
                "vault has a loan or collateral binding but no reviewed confinement; exact exit unavailable",
            ));
        }
        return Ok(());
    }
    let proof = evidence::load_proof(&mut Host, token)?;
    let config = view(&keys_contract(), "get_pledge_config", json!({}))?;
    evidence::verify_proof(
        &proof,
        &cfg_env_reviewer(),
        guarded::text(&config, "attestor_public_key")?,
        &keys_contract(),
    )?;
    evidence::validate_policy(&proof.expected_policy, &proof.manifest)?;
    if proof.prepared.worker_hash != cfg("GUARDED_WORKER_HASH", "")
        || proof.prepared.wallet_pubkey != format!("ed25519:{wallet_id}")
        || proof.manifest.api_key_sha256 != sha256_hex(key)
    {
        return Err(err(
            "exit_policy",
            "reviewed confinement does not match exact worker/wallet/key",
        ));
    }
    let binding = view(
        &keys_contract(),
        "get_collateral_binding",
        json!({"token_id":token}),
    )?;
    let public = view(
        guarded::text(&config, "custody_contract")?,
        "get_wallet_policy",
        json!({"wallet_pubkey":proof.prepared.wallet_pubkey}),
    )?;
    let effective = custody_get(key, "/wallet/v1/policy")?;
    if !collateral::binding_matches(&proof.prepared, &binding, &public, &keys_contract())
        || !collateral::effective_policy_matches(
            &proof.expected_policy,
            &effective,
            &proof.prepared,
            &keys_contract(),
        )
    {
        return Err(err(
            "exit_policy",
            "current locked/thawed decrypted policy differs from exact reviewed exit policy",
        ));
    }
    Ok(())
}
