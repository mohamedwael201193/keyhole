// Production adapter; no arbitrary calls, keys, signing, destination or token selectors.
impl exact_exit::Host for Host {
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
