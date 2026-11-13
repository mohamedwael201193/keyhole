// Thin production transport: every minter entry uses native_send::execute.
use keyhole_worker::native_send;
/// The single shared transport for every send-tx call site (the stale test
/// enforces exactly one occurrence of the transport call in this file).
fn send_tx(signed: &str, wait_until: &str) -> Result<Value, Error> {
    // Round 4: the transport choke point. A send changes on-chain state,
    // so the per-run read cache is invalidated after EVERY send — including
    // a send whose response is unavailable (the tx may still have landed).
    // A cached value can therefore never survive a send.
    let (v, e) = rpc::send_tx(signed, wait_until);
    keyhole_worker::read_cache::invalidate();
    if !e.is_empty() {
        return Err(err(
            "native_unknown",
            "original send response unavailable; reconcile, never resend",
        ));
    }
    serde_json::from_str(&v)
        .map_err(|_| err("native_unknown", "invalid original send response"))
}
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
        // Round 4: the final block is cached per run, shared with
        // chain_now_ms (which populates it). The cache is invalidated
        // after every send, so a stale hash is impossible.
        if let Some(cached) = keyhole_worker::read_cache::get_block() {
            return Ok((cached.hash, cached.height));
        }
        let (v, e) = rpc::block("final");
        if !e.is_empty() {
            return Err(err("rpc", "final block unavailable"));
        }
        if serde_json::from_str::<Value>(&v).is_err() {
            return Err(err("rpc", "invalid final block"));
        }
        // Same flattened-or-envelope shapes `chain_now_ms` already accepts.
        let h = final_block_hash(&v).ok_or_else(|| err("rpc", "invalid block hash"))?;
        let height = native_send::block_height(&v);
        if let Some(entry) = keyhole_worker::parse_final_block(&v) {
            keyhole_worker::read_cache::put_block(entry);
        }
        Ok((h, height))
    }
    fn broadcast(&mut self, signed: &str) -> Result<Value, Error> {
        // NONE, never FINAL: the OutLayer host caps every near:rpc call at
        // 30 s total / 10 s connect with no retry (host_functions_sync.rs),
        // so a FINAL wait that outlasts 30 s returns "Failed to send RPC
        // request" even when the tx was accepted — and gives no hash. That is
        // the exact failure that created the lost claim_payout (J5dHg2q…).
        // The tx hash is computed from the signed bytes BEFORE sending
        // (native_send::execute), so the caller polls tx_status by hash
        // afterwards; a tx that is not FINAL yet returns pending with the
        // hash, never UNKNOWN-without-hash.
        send_tx(signed, "NONE")
    }
    fn broadcast_async(&mut self, signed: &str) -> Result<Value, Error> {
        // Async re-broadcast of the exact stored bytes (same hash/nonce):
        // the node rejects a duplicate, so the tx can never execute twice.
        send_tx(signed, "NONE")
    }
    fn status(&mut self, hash: &str, signer: &str) -> Result<Value, Error> {
        // Short NONE poll only — NEVER a FINAL wait inside one host call.
        // The OutLayer host caps every near:rpc call at 30 s, so a FINAL
        // wait that outlasts 30 s returns "Failed to send RPC request" even
        // when the tx was accepted (the lost claim_payout, J5dHg2q…). NONE
        // returns the official cause without waiting, and finality is read
        // from the response body instead: a tx that is not FINAL yet returns
        // "not yet FINAL" here and the caller polls again by hash
        // (reconcile) — never re-signs.
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
        Err(err("native_unknown", "original send not yet FINAL"))
    }
    fn pause(&mut self) {
        // The host pause, shared with the provider driver (guarded_host.rs):
        // a 2 s thread sleep. In wasi-p2 this yields on the monotonic clock;
        // it is the only wait the worker has (no busy loop, no timer API).
        // It spaces status re-polls so a tx has time to enter a block
        // (native_send::MAX_STATUS_POLLS) instead of three instant polls
        // all returning UNKNOWN_TRANSACTION before the tx is indexed.
        std::thread::sleep(std::time::Duration::from_secs(2));
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
            // Round 4: reuse the cached final block (populated by
            // chain_now_ms / NativeRpc::block) instead of a fresh read.
            if let Some(cached) = keyhole_worker::read_cache::get_block() {
                cached.height
            } else {
                let (raw, e) = rpc::block("final");
                if e.is_empty() {
                    if let Some(entry) = keyhole_worker::parse_final_block(&raw) {
                        keyhole_worker::read_cache::put_block(entry);
                    }
                    native_send::block_height(&raw)
                } else {
                    None
                }
            }
        };
        let period = {
            // Round 4: the protocol config is static for the run; cache
            // the raw response so a second reconcile does not re-read it.
            let raw_opt = match keyhole_worker::read_cache::get_protocol_config() {
                Some(raw) => Some(raw),
                None => {
                    let (raw, e) = rpc::raw(
                        "EXPERIMENTAL_protocol_config",
                        r#"{"finality":"final"}"#,
                    );
                    if e.is_empty() {
                        keyhole_worker::read_cache::put_protocol_config(raw.clone());
                        Some(raw)
                    } else {
                        None
                    }
                }
            };
            raw_opt.and_then(|raw| native_send::transaction_validity_period(&raw))
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
fn op_rebroadcast_minter_send(input: &Value) -> Result<Value, Error> {
    // Re-broadcast the exact signed bytes of the current unresolved ticket
    // (lost claim_payout J5dHg2q…, ref block 224377957). Fresh NEP-413 by the
    // ticket's actor or the project owner. Never re-signs: the bytes come from
    // the stored plan. Only while the validity window is provably open;
    // refused after expiry. If the tx is FINAL, the ticket clears here;
    // otherwise the caller runs the normal reconcile once it is FINAL.
    if input.pointer("/auth/scheme").and_then(Value::as_str) != Some("nep413") {
        return Err(err("no_auth", "fresh NEP-413 required"));
    }
    let c = authenticate(input, "rebroadcast_minter_send", false)?;
    let Some(t) = native_send::current(&mut Host)? else {
        return Ok(json!({"ok":true,"status":"idle"}));
    };
    if c.account != t.actor && c.account != keys_contract() {
        return Err(err(
            "not_owner",
            "only original actor or project owner may rebroadcast minter send",
        ));
    }
    native_send::rebroadcast(&mut Host, &mut NativeRpc { provision: None }, &t)
}
