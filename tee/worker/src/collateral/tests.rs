use super::*;
use ed25519_dalek::{Signer, SigningKey};
use std::collections::BTreeMap;
#[derive(Default)]
struct Mem(BTreeMap<String, Vec<u8>>);
impl Store for Mem {
    fn read(&mut self, k: &str) -> Result<Vec<u8>, Error> {
        Ok(self.0.get(k).cloned().unwrap_or_default())
    }
    fn set_if_absent(&mut self, k: &str, v: &[u8]) -> Result<bool, Error> {
        if self.0.contains_key(k) {
            Ok(false)
        } else {
            self.0.insert(k.into(), v.into());
            Ok(true)
        }
    }
    fn remove(&mut self, k: &str) -> Result<(), Error> {
        self.0.remove(k);
        Ok(())
    }
    fn list_prefix(&mut self, p: &str) -> Result<Vec<String>, Error> {
        Ok(self
            .0
            .keys()
            .filter(|s| s.starts_with(p))
            .cloned()
            .collect())
    }
    fn incr(&mut self, _: &str, _: i64) -> Result<i64, Error> {
        unreachable!()
    }
}
fn plan() -> Prepared {
    let key = SigningKey::from_bytes(&[42; 32]);
    let mut p = Prepared {
        token_id: "pilot".into(),
        owner: "borrow.near".into(),
        owner_epoch: 7,
        worker_hash: "ab".repeat(32),
        wallet_pubkey: format!("ed25519:{}", hex::encode(key.verifying_key().as_bytes())),
        plaintext_hash: "cd".repeat(32),
        encrypted_data: "ciphertext-no-secret-fixture".into(),
        wallet_signature: String::new(),
        version: 1,
        valid_until: 2000,
    };
    let m = format!(
        "store_wallet_policy:v2:{}:1:1:2000:{}:{}:keys.near",
        p.wallet_pubkey,
        p.encrypted_data.len(),
        p.encrypted_data
    );
    p.wallet_signature = hex::encode(key.sign(&Sha256::digest(m.as_bytes())).to_bytes());
    p
}
fn review(p: &Prepared) -> AuthorityAudit {
    AuthorityAudit {
        domain: DOMAIN.into(),
        project_uuid: guarded::PROJECT_UUID.into(),
        contract: "keys.near".into(),
        provision_id: p.id(),
        authority_audit_sha256: "ef".repeat(32),
        issued_at_sec: 1000,
        expires_at_sec: 1100,
        no_presigned_authorities: true,
        all_aliases_reviewed: true,
        old_jobs_drained: true,
        external_chain_authorities_reviewed: true,
        effective_policy_reviewed: true,
        reachable_quorum_verified: true,
    }
}
fn approval(a: &AuthorityAudit) -> (String, String, String) {
    let k = SigningKey::from_bytes(&[43; 32]);
    let m = serde_json::to_string(a).unwrap();
    let sig = B64.encode(k.sign(format!("{DOMAIN}\n{m}").as_bytes()).to_bytes());
    (m, sig, B64.encode(k.verifying_key().as_bytes()))
}
fn views(p: &Prepared) -> (Value, Value) {
    (
        json!({"ready":true,"wallet_pubkey":p.wallet_pubkey,"encrypted_policy_hash":p.policy_hash(),"policy_version":"1"}),
        json!({"owner":"keys.near","locked":true,"frozen":false,"version":1,"encrypted_data":p.encrypted_data}),
    )
}
fn receipt(p: &Prepared) -> Value {
    let mut v = crate::receipts::fixture("original", "minter.near", "keys.near", "true");
    v["transaction"]["actions"] = json!([{"FunctionCall":{"method_name":"register_collateral","deposit":(BINDING_DEPOSIT+1).to_string(),"gas":200_000_000_000_000u64,"args":B64.encode(p.args().to_string())}}]);
    v
}
#[test]
fn restricted_policy_has_no_raw_or_external_signing() {
    let p = policy("wallet", "sealed-key", &json!([{"id":"review.near"}]), 1).unwrap();
    assert_eq!(
        p["authorized_key_hashes"],
        json!([sha256_hex("sealed-key")])
    );
    assert_eq!(p["capabilities"]["sign_message"]["allowed"], false);
    assert!(!p["rules"]["transaction_types"]
        .as_array()
        .unwrap()
        .contains(&json!("call")));
    assert!(!p.to_string().contains("sealed-key"));
}
#[test]
fn quorum_must_be_reachable_unique_and_named() {
    for (a, t) in [
        (json!([]), 1),
        (json!([{"id":"a.near"}]), 0),
        (json!([{"id":"a.near"}]), 2),
        (json!([{"id":"a.near"},{"id":"a.near"}]), 2),
        (json!([{"id":"a.near","role":"admin"}]), 1),
        (json!([{"id":"!"}]), 1),
    ] {
        assert!(policy("wallet", "key", &a, t).is_err());
    }
}
#[test]
fn provider_signature_binds_caller_ciphertext_lock_and_validity() {
    let p = plan();
    assert!(p.validate("keys.near", 1000).is_ok());
    assert!(p.validate("evil.near", 1000).is_err());
    for mutate in 0..5 {
        let mut p = p.clone();
        match mutate {
            0 => p.encrypted_data.push('x'),
            1 => p.version = 2,
            2 => p.valid_until += 1,
            3 => p.wallet_pubkey = format!("ed25519:{}", "aa".repeat(32)),
            _ => p.wallet_signature = "aa".repeat(64),
        }
        assert!(p.validate("keys.near", 1000).is_err());
    }
}
#[test]
fn expired_or_oversized_artifact_fails() {
    let mut p = plan();
    assert!(p.validate("keys.near", 1940).is_err());
    p.encrypted_data = "x".repeat(4097);
    assert!(p.validate("keys.near", 1000).is_err());
}
#[test]
fn pinned_reviewer_required_not_holder_assertion() {
    let p = plan();
    let a = review(&p);
    let (m, s, k) = approval(&a);
    assert!(audit(&m, &s, &k, &p, "keys.near", 1001).is_ok());
    assert!(audit(&m, &s, "", &p, "keys.near", 1001).is_err());
    let mut p = p;
    p.owner_epoch += 1;
    assert!(audit(&m, &s, &k, &p, "keys.near", 1001).is_err());
}
#[test]
fn audit_rejects_each_incomplete_authority_surface() {
    for flag in [
        "no_presigned_authorities",
        "all_aliases_reviewed",
        "old_jobs_drained",
        "external_chain_authorities_reviewed",
        "effective_policy_reviewed",
        "reachable_quorum_verified",
    ] {
        let p = plan();
        let mut a = serde_json::to_value(review(&p)).unwrap();
        a[flag] = json!(false);
        let a: AuthorityAudit = serde_json::from_value(a).unwrap();
        let (m, s, k) = approval(&a);
        assert!(audit(&m, &s, &k, &p, "keys.near", 1001).is_err(), "{flag}");
    }
}
#[test]
fn audit_has_build_policy_epoch_domain_expiry_separation() {
    let p = plan();
    for field in [
        "domain",
        "project_uuid",
        "contract",
        "provision_id",
        "authority_audit_sha256",
    ] {
        let mut a = serde_json::to_value(review(&p)).unwrap();
        a[field] = json!("wrong");
        let a: AuthorityAudit = serde_json::from_value(a).unwrap();
        let (m, s, k) = approval(&a);
        assert!(audit(&m, &s, &k, &p, "keys.near", 1001).is_err());
    }
    let (m, s, k) = approval(&review(&p));
    assert!(audit(&m, &s, &k, &p, "keys.near", 1100).is_err());
    assert!(audit(&m, &s, &k, &p, "keys.near", 999).is_err());
}
#[test]
fn audit_signature_is_exact_bytes_not_reserialized() {
    let p = plan();
    let (m, s, k) = approval(&review(&p));
    assert!(audit(&(m + " "), &s, &k, &p, "keys.near", 1001).is_err());
}
#[test]
fn quote_is_actual_beneficiary_quote_and_signed_ceiling() {
    assert_eq!(
        quote(&json!("5240000000000000000000"), "66190000000000000000000").unwrap(),
        25_240_000_000_000_000_000_000
    );
    assert_eq!(
        quote(&json!(MAX_QUOTE.to_string()), "66190000000000000000000").unwrap(),
        BINDING_DEPOSIT + MAX_QUOTE
    );
    for q in [
        json!(0),
        json!("0"),
        json!("-1"),
        json!((MAX_QUOTE + 1).to_string()),
    ] {
        assert!(quote(&q, "66190000000000000000000").is_err());
    }
    assert!(quote(&json!("5240000000000000000000"), "1").is_err());
}
#[test]
fn pending_and_ack_never_count_as_final_registration() {
    let p = plan();
    let v = receipt(&p);
    assert!(final_registration(
        &v,
        "original",
        "minter.near",
        "keys.near",
        &p,
        BINDING_DEPOSIT + 1
    ));
    for status in [
        json!({"SuccessReceiptId":"receipt"}),
        json!({"SuccessValue":B64.encode("false")}),
        json!({"Failure":"failed"}),
        json!(null),
    ] {
        let mut v = v.clone();
        v["status"] = status;
        assert!(!final_registration(
            &v,
            "original",
            "minter.near",
            "keys.near",
            &p,
            BINDING_DEPOSIT + 1
        ));
    }
    for status in ["EXECUTED_OPTIMISTIC", "INCLUDED_FINAL", "EXECUTED"] {
        let mut v = v.clone();
        v["final_execution_status"] = json!(status);
        assert!(!final_registration(
            &v,
            "original",
            "minter.near",
            "keys.near",
            &p,
            BINDING_DEPOSIT + 1
        ));
    }
}
#[test]
fn original_receipt_must_bind_exact_actions_and_deposit() {
    let p = plan();
    let v = receipt(&p);
    for path in ["hash", "signer_id", "receiver_id"] {
        let mut v = v.clone();
        v["transaction"][path] = json!("wrong");
        assert!(!final_registration(
            &v,
            "original",
            "minter.near",
            "keys.near",
            &p,
            BINDING_DEPOSIT + 1
        ));
    }
    for path in ["method_name", "deposit", "args"] {
        let mut v = v.clone();
        v["transaction"]["actions"][0]["FunctionCall"][path] = json!("wrong");
        assert!(!final_registration(
            &v,
            "original",
            "minter.near",
            "keys.near",
            &p,
            BINDING_DEPOSIT + 1
        ));
    }
    let mut v = v;
    v["receipts_outcome"][0]["outcome"]["status"] = json!({"Failure":"callback lost"});
    assert!(!final_registration(
        &v,
        "original",
        "minter.near",
        "keys.near",
        &p,
        BINDING_DEPOSIT + 1
    ));
}
#[test]
fn sealed_writer_only_after_terminal_exact_binding_and_immutable() {
    let p = plan();
    let a = review(&p);
    let (b, policy) = views(&p);
    let mut st = Mem::default();
    assert!(seal_eligibility(&mut st, &p, &a, &b, &policy, "keys.near", false).is_err());
    assert!(st.0.is_empty());
    for field in [
        "ready",
        "wallet_pubkey",
        "encrypted_policy_hash",
        "policy_version",
    ] {
        let mut b = b.clone();
        b[field] = json!(null);
        assert!(seal_eligibility(&mut st, &p, &a, &b, &policy, "keys.near", true).is_err());
    }
    seal_eligibility(&mut st, &p, &a, &b, &policy, "keys.near", true).unwrap();
    seal_eligibility(&mut st, &p, &a, &b, &policy, "keys.near", true).unwrap();
    let raw = st
        .read(&crate::tkey(&p.token_id, "confinement_v1"))
        .unwrap();
    let e: guarded::Eligibility = serde_json::from_slice(&raw).unwrap();
    assert_eq!(e.policy_hash, p.policy_hash());
    let mut a = a;
    a.authority_audit_sha256 = "01".repeat(32);
    assert!(seal_eligibility(&mut st, &p, &a, &b, &policy, "keys.near", true).is_err());
}
#[test]
fn sealed_writer_rejects_wrong_controller_unlocked_frozen_or_missing_policy() {
    let p = plan();
    let a = review(&p);
    let (b, policy) = views(&p);
    for field in ["owner", "locked", "frozen", "version", "encrypted_data"] {
        let mut policy = policy.clone();
        policy[field] = json!(null);
        let mut st = Mem::default();
        assert!(seal_eligibility(&mut st, &p, &a, &b, &policy, "keys.near", true).is_err());
        assert!(st.0.is_empty());
    }
}
#[test]
fn current_decrypted_policy_must_match_all_prepared_authority_surfaces() {
    let p = plan();
    let expected = policy("wallet", "sealed-key", &json!([{"id":"review.near"}]), 1).unwrap();
    let mut observed = expected.clone();
    observed["policy"] = json!("stored");
    observed["controller"] = json!("keys.near");
    observed["version"] = json!(1);
    observed["locked"] = json!(true);
    observed["frozen"] = json!(false);
    assert!(effective_policy_matches(
        &expected,
        &observed,
        &p,
        "keys.near"
    ));
    for field in [
        "policy",
        "controller",
        "version",
        "locked",
        "frozen",
        "rules",
        "approval",
        "capabilities",
        "authorized_key_hashes",
    ] {
        let mut v = observed.clone();
        v[field] = Value::Null;
        assert!(
            !effective_policy_matches(&expected, &v, &p, "keys.near"),
            "{field}"
        );
    }
}

