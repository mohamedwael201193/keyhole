// Thin production transport: every minter entry uses native_send::execute.
use keyhole_worker::native_send;
struct NativeRpc {
    provision: Option<(Prepared, u128, PreAudit)>,
}
impl native_send::Rpc for NativeRpc {
    fn preflight(&mut self) -> Result<(), Error> {
        if let Some((p, deposit, _)) = &self.provision {
            let k = provision_root(&p.token_id, p.owner_epoch);
            if !Store::read(&mut Host, &format!("{k}/submitted"))?.is_empty() {
                return Err(err(
                    "collateral_unknown",
                    "original provisioning send already recorded",
                ));
            }
            let (mid, _) = guarded_minter()?;
            provision_native_budget(&mid, *deposit)?;
        }
        Ok(())
    }
    fn prepared(&mut self, p: &native_send::Plan) -> Result<(), Error> {
        if let Some((prepared, deposit, audit)) = &self.provision {
            let k = provision_root(&prepared.token_id, prepared.owner_epoch);
            guarded::put_once(
                &mut Host,
                &format!("{k}/audit"),
                &serde_json::to_vec(audit).map_err(|_| err("storage", "audit encoding"))?,
            )?;
            guarded::put_once(
                &mut Host,
                &format!("{k}/deposit"),
                deposit.to_string().as_bytes(),
            )?;
            guarded::put_once(&mut Host, &format!("{k}/tx_hash"), p.hash.as_bytes())?;
            if !Host.set_if_absent(&format!("{k}/submitted"), b"1")? {
                return Err(err("collateral_unknown", "native send already claimed"));
            }
        }
        Ok(())
    }
    fn nonce(&mut self, signer: &str, public_key: &str) -> Result<u64, Error> {
        let (v, e) = rpc::view_access_key(signer, public_key, "final");
        if !e.is_empty() {
            return Err(err("rpc", "native access key unavailable"));
        }
        if serde_json::from_str::<Value>(&v).is_err() {
            return Err(err("rpc", "invalid native access key"));
        }
        // Same flattened-or-envelope shapes `is_full_access` already accepts (auth succeeded).
        access_key_nonce(&v).ok_or_else(|| err("rpc", "missing native nonce"))
    }
    fn block(&mut self) -> Result<([u8; 32], Option<u64>), Error> {
        let (v, e) = rpc::block("final");
        if !e.is_empty() {
            return Err(err("rpc", "final block unavailable"));
        }
        if serde_json::from_str::<Value>(&v).is_err() {
            return Err(err("rpc", "invalid final block"));
        }
        // Same flattened-or-envelope shapes `chain_now_ms` already accepts.
        let h = final_block_hash(&v).ok_or_else(|| err("rpc", "invalid block hash"))?;
        Ok((h, native_send::block_height(&v)))
    }
    fn broadcast(&mut self, signed: &str) -> Result<Value, Error> {
        let (v, e) = rpc::send_tx(signed, "FINAL");
        if !e.is_empty() {
            return Err(err(
                "native_unknown",
                "original send response unavailable; reconcile, never resend",
            ));
        }
        serde_json::from_str(&v)
            .map_err(|_| err("native_unknown", "invalid original send response"))
    }
    fn status(&mut self, hash: &str, signer: &str) -> Result<Value, Error> {
        // NONE returns the official cause without waiting. FINAL timeouts were
        // previously collapsed into "not yet FINAL" and hid UNKNOWN_TRANSACTION.
        let (v, e) = rpc::tx_status(hash, signer, "NONE");
        if native_send::rpc_reports_unknown(&v, &e) {
            return Err(err("unknown_transaction", "UNKNOWN_TRANSACTION"));
        }
        if !e.is_empty() {
            return Err(err("native_unknown", "original send not yet FINAL"));
        }
        let body: Value = serde_json::from_str(&v)
            .map_err(|_| err("native_unknown", "original status unavailable"))?;
        if body.pointer("/final_execution_status").and_then(|x| x.as_str()) == Some("FINAL")
            || body.pointer("/result/final_execution_status").and_then(|x| x.as_str()) == Some("FINAL")
        {
            return Ok(body);
        }
        let (v2, e2) = rpc::tx_status(hash, signer, "FINAL");
        if native_send::rpc_reports_unknown(&v2, &e2) {
            return Err(err("unknown_transaction", "UNKNOWN_TRANSACTION"));
        }
        if !e2.is_empty() {
            return Err(err("native_unknown", "original send not yet FINAL"));
        }
        serde_json::from_str(&v2).map_err(|_| err("native_unknown", "original status unavailable"))
    }
    fn validity_context(&mut self, plan: &native_send::Plan) -> (Option<u64>, Option<u64>, Option<u64>) {
        // A stored height needs no lookup (the caller prefers it); only legacy plans look it up.
        let ref_h = if plan.reference_height.is_some() {
            None
        } else {
            native_send::plan_block_hash(plan)
        }
        .and_then(|h| {
            let (raw, e) = rpc::block(&bs58::encode(h).into_string());
            if e.is_empty() {
                native_send::block_height(&raw)
            } else {
                None
            }
        });
        let final_h = {
            let (raw, e) = rpc::block("final");
            if e.is_empty() {
                native_send::block_height(&raw)
            } else {
                None
            }
        };
        let period = {
            let (raw, e) = rpc::raw(
                "EXPERIMENTAL_protocol_config",
                r#"{"finality":"final"}"#,
            );
            if e.is_empty() {
                native_send::transaction_validity_period(&raw)
            } else {
                None
            }
        };
        (ref_h, final_h, period)
    }
}
fn send_full(
    signer: &str,
    sk_str: &str,
    receiver: &str,
    actions: &[Action],
) -> Result<(String, Value), Error> {
    let seed = minter_secret(sk_str)?;
    let mut id = [0u8; 32];
    getrandom::fill(&mut id).map_err(|_| err("rng", "native id unavailable"))?;
    let actor = BIND
        .with(|b| b.borrow().as_ref().map(|v| v.0.clone()))
        .unwrap_or_else(keys_contract);
    native_send::execute(
        &mut Host,
        &mut NativeRpc { provision: None },
        &hex::encode(id),
        &actor,
        signer,
        &seed,
        receiver,
        actions,
    )
}
fn op_reconcile_minter_send(input: &Value) -> Result<Value, Error> {
    if input.pointer("/auth/scheme").and_then(Value::as_str) != Some("nep413") {
        return Err(err("no_auth", "fresh NEP-413 required"));
    }
    let c = authenticate(input, "reconcile_minter_send", false)?;
    let Some(t) = native_send::current(&mut Host)? else {
        return Ok(json!({"ok":true,"status":"idle"}));
    };
    if c.account != t.actor && c.account != keys_contract() {
        return Err(err(
            "not_owner",
            "only original actor or project owner may recover minter send",
        ));
    }
    if c.req.params["abort_unsent"] == true {
        native_send::abort_unsent(&mut Host, &t)?;
        return Ok(json!({"ok":true,"status":"proven_never_submitted"}));
    }
    let (p, v, success) =
        native_send::reconcile(&mut Host, &mut NativeRpc { provision: None }, &t)?;
    if v.get("does_not_exist") == Some(&Value::Bool(true)) {
        return Ok(json!({
            "ok": true,
            "tx_hash": p.hash,
            "status": "does_not_exist",
            "reference_block_height": v.get("reference_block_height"),
            "final_height": v.get("final_height"),
            "transaction_validity_period": v.get("transaction_validity_period"),
        }));
    }
    Ok(json!({"ok":true,"tx_hash":p.hash,"status":if success{"success"}else{"failed"}}))
}
