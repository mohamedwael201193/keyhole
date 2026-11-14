//! Phased confinement evidence. All negatives are scoped to the reviewed worker/TEE/provider
//! authority model, not a global oracle. Authored for devmo; no financial operation lives here.
use crate::{
    collateral::{self, Prepared},
    err, guarded, sha256_hex, tkey, Auth, Error, Store,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const PRE: &str = "KEYHOLE_COLLATERAL_PRE_AUDIT_V2";
pub const REPORT: &str = "KEYHOLE_EFFECTIVE_POLICY_REPORT_V2";
pub const POST: &str = "KEYHOLE_COLLATERAL_POST_AUDIT_V2";
pub const SCOPE: &str = "reviewed-worker-and-documented-tee-provider-v2";
pub fn root(token: &str) -> String {
    tkey(token, "collateral_enrollment_v2")
}
pub fn digest<T: Serialize>(v: &T) -> Result<String, Error> {
    // serde_json's default map is BTreeMap. Conversion sorts all object keys recursively.
    let v = serde_json::to_value(v).map_err(|_| err("evidence", "encoding failed"))?;
    fn no_float(v: &Value) -> bool {
        match v {
            Value::Number(n) => n.is_i64() || n.is_u64(),
            Value::Array(a) => a.iter().all(no_float),
            Value::Object(o) => o.values().all(no_float),
            _ => true,
        }
    }
    if !no_float(&v) {
        return Err(err("evidence", "floating point is not signed evidence"));
    }
    Ok(sha256_hex(&v.to_string()))
}
pub fn signed<T: Serialize>(domain: &str, v: &T, seed: &[u8; 32]) -> Result<SignedReport, Error> {
    let message = serde_json::to_string(v).map_err(|_| err("evidence", "encoding failed"))?;
    let k = SigningKey::from_bytes(seed);
    Ok(SignedReport {
        signature: B64.encode(k.sign(format!("{domain}\n{message}").as_bytes()).to_bytes()),
        message,
    })
}
fn signature(domain: &str, message: &str, sig: &str, pk: &str) -> Result<(), Error> {
    if message.len() > 32768 {
        return Err(err("evidence", "oversized signed evidence"));
    }
    let pk: [u8; 32] = B64
        .decode(pk)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| err("evidence", "review/attestor key missing"))?;
    let sig: [u8; 64] = B64
        .decode(sig)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| err("evidence", "invalid signature encoding"))?;
    VerifyingKey::from_bytes(&pk)
        .map_err(|_| err("evidence", "invalid verification key"))?
        .verify_strict(
            format!("{domain}\n{message}").as_bytes(),
            &Signature::from_bytes(&sig),
        )
        .map_err(|_| err("evidence", "unapproved signed evidence"))
}
fn fresh(issued: u64, expires: u64, now: u64) -> bool {
    issued <= now && now < expires && expires <= issued.saturating_add(900)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FreshManifest {
    pub domain: String,
    pub project_uuid: String,
    pub contract: String,
    pub token_id: String,
    pub owner: String,
    pub owner_epoch: u64,
    pub worker_hash: String,
    pub wallet_id: String,
    pub wallet_pubkey: String,
    pub api_key_sha256: String,
    pub register_operation_id: String,
    pub created_at_ms: u64,
    pub namespace_absence_sha256: String,
    pub registration_sha256: String,
    pub initial_inventory_sha256: String,
    pub authority_scope: String,
}
impl FreshManifest {
    pub fn validate(&self, p: &Prepared, contract: &str) -> Result<(), Error> {
        if self.domain != "KEYHOLE_FRESH_WALLET_V2"
            || self.project_uuid != guarded::PROJECT_UUID
            || self.contract != contract
            || self.token_id != p.token_id
            || self.owner != p.owner
            || self.owner_epoch != p.owner_epoch
            || self.worker_hash != p.worker_hash
            || self.wallet_pubkey != p.wallet_pubkey
            || !guarded::uuid(&self.wallet_id)
            || self.authority_scope != SCOPE
            || self.created_at_ms == 0
            || [
                &self.api_key_sha256,
                &self.register_operation_id,
                &self.namespace_absence_sha256,
                &self.registration_sha256,
                &self.initial_inventory_sha256,
            ]
            .iter()
            .any(|h| !guarded::lower_hash(h))
        {
            return Err(err(
                "evidence",
                "not a fresh scoped wallet manifest for this plan",
            ));
        }
        Ok(())
    }
}
/// The same one-POST transport boundary is used by production and fault-injection tests.
pub trait RegisterTransport {
    fn register(&mut self) -> Result<Value, Error>;
}
pub fn fresh_namespaces(token: &str, owner: &str) -> Vec<String> {
    vec![
        tkey(token, "wallet"),
        crate::hkey(owner, "wallet"),
        tkey(token, "wallet_claim"),
        tkey(token, "confinement_v1"),
    ]
}
pub fn register_fresh(
    st: &mut dyn Store,
    transport: &mut impl RegisterTransport,
    token: &str,
    owner: &str,
    claim: &Value,
) -> Result<Value, Error> {
    let absent = fresh_namespaces(token, owner);
    for k in &absent {
        if !st.read(k)?.is_empty() {
            return Err(err("evidence", "wallet/legacy alias/claim already exists"));
        }
    }
    let r = root(token);
    if !st.set_if_absent(&format!("{r}/claim"), claim.to_string().as_bytes())? {
        return Err(err(
            "collateral_unknown",
            "original registration claimed; never repeat POST",
        ));
    }
    // Close the ordinary wallet-creator race after the shared token claim.
    for k in &absent {
        if !st.read(k)?.is_empty() {
            return Err(err(
                "collateral_unknown",
                "concurrent wallet creation; no POST",
            ));
        }
    }
    let j = transport.register()?;
    guarded::put_once(
        st,
        &format!("{r}/registration_sealed"),
        j.to_string().as_bytes(),
    )?;
    let key = guarded::text(&j, "api_key")?;
    let id = guarded::text(&j, "near_account_id")?;
    let wallet = guarded::text(&j, "wallet_id")?;
    if key.is_empty() || !guarded::lower_hash(id) || !guarded::uuid(wallet) {
        return Err(err("collateral_unknown", "unknown fresh wallet identity"));
    }
    if !st.set_if_absent(
        &format!("g/collateral_wallet_v2/{}", sha256_hex(wallet)),
        token.as_bytes(),
    )? || !st.set_if_absent(
        &format!("g/collateral_key_v2/{}", sha256_hex(key)),
        token.as_bytes(),
    )? || !st.set_if_absent(&format!("g/collateral_pubkey_v2/{id}"), token.as_bytes())?
    {
        return Err(err(
            "collateral_unknown",
            "provider reused wallet, public identity or API key",
        ));
    }
    let rec = json!({"api_key":key,"near_account_id":id,"wallet_id":wallet});
    guarded::put_once(st, &tkey(token, "wallet"), rec.to_string().as_bytes())?;
    Ok(rec)
}
pub fn consume_guardian(
    st: &mut dyn Store,
    account: &str,
    nonce: &[u8; 32],
    operation_id: &str,
) -> Result<(), Error> {
    if !st.set_if_absent(
        &format!("g/collateral_guardian_v2/{account}/{}", hex::encode(nonce)),
        operation_id.as_bytes(),
    )? {
        return Err(err(
            "guardian",
            "guardian challenge replayed; sign a fresh challenge",
        ));
    }
    Ok(())
}
pub fn fresh_balances(balance: &Value, wallet: &str) -> Result<(), Error> {
    if balance["account_id"] != wallet {
        return Err(err("evidence", "fresh balance wallet mismatch"));
    }
    let rows = balance["balances"]
        .as_array()
        .ok_or_else(|| err("evidence", "unknown initial balances"))?;
    for row in rows {
        if row["token"].as_str().is_none_or(str::is_empty)
            || row["balance"].as_str().and_then(|s| s.parse::<u128>().ok()) != Some(0)
        {
            return Err(err("evidence", "fresh wallet is funded or balance unknown"));
        }
    }
    Ok(())
}
/// V1 policy builder remains a legacy pure helper, never the production V2 admission path.
pub fn admin_policy(
    wallet: &str,
    key: &str,
    approvers: &Value,
    threshold: u64,
) -> Result<Value, Error> {
    let a = approvers
        .as_array()
        .filter(|a| a.len() == 1)
        .ok_or_else(|| err("evidence", "one reviewed guardian required"))?;
    let row = a[0]
        .as_object()
        .filter(|o| o.len() == 2)
        .ok_or_else(|| err("evidence", "guardian id and explicit admin role required"))?;
    if threshold != 1 || row.get("role") != Some(&json!("admin")) {
        return Err(err(
            "evidence",
            "policy guardian must explicitly be admin, threshold one",
        ));
    }
    let id = guarded::text(&a[0], "id")?;
    let mut p = collateral::policy(wallet, key, &json!([{"id":id}]), 1)?;
    p["approval"]["approvers"] = approvers.clone();
    Ok(p)
}
pub fn validate_policy(policy: &Value, m: &FreshManifest) -> Result<(), Error> {
    let id = guarded::text(&policy["approval"]["approvers"][0], "id")?;
    let mut exact = admin_policy(
        &m.wallet_id,
        "not-a-credential",
        &json!([{"id":id,"role":"admin"}]),
        1,
    )?;
    exact["authorized_key_hashes"] = json!([m.api_key_sha256]);
    if *policy != exact {
        return Err(err(
            "evidence",
            "policy is not the exact reviewed admin confinement template",
        ));
    }
    Ok(())
}
pub fn guardian_params(
    p: &Value,
    token: &str,
    wallet: &str,
    contract: &str,
    owner: &str,
    epoch: u64,
    worker: &str,
) -> Result<Value, Error> {
    Ok(
        json!({"domain":"KEYHOLE_GUARDIAN_LIVENESS_V2","project_id":guarded::PROJECT_ID,"project_uuid":guarded::PROJECT_UUID,
        "contract":contract,"token_id":token,"wallet_pubkey":wallet,"owner":owner,"owner_epoch":epoch.to_string(),"worker_hash":worker,
        "candidate_policy_sha256":digest(p)?,"threshold":1}),
    )
}
/// True when `permission` is the JSON string "FullAccess", on a flattened
/// `view_access_key` body or inside a JSON-RPC `{ "result": { … } }` envelope.
/// Same shapes as `is_full_access` / the #212 nonce envelope fix. A live
/// prepare (call 04cfc127 on 4178346e) failed the flattened-only check.
fn full_access_permission(access: &Value) -> bool {
    let p = access
        .get("permission")
        .or_else(|| access.pointer("/result/permission"));
    matches!(p, Some(Value::String(s)) if s == "FullAccess")
}
pub fn guardian(
    auth: &Auth,
    expected: &Value,
    policy: &Value,
    access: &Value,
    recipient: &str,
    now_ms: u64,
) -> Result<[u8; 32], Error> {
    if auth.scheme != "nep413"
        || policy["approval"]["threshold"] != 1
        || policy["approval"]["approvers"].as_array().map(Vec::len) != Some(1)
        || policy["approval"]["approvers"][0]["id"] != auth.account_id
        || policy["approval"]["approvers"][0]["role"] != "admin"
        || !full_access_permission(access)
    {
        return Err(err(
            "guardian",
            "current full-access reviewed admin guardian required",
        ));
    }
    let (req, nonce) = crate::verify_nep413(auth, recipient)?;
    crate::check_freshness(req.ts_ms, now_ms)?;
    if req.op != "collateral_guardian" || req.params != *expected {
        return Err(err("guardian", "challenge is for different policy/context"));
    }
    Ok(nonce)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreAudit {
    pub domain: String,
    pub project_uuid: String,
    pub contract: String,
    pub provision_id: String,
    pub manifest_sha256: String,
    pub candidate_policy_sha256: String,
    pub guardian_sha256: String,
    pub authority_scope: String,
    pub report_sha256: String,
    pub candidate_policy_reviewed: bool,
    pub fresh_creation_reviewed: bool,
    pub known_authorities_reviewed: bool,
    pub prior_jobs_drained: bool,
    pub issued_at_sec: u64,
    pub expires_at_sec: u64,
}
#[allow(clippy::too_many_arguments)]
pub fn pre_audit(
    message: &str,
    sig: &str,
    reviewer: &str,
    p: &Prepared,
    m: &FreshManifest,
    expected: &Value,
    guardian_hash: &str,
    contract: &str,
    now: u64,
) -> Result<PreAudit, Error> {
    signature(PRE, message, sig, reviewer)?;
    let a: PreAudit =
        serde_json::from_str(message).map_err(|_| err("evidence", "invalid pre-install audit"))?;
    m.validate(p, contract)?;
    validate_policy(expected, m)?;
    if a.domain != PRE
        || a.project_uuid != guarded::PROJECT_UUID
        || a.contract != contract
        || a.provision_id != p.id()
        || a.manifest_sha256 != digest(m)?
        || a.candidate_policy_sha256 != digest(expected)?
        || a.guardian_sha256 != guardian_hash
        || !guarded::lower_hash(&a.report_sha256)
        || a.authority_scope != SCOPE
        || !fresh(a.issued_at_sec, a.expires_at_sec, now)
        || !a.candidate_policy_reviewed
        || !a.fresh_creation_reviewed
        || !a.known_authorities_reviewed
        || !a.prior_jobs_drained
    {
        return Err(err(
            "evidence",
            "wrong-plan, stale or incomplete pre-review",
        ));
    }
    Ok(a)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffectiveReport {
    pub domain: String,
    pub project_uuid: String,
    pub contract: String,
    pub provision_id: String,
    pub token_id: String,
    pub current_owner: String,
    pub current_epoch: u64,
    pub worker_hash: String,
    pub wallet_pubkey: String,
    pub policy_hash: String,
    pub policy_version: u64,
    pub manifest_sha256: String,
    pub pre_audit_sha256: String,
    pub guardian_sha256: String,
    pub guardian_auth: Value,
    pub guardian_access_key: Value,
    pub candidate_policy_sha256: String,
    pub installed_tx: String,
    pub final_receipts_sha256: String,
    pub public_policy_sha256: String,
    pub inventory_sha256: String,
    pub effective_policy: Value,
    pub authority_scope: String,
    pub issued_at_sec: u64,
    pub expires_at_sec: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedReport {
    pub message: String,
    pub signature: String,
}
pub fn report(
    s: &SignedReport,
    attestor: &str,
    p: &Prepared,
    expected: &Value,
    contract: &str,
    now: u64,
    check_time: bool,
) -> Result<EffectiveReport, Error> {
    signature(REPORT, &s.message, &s.signature, attestor)?;
    let r: EffectiveReport = serde_json::from_str(&s.message)
        .map_err(|_| err("evidence", "invalid effective policy report"))?;
    if r.domain != REPORT
        || r.project_uuid != guarded::PROJECT_UUID
        || r.contract != contract
        || r.provision_id != p.id()
        || r.token_id != p.token_id
        || r.wallet_pubkey != p.wallet_pubkey
        || r.worker_hash != p.worker_hash
        || r.policy_hash != p.policy_hash()
        || r.policy_version != p.version
        || r.candidate_policy_sha256 != digest(expected)?
        || r.authority_scope != SCOPE
        || !fresh(r.issued_at_sec, r.expires_at_sec, r.issued_at_sec)
        || (check_time && !fresh(r.issued_at_sec, r.expires_at_sec, now))
        || !crate::is_valid_account_id(&r.current_owner)
        || r.installed_tx.is_empty()
        || [
            &r.manifest_sha256,
            &r.pre_audit_sha256,
            &r.guardian_sha256,
            &r.final_receipts_sha256,
            &r.public_policy_sha256,
            &r.inventory_sha256,
        ]
        .iter()
        .any(|h| !guarded::lower_hash(h))
        || !collateral::effective_policy_matches(expected, &r.effective_policy, p, contract)
    {
        return Err(err(
            "evidence",
            "tampered, incomplete or wrong-policy effective report",
        ));
    }
    let auth: Auth = serde_json::from_value(r.guardian_auth.clone())
        .map_err(|_| err("guardian", "report guardian proof missing"))?;
    let expected_challenge = guardian_params(
        expected,
        &p.token_id,
        &p.wallet_pubkey,
        contract,
        &r.current_owner,
        r.current_epoch,
        &p.worker_hash,
    )?;
    guardian(
        &auth,
        &expected_challenge,
        expected,
        &r.guardian_access_key,
        "keyhole",
        r.issued_at_sec.saturating_mul(1000),
    )?;
    if digest(&r.guardian_auth)? != r.guardian_sha256 {
        return Err(err("guardian", "report guardian digest mismatch"));
    }
    Ok(r)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PostAudit {
    pub domain: String,
    pub project_uuid: String,
    pub contract: String,
    pub provision_id: String,
    pub report_sha256: String,
    pub authority_scope: String,
    pub no_presigned_authorities: bool,
    pub all_aliases_reviewed: bool,
    pub old_jobs_drained: bool,
    pub external_chain_authorities_reviewed: bool,
    pub effective_policy_reviewed: bool,
    pub reachable_quorum_verified: bool,
    pub issued_at_sec: u64,
    pub expires_at_sec: u64,
}
#[allow(clippy::too_many_arguments)]
pub fn post_audit(
    message: &str,
    sig: &str,
    reviewer: &str,
    r: &SignedReport,
    p: &Prepared,
    contract: &str,
    now: u64,
    check_time: bool,
) -> Result<PostAudit, Error> {
    signature(POST, message, sig, reviewer)?;
    let a: PostAudit = serde_json::from_str(message)
        .map_err(|_| err("evidence", "invalid post-install review"))?;
    if a.domain != POST
        || a.project_uuid != guarded::PROJECT_UUID
        || a.contract != contract
        || a.provision_id != p.id()
        || a.report_sha256 != digest(r)?
        || a.authority_scope != SCOPE
        || !fresh(a.issued_at_sec, a.expires_at_sec, a.issued_at_sec)
        || (check_time && !fresh(a.issued_at_sec, a.expires_at_sec, now))
        || !a.no_presigned_authorities
        || !a.all_aliases_reviewed
        || !a.old_jobs_drained
        || !a.external_chain_authorities_reviewed
        || !a.effective_policy_reviewed
        || !a.reachable_quorum_verified
    {
        return Err(err(
            "evidence",
            "separate genuine post-install review required",
        ));
    }
    Ok(a)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Proof {
    pub prepared: Prepared,
    pub manifest: FreshManifest,
    pub expected_policy: Value,
    pub pre_message: String,
    pub pre_signature: String,
    pub report: SignedReport,
    pub post_message: String,
    pub post_signature: String,
}
/// A certificate may use a durable past review, but signatures, exact plan and all bindings
/// must still verify. Finalization enforces freshness separately; live policy/floor is re-read.
pub fn verify_proof(
    proof: &Proof,
    reviewer: &str,
    attestor: &str,
    contract: &str,
) -> Result<EffectiveReport, Error> {
    let p = &proof.prepared;
    proof.manifest.validate(p, contract)?;
    p.validate(contract, p.valid_until.saturating_sub(61))?;
    let r = report(
        &proof.report,
        attestor,
        p,
        &proof.expected_policy,
        contract,
        0,
        false,
    )?;
    let a: PreAudit = serde_json::from_str(&proof.pre_message)
        .map_err(|_| err("evidence", "pre-review missing"))?;
    pre_audit(
        &proof.pre_message,
        &proof.pre_signature,
        reviewer,
        p,
        &proof.manifest,
        &proof.expected_policy,
        &a.guardian_sha256,
        contract,
        a.issued_at_sec,
    )?;
    if r.pre_audit_sha256 != digest(&a)? || r.manifest_sha256 != digest(&proof.manifest)? {
        return Err(err("evidence", "proof provenance mismatch"));
    }
    post_audit(
        &proof.post_message,
        &proof.post_signature,
        reviewer,
        &proof.report,
        p,
        contract,
        0,
        false,
    )?;
    Ok(r)
}
/// Marker before proof is invalid. Never infer eligibility from an on-chain ready binding.
fn commit(
    st: &mut dyn Store,
    proof: &Proof,
    reviewer: &str,
    attestor: &str,
    contract: &str,
) -> Result<(), Error> {
    verify_proof(proof, reviewer, attestor, contract)?;
    let token = &proof.prepared.token_id;
    let k = proof_key(token, &digest(&proof.report)?);
    let marker = tkey(token, "confinement_v1");
    if !st.read(&marker)?.is_empty() && load_proof(st, token).is_err() {
        return Err(err("evidence", "commit marker exists before V2 proof"));
    }
    guarded::put_once(
        st,
        &k,
        &serde_json::to_vec(proof).map_err(|_| err("evidence", "proof encoding"))?,
    )?;
    let e = guarded::Eligibility {
        revision: guarded::REVISION.into(),
        wallet_pubkey: proof.prepared.wallet_pubkey.clone(),
        policy_hash: proof.prepared.policy_hash(),
        policy_version: proof.prepared.version.to_string(),
        authority_audit_sha256: digest(&proof.report)?,
        no_presigned_authorities: true,
    };
    guarded::put_once(
        st,
        &marker,
        &serde_json::to_vec(&e).map_err(|_| err("evidence", "marker encoding"))?,
    )?;
    Ok(())
}
#[allow(clippy::too_many_arguments)]
pub fn finalize(
    st: &mut dyn Store,
    proof: &Proof,
    reviewer: &str,
    attestor: &str,
    contract: &str,
    owner: &str,
    epoch: u64,
    now: u64,
) -> Result<(), Error> {
    let r = report(
        &proof.report,
        attestor,
        &proof.prepared,
        &proof.expected_policy,
        contract,
        now,
        true,
    )?;
    post_audit(
        &proof.post_message,
        &proof.post_signature,
        reviewer,
        &proof.report,
        &proof.prepared,
        contract,
        now,
        true,
    )?;
    if r.current_owner != owner || r.current_epoch != epoch {
        return Err(err(
            "evidence",
            "ownership changed during enrollment; refresh report and post-review",
        ));
    }
    commit(st, proof, reviewer, attestor, contract)
}
pub fn proof_key(token: &str, report_hash: &str) -> String {
    format!("{}/proofs/{report_hash}", root(token))
}
pub fn load_proof(st: &mut dyn Store, token: &str) -> Result<Proof, Error> {
    let marker: guarded::Eligibility =
        serde_json::from_slice(&st.read(&tkey(token, "confinement_v1"))?)
            .map_err(|_| err("evidence", "final commit marker missing"))?;
    if !guarded::lower_hash(&marker.authority_audit_sha256) {
        return Err(err("evidence", "invalid committed report hash"));
    }
    let p: Proof =
        serde_json::from_slice(&st.read(&proof_key(token, &marker.authority_audit_sha256))?)
            .map_err(|_| err("evidence", "committed V2 proof companion missing"))?;
    if marker.authority_audit_sha256 != digest(&p.report)?
        || marker.wallet_pubkey != p.prepared.wallet_pubkey
        || marker.policy_hash != p.prepared.policy_hash()
        || marker.policy_version != p.prepared.version.to_string()
        || p.prepared.token_id != token
    {
        return Err(err("evidence", "marker/proof binding mismatch"));
    }
    Ok(p)
}
pub fn idle(st: &mut dyn Store, token: &str) -> Result<(), Error> {
    if !st.read(&format!("{}/claim", root(token)))?.is_empty() {
        load_proof(st, token).map_err(|_| {
            err(
                "collateral_unknown",
                "token enrollment pending across all owner epochs",
            )
        })?;
    }
    Ok(())
}
#[allow(clippy::too_many_arguments)]
pub fn eligible(
    st: &mut dyn Store,
    token: &str,
    cert: &guarded::Certificate,
    reviewer: &str,
    attestor: &str,
    contract: &str,
    worker: &str,
) -> Result<(), Error> {
    let p = load_proof(st, token)?;
    verify_proof(&p, reviewer, attestor, contract)?;
    if p.prepared.token_id != token
        || p.prepared.worker_hash != worker
        || p.prepared.wallet_pubkey != cert.wallet_pubkey
        || p.prepared.policy_hash() != cert.policy_hash
        || p.prepared.version.to_string() != cert.policy_version
    {
        return Err(err(
            "evidence",
            "certificate binding does not match V2 proof",
        ));
    }
    guarded::eligible(&st.read(&tkey(token, "confinement_v1"))?, cert)?;
    let e: guarded::Eligibility = serde_json::from_slice(&st.read(&tkey(token, "confinement_v1"))?)
        .map_err(|_| err("evidence", "marker missing"))?;
    if e.authority_audit_sha256 != digest(&p.report)? {
        return Err(err("evidence", "marker/proof mismatch"));
    }
    Ok(())
}
/// Provider quotes use RFC3339 UTC. Unsupported timezone/precision fails closed;
/// caller requires an additional signing/bridge margin, never fabricates an expiry.
pub fn quote_expiry_ms(value: &str) -> Option<u64> {
    let s = value.strip_suffix('Z')?;
    if s.len() < 19
        || !s.is_ascii()
        || &s[4..5] != "-"
        || &s[7..8] != "-"
        || &s[10..11] != "T"
        || &s[13..14] != ":"
        || &s[16..17] != ":"
    {
        return None;
    }
    let n = |a: usize, b: usize| s[a..b].parse::<u64>().ok();
    let y = n(0, 4)?;
    let m = n(5, 7)?;
    let d = n(8, 10)?;
    let h = n(11, 13)?;
    let min = n(14, 16)?;
    let sec = n(17, 19)?;
    if !(1970..=2100).contains(&y) || !(1..=12).contains(&m) || h > 23 || min > 59 || sec > 59 {
        return None;
    }
    let leap = |year: u64| {
        year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
    };
    let months = [
        31,
        if leap(y) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if d == 0 || d > months[(m - 1) as usize] {
        return None;
    }
    let mut days = (1970..y)
        .map(|year| if leap(year) { 366 } else { 365 })
        .sum::<u64>();
    days += months[..(m - 1) as usize].iter().sum::<u64>() + d - 1;
    let fraction = if s.len() == 19 {
        0
    } else {
        let f = s[19..].strip_prefix('.')?;
        if f.is_empty() || !f.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let padded = format!("{f}000");
        padded[..3].parse::<u64>().ok()?
    };
    Some(((days * 24 + h) * 3600 + min * 60 + sec) * 1000 + fraction)
}
/// Field-level diff for the frozen-policy path (loan certificate, exact exit).
/// The frozen marker is checked first against the expected freeze state, then
/// normalised to false before the shared `policy_diff` runs, so the frozen
/// token is named explicitly instead of being folded into a bare bool.
/// Empty == match.
pub fn policy_diff_with_freeze(
    expected: &Value,
    observed: &Value,
    p: &Prepared,
    contract: &str,
    frozen: bool,
) -> Vec<String> {
    let mut diff = Vec::new();
    match observed.get("frozen") {
        Some(Value::Bool(b)) if *b == frozen => {}
        Some(Value::Bool(true)) => diff.push("meta.frozen:true".to_string()),
        Some(Value::Bool(false)) => diff.push("meta.frozen:false".to_string()),
        Some(_) => diff.push("meta.frozen:type".to_string()),
        None => diff.push("meta.frozen:absent".to_string()),
    }
    let mut normalized = observed.clone();
    normalized["frozen"] = json!(false);
    diff.extend(collateral::policy_diff(
        expected, &normalized, p, contract,
    ));
    diff
}

pub fn effective_with_freeze(
    expected: &Value,
    observed: &Value,
    p: &Prepared,
    contract: &str,
    frozen: bool,
) -> bool {
    policy_diff_with_freeze(expected, observed, p, contract, frozen).is_empty()
}
/// Inspect even terminal results. Unknown authority-producing request types are not "drained".
///
/// Official OutLayer RequestType: the deposit family (intents/deposit, storage-deposit,
/// cross-chain deposit) and this worker's exact-exit storage hop all gate as `call`.
/// Same-chain exact-exit withdraw is `withdraw` (distinct from `cross_chain_withdraw`).
/// A confidential cross-chain deposit (`POST /wallet/v1/confidential/deposit/cross-chain`,
/// legacy `/confidential/deposit-intent`) appears in request history as
/// `confidential_deposit_intent` (live funding_status `5751278c` on `961318d`).
/// Settled rows of those documented types may carry a consumed intent `signature` or
/// `signature_hex` (already submitted with the request). Those are drained. Leftover
/// unused authorities — `wallet_signature`, `signed_transaction`, `signed_tx`,
/// `private_key`, `api_key`, `handoff_url` — and unknown types (`policy_update`,
/// `raw_sign`, `limit_order`) stay undrained. Error text names the type and leftover
/// key paths only, never values.
pub fn authority_inventory(pages: &[Value]) -> Result<(), Error> {
    guarded::settled_inventory(pages)?;
    fn leftover_keys(v: &Value) -> Vec<String> {
        fn walk(v: &Value, path: &str, out: &mut Vec<String>) {
            match v {
                Value::Object(o) => {
                    for (k, child) in o {
                        let p = if path.is_empty() {
                            k.clone()
                        } else {
                            format!("{path}.{k}")
                        };
                        if matches!(
                            k.as_str(),
                            "wallet_signature"
                                | "signed_transaction"
                                | "signed_tx"
                                | "private_key"
                                | "api_key"
                                | "handoff_url"
                        ) {
                            out.push(p.clone());
                        }
                        walk(child, &p, out);
                    }
                }
                Value::Array(a) => {
                    for (i, child) in a.iter().enumerate() {
                        walk(child, &format!("{path}[{i}]"), out);
                    }
                }
                _ => {}
            }
        }
        let mut out = Vec::new();
        walk(v, "", &mut out);
        out
    }
    for page in pages {
        for row in page["requests"]
            .as_array()
            .ok_or_else(|| err("evidence", "unknown inventory"))?
        {
            let kind = row["type"].as_str();
            if !matches!(
                kind,
                Some(
                    "confidential"
                        | "deposit"
                        | "swap"
                        | "cross_chain_withdraw"
                        | "call"
                        | "withdraw"
                        | "confidential_deposit_intent",
                )
            ) {
                return Err(err(
                    "evidence",
                    format!(
                        "unreviewed or reusable prior authority (type={})",
                        kind.unwrap_or("missing")
                    ),
                ));
            }
            let leftover = leftover_keys(&row["result"]);
            if !leftover.is_empty() {
                return Err(err(
                    "evidence",
                    format!(
                        "unreviewed or reusable prior authority (type={}, leftover={})",
                        kind.unwrap_or("missing"),
                        leftover.join(",")
                    ),
                ));
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests;