#[test]
fn title_epoch_namespaces_do_not_strand_new_holder_and_only_reconcile_can_adopt() {
    let p = plan();
    assert_ne!(
        provision_root(&p.token_id, p.owner_epoch),
        provision_root(&p.token_id, p.owner_epoch + 1)
    );
    assert!(holder_plan_access(&p, &p.owner, p.owner_epoch, false));
    assert!(!holder_plan_access(
        &p,
        "new.near",
        p.owner_epoch + 1,
        false
    ));
    assert!(!holder_plan_access(&p, &p.owner, p.owner_epoch + 2, false));
    assert!(holder_plan_access(&p, "new.near", p.owner_epoch + 1, true));
    assert_eq!(p.args()["expected_owner_id"], p.owner);
    assert_eq!(p.args()["expected_owner_epoch"], p.owner_epoch.to_string());
}
#[test]
fn production_idle_gate_only_holds_the_current_title_epoch() {
    let mut s = Mem::default();
    let p = plan();
    s.set_if_absent(
        &format!("{}/claimed", provision_root(&p.token_id, p.owner_epoch)),
        b"old",
    )
    .unwrap();
    assert!(assert_provision_idle(&mut s, &p.token_id, p.owner_epoch).is_err());
    assert!(assert_provision_idle(&mut s, &p.token_id, p.owner_epoch + 1).is_ok());
    assert!(assert_provision_idle(&mut s, &p.token_id, p.owner_epoch + 2).is_ok());
}
#[test]
fn exact_closed_false_or_failure_is_terminal_but_incomplete_failure_is_unknown() {
    let p = plan();
    for status in [
        json!({"SuccessValue":B64.encode("false")}),
        json!({"Failure":{"ActionError":"failed"}}),
    ] {
        let mut v = receipt(&p);
        v["status"] = status.clone();
        v["receipts_outcome"][0]["outcome"]["status"] = status;
        assert_eq!(
            registration_terminal(
                &v,
                "original",
                "minter.near",
                "keys.near",
                &p,
                BINDING_DEPOSIT + 1
            ),
            Some(false)
        );
        v["receipts_outcome"] = Value::Null;
        assert_eq!(
            registration_terminal(
                &v,
                "original",
                "minter.near",
                "keys.near",
                &p,
                BINDING_DEPOSIT + 1
            ),
            None
        );
    }
}
