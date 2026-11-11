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
        let v: Value =
            serde_json::from_str(&v).map_err(|_| err("rpc", "invalid native access key"))?;
        v["nonce"]
            .as_u64()
            .ok_or_else(|| err("rpc", "missing native nonce"))
    }
    fn block(&mut self) -> Result<[u8; 32], Error> {
        let (v, e) = rpc::block("final");
        if !e.is_empty() {
            return Err(err("rpc", "final block unavailable"));
        }
        let v: Value = serde_json::from_str(&v).map_err(|_| err("rpc", "invalid final block"))?;
        bs58::decode(guarded::text(&v["header"], "hash")?)
            .into_vec()
            .ok()
            .and_then(|b| b.try_into().ok())
            .ok_or_else(|| err("rpc", "invalid block hash"))
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
        let (v, e) = rpc::tx_status(hash, signer, "FINAL");
        if !e.is_empty() {
            return Err(err("native_unknown", "original send not yet FINAL"));
        }
        serde_json::from_str(&v).map_err(|_| err("native_unknown", "original status unavailable"))
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
    let (p, _, success) =
        native_send::reconcile(&mut Host, &mut NativeRpc { provision: None }, &t)?;
    Ok(json!({"ok":true,"tx_hash":p.hash,"status":if success{"success"}else{"failed"}}))
}
