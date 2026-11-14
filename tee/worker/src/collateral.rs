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

/// Canonical JSON: every object's keys sorted recursively, compact separators.
/// Matches the provider's policy_canonical_hash rule (WP :923-947) and the
/// Python `json.dumps(sort_keys=True, separators=(",",":"))` used in E0.
/// `serde_json::to_value` already sorts keys (BTreeMap), but the explicit sort
/// below makes the rule independent of the Map implementation.
pub fn canonical_json(v: &Value) -> String {
    fn sort(v: &Value) -> Value {
        match v {
            Value::Object(m) => {
                let mut keys: Vec<&String> = m.keys().collect();
                keys.sort();
                let mut out = serde_json::Map::new();
                for k in keys {
                    out.insert(k.clone(), sort(&m[k]));
                }
                Value::Object(out)
            }
            Value::Array(a) => Value::Array(a.iter().map(sort).collect()),
            other => other.clone(),
        }
    }
    serde_json::to_string(&sort(v)).expect("serializable value")
}

/// sha256 hex of the canonical JSON. Same as `evidence::digest` for Values.
pub fn canonical_hash(v: &Value) -> String {
    sha256_hex(&canonical_json(v))
}

/// Shape summary of an observed policy body: key -> type, arrays as [type;len].
/// No values. At most 600 chars. Used in policy errors so a reviewer can see
/// the observed shape without any secret or hash material.
pub fn observed_shape(observed: &Value) -> String {
    fn shape(v: &Value) -> String {
        match v {
            Value::Null => "null".into(),
            Value::Bool(_) => "bool".into(),
            Value::Number(_) => "number".into(),
            Value::String(_) => "string".into(),
            Value::Array(a) => {
                if a.is_empty() {
                    "[;0]".into()
                } else {
                    format!("[{};{}]", shape(&a[0]), a.len())
                }
            }
            Value::Object(m) => {
                let mut parts: Vec<String> =
                    m.iter().map(|(k, val)| format!("{k}:{}", shape(val))).collect();
                parts.sort();
                format!("{{{}}}", parts.join(","))
            }
        }
    }
    let s = shape(observed);
    if s.len() > 600 {
        let mut t: String = s.chars().take(597).collect();
        t.push_str("...");
        t
    } else {
        s
    }
}

