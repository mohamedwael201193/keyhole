use super::*;
use serde_json::json;
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
    assert!(p["rules"]["transaction_types"]
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
    // ROUND 9: the provider returns the wallet's own public key as
    // controller, not the keys contract (experiment E7/E8).
    observed["controller"] = json!(p.wallet_pubkey);
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

#[test]
fn observed_wallet_and_every_authority_field_are_exact() {
    let p = plan();
    let expected = policy("wallet", "sealed-key", &json!([{"id":"review.near"}]), 1).unwrap();
    let mut good = expected.clone();
    // ROUND 9: controller is the wallet's own public key (experiment E7/E8),
    // not the keys contract.
    for (k,v) in [("policy",json!("stored")),("controller",json!(p.wallet_pubkey.clone())),("version",json!(1)),("locked",json!(true)),("frozen",json!(false))] { good[k]=v; }
    // ROUND 9: usage:null is NOT in the bad list anymore. Plan section 4.2
    // (documented OA default) accepts usage as absent | null | object.
    for (k,v) in [("wallet_id",json!("different-wallet")),("wallet_id",Value::Null),("refund_addresses",json!({"base":"other-address"})),("refund_addresses",Value::Null),("unknown_authority",json!({"allowed":true})),("rules",Value::Null),("authorized_key_hashes",json!(["extra-key"]))] {
        let mut bad=good.clone();bad[k]=v;
        assert!(!effective_policy_matches(&expected,&bad,&p,"keys.near"),"{k}");
    }
    // ROUND 9: a controller that is the contract (not the wallet pubkey) is a
    // real mismatch.
    let mut bad_contract = good.clone();
    bad_contract["controller"] = json!("keys.near");
    assert!(!effective_policy_matches(&expected,&bad_contract,&p,"keys.near"));
    // ROUND 9: usage null is accepted (documented default).
    let mut usage_null = good.clone();
    usage_null["usage"] = Value::Null;
    assert!(effective_policy_matches(&expected,&usage_null,&p,"keys.near"));
    let mut usage_bad = good.clone();
    usage_bad["usage"] = json!("not-an-object");
    assert!(!effective_policy_matches(&expected,&usage_bad,&p,"keys.near"));
    let mut bad=good.clone();bad["capabilities"]["new_signing_door"]=json!({"allowed":true});
    assert!(!effective_policy_matches(&expected,&bad,&p,"keys.near"));
    good["usage"]=json!({"daily":{"usdc":"123"}});
    good["refund_addresses"]=json!({});
    assert!(effective_policy_matches(&expected,&good,&p,"keys.near"));
    let mut with_refund=expected.clone();with_refund["refund_addresses"]=json!({"base":"reviewed-address"});
    good["refund_addresses"]=with_refund["refund_addresses"].clone();
    assert!(effective_policy_matches(&with_refund,&good,&p,"keys.near"));
    good["refund_addresses"]["base"]=json!("changed-address");
    assert!(!effective_policy_matches(&with_refund,&good,&p,"keys.near"));
    good.as_object_mut().unwrap().remove("wallet_id");
    assert!(!effective_policy_matches(&expected,&good,&p,"keys.near"));
}


#[test]
fn wallet_pubkey_hex_and_base58_are_the_same_key() {
    let raw: [u8; 32] = [
        0xe1, 0x56, 0x87, 0x46, 0xa7, 0x0e, 0x6f, 0x41, 0x84, 0x07, 0x5a, 0xaf, 0xba, 0xd2, 0x69,
        0x44, 0xf8, 0xe0, 0xae, 0x1e, 0xd2, 0xd2, 0x65, 0x0e, 0x60, 0x28, 0xaa, 0x2a, 0x95, 0xec,
        0x34, 0x89,
    ];
    let hex: String = raw.iter().map(|b| format!("{b:02x}")).collect();
    let b58 = bs58::encode(raw).into_string();
    assert_eq!(wallet_pubkey_bytes(&format!("ed25519:{hex}")), Some(raw));
    assert_eq!(wallet_pubkey_bytes(&hex), Some(raw));
    assert_eq!(wallet_pubkey_bytes(&hex.to_uppercase()), Some(raw));
    assert_eq!(wallet_pubkey_bytes(&format!("ed25519:{b58}")), Some(raw));
    assert_eq!(wallet_pubkey_bytes(&b58), Some(raw));
    assert!(same_wallet_pubkey(&json!(format!("ed25519:{b58}")), &hex));
    assert!(same_wallet_pubkey(&json!(format!("ed25519:{hex}")), &hex));
    assert!(same_wallet_pubkey(&json!(b58), &hex));
    assert!(!same_wallet_pubkey(
        &json!(format!("ed25519:{b58}")),
        &"aa".repeat(32)
    ));
    assert!(!same_wallet_pubkey(&json!("not-a-key"), &hex));
    // Live 200 body used the wallet UUID, which is not a 32-byte key.
    let uuid = "66684254-fe09-4176-8927-8b3e6f10d774";
    assert!(!same_wallet_pubkey(&json!(uuid), &hex));
    assert!(wallet_pubkey_is_wallet_id(&json!(uuid), uuid));
    assert!(wallet_pubkey_is_wallet_id(&json!(uuid.to_uppercase()), uuid));
    assert!(!wallet_pubkey_is_wallet_id(&json!("other-id"), uuid));
    assert!(!wallet_pubkey_is_wallet_id(&json!(uuid), ""));
}

#[test]
fn public_encrypt_failure_redacts_secrets_and_names_http_status() {
    let body = json!({
        "error": "bad_request",
        "message": "locked without quorum",
        "encrypted_base64": "SECRET_CIPHERTEXT",
        "api_key": "wk_secret",
        "signature_hex": "deadbeef",
        "wallet_pubkey": "ed25519:abc",
        "policy_hash": "ab".repeat(32),
        "details": {"api_key": "nested-secret", "reason": "x"}
    });
    let s = public_encrypt_failure(400, &body);
    assert!(s.contains("http 400"), "{s}");
    assert!(s.contains("bad_request"), "{s}");
    assert!(s.contains("locked without quorum"), "{s}");
    assert!(s.contains("ed25519:abc"), "{s}");
    assert!(!s.contains("SECRET_CIPHERTEXT"), "{s}");
    assert!(!s.contains("wk_secret"), "{s}");
    assert!(!s.contains("deadbeef"), "{s}");
    assert!(!s.contains("nested-secret"), "{s}");
    assert!(s.contains("[redacted]"), "{s}");
}

#[test]
fn hollow_claim_is_cleared_and_stored_ciphertext_is_reused() {
    assert!(hollow_encrypt_claim(true, false));
    assert!(!hollow_encrypt_claim(true, true));
    assert!(!hollow_encrypt_claim(false, false));
    assert!(reuse_encrypt_result(true));
    assert!(!reuse_encrypt_result(false));
}

// ---------------------------------------------------------------------------
// ROUND 9 live ground-truth tests (T1-T5, T8-T10). Every test is fed by a
// CAPTURED body from the Phase-1 experiment (exec/loans/live_r9/, copied to
// tee/worker/src/fixtures/live_r9/). No body is synthesized. The experiment
// wallet is 08bff346-2c28-4390-8d00-049ed43f656d, near_account_id (wallet
// public-key hex) 21d789097f45a577a3867bdfb01901cc8cc7a7737041c63e7988f73e710f8ea0.
// ---------------------------------------------------------------------------

fn live_prepared(wallet_pubkey: &str) -> Prepared {
    Prepared {
        token_id: "live-r9".into(),
        owner: "keyhole-devmo.near".into(),
        owner_epoch: 0,
        worker_hash: "ab".repeat(32),
        wallet_pubkey: wallet_pubkey.into(),
        plaintext_hash: "cd".repeat(32),
        encrypted_data: "fixture-ciphertext".into(),
        wallet_signature: String::new(),
        version: 1,
        valid_until: 2000,
    }
}

fn live_fixture(name: &str) -> Value {
    // include_str! is resolved relative to THIS source file, so the fixture
    // path is stable no matter which directory cargo test runs from. The
    // macro expands the literal name into the include path at compile time.
    macro_rules! live_json {
        ($n:literal) => {{
            let text = include_str!(concat!("../fixtures/live_r9/", $n));
            serde_json::from_str::<Value>(text).unwrap()
        }};
    }
    match name {
        "e3_P.json" => live_json!("e3_P.json"),
        "e7_policy_final.json" => live_json!("e7_policy_final.json"),
        "e9_policy_frozen_t60s.json" => live_json!("e9_policy_frozen_t60s.json"),
        "e10_policy_thawed_t60s.json" => live_json!("e10_policy_thawed_t60s.json"),
        "e2_policy_none.json" => live_json!("e2_policy_none.json"),
        "e3_encrypt_policy.json" => live_json!("e3_encrypt_policy.json"),
        "e4_sign_policy.json" => live_json!("e4_sign_policy.json"),
        "b3_prepare.out.json" => live_json!("b3_prepare.out.json"),
        "b3_wallet_policy_view.json" => live_json!("b3_wallet_policy_view.json"),
        "e6_wallet_policy_view.json" => live_json!("e6_wallet_policy_view.json"),
        "e9_wallet_policy_view_frozen.json" => live_json!("e9_wallet_policy_view_frozen.json"),
        _ => panic!("live_r9 fixture not registered in live_fixture: {name}"),
    }
}

const EXP_WALLET_PUBKEY: &str =
    "ed25519:21d789097f45a577a3867bdfb01901cc8cc7a7737041c63e7988f73e710f8ea0";
const B3_WALLET_PUBKEY: &str =
    "ed25519:85eba57887f1fe1c22c8b97ed137c4b52da4cdbfb19394c37118210d4fba53f1";

#[test]
fn r9_t1_effective_matches_captured_stored_unfrozen() {
    // T1: expected = the captured P.json (e3), observed = the captured stored
    // body (e7 t=300s). The ONLY difference the old code saw was the
    // controller; with the round-9 controller rule the diff must be empty.
    let expected = live_fixture("e3_P.json");
    let observed = live_fixture("e7_policy_final.json")["body"].clone();
    let p = live_prepared(EXP_WALLET_PUBKEY);
    let diff = policy_diff(&expected, &observed, &p, "keyhole-devmo.near");
    assert!(diff.is_empty(), "T1 diff must be empty, got {diff:?}");
    assert!(effective_policy_matches(
        &expected,
        &observed,
        &p,
        "keyhole-devmo.near"
    ));
}

#[test]
fn r9_t2_effective_with_freeze_matches_captured_frozen_and_thawed() {
    // T2: frozen (E9 t=60s) and thawed (E10 t=60s) bodies, via the frozen
    // path. The frozen body differs from P.json only by controller + the
    // frozen marker itself; the thawed body only by controller.
    let expected = live_fixture("e3_P.json");
    let p = live_prepared(EXP_WALLET_PUBKEY);
    let frozen = live_fixture("e9_policy_frozen_t60s.json")["body"].clone();
    let diff_frozen = crate::collateral_evidence::policy_diff_with_freeze(
        &expected,
        &frozen,
        &p,
        "keyhole-devmo.near",
        true,
    );
    assert!(
        diff_frozen.is_empty(),
        "T2 frozen diff must be empty, got {diff_frozen:?}"
    );
    assert!(crate::collateral_evidence::effective_with_freeze(
        &expected,
        &frozen,
        &p,
        "keyhole-devmo.near",
        true
    ));
    let thawed = live_fixture("e10_policy_thawed_t60s.json")["body"].clone();
    let diff_thawed = crate::collateral_evidence::policy_diff_with_freeze(
        &expected,
        &thawed,
        &p,
        "keyhole-devmo.near",
        false,
    );
    assert!(
        diff_thawed.is_empty(),
        "T2 thawed diff must be empty, got {diff_thawed:?}"
    );
    assert!(crate::collateral_evidence::effective_with_freeze(
        &expected,
        &thawed,
        &p,
        "keyhole-devmo.near",
        false
    ));
    // A frozen body checked against the unfrozen expectation must fail, and
    // name the frozen field.
    let diff_wrong = crate::collateral_evidence::policy_diff_with_freeze(
        &expected,
        &frozen,
        &p,
        "keyhole-devmo.near",
        false,
    );
    assert!(
        diff_wrong.contains(&"meta.frozen:true".to_string()),
        "T2 wrong-freeze diff must name meta.frozen:true, got {diff_wrong:?}"
    );
}

#[test]
fn r9_t3_diff_names_each_field() {
    // T3: mutate the captured stored body one field at a time; each mutation
    // must produce exactly the token that names it (and fail the bool).
    let expected = live_fixture("e3_P.json");
    let stored = live_fixture("e7_policy_final.json")["body"].clone();
    let p = live_prepared(EXP_WALLET_PUBKEY);
    let contract = "keyhole-devmo.near";
    // One mutation case: (name, mutation, expected diff tokens).
    type Case = (String, Box<dyn Fn(&mut Value)>, Vec<&'static str>);
    let mut cases: Vec<Case> = Vec::new();
    cases.push((
        "controller other key".into(),
        Box::new(|v: &mut Value| {
            v["controller"] = json!("ed25519:0000000000000000000000000000000000000000000000000000000000000000");
        }),
        vec!["meta.controller:differs"],
    ));
    cases.push((
        "controller is the contract (the S11 failure)".into(),
        Box::new(|v: &mut Value| {
            v["controller"] = json!("keyhole-devmo.near");
        }),
        vec!["meta.controller:differs"],
    ));
    cases.push((
        "policy none".into(),
        Box::new(|v: &mut Value| {
            v["policy"] = json!("none");
        }),
        vec!["meta.policy:none"],
    ));
    cases.push((
        "version 2".into(),
        Box::new(|v: &mut Value| {
            v["version"] = json!(2);
        }),
        vec!["meta.version:2"],
    ));
    cases.push((
        "version 0".into(),
        Box::new(|v: &mut Value| {
            v["version"] = json!(0);
        }),
        vec!["meta.version:0"],
    ));
    cases.push((
        "locked false".into(),
        Box::new(|v: &mut Value| {
            v["locked"] = json!(false);
        }),
        vec!["meta.locked:false"],
    ));
    cases.push((
        "frozen true".into(),
        Box::new(|v: &mut Value| {
            v["frozen"] = json!(true);
        }),
        vec!["meta.frozen:true"],
    ));
    cases.push((
        "usage null is accepted (documented default)".into(),
        Box::new(|v: &mut Value| {
            v["usage"] = Value::Null;
        }),
        vec![],
    ));
    cases.push((
        "usage wrong type".into(),
        Box::new(|v: &mut Value| {
            v["usage"] = json!("not-an-object");
        }),
        vec!["usage:type"],
    ));
    cases.push((
        "refund_addresses null".into(),
        Box::new(|v: &mut Value| {
            v["refund_addresses"] = Value::Null;
        }),
        vec!["top.null:refund_addresses"],
    ));
    cases.push((
        "transaction_types reordered".into(),
        Box::new(|v: &mut Value| {
            v["rules"]["transaction_types"] =
                json!(["call","withdraw","cross_chain_withdraw","swap","confidential"]);
        }),
        vec!["rules.transaction_types:order"],
    ));
    cases.push((
        "transaction_types element changed".into(),
        Box::new(|v: &mut Value| {
            v["rules"]["transaction_types"] =
                json!(["confidential","swap","cross_chain_withdraw","withdraw","transfer"]);
        }),
        vec!["rules.transaction_types:element[4]"],
    ));
    cases.push((
        "threshold as object".into(),
        Box::new(|v: &mut Value| {
            v["approval"]["threshold"] = json!({"required":1});
        }),
        vec!["approval.threshold:type number->object"],
    ));
    cases.push((
        "threshold value 2".into(),
        Box::new(|v: &mut Value| {
            v["approval"]["threshold"] = json!(2);
        }),
        vec!["approval.threshold:value"],
    ));
    cases.push((
        "approver role changed".into(),
        Box::new(|v: &mut Value| {
            v["approval"]["approvers"][0]["role"] = json!("user");
        }),
        vec!["approval.approvers[0].role:value"],
    ));
    cases.push((
        "approver extra key pubkey".into(),
        Box::new(|v: &mut Value| {
            v["approval"]["approvers"][0]["pubkey"] = json!("ed25519:abc");
        }),
        vec!["approval.approvers[0].extra_key:pubkey"],
    ));
    cases.push((
        "capability extra key allowed_recipients".into(),
        Box::new(|v: &mut Value| {
            v["capabilities"]["sign_message"]["allowed_recipients"] = json!([]);
        }),
        vec!["capabilities.sign_message.extra_key:allowed_recipients"],
    ));
    cases.push((
        "capability allowed flipped".into(),
        Box::new(|v: &mut Value| {
            v["capabilities"]["sign_message"]["allowed"] = json!(true);
        }),
        vec!["capabilities.sign_message.allowed:value"],
    ));
    cases.push((
        "authorized_key_hashes emptied".into(),
        Box::new(|v: &mut Value| {
            v["authorized_key_hashes"] = json!([]);
        }),
        vec!["authorized_key_hashes:len 1->0"],
    ));
    cases.push((
        "authorized_key_hashes element changed".into(),
        Box::new(|v: &mut Value| {
            v["authorized_key_hashes"] = json!(["0000000000000000000000000000000000000000000000000000000000000000"]);
        }),
        vec!["authorized_key_hashes:elements differ"],
    ));
    cases.push((
        "wallet_id differs".into(),
        Box::new(|v: &mut Value| {
            v["wallet_id"] = json!("different-wallet-id");
        }),
        vec!["wallet_id:differs"],
    ));
    cases.push((
        "extra top-level key".into(),
        Box::new(|v: &mut Value| {
            v["webhook_url"] = json!("https://example.invalid/hook");
        }),
        vec!["top.extra_key:webhook_url"],
    ));
    // ROUND 9 FIX (panel H6): pin the mutations the code catches but T3 did
    // not cover — approval/rules extra fields (fallback), capability
    // missing/extra (fallback), authorized_key_hashes null, version as a
    // string, controller absent.
    cases.push((
        "approval extra field".into(),
        Box::new(|v: &mut Value| {
            v["approval"]["admin_quorum"] = json!(2);
        }),
        vec!["approval:differs"],
    ));
    cases.push((
        "rules extra field".into(),
        Box::new(|v: &mut Value| {
            v["rules"]["admin_quorum"] = json!(2);
        }),
        vec!["rules.extra_key:admin_quorum"],
    ));
    cases.push((
        "capability missing".into(),
        Box::new(|v: &mut Value| {
            v["capabilities"].as_object_mut().unwrap().remove("sign_message");
        }),
        vec!["capabilities.sign_message:missing"],
    ));
    cases.push((
        "capability extra".into(),
        Box::new(|v: &mut Value| {
            v["capabilities"]["new_capability"] = json!({"allowed": true});
        }),
        vec!["capabilities.new_capability:extra"],
    ));
    cases.push((
        "authorized_key_hashes null".into(),
        Box::new(|v: &mut Value| {
            v["authorized_key_hashes"] = Value::Null;
        }),
        vec!["authorized_key_hashes:missing"],
    ));
    cases.push((
        "version as string".into(),
        Box::new(|v: &mut Value| {
            v["version"] = json!("1");
        }),
        vec!["meta.version:type"],
    ));
    cases.push((
        "controller absent".into(),
        Box::new(|v: &mut Value| {
            v.as_object_mut().unwrap().remove("controller");
        }),
        vec!["meta.controller:absent"],
    ));
    for (name, mutate, want) in cases {
        let mut v = stored.clone();
        mutate(&mut v);
        let diff = policy_diff(&expected, &v, &p, contract);
        // ROUND 9 FIX (panel H6): assert EXACT equality, not containment.
        // If a fallback is ever refactored away, a missing token must fail
        // this test. The expected list is the complete diff for the mutation.
        let mut got: Vec<&str> = diff.iter().map(|s| s.as_str()).collect();
        got.sort_unstable();
        let mut want_sorted = want.clone();
        want_sorted.sort_unstable();
        assert_eq!(
            got, want_sorted,
            "T3 {name}: diff must be exactly {want:?}, got {diff:?}"
        );
        if want.is_empty() {
            assert!(
                diff.is_empty(),
                "T3 {name}: diff must be empty (accepted), got {diff:?}"
            );
            assert!(effective_policy_matches(&expected, &v, &p, contract));
        } else {
            assert!(
                !effective_policy_matches(&expected, &v, &p, contract),
                "T3 {name}: bool must be false"
            );
            // No token may leak a hash, account id, wallet id or key value.
            for t in &diff {
                assert!(
                    !t.contains("21d78909") && !t.contains("1dc141bb") && !t.contains("08bff346"),
                    "T3 {name}: token leaks a value: {t}"
                );
            }
        }
    }
}

#[test]
fn r9_t4_pending_sync_classified() {
    // T4: the E2 pre-store body (policy:"none") is a provider-sync artifact,
    // not a real mismatch. A stored-but-different body is ineligible, not sync.
    let expected = live_fixture("e3_P.json");
    let p = live_prepared(EXP_WALLET_PUBKEY);
    let none_body = live_fixture("e2_policy_none.json")["body"].clone();
    let diff = policy_diff(&expected, &none_body, &p, "keyhole-devmo.near");
    assert!(
        diff.contains(&"meta.policy:none".to_string()),
        "T4 no-policy diff must contain meta.policy:none, got {diff:?}"
    );
    assert!(
        policy_diff_is_sync_only(&diff, Some(false), Some(false)),
        "T4 no-policy diff must classify as PENDING_PROVIDER_SYNC, got {diff:?}"
    );
    assert!(!effective_policy_matches(
        &expected,
        &none_body,
        &p,
        "keyhole-devmo.near"
    ));
    // Stored but different (controller is the contract) is ineligible.
    let mut stored_bad = live_fixture("e7_policy_final.json")["body"].clone();
    stored_bad["controller"] = json!("keyhole-devmo.near");
    let diff_bad = policy_diff(&expected, &stored_bad, &p, "keyhole-devmo.near");
    assert!(
        diff_bad.contains(&"meta.controller:differs".to_string()),
        "T4 stored-bad diff must contain meta.controller:differs, got {diff_bad:?}"
    );
    assert!(
        !policy_diff_is_sync_only(&diff_bad, Some(false), Some(false)),
        "T4 stored-bad diff must NOT classify as sync, got {diff_bad:?}"
    );
    // A frozen lag (chain frozen, provider not yet) is sync; the same frozen
    // token with the chain agreeing is a real mismatch.
    let frozen_lag = vec!["meta.frozen:true".to_string()];
    assert!(policy_diff_is_sync_only(
        &frozen_lag,
        Some(false),
        Some(true)
    ));
    assert!(!policy_diff_is_sync_only(
        &frozen_lag,
        Some(true),
        Some(true)
    ));
}

#[test]
fn r9_t5_canonical_hash_and_provider_hash_relationship() {
    // T5 (ADAPTED to the corrected tripwire): the plan section 4.1 tripwire
    // as written (`canonical_hash(P.json) == encrypt policy_hash`) can NEVER
    // pass -- the provider's stored plaintext adds the controller and meta
    // fields P.json lacks (experiment E0.1/E3; 23 candidate stored-forms
    // across 2 independent cases, 0 matches). This test pins the true
    // relationship instead of asserting the impossible equality:
    //  (a) canonical_hash(P.json) equals the known H_local (the worker's own
    //      candidate_policy_sha256 rule), proving the canonicalisation is right;
    //  (b) the provider is self-consistent: sign policy_hash == encrypt
    //      policy_hash;
    //  (c) canonical_hash(P.json) != encrypt policy_hash (the old tripwire
    //      would always trip -- this is the correction, not a failure).
    let expected = live_fixture("e3_P.json");
    let h_local = canonical_hash(&expected);
    assert_eq!(
        h_local,
        "1f9c8f5e0971166338d3d43ce0b2a2247b80c3e5b7168d178bbf0a4b5466c22c",
        "T5 canonical_hash(P.json) must equal the experiment H_local"
    );
    let enc = live_fixture("e3_encrypt_policy.json");
    let sign = live_fixture("e4_sign_policy.json");
    assert_eq!(
        enc["policy_hash"], sign["policy_hash"],
        "T5 provider must be self-consistent (sign == encrypt)"
    );
    assert_ne!(
        h_local,
        enc["policy_hash"].as_str().unwrap(),
        "T5 canonical_hash(P.json) must DIFFER from the provider policy_hash (the stored form adds controller+meta)"
    );
    // The B3 case reproduces the same relationship independently, by
    // RECOMPUTING the canonical hash over the captured B3 candidate_policy
    // (not just reading the recorded field).
    let b3 = live_fixture("b3_prepare.out.json");
    let b3_candidate = &b3["candidate_policy"];
    let b3_recomputed = canonical_hash(b3_candidate);
    assert_eq!(
        b3_recomputed,
        b3["candidate_policy_sha256"].as_str().unwrap(),
        "T5 B3 canonical_hash(candidate_policy) must equal the recorded candidate_policy_sha256"
    );
    assert_ne!(
        b3_recomputed,
        b3["plaintext_hash"].as_str().unwrap(),
        "T5 B3 candidate hash must differ from the provider plaintext_hash"
    );
}

#[test]
fn r9_t8_binding_matches_real_views() {
    // T8: binding_matches against the real B3 binding/view SHAPES. The B3
    // ciphertext itself is redacted from the fixtures, so the test uses a
    // consistent test ciphertext (the binding's encrypted_policy_hash is
    // recomputed from it); every other field is the real captured value
    // (B3 wallet pubkey, policy version, owner, locked, frozen, version).
    let mut p = live_prepared(B3_WALLET_PUBKEY);
    p.encrypted_data = "fixture-ciphertext-for-binding-test".into();
    p.version = 1;
    let binding = json!({
        "wallet_pubkey": B3_WALLET_PUBKEY,
        "encrypted_policy_hash": p.policy_hash(),
        "policy_version": "1",
        "ready": true,
        "policy_generation": "0",
    });
    // Real B3 view fields (b3_wallet_policy_view.json), with the test
    // ciphertext substituted for the redacted one.
    let mut view = live_fixture("b3_wallet_policy_view.json");
    view["encrypted_data"] = json!(p.encrypted_data);
    assert!(
        binding_matches(&p, &binding, &view, "keyhole-devmo.near"),
        "T8 binding_matches must pass on the real B3 view shape"
    );
    // A tampered binding hash must fail.
    let mut bad_binding = binding.clone();
    bad_binding["encrypted_policy_hash"] = json!("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    assert!(
        !binding_matches(&p, &bad_binding, &view, "keyhole-devmo.near"),
        "T8 tampered binding hash must fail"
    );
    // A frozen view must fail binding_matches (it requires frozen == false).
    let mut frozen_view = view.clone();
    frozen_view["frozen"] = json!(true);
    assert!(
        !binding_matches(&p, &binding, &frozen_view, "keyhole-devmo.near"),
        "T8 frozen view must fail binding_matches"
    );
    // The experiment views (unfrozen E6, frozen E9) carry the same shape:
    // owner, frozen, version, locked, storage_deposit, storage_refund_to.
    let e6 = live_fixture("e6_wallet_policy_view.json");
    assert_eq!(e6["frozen"], json!(false));
    assert_eq!(e6["locked"], json!(true));
    assert_eq!(e6["version"], json!(1));
    let e9 = live_fixture("e9_wallet_policy_view_frozen.json");
    assert_eq!(e9["frozen"], json!(true));
    assert_eq!(e9["locked"], json!(true));
    assert_eq!(e9["version"], json!(1));
}

#[test]
fn r9_t9_sign_and_encrypt_response_shapes() {
    // T9: the captured sign-policy and encrypt-policy response shapes.
    let enc = live_fixture("e3_encrypt_policy.json");
    assert_eq!(enc["status"], json!(200));
    // wallet_pubkey is the wallet_id UUID, not a 32-byte key (live prepare
    // eb62bc50 already documented this form).
    assert_eq!(
        enc["wallet_pubkey"],
        json!("08bff346-2c28-4390-8d00-049ed43f656d")
    );
    let ph = enc["policy_hash"].as_str().unwrap();
    assert_eq!(ph.len(), 64);
    assert!(ph.bytes().all(|b| b.is_ascii_hexdigit()));
    let sign = live_fixture("e4_sign_policy.json");
    assert_eq!(sign["status"], json!(200));
    assert_eq!(sign["locked"], json!(true));
    assert_eq!(sign["version"], json!(1));
    let pk = sign["public_key_hex"].as_str().unwrap();
    assert_eq!(pk.len(), 64);
    assert!(pk.bytes().all(|b| b.is_ascii_hexdigit()));
    assert_eq!(
        pk,
        "21d789097f45a577a3867bdfb01901cc8cc7a7737041c63e7988f73e710f8ea0",
        "T9 sign public_key_hex must be the wallet near_account_id hex"
    );
    assert_eq!(
        sign["policy_hash"], enc["policy_hash"],
        "T9 sign policy_hash must equal encrypt policy_hash"
    );
    assert!(sign["valid_until"].as_u64().unwrap() > 0);
}

#[test]
fn r9_t10_every_custody_get_path_has_a_fixture() {
    // T10: coverage guard. Every `custody_get` path in the worker source
    // must have at least one captured live_r9 fixture, so a new first-live
    // shape cannot be added silently. The guard reads the host sources
    // (text) and the fixture directory (file names).
    let hosts = [
        include_str!("../collateral_host.rs"),
        include_str!("../collateral_evidence_host.rs"),
        include_str!("../guarded_host.rs"),
        include_str!("../exact_exit_host.rs"),
    ];
    // Collect the literal custody_get paths used in the host sources.
    let mut paths: Vec<String> = Vec::new();
    for src in hosts {
        for part in src.split("custody_get(").skip(1) {
            // The call is custody_get(key, "<path>") or custody_get(key, &format!(...)).
            // Take the first quoted literal after the comma.
            if let Some(rest) = part.split(',').nth(1) {
                if let Some(start) = rest.find('"') {
                    let after = &rest[start + 1..];
                    if let Some(end) = after.find('"') {
                        let lit = &after[..end];
                        if lit.starts_with("/wallet/v1/") {
                            paths.push(lit.to_string());
                        }
                    }
                }
            }
        }
    }
    paths.sort();
    paths.dedup();
    assert!(
        !paths.is_empty(),
        "T10 must find at least one custody_get path in the host sources"
    );
    // The fixture set (live_r9) must cover each distinct path family.
    // include_str! is resolved relative to THIS source file, so a missing
    // fixture fails compilation -- the strongest possible coverage guard.
    let _fixtures: &[&str] = &[
        include_str!("../fixtures/live_r9/e2_requests.json"),
        include_str!("../fixtures/live_r9/e2_limit_orders.json"),
        include_str!("../fixtures/live_r9/e2_pending_approvals.json"),
        include_str!("../fixtures/live_r9/e2_conf_balance.json"),
        include_str!("../fixtures/live_r9/e2_conf_balance_token.json"),
        include_str!("../fixtures/live_r9/e2_balance_intents.json"),
        include_str!("../fixtures/live_r9/e2_policy_none.json"),
        include_str!("../fixtures/live_r9/e7_policy_final.json"),
        include_str!("../fixtures/live_r9/e9_policy_frozen_t60s.json"),
        include_str!("../fixtures/live_r9/e10_policy_thawed_t60s.json"),
        include_str!("../fixtures/live_r9/e2c_requests_after_deposit.json"),
        include_str!("../fixtures/live_r9/e9_cert_requests.json"),
        include_str!("../fixtures/live_r9/e9_cert_conf_balance_token.json"),
    ];
    assert_eq!(_fixtures.len(), 13, "T10 must list all 13 coverage fixtures");
    // Every custody_get path family must be represented by a fixture.
    // ROUND 9 FIX (panel H2): the guard must iterate the DISCOVERED paths,
    // not a fixed list of known families. A new custody_get path that
    // matches no fixture family must FAIL this test, so a new first-live
    // shape cannot be added silently.
    let families = [
        "/wallet/v1/requests",
        "/wallet/v1/limit-orders",
        "/wallet/v1/pending_approvals",
        "/wallet/v1/confidential/balance",
        "/wallet/v1/balance",
        "/wallet/v1/policy",
    ];
    for p in &paths {
        assert!(
            families.iter().any(|f| p.starts_with(f)),
            "T10 custody_get path {p} has no fixture family — add a captured fixture for it"
        );
    }
    // Each known family must also be present in the source (guards deletion).
    for prefix in families {
        assert!(
            paths.iter().any(|p| p.starts_with(prefix)),
            "T10 custody_get path family {prefix} not found in host sources"
        );
    }
    // The policy path must have all four shapes: none, stored, frozen, thawed.
    let _policy_shapes: &[&str] = &[
        include_str!("../fixtures/live_r9/e2_policy_none.json"),
        include_str!("../fixtures/live_r9/e7_policy_final.json"),
        include_str!("../fixtures/live_r9/e9_policy_frozen_t60s.json"),
        include_str!("../fixtures/live_r9/e10_policy_thawed_t60s.json"),
    ];
    assert_eq!(_policy_shapes.len(), 4, "T10 must list all 4 policy shapes");
}

#[test]
fn r9_custody_probe_is_wired_read_only_and_honest() {
    // ROUND 9 (panel H7): custody_probe had zero tests. This text test pins
    // the wiring and the honesty properties that the library tests cannot
    // reach (the op is a host function, wasm32-only).
    let host = include_str!("../collateral_host.rs");
    let main = include_str!("../main.rs");
    // Wired: in the ops list and in the dispatch match.
    assert!(main.contains("\"custody_probe\""), "T-custody_probe: ops list");
    assert!(
        main.contains("\"custody_probe\" => op_custody_probe(&input)"),
        "T-custody_probe: dispatch"
    );
    // The op function exists and authenticates as the owner (NEP-413).
    assert!(
        host.contains("fn op_custody_probe(input: &Value)"),
        "T-custody_probe: op function"
    );
    assert!(
        host.contains("provision_auth(input, \"custody_probe\")"),
        "T-custody_probe: owner auth"
    );
    // Read-only: the probe body uses GET only. Extract the op function and
    // assert it contains no POST/send.
    let start = host.find("fn op_custody_probe").unwrap();
    let probe = &host[start..];
    // The op ends at the next top-level `fn ` after its start.
    let end = probe[10..].find("\nfn ").map(|i| i + 10).unwrap_or(probe.len());
    let probe = &probe[..end];
    assert!(
        probe.contains("http(\"GET\""),
        "T-custody_probe: must use GET"
    );
    assert!(
        !probe.contains("http(\"POST\""),
        "T-custody_probe: must not POST"
    );
    assert!(
        !probe.contains("native_send"),
        "T-custody_probe: must not send a transaction"
    );
    // Honest ok: the top-level ok reflects the core policy read, not a
    // hardcoded true. (Panel H7: ok:true with every endpoint failed misleads.)
    assert!(
        probe.contains("let ok = policy_status.as_u64() == Some(200);"),
        "T-custody_probe: ok must derive from the policy read status"
    );
    assert!(
        !probe.contains("\"ok\":true,\"op\":\"custody_probe\""),
        "T-custody_probe: ok must not be hardcoded true"
    );
    // The op returns per-endpoint status/shape and the three verdicts.
    for key in [
        "\"policy\"",
        "\"requests\"",
        "\"limit_orders\"",
        "\"pending_approvals\"",
        "\"confidential_balance\"",
        "\"confidential_balance_token\"",
        "\"balance_intents\"",
        "\"policy_diff\"",
        "\"settled_inventory\"",
        "\"authority_inventory\"",
        "\"fixed_floor_shape\"",
    ] {
        assert!(
            probe.contains(key),
            "T-custody_probe: output must carry {key}"
        );
    }
}
