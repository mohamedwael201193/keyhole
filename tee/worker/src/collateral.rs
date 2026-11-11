//! Fail-closed collateral provisioning primitives. No secret or caller-provided audit is trusted
//! without a signature from the separately configured confinement reviewer.
use crate::{err, guarded, sha256_hex, Error, Store};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const DOMAIN: &str = "KEYHOLE_COLLATERAL_AUDIT_V1";
pub const BINDING_DEPOSIT: u128 = 20_000_000_000_000_000_000_000;
pub const MAX_QUOTE: u128 = 46_190_000_000_000_000_000_000;

/// Only the worker constructs the policy. Raw signing, arbitrary Intents calls, external keys,
/// resting orders and cross-chain signing are not enabled. Ordinary confidential paths
/// remain available after the controller thaws, under the existing holder/epoch gates.
pub fn policy(
    wallet_id: &str,
    api_key: &str,
    approvers: &Value,
    threshold: u64,
) -> Result<Value, Error> {
    let a = approvers
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 3)
        .ok_or_else(|| {
            err(
                "collateral_policy",
                "one to three reachable approvers required",
            )
        })?;
    let mut ids = std::collections::BTreeSet::new();
    for row in a {
        let o = row
            .as_object()
            .filter(|o| o.len() == 1)
            .ok_or_else(|| err("collateral_policy", "approvers accept id only"))?;
        let id = o
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| crate::is_valid_account_id(s))
            .ok_or_else(|| err("collateral_policy", "valid approver id required"))?;
        if !ids.insert(id) {
            return Err(err("collateral_policy", "duplicate approver"));
        }
    }
    if threshold == 0
        || threshold as usize > ids.len()
        || wallet_id.is_empty()
        || api_key.is_empty()
    {
        return Err(err(
            "collateral_policy",
            "unreachable quorum or missing custody",
        ));
    }
    Ok(json!({"wallet_id":wallet_id,
        "rules":{"transaction_types":["confidential","swap","cross_chain_withdraw","withdraw","call"]},
        "approval":{"locked":true,"threshold":threshold,"approvers":a,
            "excluded_types":["confidential","swap","cross_chain_withdraw","withdraw"]},
        "capabilities":{"confidential":{"allowed":true},"swap":{"allowed":true},
            "cross_chain_withdraw":{"allowed":true},"sign_message":{"allowed":false},
            "raw_sign":{"allowed":false},"evm_sign":{"allowed":false},
            "solana_sign":{"allowed":false},"intents_call":{"allowed":false},
            "limit_order":{"allowed":false},"payment_check":{"allowed":false}},
        "authorized_key_hashes":[sha256_hex(api_key)]}))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Prepared {
    pub token_id: String,
    pub owner: String,
    pub owner_epoch: u64,
    pub worker_hash: String,
    pub wallet_pubkey: String,
    pub plaintext_hash: String,
    pub encrypted_data: String,
    pub wallet_signature: String,
    pub version: u64,
    pub valid_until: u64,
}
impl Prepared {
    pub fn id(&self) -> String {
        sha256_hex(&serde_json::to_string(self).expect("serializable plan"))
    }
    pub fn policy_hash(&self) -> String {
        B64.encode(Sha256::digest(self.encrypted_data.as_bytes()))
    }
    pub fn args(&self) -> Value {
        json!({"token_id":self.token_id,"wallet_pubkey":self.wallet_pubkey,
        "encrypted_data":self.encrypted_data,"wallet_signature":self.wallet_signature,
        "version":self.version,"valid_until":self.valid_until,"expected_owner_id":self.owner,"expected_owner_epoch":self.owner_epoch.to_string()})
    }
    pub fn validate(&self, contract: &str, now_sec: u64) -> Result<(), Error> {
        if !guarded::lower_hash(&self.worker_hash)
            || !guarded::lower_hash(&self.plaintext_hash)
            || !self
                .wallet_pubkey
                .strip_prefix("ed25519:")
                .is_some_and(guarded::lower_hash)
            || self.encrypted_data.is_empty()
            || self.encrypted_data.len() > 4096
            || self.version != 1
            || self.valid_until <= now_sec.saturating_add(60)
            || self.token_id.is_empty()
            || self.token_id.len() > 64
        {
            return Err(err(
                "collateral_policy",
                "invalid or stale fresh-policy artifact",
            ));
        }
        let pk: [u8; 32] = hex::decode(self.wallet_pubkey.trim_start_matches("ed25519:"))
            .ok()
            .and_then(|v| v.try_into().ok())
            .ok_or_else(|| err("collateral_policy", "invalid wallet key"))?;
        let sig: [u8; 64] = hex::decode(&self.wallet_signature)
            .ok()
            .and_then(|v| v.try_into().ok())
            .ok_or_else(|| err("collateral_policy", "invalid wallet signature"))?;
        let message = format!(
            "store_wallet_policy:v2:{}:{}:1:{}:{}:{}:{}",
            self.wallet_pubkey,
            self.version,
            self.valid_until,
            self.encrypted_data.len(),
            self.encrypted_data,
            contract
        );
        VerifyingKey::from_bytes(&pk)
            .map_err(|_| err("collateral_policy", "invalid wallet key"))?
            .verify_strict(
                &Sha256::digest(message.as_bytes()),
                &Signature::from_bytes(&sig),
            )
            .map_err(|_| {
                err(
                    "collateral_policy",
                    "provider signature does not bind caller/locked/artifact",
                )
            })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorityAudit {
    pub domain: String,
    pub project_uuid: String,
    pub contract: String,
    pub provision_id: String,
    pub authority_audit_sha256: String,
    pub issued_at_sec: u64,
    pub expires_at_sec: u64,
    pub no_presigned_authorities: bool,
    pub all_aliases_reviewed: bool,
    pub old_jobs_drained: bool,
    pub external_chain_authorities_reviewed: bool,
    pub effective_policy_reviewed: bool,
    pub reachable_quorum_verified: bool,
}
/// Verify exact bytes, not reserialized JSON. A caller cannot nominate the review key.
/// The signed review commits to a sealed plan, and hence wallet, owner epoch, runtime
/// build, ciphertext, plaintext hash, caller-bound provider signature and validity.
pub fn audit(
    message: &str,
    signature: &str,
    pinned_key: &str,
    p: &Prepared,
    contract: &str,
    now: u64,
) -> Result<AuthorityAudit, Error> {
    if message.len() > 4096 {
        return Err(err("collateral_audit", "oversized review"));
    }
    let a: AuthorityAudit =
        serde_json::from_str(message).map_err(|_| err("collateral_audit", "invalid review"))?;
    if a.domain != DOMAIN
        || a.project_uuid != guarded::PROJECT_UUID
        || a.contract != contract
        || a.provision_id != p.id()
        || !guarded::lower_hash(&a.authority_audit_sha256)
        || !a.no_presigned_authorities
        || !a.all_aliases_reviewed
        || !a.old_jobs_drained
        || !a.external_chain_authorities_reviewed
        || !a.effective_policy_reviewed
        || !a.reachable_quorum_verified
        || a.issued_at_sec > now
        || a.expires_at_sec <= now
        || a.expires_at_sec > a.issued_at_sec.saturating_add(900)
    {
        return Err(err(
            "collateral_audit",
            "incomplete, expired or wrong-plan authority review",
        ));
    }
    let pk: [u8; 32] = B64
        .decode(pinned_key)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or_else(|| err("collateral_audit", "reviewer key not configured"))?;
    let sig: [u8; 64] = B64
        .decode(signature)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or_else(|| err("collateral_audit", "invalid review signature"))?;
    VerifyingKey::from_bytes(&pk)
        .map_err(|_| err("collateral_audit", "invalid reviewer key"))?
        .verify_strict(
            format!("{DOMAIN}\n{message}").as_bytes(),
            &Signature::from_bytes(&sig),
        )
        .map_err(|_| err("collateral_audit", "unapproved authority review"))?;
    Ok(a)
}

pub fn quote(q: &Value, max: &str) -> Result<u128, Error> {
    let q = q
        .as_str()
        .and_then(|s| s.parse::<u128>().ok())
        .filter(|q| *q > 0 && *q <= MAX_QUOTE)
        .ok_or_else(|| err("collateral_quote", "invalid current provider quote"))?;
    let d = BINDING_DEPOSIT
        .checked_add(q)
        .ok_or_else(|| err("collateral_quote", "overflow"))?;
    let max = max
        .parse::<u128>()
        .map_err(|_| err("collateral_quote", "signed maximum required"))?;
    if d > max || max > BINDING_DEPOSIT + MAX_QUOTE {
        return Err(err("collateral_quote", "binding exceeds signed budget"));
    }
    Ok(d)
}

/// The ciphertext signature is checked separately. Also require the provider's
/// current decrypted view to expose the exact restricted rules actually prepared.
pub fn effective_policy_matches(
    expected: &Value,
    observed: &Value,
    p: &Prepared,
    contract: &str,
) -> bool {
    // Complete reviewed policy projection; metadata is a closed allowlist, never
    // a reason to ignore a newly introduced authority surface.
    const POLICY: &[&str] = &["wallet_id", "rules", "approval", "capabilities", "authorized_key_hashes", "refund_addresses"];
    const META: &[&str] = &["policy", "controller", "version", "locked", "frozen", "usage"];
    let (Some(e), Some(o)) = (expected.as_object(), observed.as_object()) else { return false; };
    if e.keys().any(|k| !POLICY.contains(&k.as_str()))
        || o.keys().any(|k| !POLICY.contains(&k.as_str()) && !META.contains(&k.as_str()))
        || !e.get("wallet_id").and_then(Value::as_str).is_some_and(|s| !s.is_empty())
        || o.get("wallet_id") != e.get("wallet_id")
        || o.get("usage").is_some_and(|v| !v.is_object())
    { return false; }
    // No refund entries means provider-derived destination defaults. Explicit
    // empty object and absence are equivalent; null is NOT an empty map.
    let refunds = |v: &Value| -> Option<Value> {
        match v.get("refund_addresses") {
            None => Some(json!({})),
            Some(Value::Object(m)) if m.values().all(Value::is_string) => Some(json!(m)),
            _ => None,
        }
    };
    let Some(refunds_expected) = refunds(expected) else { return false; };
    observed["policy"] == "stored"
        && observed["controller"] == contract
        && observed["version"].as_u64() == Some(p.version)
        && observed["locked"] == true
        && observed["frozen"] == false
        && refunds(observed) == Some(refunds_expected)
        && ["rules", "approval", "capabilities", "authorized_key_hashes"]
            .iter()
            .all(|k| !expected[*k].is_null() && observed[*k] == expected[*k])
}

pub fn binding_matches(p: &Prepared, b: &Value, policy: &Value, contract: &str) -> bool {
    b["ready"] == true
        && b["wallet_pubkey"] == p.wallet_pubkey
        && b["encrypted_policy_hash"] == p.policy_hash()
        && b["policy_version"].as_str() == Some(p.version.to_string().as_str())
        && policy["owner"] == contract
        && policy["encrypted_data"] == p.encrypted_data
        && policy["locked"] == true
        && policy["frozen"] == false
        && policy["version"].as_u64() == Some(p.version)
}
/// A view, tx acknowledgement or final_execution_status alone is never a success.
/// The original hash and method must match; terminal SuccessValue must decode to true.
#[allow(clippy::too_many_arguments)]
pub fn registration_terminal_for(
    v: &Value,
    hash: &str,
    minter: &str,
    contract: &str,
    p: &Prepared,
    deposit: u128,
    custody: &str,
) -> Option<bool> {
    let v = v.get("result").unwrap_or(v);
    let identity = v["final_execution_status"] == "FINAL"
        && v["transaction"]["hash"] == hash
        && v["transaction"]["signer_id"] == minter
        && v["transaction"]["receiver_id"] == contract
        && v["transaction"]["actions"].as_array().is_some_and(|a| {
            a.len() == 1 && {
                let f = &a[0]["FunctionCall"];
                f["method_name"] == "register_collateral"
                    && f["deposit"] == deposit.to_string()
                    && f["gas"].as_u64() == Some(200_000_000_000_000)
                    && f["args"]
                        .as_str()
                        .and_then(|s| B64.decode(s).ok())
                        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                        == Some(p.args())
            }
        });
    if !identity {
        return None;
    }
    let proof = crate::receipts::terminal(
        v,
        hash,
        minter,
        contract,
        Some(&[minter, contract, custody]),
    )?;
    match proof {
        crate::receipts::Terminal::Success { bytes, executor } => {
            if executor != contract {
                return None;
            }
            Some(bytes == b"true" && !crate::receipts::has_failure(v))
        }
        crate::receipts::Terminal::Failure => Some(false),
    }
}
pub fn registration_terminal(
    v: &Value,
    hash: &str,
    minter: &str,
    contract: &str,
    p: &Prepared,
    deposit: u128,
) -> Option<bool> {
    registration_terminal_for(v, hash, minter, contract, p, deposit, "outlayer.near")
}
pub fn final_registration(
    v: &Value,
    hash: &str,
    minter: &str,
    contract: &str,
    p: &Prepared,
    deposit: u128,
) -> bool {
    registration_terminal(v, hash, minter, contract, p, deposit) == Some(true)
}

pub fn seal_eligibility(
    st: &mut dyn Store,
    p: &Prepared,
    a: &AuthorityAudit,
    b: &Value,
    policy: &Value,
    contract: &str,
    final_receipt: bool,
) -> Result<(), Error> {
    if !final_receipt
        || a.provision_id != p.id()
        || a.domain != DOMAIN
        || a.project_uuid != guarded::PROJECT_UUID
        || a.contract != contract
        || !guarded::lower_hash(&a.authority_audit_sha256)
        || !a.no_presigned_authorities
        || !a.all_aliases_reviewed
        || !a.old_jobs_drained
        || !a.external_chain_authorities_reviewed
        || !a.effective_policy_reviewed
        || !a.reachable_quorum_verified
        || !binding_matches(p, b, policy, contract)
    {
        return Err(err(
            "collateral_unknown",
            "original registration/binding not terminal and exact",
        ));
    }
    let e = guarded::Eligibility {
        revision: guarded::REVISION.into(),
        wallet_pubkey: p.wallet_pubkey.clone(),
        policy_hash: p.policy_hash(),
        policy_version: p.version.to_string(),
        authority_audit_sha256: a.authority_audit_sha256.clone(),
        no_presigned_authorities: true,
    };
    let raw = serde_json::to_vec(&e).map_err(|_| err("storage", "audit encoding"))?;
    let k = crate::tkey(&p.token_id, "confinement_v1");
    if !st.set_if_absent(&k, &raw)? && st.read(&k)? != raw {
        return Err(err("collateral_audit", "sealed audit conflict"));
    }
    Ok(())
}

#[cfg(test)]
mod tests;

/// Epoch-scoped local preparation can never strand a later title holder. The
/// contract CAS is the authority barrier, not this off-chain namespace.
pub fn provision_root(token: &str, epoch: u64) -> String {
    crate::tkey(token, &format!("collateral_provision_v2/{epoch}"))
}
pub fn holder_plan_access(p: &Prepared, owner: &str, epoch: u64, reconcile_only: bool) -> bool {
    reconcile_only || (p.owner == owner && p.owner_epoch == epoch)
}

pub fn assert_provision_idle(st: &mut dyn Store, token: &str, epoch: u64) -> Result<(), Error> {
    let k = provision_root(token, epoch);
    if !st.read(&format!("{k}/claimed"))?.is_empty()
        && st.read(&format!("{k}/complete"))?.is_empty()
    {
        return Err(err(
            "collateral_unknown",
            "current epoch provisioning is pending; reconcile original operation",
        ));
    }
    Ok(())
}