/// Field-level diff between the reviewed (expected) policy and the provider's
/// live (observed) GET /wallet/v1/policy body. Returns stable name-only tokens;
/// empty == match. Values are printed only for booleans, the policy marker and
/// the version number. Hashes, account ids, wallet ids and keys print "differs"
/// only, so the diff never leaks secret or identifying material.
///
/// ROUND 9 (ground truth, experiment E7/E8): the provider returns the wallet's
/// OWN public key as `controller` (`"ed25519:<wallet near_account_id hex>"`),
/// NOT the keys contract. The old code required `observed["controller"] ==
/// contract`, which is the single field that failed in S11. The controller
/// check below therefore compares against `p.wallet_pubkey` (the Prepared's
/// wallet key). The `contract` parameter is retained for signature stability;
/// the contract is the on-chain owner, verified separately by
/// `binding_matches` (which checks `policy["owner"] == contract` on the
/// outlayer.near view). `usage` accepts absent | null | object (documented
/// OA default, plan section 4.2). `refund_addresses` null is NOT accepted:
/// the experiment captured it absent in both bodies, never null.
pub fn policy_diff(
    expected: &Value,
    observed: &Value,
    p: &Prepared,
    contract: &str,
) -> Vec<String> {
    let _ = contract;
    let mut diff: Vec<String> = Vec::new();
    const POLICY: &[&str] = &[
        "wallet_id",
        "rules",
        "approval",
        "capabilities",
        "authorized_key_hashes",
        "refund_addresses",
    ];
    const META: &[&str] = &["policy", "controller", "version", "locked", "frozen", "usage"];
    let Some(e) = expected.as_object() else {
        return vec!["top.expected:not_object".to_string()];
    };
    let Some(o) = observed.as_object() else {
        return vec!["top.observed:not_object".to_string()];
    };
    // Top-level key sets (closed allowlists; a newly introduced authority
    // surface must never be silently ignored).
    for k in e.keys() {
        if !POLICY.contains(&k.as_str()) {
            diff.push(format!("top.extra_key:{k}"));
        }
    }
    for k in o.keys() {
        if !POLICY.contains(&k.as_str()) && !META.contains(&k.as_str()) {
            diff.push(format!("top.extra_key:{k}"));
        }
    }
    // wallet_id.
    match e.get("wallet_id").and_then(Value::as_str) {
        Some(s) if !s.is_empty() => {
            if o.get("wallet_id") != e.get("wallet_id") {
                diff.push("wallet_id:differs".to_string());
            }
        }
        _ => diff.push("wallet_id:missing".to_string()),
    }
    // usage: absent | null | object. Any other type is a real difference.
    if let Some(u) = o.get("usage") {
        if !u.is_null() && !u.is_object() {
            diff.push("usage:type".to_string());
        }
    }
    // refund_addresses: absent == {} ; null is NOT an empty map (captured
    // absent in both bodies, never null); a non-string value is a type error.
    let refunds_expected = match e.get("refund_addresses") {
        None => Some(json!({})),
        Some(Value::Object(m)) if m.values().all(Value::is_string) => Some(json!(m)),
        _ => None,
    };
    let Some(refunds_expected) = refunds_expected else {
        diff.push("refund_addresses:expected_invalid".to_string());
        return diff;
    };
    match o.get("refund_addresses") {
        // ROUND 9 FIX (panel H5): observed-absent is only a match when the
        // expected map is empty. If the expected template ever carries a
        // refund address, its disappearance must be a diff.
        None => {
            if refunds_expected != json!({}) {
                diff.push("refund_addresses:value".to_string());
            }
        }
        Some(Value::Null) => diff.push("top.null:refund_addresses".to_string()),
        Some(Value::Object(m)) => {
            if !m.values().all(Value::is_string) {
                diff.push("refund_addresses:type".to_string());
            } else if json!(m) != refunds_expected {
                diff.push("refund_addresses:value".to_string());
            }
        }
        Some(_) => diff.push("refund_addresses:type".to_string()),
    }
    // Meta: policy marker.
    match o.get("policy") {
        None => diff.push("meta.policy:absent".to_string()),
        Some(Value::String(s)) if s == "stored" => {}
        Some(Value::String(s)) if s == "none" => diff.push("meta.policy:none".to_string()),
        Some(_) => diff.push("meta.policy:value".to_string()),
    }
    // Meta: controller. Ground truth (E7/E8): the provider returns the
    // wallet's own public key, never the contract. Compare the 32-byte key
    // (encoding-tolerant) against p.wallet_pubkey.
    match o.get("controller") {
        None => diff.push("meta.controller:absent".to_string()),
        Some(v) => {
            if v.as_str().is_none() {
                diff.push("meta.controller:type".to_string());
            } else if !same_wallet_pubkey(v, &p.wallet_pubkey) {
                diff.push("meta.controller:differs".to_string());
            }
        }
    }
    // Meta: version (number; 0 is a distinct sync token).
    match o.get("version") {
        None => diff.push("meta.version:absent".to_string()),
        Some(Value::Number(n)) => {
            if let Some(v) = n.as_u64() {
                if v == 0 {
                    diff.push("meta.version:0".to_string());
                } else if v != p.version {
                    diff.push(format!("meta.version:{v}"));
                }
            } else {
                diff.push("meta.version:type".to_string());
            }
        }
        Some(_) => diff.push("meta.version:type".to_string()),
    }
    // Meta: locked must be true.
    match o.get("locked") {
        None => diff.push("meta.locked:absent".to_string()),
        Some(Value::Bool(true)) => {}
        Some(Value::Bool(false)) => diff.push("meta.locked:false".to_string()),
        Some(_) => diff.push("meta.locked:type".to_string()),
    }
    // Meta: frozen must be false (callers that expect frozen use
    // `policy_diff_with_freeze`, which normalises before calling this).
    match o.get("frozen") {
        None => diff.push("meta.frozen:absent".to_string()),
        Some(Value::Bool(false)) => {}
        Some(Value::Bool(true)) => diff.push("meta.frozen:true".to_string()),
        Some(_) => diff.push("meta.frozen:type".to_string()),
    }
    // rules / approval / capabilities / authorized_key_hashes (strict Value==,
    // with per-field tokens so a reviewer sees which surface moved).
    diff.extend(diff_policy_section("rules", &expected["rules"], &observed["rules"]));
    diff.extend(diff_policy_section(
        "approval",
        &expected["approval"],
        &observed["approval"],
    ));
    diff.extend(diff_policy_section(
        "capabilities",
        &expected["capabilities"],
        &observed["capabilities"],
    ));
    match (&expected["authorized_key_hashes"], &observed["authorized_key_hashes"]) {
        (Value::Array(ea), Value::Array(oa)) => {
            if ea.len() != oa.len() {
                diff.push(format!(
                    "authorized_key_hashes:len {}->{}",
                    ea.len(),
                    oa.len()
                ));
            } else if ea != oa {
                diff.push("authorized_key_hashes:elements differ".to_string());
            }
        }
        (Value::Null, _) | (_, Value::Null) => {
            diff.push("authorized_key_hashes:missing".to_string())
        }
        _ => diff.push("authorized_key_hashes:type".to_string()),
    }
    diff
}

