//! Deterministic, non-production fixture seeds only. Never used for real reviews/signing.
use super::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
#[derive(Default)]
struct Mem {
    rows: BTreeMap<String, Vec<u8>>,
    writes: Vec<String>,
    fail_before: Option<String>,
}
impl Store for Mem {
    fn read(&mut self, k: &str) -> Result<Vec<u8>, Error> {
        Ok(self.rows.get(k).cloned().unwrap_or_default())
    }
    fn set_if_absent(&mut self, k: &str, v: &[u8]) -> Result<bool, Error> {
        if self.fail_before.as_deref() == Some(k) {
            return Err(err("test", "injected storage crash"));
        }
        if self.rows.contains_key(k) {
            Ok(false)
        } else {
            self.writes.push(k.into());
            self.rows.insert(k.into(), v.into());
            Ok(true)
        }
    }
    fn remove(&mut self, k: &str) -> Result<(), Error> {
        self.rows.remove(k);
        Ok(())
    }
    fn list_prefix(&mut self, p: &str) -> Result<Vec<String>, Error> {
        Ok(self
            .rows
            .keys()
            .filter(|k| k.starts_with(p))
            .cloned()
            .collect())
    }
    fn incr(&mut self, _: &str, _: i64) -> Result<i64, Error> {
        unreachable!()
    }
}
fn pk(seed: u8) -> String {
    B64.encode(
        SigningKey::from_bytes(&[seed; 32])
            .verifying_key()
            .to_bytes(),
    )
}
fn review<T: Serialize>(d: &str, v: &T) -> SignedReport {
    signed(d, v, &[22; 32]).unwrap()
}
fn guardian_fixture(policy: &Value, owner: &str, epoch: u64) -> Value {
    let k = SigningKey::from_bytes(&[23; 32]);
    let n = [24u8; 32];
    let params = guardian_params(
        policy,
        "k0123456789abcdef",
        &format!(
            "ed25519:{}",
            hex::encode(SigningKey::from_bytes(&[42; 32]).verifying_key().to_bytes())
        ),
        "keys.near",
        owner,
        epoch,
        &"ab".repeat(32),
    )
    .unwrap();
    let message=json!({"op":"collateral_guardian","account_id":"guardian.near","ts_ms":1_000_000,"params":params}).to_string();
    let sig = k.sign(&Sha256::digest(crate::nep413_bytes(
        &message, &n, "keyhole", None,
    )));
    json!({"scheme":"nep413","account_id":"guardian.near","public_key":format!("ed25519:{}",bs58::encode(k.verifying_key().as_bytes()).into_string()),"signature":B64.encode(sig.to_bytes()),"nonce":B64.encode(n),"message":message,"recipient":"keyhole"})
}
fn fixture() -> Proof {
    let wallet = SigningKey::from_bytes(&[42; 32]);
    let mut p = Prepared {
        token_id: "k0123456789abcdef".into(),
        owner: "borrow.near".into(),
        owner_epoch: 7,
        worker_hash: "ab".repeat(32),
        wallet_pubkey: format!("ed25519:{}", hex::encode(wallet.verifying_key().as_bytes())),
        plaintext_hash: "cd".repeat(32),
        encrypted_data: "nonsecret fixture ciphertext".into(),
        wallet_signature: String::new(),
        version: 1,
        valid_until: 2000,
    };
    let msg = format!(
        "store_wallet_policy:v2:{}:1:1:2000:{}:{}:keys.near",
        p.wallet_pubkey,
        p.encrypted_data.len(),
        p.encrypted_data
    );
    p.wallet_signature = hex::encode(wallet.sign(&Sha256::digest(msg.as_bytes())).to_bytes());
    let m = FreshManifest {
        domain: "KEYHOLE_FRESH_WALLET_V2".into(),
        project_uuid: guarded::PROJECT_UUID.into(),
        contract: "keys.near".into(),
        token_id: p.token_id.clone(),
        owner: p.owner.clone(),
        owner_epoch: 7,
        worker_hash: p.worker_hash.clone(),
        wallet_id: "11111111-1111-4111-8111-111111111111".into(),
        wallet_pubkey: p.wallet_pubkey.clone(),
        api_key_sha256: sha256_hex("fixture-not-a-production-api-key"),
        register_operation_id: "11".repeat(32),
        created_at_ms: 999_000,
        namespace_absence_sha256: "12".repeat(32),
        registration_sha256: "13".repeat(32),
        initial_inventory_sha256: "14".repeat(32),
        authority_scope: SCOPE.into(),
    };
    let expected = admin_policy(
        &m.wallet_id,
        "fixture-not-a-production-api-key",
        &json!([{"id":"guardian.near","role":"admin"}]),
        1,
    )
    .unwrap();
    let guardian = guardian_fixture(&expected, &p.owner, 7);
    let pre = PreAudit {
        domain: PRE.into(),
        project_uuid: guarded::PROJECT_UUID.into(),
        contract: "keys.near".into(),
        provision_id: p.id(),
        manifest_sha256: digest(&m).unwrap(),
        candidate_policy_sha256: digest(&expected).unwrap(),
        guardian_sha256: digest(&guardian).unwrap(),
        authority_scope: SCOPE.into(),
        report_sha256: "15".repeat(32),
        candidate_policy_reviewed: true,
        fresh_creation_reviewed: true,
        known_authorities_reviewed: true,
        prior_jobs_drained: true,
        issued_at_sec: 1000,
        expires_at_sec: 1100,
    };
    let mut effective = expected.clone();
    effective["policy"] = json!("stored");
    effective["controller"] = json!("keys.near");
    effective["version"] = json!(1);
    effective["locked"] = json!(true);
    effective["frozen"] = json!(false);
    let r = EffectiveReport {
        domain: REPORT.into(),
        project_uuid: guarded::PROJECT_UUID.into(),
        contract: "keys.near".into(),
        provision_id: p.id(),
        token_id: p.token_id.clone(),
        current_owner: p.owner.clone(),
        current_epoch: 7,
        worker_hash: p.worker_hash.clone(),
        wallet_pubkey: p.wallet_pubkey.clone(),
        policy_hash: p.policy_hash(),
        policy_version: 1,
        manifest_sha256: digest(&m).unwrap(),
        pre_audit_sha256: digest(&pre).unwrap(),
        guardian_sha256: digest(&guardian).unwrap(),
        guardian_auth: guardian,
        guardian_access_key: json!({"permission":"FullAccess","nonce":1}),
        candidate_policy_sha256: digest(&expected).unwrap(),
        installed_tx: "original-install-fixture".into(),
        final_receipts_sha256: "16".repeat(32),
        public_policy_sha256: "17".repeat(32),
        inventory_sha256: "18".repeat(32),
        effective_policy: effective,
        authority_scope: SCOPE.into(),
        issued_at_sec: 1000,
        expires_at_sec: 1100,
    };
    let sr = signed(REPORT, &r, &[21; 32]).unwrap();
    let post = PostAudit {
        domain: POST.into(),
        project_uuid: guarded::PROJECT_UUID.into(),
        contract: "keys.near".into(),
        provision_id: p.id(),
        report_sha256: digest(&sr).unwrap(),
        authority_scope: SCOPE.into(),
        no_presigned_authorities: true,
        all_aliases_reviewed: true,
        old_jobs_drained: true,
        external_chain_authorities_reviewed: true,
        effective_policy_reviewed: true,
        reachable_quorum_verified: true,
        issued_at_sec: 1000,
        expires_at_sec: 1100,
    };
    let pre = review(PRE, &pre);
    let post = review(POST, &post);
    Proof {
        prepared: p,
        manifest: m,
        expected_policy: expected,
        pre_message: pre.message,
        pre_signature: pre.signature,
        report: sr,
        post_message: post.message,
        post_signature: post.signature,
    }
}
fn verify(p: &Proof) -> Result<EffectiveReport, Error> {
    verify_proof(p, &pk(22), &pk(21), "keys.near")
}
fn finish(st: &mut Mem, p: &Proof) -> Result<(), Error> {
    finalize(st, p, &pk(22), &pk(21), "keys.near", "borrow.near", 7, 1001)
}
#[test]
fn full_phased_proof_verifies() {
    verify(&fixture()).unwrap();
}
#[test]
fn pre_review_cannot_assert_effective_policy() {
    let p = fixture();
    let mut v: Value = serde_json::from_str(&p.pre_message).unwrap();
    v["effective_policy_reviewed"] = json!(true);
    let s = review(PRE, &v);
    let mut p = p;
    p.pre_message = s.message;
    p.pre_signature = s.signature;
    assert!(verify(&p).is_err());
}
#[test]
fn replayed_pre_audit_cannot_be_post_review() {
    let mut p = fixture();
    p.post_message = p.pre_message.clone();
    p.post_signature = p.pre_signature.clone();
    assert!(verify(&p).is_err());
}
#[test]
fn audit_over_different_policy_hash_rejected() {
    let mut p = fixture();
    let mut a: PreAudit = serde_json::from_str(&p.pre_message).unwrap();
    a.candidate_policy_sha256 = "00".repeat(32);
    let s = review(PRE, &a);
    p.pre_message = s.message;
    p.pre_signature = s.signature;
    assert!(verify(&p).is_err());
}
#[test]
fn missing_post_review_never_commits() {
    let mut p = fixture();
    p.post_message.clear();
    let mut s = Mem::default();
    assert!(finish(&mut s, &p).is_err());
    assert!(s.writes.is_empty());
}
#[test]
fn role_signer_is_not_policy_admin() {
    assert!(admin_policy(
        "wallet",
        "key",
        &json!([{"id":"guardian.near","role":"signer"}]),
        1
    )
    .is_err());
}
#[test]
fn implicit_default_signer_is_rejected() {
    assert!(admin_policy("wallet", "key", &json!([{"id":"guardian.near"}]), 1).is_err());
}
#[test]
fn arbitrary_guardian_fields_rejected() {
    assert!(admin_policy(
        "wallet",
        "key",
        &json!([{"id":"guardian.near","role":"admin","pubkey":"ed25519:injected"}]),
        1
    )
    .is_err());
}
#[test]
fn unreachable_threshold_rejected() {
    assert!(admin_policy(
        "wallet",
        "key",
        &json!([{"id":"guardian.near","role":"admin"}]),
        2
    )
    .is_err());
}
#[test]
fn ownership_changed_mid_enrollment_rejects_finalization() {
    let p = fixture();
    let mut s = Mem::default();
    assert!(finalize(
        &mut s,
        &p,
        &pk(22),
        &pk(21),
        "keys.near",
        "new.near",
        8,
        1001
    )
    .is_err());
    assert!(s.writes.is_empty());
}
#[test]
fn epoch_only_change_also_rejects_finalization() {
    let p = fixture();
    let mut s = Mem::default();
    assert!(finalize(
        &mut s,
        &p,
        &pk(22),
        &pk(21),
        "keys.near",
        "borrow.near",
        8,
        1001
    )
    .is_err());
}
#[test]
fn token_lock_cannot_be_escaped_by_epoch() {
    let p = fixture();
    let mut s = Mem::default();
    s.rows.insert(
        format!("{}/claim", root(&p.prepared.token_id)),
        b"epoch-seven".to_vec(),
    );
    assert!(idle(&mut s, &p.prepared.token_id).is_err());
    assert!(idle(&mut s, &p.prepared.token_id).is_err());
}
#[test]
fn marker_before_proof_rejected() {
    let p = fixture();
    let mut s = Mem::default();
    s.rows.insert(
        tkey(&p.prepared.token_id, "confinement_v1"),
        b"old-marker".to_vec(),
    );
    assert!(finish(&mut s, &p).is_err());
    assert!(!s.rows.contains_key(&proof_key(
        &p.prepared.token_id,
        &digest(&p.report).unwrap()
    )));
}
#[test]
fn proof_is_written_before_last_marker() {
    let p = fixture();
    let mut s = Mem::default();
    finish(&mut s, &p).unwrap();
    assert_eq!(
        s.writes,
        vec![
            proof_key(&p.prepared.token_id, &digest(&p.report).unwrap()),
            tkey(&p.prepared.token_id, "confinement_v1")
        ]
    );
}
#[test]
fn crash_before_marker_keeps_token_locked() {
    let p = fixture();
    let mut s = Mem::default();
    s.rows.insert(
        format!("{}/claim", root(&p.prepared.token_id)),
        b"claim".to_vec(),
    );
    s.fail_before = Some(tkey(&p.prepared.token_id, "confinement_v1"));
    assert!(finish(&mut s, &p).is_err());
    assert!(idle(&mut s, &p.prepared.token_id).is_err());
    s.fail_before = None;
    finish(&mut s, &p).unwrap();
    idle(&mut s, &p.prepared.token_id).unwrap();
}
#[test]
fn same_finalization_is_idempotent() {
    let p = fixture();
    let mut s = Mem::default();
    finish(&mut s, &p).unwrap();
    finish(&mut s, &p).unwrap();
    assert_eq!(s.writes.len(), 2);
}
#[test]
fn tampered_effective_policy_report_rejected() {
    let mut p = fixture();
    let mut r: EffectiveReport = serde_json::from_str(&p.report.message).unwrap();
    r.effective_policy["capabilities"]["raw_sign"]["allowed"] = json!(true);
    p.report.message = serde_json::to_string(&r).unwrap();
    assert!(verify(&p).is_err());
}
#[test]
fn even_resigned_wrong_effective_policy_rejected() {
    let mut p = fixture();
    let mut r: EffectiveReport = serde_json::from_str(&p.report.message).unwrap();
    r.effective_policy["approval"]["approvers"][0]["role"] = json!("signer");
    p.report = signed(REPORT, &r, &[21; 32]).unwrap();
    assert!(verify(&p).is_err());
}
#[test]
fn report_for_different_context_rejected() {
    for field in [
        "worker_hash",
        "wallet_pubkey",
        "contract",
        "project_uuid",
        "provision_id",
        "policy_hash",
        "token_id",
    ] {
        let mut p = fixture();
        let mut r: Value = serde_json::from_str(&p.report.message).unwrap();
        r[field] = json!("wrong");
        p.report = signed(REPORT, &r, &[21; 32]).unwrap();
        assert!(verify(&p).is_err(), "{field}");
    }
}
#[test]
fn reviewer_cannot_use_wrong_key() {
    assert!(verify_proof(&fixture(), &pk(19), &pk(21), "keys.near").is_err());
}
#[test]
fn attestor_cannot_be_substituted() {
    assert!(verify_proof(&fixture(), &pk(22), &pk(19), "keys.near").is_err());
}
#[test]
fn post_audit_over_other_report_rejected() {
    let mut p = fixture();
    let mut a: PostAudit = serde_json::from_str(&p.post_message).unwrap();
    a.report_sha256 = "00".repeat(32);
    let s = review(POST, &a);
    p.post_message = s.message;
    p.post_signature = s.signature;
    assert!(verify(&p).is_err());
}
#[test]
fn each_missing_authority_assertion_rejected() {
    for f in [
        "no_presigned_authorities",
        "all_aliases_reviewed",
        "old_jobs_drained",
        "external_chain_authorities_reviewed",
        "effective_policy_reviewed",
        "reachable_quorum_verified",
    ] {
        let mut p = fixture();
        let mut a: Value = serde_json::from_str(&p.post_message).unwrap();
        a[f] = json!(false);
        let s = review(POST, &a);
        p.post_message = s.message;
        p.post_signature = s.signature;
        assert!(verify(&p).is_err(), "{f}");
    }
}
#[test]
fn post_review_expired_rejects_new_commit() {
    let p = fixture();
    assert!(finalize(
        &mut Mem::default(),
        &p,
        &pk(22),
        &pk(21),
        "keys.near",
        "borrow.near",
        7,
        1100
    )
    .is_err());
}
#[test]
fn legacy_or_wrong_manifest_rejected() {
    for f in ["owner", "worker_hash", "wallet_pubkey", "authority_scope"] {
        let mut p = fixture();
        let mut m: Value = serde_json::to_value(&p.manifest).unwrap();
        m[f] = json!("wrong");
        p.manifest = serde_json::from_value(m).unwrap();
        assert!(verify(&p).is_err());
    }
}
#[test]
fn no_plaintext_secret_in_policy() {
    let p = fixture();
    assert!(!p
        .expected_policy
        .to_string()
        .contains("fixture-not-a-production-api-key"));
    validate_policy(&p.expected_policy, &p.manifest).unwrap();
}
#[test]
fn extra_authorized_key_rejected() {
    let mut p = fixture();
    p.expected_policy["authorized_key_hashes"] = json!([p.manifest.api_key_sha256, "extra"]);
    assert!(validate_policy(&p.expected_policy, &p.manifest).is_err());
}
#[test]
fn unreviewed_extra_policy_field_rejected() {
    let mut p = fixture();
    p.expected_policy["aliases"] = json!(["other"]);
    assert!(validate_policy(&p.expected_policy, &p.manifest).is_err());
}
#[test]
fn complete_empty_inventory_accepts() {
    authority_inventory(&[json!({"total":0,"requests":[]})]).unwrap();
}
fn row(kind: &str, result: Value) -> Value {
    json!({"total":1,"requests":[{"request_id":"11111111-1111-4111-8111-111111111111","type":kind,"status":"success","result":result}]})
}
#[test]
fn terminal_policy_signature_is_not_drained() {
    assert!(authority_inventory(&[row(
        "policy_update",
        json!({"wallet_signature":"unconsumed"})
    )])
    .is_err());
}
#[test]
fn nested_consumed_intent_signature_is_drained() {
    authority_inventory(&[row(
        "confidential",
        json!({"nested":[{"signature":"artifact"}]})
    )])
    .unwrap();
}
#[test]
fn unknown_terminal_type_is_not_drained() {
    assert!(authority_inventory(&[row("raw_sign", json!({}))]).is_err());
}
#[test]
fn valid_confidential_history_accepts() {
    authority_inventory(&[row("confidential", json!({"intent_hash":"settled"}))]).unwrap();
}
#[test]
fn official_deposit_family_call_history_accepts() {
    authority_inventory(&[row(
        "call",
        json!({
            "intent_id": "5284646c-ebad-4862-88cb-cdc456822d06",
            "deposit_address": "0x186a755Ef1C9a91d472a1bE23B4e7964ed533EdB",
            "amount": "900000"
        }),
    )])
    .unwrap();
}
#[test]
fn exact_exit_withdraw_and_storage_call_history_accepts() {
    authority_inventory(&[json!({
        "total": 3,
        "requests": [
            {"request_id":"11111111-1111-4111-8111-111111111111","type":"call","status":"success","result":{"intent_id":"dep"}},
            {"request_id":"11111111-1111-4111-8111-111111111112","type":"confidential","status":"success","result":{"amount":"100000"}},
            {"request_id":"11111111-1111-4111-8111-111111111113","type":"withdraw","status":"success","result":{"intent_hash":"settled"}}
        ]
    })])
    .unwrap();
}
#[test]
fn settled_call_intent_signature_is_drained() {
    authority_inventory(&[row(
        "call",
        json!({
            "intent_id": "5284646c-ebad-4862-88cb-cdc456822d06",
            "deposit_address": "0x186a755Ef1C9a91d472a1bE23B4e7964ed533EdB",
            "amount": "900000",
            "signature": "consumed-intent-signature"
        }),
    )])
    .unwrap();
}
#[test]
fn settled_withdraw_signature_hex_is_drained() {
    authority_inventory(&[row("withdraw", json!({"intent_hash":"settled","signature_hex":"consumed"}))]).unwrap();
}
#[test]
fn call_signed_transaction_is_not_drained() {
    assert!(authority_inventory(&[row("call", json!({"signed_transaction":"unsent"}))]).is_err());
}
#[test]
fn call_private_key_is_not_drained() {
    assert!(authority_inventory(&[row("call", json!({"private_key":"secret"}))]).is_err());
}
#[test]
fn call_wallet_signature_is_not_drained() {
    assert!(authority_inventory(&[row("call", json!({"wallet_signature":"unconsumed"}))]).is_err());
}
#[test]
fn leftover_error_names_type_and_key_not_value() {
    let e = authority_inventory(&[row("call", json!({"signed_tx":"UNSENT_VALUE"}))]).unwrap_err();
    let msg = format!("{e:?}");
    assert!(msg.contains("type=call"), "{msg}");
    assert!(msg.contains("leftover=signed_tx"), "{msg}");
    assert!(!msg.contains("UNSENT_VALUE"), "{msg}");
}
#[test]
fn settled_confidential_deposit_intent_history_accepts() {
    authority_inventory(&[row(
        "confidential_deposit_intent",
        json!({
            "intent_id": "5284646c-ebad-4862-88cb-cdc456822d06",
            "deposit_address": "0x186a755Ef1C9a91d472a1bE23B4e7964ed533EdB",
            "amount": "900000"
        }),
    )])
    .unwrap();
}
#[test]
fn settled_confidential_deposit_intent_signature_is_drained() {
    authority_inventory(&[row(
        "confidential_deposit_intent",
        json!({
            "intent_id": "5284646c-ebad-4862-88cb-cdc456822d06",
            "signature": "consumed-intent-signature",
            "signature_hex": "consumed"
        }),
    )])
    .unwrap();
}
#[test]
fn confidential_deposit_intent_signed_transaction_is_not_drained() {
    let e = authority_inventory(&[row(
        "confidential_deposit_intent",
        json!({"signed_transaction":"UNSENT_VALUE"}),
    )])
    .unwrap_err();
    let msg = format!("{e:?}");
    assert!(msg.contains("type=confidential_deposit_intent"), "{msg}");
    assert!(msg.contains("leftover=signed_transaction"), "{msg}");
    assert!(!msg.contains("UNSENT_VALUE"), "{msg}");
}
#[test]
fn policy_update_is_still_not_drained() {
    assert!(authority_inventory(&[row("policy_update", json!({}))]).is_err());
}
#[test]
fn incomplete_inventory_is_not_drained() {
    assert!(authority_inventory(&[json!({"total":1,"requests":[]})]).is_err());
}
#[test]
fn floating_evidence_is_not_canonical() {
    assert!(digest(&json!({"amount":0.5})).is_err());
}
#[test]
fn digest_is_order_independent_for_object_keys() {
    assert_eq!(
        digest(&json!({"b":1,"a":{"z":2,"y":3}})).unwrap(),
        digest(&serde_json::from_str::<Value>(r#"{"a":{"y":3,"z":2},"b":1}"#).unwrap()).unwrap()
    );
}
#[test]
fn guardian_accepts_full_access_inside_rpc_result_envelope() {
    let p = fixture();
    let r: EffectiveReport = serde_json::from_str(&p.report.message).unwrap();
    let a: Auth = serde_json::from_value(r.guardian_auth).unwrap();
    let expected = guardian_params(
        &p.expected_policy,
        &p.prepared.token_id,
        &p.prepared.wallet_pubkey,
        "keys.near",
        "borrow.near",
        7,
        &p.prepared.worker_hash,
    )
    .unwrap();
    guardian(
        &a,
        &expected,
        &p.expected_policy,
        &json!({"permission":"FullAccess"}),
        "keyhole",
        1_000_000,
    )
    .unwrap();
    guardian(
        &a,
        &expected,
        &p.expected_policy,
        &json!({"jsonrpc":"2.0","id":"1","result":{"nonce":1,"permission":"FullAccess","block_height":1}}),
        "keyhole",
        1_000_000,
    )
    .unwrap();
    assert!(guardian(
        &a,
        &expected,
        &p.expected_policy,
        &json!({"jsonrpc":"2.0","result":{"permission":{"FunctionCall":{}}}}),
        "keyhole",
        1_000_000,
    )
    .is_err());
}
#[test]
fn guardian_requires_full_access() {
    let p = fixture();
    let r: EffectiveReport = serde_json::from_str(&p.report.message).unwrap();
    let a: Auth = serde_json::from_value(r.guardian_auth).unwrap();
    let expected = guardian_params(
        &p.expected_policy,
        &p.prepared.token_id,
        &p.prepared.wallet_pubkey,
        "keys.near",
        "borrow.near",
        7,
        &p.prepared.worker_hash,
    )
    .unwrap();
    assert!(guardian(
        &a,
        &expected,
        &p.expected_policy,
        &json!({"permission":{"FunctionCall":{}}}),
        "keyhole",
        1_000_000
    )
    .is_err());
}
#[test]
fn guardian_wrong_policy_and_recipient_rejected() {
    let p = fixture();
    let r: EffectiveReport = serde_json::from_str(&p.report.message).unwrap();
    let a: Auth = serde_json::from_value(r.guardian_auth).unwrap();
    assert!(guardian(
        &a,
        &json!({}),
        &p.expected_policy,
        &json!({"permission":"FullAccess"}),
        "keyhole",
        1_000_000
    )
    .is_err());
    let params = guardian_params(
        &p.expected_policy,
        &p.prepared.token_id,
        &p.prepared.wallet_pubkey,
        "keys.near",
        "borrow.near",
        7,
        &p.prepared.worker_hash,
    )
    .unwrap();
    assert!(guardian(
        &a,
        &params,
        &p.expected_policy,
        &json!({"permission":"FullAccess"}),
        "other",
        1_000_000
    )
    .is_err());
}
#[test]
fn guardian_stale_challenge_rejected() {
    let p = fixture();
    let r: EffectiveReport = serde_json::from_str(&p.report.message).unwrap();
    let a: Auth = serde_json::from_value(r.guardian_auth).unwrap();
    let params = guardian_params(
        &p.expected_policy,
        &p.prepared.token_id,
        &p.prepared.wallet_pubkey,
        "keys.near",
        "borrow.near",
        7,
        &p.prepared.worker_hash,
    )
    .unwrap();
    assert!(guardian(
        &a,
        &params,
        &p.expected_policy,
        &json!({"permission":"FullAccess"}),
        "keyhole",
        2_000_000
    )
    .is_err());
}
struct Registration {
    calls: usize,
    unknown: bool,
    malformed: bool,
}
impl RegisterTransport for Registration {
    fn register(&mut self) -> Result<Value, Error> {
        self.calls += 1;
        if self.unknown {
            return Err(err("test", "lost original response"));
        }
        if self.malformed {
            return Ok(json!({}));
        }
        Ok(
            json!({"api_key":"fixture-key-only","near_account_id":"ab".repeat(32),"wallet_id":"22222222-2222-4222-8222-222222222222","handoff_url":"fixture-must-stay-sealed"}),
        )
    }
}
#[test]
fn fresh_registration_transport_called_once_on_success() {
    let mut st = Mem::default();
    let mut t = Registration {
        calls: 0,
        unknown: false,
        malformed: false,
    };
    let r = register_fresh(
        &mut st,
        &mut t,
        "token",
        "borrow.near",
        &json!({"op":"one"}),
    )
    .unwrap();
    assert!(r.get("handoff_url").is_none());
    assert!(register_fresh(
        &mut st,
        &mut t,
        "token",
        "borrow.near",
        &json!({"op":"two"})
    )
    .is_err());
    assert_eq!(t.calls, 1);
}
#[test]
fn lost_registration_response_never_resubmits() {
    let mut st = Mem::default();
    let mut t = Registration {
        calls: 0,
        unknown: true,
        malformed: false,
    };
    for _ in 0..2 {
        assert!(register_fresh(
            &mut st,
            &mut t,
            "token",
            "borrow.near",
            &json!({"op":"one"})
        )
        .is_err());
    }
    assert_eq!(t.calls, 1);
}
#[test]
fn malformed_registration_response_never_resubmits() {
    let mut st = Mem::default();
    let mut t = Registration {
        calls: 0,
        unknown: false,
        malformed: true,
    };
    for _ in 0..2 {
        assert!(register_fresh(
            &mut st,
            &mut t,
            "token",
            "borrow.near",
            &json!({"op":"one"})
        )
        .is_err());
    }
    assert_eq!(t.calls, 1);
}
#[test]
fn every_legacy_namespace_refuses_before_provider_post() {
    for k in fresh_namespaces("token", "borrow.near") {
        let mut st = Mem::default();
        st.rows.insert(k.clone(), b"existing".to_vec());
        let mut t = Registration {
            calls: 0,
            unknown: false,
            malformed: false,
        };
        assert!(
            register_fresh(
                &mut st,
                &mut t,
                "token",
                "borrow.near",
                &json!({"op":"one"})
            )
            .is_err(),
            "{k}"
        );
        assert_eq!(t.calls, 0);
    }
}
#[test]
fn duplicate_provider_wallet_cannot_enroll_a_second_token() {
    let mut st = Mem::default();
    let mut t = Registration {
        calls: 0,
        unknown: false,
        malformed: false,
    };
    register_fresh(&mut st, &mut t, "one", "borrow.near", &json!({"op":"one"})).unwrap();
    assert!(register_fresh(&mut st, &mut t, "two", "other.near", &json!({"op":"two"})).is_err());
    assert!(!st.rows.contains_key(&tkey("two", "wallet")));
}
#[test]
fn registration_storage_failure_retains_latch() {
    let mut st = Mem {
        fail_before: Some(format!("{}/registration_sealed", root("token"))),
        ..Mem::default()
    };
    let mut t = Registration {
        calls: 0,
        unknown: false,
        malformed: false,
    };
    assert!(register_fresh(
        &mut st,
        &mut t,
        "token",
        "borrow.near",
        &json!({"op":"one"})
    )
    .is_err());
    st.fail_before = None;
    assert!(register_fresh(
        &mut st,
        &mut t,
        "token",
        "borrow.near",
        &json!({"op":"one"})
    )
    .is_err());
    assert_eq!(t.calls, 1);
}
#[test]
fn guardian_nonce_cannot_be_replayed() {
    let mut s = Mem::default();
    consume_guardian(&mut s, "guardian.near", &[9; 32], "first").unwrap();
    assert!(consume_guardian(&mut s, "guardian.near", &[9; 32], "second").is_err());
}
#[test]
fn pre_review_cannot_be_replayed_across_owner_epoch() {
    let mut p = fixture();
    p.prepared.owner_epoch += 1;
    p.manifest.owner_epoch += 1;
    assert!(verify(&p).is_err());
}
#[test]
fn quote_deadline_utc_epoch_and_fraction() {
    assert_eq!(quote_expiry_ms("1970-01-01T00:00:00Z"), Some(0));
    assert_eq!(quote_expiry_ms("1970-01-01T00:00:01.123456Z"), Some(1123));
}
#[test]
fn quote_deadline_leap_year_validation() {
    assert!(quote_expiry_ms("2024-02-29T23:59:59.000Z").is_some());
    assert!(quote_expiry_ms("2023-02-29T00:00:00Z").is_none());
}
#[test]
fn unknown_quote_deadline_is_not_substituted() {
    for d in [
        "",
        "tomorrow",
        "2026-11-11T19:00:00+02:00",
        "2026-13-01T00:00:00Z",
        "2026-11-11T24:00:00Z",
        "2026-11-11T12:00:00.Z",
    ] {
        assert!(quote_expiry_ms(d).is_none(), "{d}");
    }
}
#[test]
fn certificate_requires_live_frozen_effective_policy() {
    let p = fixture();
    let r: EffectiveReport = serde_json::from_str(&p.report.message).unwrap();
    assert!(!effective_with_freeze(
        &p.expected_policy,
        &r.effective_policy,
        &p.prepared,
        "keys.near",
        true
    ));
    let mut live = r.effective_policy;
    live["frozen"] = json!(true);
    assert!(effective_with_freeze(
        &p.expected_policy,
        &live,
        &p.prepared,
        "keys.near",
        true
    ));
    live["capabilities"]["raw_sign"]["allowed"] = json!(true);
    assert!(!effective_with_freeze(
        &p.expected_policy,
        &live,
        &p.prepared,
        "keys.near",
        true
    ));
}
#[test]
fn crash_before_marker_can_refresh_expired_uncommitted_report() {
    let p = fixture();
    let marker = tkey(&p.prepared.token_id, "confinement_v1");
    let mut st = Mem {
        fail_before: Some(marker.clone()),
        ..Mem::default()
    };
    assert!(finish(&mut st, &p).is_err());
    st.fail_before = None;
    let mut renewed = p.clone();
    let mut r: EffectiveReport = serde_json::from_str(&renewed.report.message).unwrap();
    r.issued_at_sec = 1200;
    r.expires_at_sec = 1300;
    renewed.report = signed(REPORT, &r, &[21; 32]).unwrap();
    let mut a: PostAudit = serde_json::from_str(&renewed.post_message).unwrap();
    a.report_sha256 = digest(&renewed.report).unwrap();
    a.issued_at_sec = 1200;
    a.expires_at_sec = 1300;
    let a = review(POST, &a);
    renewed.post_message = a.message;
    renewed.post_signature = a.signature;
    finalize(
        &mut st,
        &renewed,
        &pk(22),
        &pk(21),
        "keys.near",
        "borrow.near",
        7,
        1201,
    )
    .unwrap();
    assert_eq!(
        load_proof(&mut st, &p.prepared.token_id)
            .unwrap()
            .report
            .message,
        renewed.report.message
    );
    assert!(st.rows.contains_key(&proof_key(
        &p.prepared.token_id,
        &digest(&p.report).unwrap()
    )));
}
#[test]
fn new_holder_can_finalize_original_install_only_after_fresh_report_and_review() {
    let mut p = fixture();
    let mut r: EffectiveReport = serde_json::from_str(&p.report.message).unwrap();
    r.current_owner = "new.near".into();
    r.current_epoch = 8;
    r.guardian_auth = guardian_fixture(&p.expected_policy, "new.near", 8);
    r.guardian_sha256 = digest(&r.guardian_auth).unwrap();
    p.report = signed(REPORT, &r, &[21; 32]).unwrap();
    let mut post: PostAudit = serde_json::from_str(&p.post_message).unwrap();
    post.report_sha256 = digest(&p.report).unwrap();
    let post = review(POST, &post);
    p.post_message = post.message;
    p.post_signature = post.signature;
    let mut st = Mem::default();
    finalize(
        &mut st,
        &p,
        &pk(22),
        &pk(21),
        "keys.near",
        "new.near",
        8,
        1001,
    )
    .unwrap();
    assert_eq!(
        load_proof(&mut st, &p.prepared.token_id)
            .unwrap()
            .prepared
            .owner,
        "borrow.near"
    );
}
#[test]
fn initial_wallet_requires_genuine_zero_balances() {
    fresh_balances(&json!({"account_id":"wallet","balances":[]}), "wallet").unwrap();
    for b in [
        json!({}),
        json!({"account_id":"other","balances":[]}),
        json!({"account_id":"wallet","balances":[{"token":"USDC","balance":"1"}]}),
        json!({"account_id":"wallet","balances":[{"token":"USDC"}]}),
    ] {
        assert!(fresh_balances(&b, "wallet").is_err());
    }
}
#[test]
fn different_uuid_and_key_cannot_alias_existing_fresh_public_identity() {
    let mut st = Mem::default();
    let mut first = Registration {
        calls: 0,
        unknown: false,
        malformed: false,
    };
    register_fresh(
        &mut st,
        &mut first,
        "first",
        "owner",
        &json!({"operation":"first"}),
    )
    .unwrap();
    struct Alias(usize);
    impl RegisterTransport for Alias {
        fn register(&mut self) -> Result<Value, Error> {
            self.0 += 1;
            Ok(
                json!({"api_key":"different-fixture-key","near_account_id":"ab".repeat(32),"wallet_id":"33333333-3333-4333-8333-333333333333"}),
            )
        }
    }
    let mut alias = Alias(0);
    assert!(register_fresh(
        &mut st,
        &mut alias,
        "second",
        "different-owner",
        &json!({"operation":"second"})
    )
    .is_err());
    assert!(!st
        .read(&format!("{}/claim", root("second")))
        .unwrap()
        .is_empty());
    assert!(st.read(&tkey("second", "wallet")).unwrap().is_empty());
    assert_eq!(alias.0, 1);
}

#[test]
fn resigned_wrong_readback_wallet_or_extra_authority_never_finalizes_or_certifies() {
    for (field, value) in [("wallet_id",json!("different-wallet")),("refund_addresses",json!({"base":"unreviewed-address"})),("unknown_authority",json!({"allowed":true}))] {
        let mut p = fixture();
        let mut r: EffectiveReport = serde_json::from_str(&p.report.message).unwrap();
        r.effective_policy[field] = value;
        p.report = signed(REPORT, &r, &[21; 32]).unwrap();
        assert!(verify(&p).is_err());
        let mut s = Mem::default();
        assert!(finish(&mut s, &p).is_err());
        assert!(s.writes.is_empty());
        r.effective_policy["frozen"] = json!(true);
        assert!(!effective_with_freeze(&p.expected_policy,&r.effective_policy,&p.prepared,"keys.near",true));
    }
}