/// Per-section diff for the strict Value== policy sections. Returns stable
/// tokens; empty when the section matches exactly.
fn diff_policy_section(section: &str, expected: &Value, observed: &Value) -> Vec<String> {
    let mut diff = Vec::new();
    if expected.is_null() || observed.is_null() {
        if expected != observed {
            diff.push(format!("{section}:missing"));
        }
        return diff;
    }
    if expected == observed {
        return diff;
    }
    match section {
        "rules" => {
            diff.extend(diff_string_array(
                "rules.transaction_types",
                expected.get("transaction_types"),
                observed.get("transaction_types"),
            ));
            if let (Some(eo), Some(oo)) = (expected.as_object(), observed.as_object()) {
                for k in eo.keys() {
                    if k == "transaction_types" {
                        continue;
                    }
                    if oo.get(k) != Some(&eo[k]) {
                        diff.push(format!("rules.{k}:differs"));
                    }
                }
                for k in oo.keys() {
                    if !eo.contains_key(k) {
                        diff.push(format!("rules.extra_key:{k}"));
                    }
                }
            }
            if diff.is_empty() {
                diff.push("rules:differs".to_string());
            }
        }
        "approval" => {
            // threshold: type first (number vs {"required":n}), then value.
            match (&expected["threshold"], &observed["threshold"]) {
                (Value::Number(_), Value::Object(_))
                | (Value::Object(_), Value::Number(_)) => {
                    diff.push("approval.threshold:type number->object".to_string())
                }
                (a, b) if a != b => diff.push("approval.threshold:value".to_string()),
                _ => {}
            }
            if expected["locked"] != observed["locked"] {
                diff.push("approval.locked:value".to_string());
            }
            match (
                expected["approvers"].as_array(),
                observed["approvers"].as_array(),
            ) {
                (Some(ea), Some(oa)) => {
                    if ea.len() != oa.len() {
                        diff.push(format!(
                            "approval.approvers:len {}->{}",
                            ea.len(),
                            oa.len()
                        ));
                    }
                    for (i, (e0, o0)) in ea.iter().zip(oa.iter()).enumerate() {
                        if let (Some(eo), Some(oo)) = (e0.as_object(), o0.as_object()) {
                            if eo.get("role").is_none() || oo.get("role").is_none() {
                                if eo.get("role") != oo.get("role") {
                                    diff.push(format!(
                                        "approval.approvers[{i}].role:missing"
                                    ));
                                }
                            } else if eo["role"] != oo["role"] {
                                diff.push(format!(
                                    "approval.approvers[{i}].role:value"
                                ));
                            }
                            if eo.get("id") != oo.get("id") {
                                diff.push(format!(
                                    "approval.approvers[{i}].id:differs"
                                ));
                            }
                            for k in oo.keys() {
                                if !eo.contains_key(k) {
                                    diff.push(format!(
                                        "approval.approvers[{i}].extra_key:{k}"
                                    ));
                                }
                            }
                        } else if e0 != o0 {
                            diff.push(format!("approval.approvers[{i}]:differs"));
                        }
                    }
                }
                _ => diff.push("approval.approvers:type".to_string()),
            }
            diff.extend(diff_string_array(
                "approval.excluded_types",
                expected.get("excluded_types"),
                observed.get("excluded_types"),
            ));
            if diff.is_empty() {
                diff.push("approval:differs".to_string());
            }
        }
        "capabilities" => {
            if let (Some(eo), Some(oo)) = (expected.as_object(), observed.as_object()) {
                for (name, ecap) in eo {
                    match oo.get(name) {
                        None => diff.push(format!("capabilities.{name}:missing")),
                        Some(ocap) => {
                            if ecap["allowed"] != ocap["allowed"] {
                                diff.push(format!(
                                    "capabilities.{name}.allowed:value"
                                ));
                            }
                            if let (Some(em), Some(om)) =
                                (ecap.as_object(), ocap.as_object())
                            {
                                for k in om.keys() {
                                    if !em.contains_key(k) {
                                        diff.push(format!(
                                            "capabilities.{name}.extra_key:{k}"
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
                for name in oo.keys() {
                    if !eo.contains_key(name) {
                        diff.push(format!("capabilities.{name}:extra"));
                    }
                }
            }
            if diff.is_empty() {
                diff.push("capabilities:differs".to_string());
            }
        }
        _ => diff.push(format!("{section}:differs")),
    }
    diff
}

/// Diff for an ordered string array (transaction_types, excluded_types).
/// Order-sensitive: same elements in a different order is a real difference.
fn diff_string_array(
    path: &str,
    expected: Option<&Value>,
    observed: Option<&Value>,
) -> Vec<String> {
    let mut diff = Vec::new();
    match (expected.and_then(Value::as_array), observed.and_then(Value::as_array)) {
        (Some(ea), Some(oa)) => {
            if ea.len() != oa.len() {
                diff.push(format!("{path}:len"));
            } else if ea != oa {
                let mut sorted_e: Vec<&Value> = ea.iter().collect();
                let mut sorted_o: Vec<&Value> = oa.iter().collect();
                sorted_e.sort_by_key(|v| v.as_str().unwrap_or_default());
                sorted_o.sort_by_key(|v| v.as_str().unwrap_or_default());
                if sorted_e == sorted_o {
                    diff.push(format!("{path}:order"));
                } else {
                    for (i, (a, b)) in ea.iter().zip(oa.iter()).enumerate() {
                        if a != b {
                            diff.push(format!("{path}:element[{i}]"));
                            break;
                        }
                    }
                    if diff.is_empty() {
                        diff.push(format!("{path}:differs"));
                    }
                }
            }
        }
        _ => diff.push(format!("{path}:type")),
    }
    diff
}

/// Format a policy diff for an error message: `[token, token, ...]`, at most
/// 400 chars (truncated with "..."). Name-only tokens, no values.
pub fn policy_diff_message(diff: &[String]) -> String {
    let joined = diff.join(", ");
    if joined.len() > 400 {
        let mut t: String = joined.chars().take(397).collect();
        t.push_str("...");
        format!("[{t}]")
    } else {
        format!("[{joined}]")
    }
}

/// True when every diff token is a provider-sync artifact (the provider's view
/// has not caught up with the chain yet), not a real policy mismatch. Two
/// cases. (1) The policy marker itself is absent/none: the provider has not
/// stored or exposed the policy yet, so every missing section / absent
/// version / absent locked token is a consequence of that, and the whole diff
/// is sync (a controller diff is NOT sync -- the controller is set at wallet
/// creation, independent of the policy). (2) The policy is stored: every
/// token must be a version sync token, or a frozen token explained by the
/// chain-known frozen state differing from the observed frozen state (the
/// provider view lags the chain).
pub fn policy_diff_is_sync_only(
    diff: &[String],
    chain_frozen: Option<bool>,
    observed_frozen: Option<bool>,
) -> bool {
    if diff.is_empty() {
        return false;
    }
    let frozen_is_sync_lag = |t: &str| -> bool {
        (t == "meta.frozen:true" || t == "meta.frozen:false")
            && chain_frozen.is_some()
            && observed_frozen.is_some()
            && chain_frozen != observed_frozen
    };
    if diff
        .iter()
        .any(|t| t == "meta.policy:absent" || t == "meta.policy:none")
    {
        return diff.iter().all(|t| {
            matches!(
                t.as_str(),
                "meta.policy:absent"
                    | "meta.policy:none"
                    | "meta.version:absent"
                    | "meta.locked:absent"
                    | "rules:missing"
                    | "approval:missing"
                    | "capabilities:missing"
                    | "authorized_key_hashes:missing"
            ) || frozen_is_sync_lag(t)
        });
    }
    // Case 2: policy is stored; every token must be a version sync token,
    // or a frozen token explained by the chain-known frozen state differing
    // from the observed frozen state (the provider view lags the chain).
    // NOTE: `meta.version:type` is deliberately NOT sync. A version rendered
    // in the wrong type is a real mismatch, not a sync lag (plan section 4.3
    // lists only absent/0 as version sync tokens). It fails hard.
    diff.iter().all(|t| {
        matches!(t.as_str(), "meta.version:absent" | "meta.version:0")
            || frozen_is_sync_lag(t)
    })
}

/// The ciphertext signature is checked separately. Also require the provider's
/// current decrypted view to expose the exact restricted rules actually prepared.
/// (Bool wrapper over `policy_diff`; empty diff == match.)
pub fn effective_policy_matches(
    expected: &Value,
    observed: &Value,
    p: &Prepared,
    contract: &str,
) -> bool {
    policy_diff(expected, observed, p, contract).is_empty()
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


/// 32-byte ed25519 public key from the official wallet-pubkey forms.
/// OpenAPI documents NEAR keys as `ed25519:<base58>`; Agent ID / implicit
/// accounts use 64 lowercase hex (`ed25519:` optional). Sign-policy uses
/// `public_key_hex`. A live prepare (c797d97c) compared only `ed25519:` plus
/// the implicit-account hex, so a documented base58 200 failed.
pub fn wallet_pubkey_bytes(s: &str) -> Option<[u8; 32]> {
    let rest = s
        .trim()
        .strip_prefix("ed25519:")
        .unwrap_or(s.trim());
    if rest.len() == 64 && rest.bytes().all(|b| b.is_ascii_hexdigit()) {
        let mut out = [0u8; 32];
        for i in 0..32 {
            out[i] = u8::from_str_radix(&rest[2 * i..2 * i + 2], 16).ok()?;
        }
        return Some(out);
    }
    bs58::decode(rest)
        .into_vec()
        .ok()
        .and_then(|v| v.try_into().ok())
}

/// True when `observed` is the same 32-byte key as implicit-account hex `id`.
pub fn same_wallet_pubkey(observed: &Value, id: &str) -> bool {
    let Some(obs) = observed.as_str().and_then(wallet_pubkey_bytes) else {
        return false;
    };
    let Some(exp) = wallet_pubkey_bytes(id)
        .or_else(|| wallet_pubkey_bytes(&format!("ed25519:{id}")))
    else {
        return false;
    };
    obs == exp
}

/// Live prepare eb62bc50 (aac99f00) got encrypt-policy HTTP 200 with
/// `wallet_pubkey` set to the wallet_id UUID
/// (`66684254-fe09-4176-8927-8b3e6f10d774`), not a 32-byte ed25519 key.
/// OpenAPI leaves the string encoding unspecified. Accept that form for
/// encrypt-policy only; sign-policy still requires `public_key_hex` as a key.
pub fn wallet_pubkey_is_wallet_id(observed: &Value, wallet_id: &str) -> bool {
    let Some(obs) = observed.as_str().map(str::trim) else {
        return false;
    };
    let wid = wallet_id.trim();
    !wid.is_empty() && obs.eq_ignore_ascii_case(wid)
}

const REDACT_KEYS: &[&str] = &[
    "api_key",
    "encrypted_base64",
    "encrypted_data",
    "ciphertext",
    "signature",
    "signature_hex",
    "signature_base64",
    "private_key",
    "secret",
    "seed",
    "check_key",
    "authorization",
    "bearer",
    "handoff_url",
    "raw",
    "access_token",
    "payment_key",
    "private_key_seed_b64",
    "password",
];

/// Upstream JSON with secrets and ciphertext removed. Status and public
/// fields (`error`, `message`, `wallet_pubkey`, `policy_hash`) stay.
pub fn public_upstream_body(v: &Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, val) in map {
                if REDACT_KEYS
                    .iter()
                    .any(|s| k.eq_ignore_ascii_case(s))
                {
                    out.insert(k.clone(), Value::String("[redacted]".into()));
                } else {
                    out.insert(k.clone(), public_upstream_body(val));
                }
            }
            Value::Object(out)
        }
        Value::Array(a) => Value::Array(a.iter().map(public_upstream_body).collect()),
        other => other.clone(),
    }
}

pub fn public_encrypt_failure(st: u16, body: &Value) -> String {
    format!(
        "policy encryption unavailable; wallet remains held (http {st}; {})",
        public_upstream_body(body)
    )
}

/// A `/claimed` marker with no stored ciphertext is hollow: the encrypt POST
/// was not kept (the c797d97c path). Clear it so prepare can POST once.
/// When a ciphertext is already stored, reuse it and never POST again.
pub fn hollow_encrypt_claim(claimed: bool, encrypted_stored: bool) -> bool {
    claimed && !encrypted_stored
}

pub fn reuse_encrypt_result(encrypted_stored: bool) -> bool {
    encrypted_stored
}
