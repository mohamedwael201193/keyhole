use super::*;
use crate::{
    guarded::{JournalEvent, ProviderHost},
    Store,
};
use std::collections::BTreeMap;
#[derive(Default)]
struct Fixture {
    data: BTreeMap<String, Vec<u8>>,
    posts: Vec<(Step, Value, String)>,
    rows: BTreeMap<String, Value>,
    obs: Option<Observation>,
    lose: Option<Step>,
    wrong: Option<Step>,
    status: Option<(Step, String)>,
    delta: Option<i128>,
    registered: bool,
    finish_calls: usize,
    deny: bool,
    clock: u64,
    poll_error: bool,
    write_fail: Option<String>,
    duplicate: bool,
    final_delta: Option<i128>,
    bad_result: Option<Value>,
    storage_noop: bool,
    finish_fail: bool,
}
impl Fixture {
    fn new() -> Self {
        Self {
            obs: Some(Observation {
                confidential: "1000".into(),
                intents: "20".into(),
                recipient: "7".into(),
                native: (NATIVE_MAX * 2).to_string(),
                storage_min: STORAGE_MAX.to_string(),
                registered: false,
            }),
            clock: 1000,
            ..Self::default()
        }
    }
}
impl Store for Fixture {
    fn set_if_absent(&mut self, k: &str, v: &[u8]) -> Result<bool, Error> {
        if self.write_fail.as_ref().is_some_and(|p| k.ends_with(p)) {
            return Err(err("storage", "injected persistence failure"));
        }
        if self.data.contains_key(k) {
            return Ok(false);
        }
        self.data.insert(k.into(), v.to_vec());
        Ok(true)
    }
    fn read(&mut self, k: &str) -> Result<Vec<u8>, Error> {
        Ok(self.data.get(k).cloned().unwrap_or_default())
    }
    fn remove(&mut self, k: &str) -> Result<(), Error> {
        self.data.remove(k);
        Ok(())
    }
    fn list_prefix(&mut self, p: &str) -> Result<Vec<String>, Error> {
        Ok(self
            .data
            .keys()
            .filter(|k| k.starts_with(p))
            .cloned()
            .collect())
    }
    fn incr(&mut self, _k: &str, _d: i64) -> Result<i64, Error> {
        unreachable!()
    }
}
impl ProviderHost for Fixture {
    fn validate_dispatch(&mut self, _j: &Journal, _key: &str) -> Result<(), Error> {
        if self.deny {
            Err(err("pledged", "control changed"))
        } else {
            Ok(())
        }
    }
    fn post(&mut self, _j: &Journal, _key: &str, _path: &str) -> Result<(u16, Value), Error> {
        panic!("legacy endpoint must not be reached")
    }
    fn fetch(&mut self, _key: &str, id: &str) -> Result<(u16, Value), Error> {
        if self.poll_error {
            return Ok((503, json!({"error":"unavailable"})));
        }
        Ok((200, self.rows[id].clone()))
    }
    fn finish(&mut self, j: &Journal, t: &Terminal) -> Result<bool, Error> {
        if self.finish_fail {
            self.finish_fail = false;
            return Err(err("storage", "injected terminal gap"));
        }
        save(self, &format!("{}/terminal", j.key()), t)?;
        self.finish_calls += 1;
        Ok(true)
    }
}
impl Host for Fixture {
    fn now_ms(&mut self) -> Result<u64, Error> {
        Ok(self.clock)
    }
    fn observe(&mut self, _j: &Journal, _key: &str) -> Result<Observation, Error> {
        Ok(self.obs.clone().unwrap())
    }
    fn post_step(
        &mut self,
        _key: &str,
        ik: &str,
        step: Step,
        body: &Value,
    ) -> Result<(u16, Value), Error> {
        self.posts.push((step, body.clone(), ik.into()));
        let id = format!("00000000-0000-4000-8000-{:012x}", self.posts.len());
        let status = self
            .status
            .as_ref()
            .filter(|(s, _)| *s == step)
            .map(|(_, s)| s.as_str())
            .unwrap_or("success");
        let result = if step == Step::Withdraw {
            self.bad_result
                .clone()
                .unwrap_or(json!({"delivered":guarded::ASSET,"intent_hash":"original-intent"}))
        } else {
            json!({})
        };
        self.rows.insert(
            id.clone(),
            json!({"request_id":id,"type":step.request_type(),"status":status,"result":result}),
        );
        let o = self.obs.as_mut().unwrap();
        if status == "success" {
            match step {
                Step::Unshield => {
                    o.confidential = "900".into();
                    o.intents = (20i128 + self.delta.unwrap_or(100)).to_string();
                }
                Step::Storage => {
                    if !self.storage_noop {
                        o.registered = true;
                        self.registered = true;
                    }
                }
                Step::Withdraw => {
                    o.intents = "20".into();
                    o.recipient = (7i128 + self.final_delta.unwrap_or(100)).to_string();
                }
            }
        }
        if self.lose == Some(step) {
            return Err(err("http", "lost response after reservation"));
        }
        if self.wrong == Some(step) {
            return Ok((
                200,
                json!({"error":"policy_denied","request_id":id,"status":"success"}),
            ));
        }
        let mut reply = json!({"request_id":id,"status":status});
        if step == Step::Storage {
            reply["token"] = json!(TOKEN);
            reply["account_id"] = body["account_id"].clone();
            reply["already_registered"] = json!(self.registered);
        }
        if self.duplicate {
            reply["error"] = json!("duplicate_idempotency_key");
            reply["type"] = json!(step.request_type());
        }
        Ok((200, reply))
    }
}
fn params() -> Value {
    json!({"exit_mode":MODE,"chain":"near","to":"alice.near","token":guarded::ASSET,"amount":"100","min_amount_out":"100","deadline_ms":2000,"owner_epoch":"0","token_id":"k1"})
}
fn journal() -> Journal {
    let p = Plan::signed(&params(), 1000, "alice.near").unwrap();
    let hash = "a".repeat(64);
    Journal {
        contract: "keys.near".into(),
        token_id: "k1".into(),
        owner: "alice.near".into(),
        epoch: 0,
        nonce: 1,
        op_id: format!("1:{hash}"),
        action_hash: hash,
        kind: "withdraw".into(),
        body: p.body().unwrap(),
        wallet_id: "ab".repeat(32),
        charge: None,
        auth_scheme: "nep413".into(),
        event: Some(JournalEvent {
            ts_ms: 1000,
            usd: 100,
            source: Value::Null,
        }),
    }
}
#[test]
fn exact_three_typed_requests_and_final_balance_proof() {
    let mut h = Fixture::new();
    let j = journal();
    assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "success");
    assert_eq!(h.posts.len(), 3);
    assert_eq!(h.finish_calls, 1);
    assert_eq!(h.posts[0].1, json!({"token":guarded::ASSET,"amount":"100"}));
    assert_eq!(
        h.posts[1].1,
        json!({"token":TOKEN,"account_id":"alice.near"})
    );
    assert_eq!(
        h.posts[2].1,
        json!({"chain":"near","token":guarded::ASSET,"amount":"100","to":"alice.near","async":true})
    );
    assert_ne!(h.posts[0].2, h.posts[1].2);
    assert_ne!(h.posts[1].2, h.posts[2].2);
    assert!(h.data.contains_key(&format!("{}/settlement", j.key())));
    drive(&mut h, &j, "key").unwrap();
    assert_eq!(h.posts.len(), 3);
}
#[test]
fn legacy_and_wrong_signed_terms_never_reach_transport() {
    for (k, v) in [
        ("exit_mode", Value::Null),
        ("chain", json!("base")),
        ("token", json!("wrong")),
        ("to", json!("bob.near")),
        ("amount", json!("0")),
        ("amount", json!("01")),
        ("min_amount_out", json!("99")),
        ("deadline_ms", json!(999)),
        ("amount", json!("340282366920938463463374607431768211456")),
    ] {
        let mut p = params();
        p[k] = v;
        assert!(Plan::signed(&p, 1000, "alice.near").is_err(), "{k}");
    }
}
#[test]
fn changed_journal_destination_amount_auth_or_extra_field_refused() {
    for (field, value) in [
        ("to", json!("bob.near")),
        ("amount", json!("101")),
        ("unknown", json!(true)),
    ] {
        let mut h = Fixture::new();
        let mut j = journal();
        j.body[field] = value;
        assert!(drive(&mut h, &j, "key").is_err());
        assert!(h.posts.is_empty());
    }
    let mut j = journal();
    j.auth_scheme = "session".into();
    assert!(drive(&mut Fixture::new(), &j, "key").is_err());
}
#[test]
fn unshield_refunded_full_balance_is_failed_not_success_no_other_hop() {
    let mut h = Fixture::new();
    h.status = Some((Step::Unshield, "refunded".into()));
    let j = journal();
    assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "failed");
    assert_eq!(h.posts.len(), 1);
    assert_eq!(h.finish_calls, 1);
    let t: Terminal = read(&mut h, &format!("{}/terminal", j.key()))
        .unwrap()
        .unwrap();
    assert!(!t.success);
    assert!(!t.refund_charge);
}
#[test]
fn short_or_excess_unshield_self_credit_stops_before_registration() {
    for delta in [0, 99, 101] {
        let mut h = Fixture::new();
        h.delta = Some(delta);
        assert!(drive(&mut h, &journal(), "key").is_err());
        assert_eq!(h.posts.len(), 1);
        assert_eq!(h.finish_calls, 0);
    }
}
#[test]
fn already_registered_storage_is_idempotent_and_checked_on_chain() {
    let mut h = Fixture::new();
    h.obs.as_mut().unwrap().registered = true;
    h.registered = true;
    assert_eq!(
        drive(&mut h, &journal(), "key").unwrap()["status"],
        "success"
    );
    assert_eq!(h.posts[1].0, Step::Storage);
}
#[test]
fn lost_submit_at_each_hop_never_resends_or_advances() {
    for step in [Step::Unshield, Step::Storage, Step::Withdraw] {
        let mut h = Fixture::new();
        h.lose = Some(step);
        let j = journal();
        assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "needs_review");
        let n = h.posts.len();
        for _ in 0..3 {
            assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "needs_review");
        }
        assert_eq!(h.posts.len(), n);
        assert_eq!(h.finish_calls, 0);
    }
}
#[test]
fn known_id_pending_poll_and_resume_never_reposts_prior_hops() {
    let mut h = Fixture::new();
    h.status = Some((Step::Unshield, "processing".into()));
    let j = journal();
    assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "processing");
    assert_eq!(h.posts.len(), 1);
    let id = h.rows.keys().next().unwrap().clone();
    h.rows.get_mut(&id).unwrap()["status"] = json!("success");
    let o = h.obs.as_mut().unwrap();
    o.confidential = "900".into();
    o.intents = "120".into();
    h.status = None;
    assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "success");
    assert_eq!(h.posts.len(), 3);
}
#[test]
fn partial_failures_and_needs_review_at_each_step_hold_admission() {
    for step in [Step::Unshield, Step::Storage, Step::Withdraw] {
        for status in [
            "needs_review",
            "partially_failed",
            "pending_approval",
            "unknown",
        ] {
            let mut h = Fixture::new();
            h.status = Some((step, status.into()));
            let r = drive(&mut h, &journal(), "key");
            assert!(r
                .as_ref()
                .map_or(true, |v| v["admission_finished"] == false));
            assert_eq!(h.finish_calls, 0);
            assert_eq!(
                h.posts.len(),
                match step {
                    Step::Unshield => 1,
                    Step::Storage => 2,
                    Step::Withdraw => 3,
                }
            );
        }
    }
}
#[test]
fn provider_error_envelopes_never_bound_or_settle() {
    for step in [Step::Unshield, Step::Storage, Step::Withdraw] {
        let mut h = Fixture::new();
        h.wrong = Some(step);
        let j = journal();
        assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "needs_review");
        let n = h.posts.len();
        drive(&mut h, &j, "key").unwrap();
        assert_eq!(h.posts.len(), n);
        assert_eq!(h.finish_calls, 0);
    }
}
#[test]
fn duplicate_envelope_is_not_success_only_original_get_is_evidence() {
    let mut h = Fixture::new();
    h.duplicate = true;
    assert_eq!(
        drive(&mut h, &journal(), "key").unwrap()["status"],
        "success"
    );
    assert_eq!(h.posts.len(), 3);
}
#[test]
fn native_budget_storage_bounds_and_ownership_stop_without_posts() {
    for field in ["native", "storage_min"] {
        let mut h = Fixture::new();
        if field == "native" {
            h.obs.as_mut().unwrap().native = "0".into();
        } else {
            h.obs.as_mut().unwrap().storage_min = (STORAGE_MAX + 1).to_string();
        }
        assert!(drive(&mut h, &journal(), "key").is_err());
        assert!(h.posts.is_empty());
    }
    let mut h = Fixture::new();
    h.deny = true;
    assert!(drive(&mut h, &journal(), "key").is_err());
    assert!(h.posts.is_empty());
}
#[test]
fn expired_plan_allows_get_but_no_next_post() {
    let mut h = Fixture::new();
    h.status = Some((Step::Unshield, "processing".into()));
    let j = journal();
    drive(&mut h, &j, "key").unwrap();
    h.clock = 2001;
    let id = h.rows.keys().next().unwrap().clone();
    h.rows.get_mut(&id).unwrap()["status"] = json!("success");
    h.obs.as_mut().unwrap().confidential = "900".into();
    h.obs.as_mut().unwrap().intents = "120".into();
    assert!(drive(&mut h, &j, "key").is_err());
    assert_eq!(h.posts.len(), 1);
}
#[test]
fn provider_id_write_failure_never_double_sends() {
    let mut h = Fixture::new();
    h.write_fail = Some("/unshield/provider".into());
    let j = journal();
    assert!(drive(&mut h, &j, "key").is_err());
    h.write_fail = None;
    assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "needs_review");
    assert_eq!(h.posts.len(), 1);
}
#[test]
fn poll_http_failure_never_credits_or_releases() {
    let mut h = Fixture::new();
    h.poll_error = true;
    let j = journal();
    assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "needs_review");
    assert_eq!(h.posts.len(), 1);
    assert_eq!(h.finish_calls, 0);
}
#[test]
fn exact_delivery_requires_asset_hash_and_both_ledger_deltas() {
    let p = Plan::journal(&journal()).unwrap();
    for (step, body) in [
        (Step::Unshield, Step::Unshield.body(&p)),
        (Step::Storage, Step::Storage.body(&p)),
        (Step::Withdraw, Step::Withdraw.body(&p)),
    ] {
        assert_eq!(
            body.as_object().unwrap().len(),
            match step {
                Step::Unshield | Step::Storage => 2,
                Step::Withdraw => 5,
            }
        );
        assert!(!body.to_string().contains("min_amount_out"));
    }
    for (field, value) in [
        ("request_id", json!("00000000-0000-4000-8000-000000000999")),
        ("type", json!("confidential")),
        ("error", json!("policy_denied")),
    ] {
        let v = json!({"request_id":"00000000-0000-4000-8000-000000000001","type":"withdraw","status":"success"});
        let mut bad = v.clone();
        bad[field] = value;
        assert!(row(&bad, "00000000-0000-4000-8000-000000000001", Step::Withdraw).is_err());
    }
}

#[test]
fn short_excess_or_unrelated_destination_delta_never_completes() {
    for delta in [0, 99, 101, 500] {
        let mut h = Fixture::new();
        h.final_delta = Some(delta);
        let j = journal();
        assert!(drive(&mut h, &j, "key").is_err());
        assert_eq!(h.posts.len(), 3);
        assert_eq!(h.finish_calls, 0);
        assert!(h.read(&format!("{}/terminal", j.key())).unwrap().is_empty());
    }
}
#[test]
fn wrong_provider_delivery_asset_and_missing_intent_id_fail_closed() {
    for v in [
        json!({"delivered":"nep141:wrong","intent_hash":"original"}),
        json!({"delivered":guarded::ASSET,"intent_hash":""}),
        json!({"delivered":guarded::ASSET,"tx_hash":"not-an-intent"}),
    ] {
        let mut h = Fixture::new();
        h.bad_result = Some(v);
        assert!(drive(&mut h, &journal(), "key").is_err());
        assert_eq!(h.finish_calls, 0);
        assert_eq!(h.posts.len(), 3);
    }
}
#[test]
fn false_registration_success_does_not_trigger_public_withdraw() {
    let mut h = Fixture::new();
    h.storage_noop = true;
    assert!(drive(&mut h, &journal(), "key").is_err());
    assert_eq!(h.posts.len(), 2);
    assert_eq!(h.finish_calls, 0);
}
#[test]
fn crash_at_each_pre_dispatch_write_has_no_send_or_replacement() {
    for suffix in [
        "/baseline",
        "/unshield/before",
        "/unshield/request",
        "/unshield/dispatch",
    ] {
        let mut h = Fixture::new();
        h.write_fail = Some(suffix.into());
        assert!(drive(&mut h, &journal(), "key").is_err());
        assert!(h.posts.is_empty());
    }
}
#[test]
fn durable_reply_before_id_loss_is_unknown_not_a_resend() {
    for suffix in ["/unshield/reply", "/storage/reply", "/withdraw/reply"] {
        let mut h = Fixture::new();
        h.write_fail = Some(suffix.into());
        let j = journal();
        assert!(drive(&mut h, &j, "key").is_err());
        let n = h.posts.len();
        h.write_fail = None;
        assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "needs_review");
        assert_eq!(h.posts.len(), n);
        assert_eq!(h.finish_calls, 0);
    }
}

#[test]
fn complete_verified_evidence_survives_finish_gap_and_later_balance_activity() {
    let mut h = Fixture::new();
    h.finish_fail = true;
    let j = journal();
    assert!(drive(&mut h, &j, "key").is_err());
    assert_eq!(h.posts.len(), 3);
    h.obs.as_mut().unwrap().recipient = "5000".into();
    assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "success");
    assert_eq!(h.posts.len(), 3);
}
#[test]
fn replay_cannot_change_amount_and_minimum_together() {
    let mut h = Fixture::new();
    h.status = Some((Step::Unshield, "processing".into()));
    let mut j = journal();
    drive(&mut h, &j, "key").unwrap();
    j.body["amount"] = json!("101");
    j.body["min_amount_out"] = json!("101");
    assert!(drive(&mut h, &j, "key").is_err());
    assert_eq!(h.posts.len(), 1);
}

fn wire_readbacks() -> Vec<Value> {
    vec![
        json!({"account_id":"ab".repeat(32),"token":guarded::ASSET,"balance":"1000"}),
        json!({"account_id":"ab".repeat(32),"account":"executor","token":guarded::ASSET,"balance":"20"}),
        json!("20"),
        json!("7"),
        json!({"total":"1","available":"0"}),
        json!({"min":STORAGE_MAX.to_string()}),
        json!({"amount":(NATIVE_MAX*2).to_string()}),
    ]
}
fn decode_wire(v: &[Value]) -> Result<Observation, Error> {
    decode_readbacks(
        &"ab".repeat(32),
        Readbacks {
            private: &v[0],
            public: &v[1],
            intents: &v[2],
            recipient: &v[3],
            storage: &v[4],
            bounds: &v[5],
            native: &v[6],
        },
    )
}
#[test]
fn production_wire_decoder_checks_independent_identity_and_amounts() {
    let mut v = wire_readbacks();
    let o = decode_wire(&v).unwrap();
    assert_eq!(o.intents, "20");
    assert!(o.registered);
    v[4] = Value::Null;
    assert!(!decode_wire(&v).unwrap().registered);
    for (i, field, value) in [
        (0, "account_id", json!("cd".repeat(32))),
        (0, "token", json!("wrong")),
        (1, "account", json!("asset")),
        (1, "balance", json!("21")),
        (4, "total", json!("0")),
    ] {
        let mut v = wire_readbacks();
        v[i][field] = value;
        assert!(decode_wire(&v).is_err());
    }
}
#[test]
fn malformed_or_error_envelopes_at_every_readback_fail_closed() {
    for i in 0..7 {
        for bad in [
            json!({"error":"provider_error"}),
            json!({"jsonrpc":"2.0","result":null}),
            json!([]),
            json!(false),
            json!("bad"),
        ] {
            let mut v = wire_readbacks();
            v[i] = bad;
            assert!(decode_wire(&v).is_err(), "index {i}");
        }
    }
    for bad in [
        json!("-1"),
        json!("1.0"),
        json!("1e2"),
        json!(20),
        json!("340282366920938463463374607431768211456"),
    ] {
        let mut v = wire_readbacks();
        v[2] = bad.clone();
        assert!(decode_wire(&v).is_err());
        let mut v = wire_readbacks();
        v[3] = bad;
        assert!(decode_wire(&v).is_err());
    }
}
#[test]
fn wasi_adapter_uses_the_native_tested_wire_decoder_and_final_views() {
    let src = include_str!("exact_exit_host.rs");
    assert!(src.contains("exact_exit::decode_readbacks"));
    for method in [
        "mt_balance_of",
        "ft_balance_of",
        "storage_balance_of",
        "storage_balance_bounds",
    ] {
        assert!(src.contains(method));
    }
    assert!(src.contains("source=intents&account=executor"));
    assert!(!src.contains("poll_url"));
}

#[test]
fn production_rechecks_reviewed_effective_policy_before_unshield_and_spend() {
    let s = include_str!("main.rs")
        .split("fn op_withdraw(")
        .nth(1)
        .unwrap()
        .split("fn load_prov(")
        .next()
        .unwrap();
    assert!(s.find("exact_exit_policy(").unwrap() < s.find("charge_spend(").unwrap());
    let h = include_str!("exact_exit_host.rs");
    for gate in [
        "evidence::load_proof",
        "evidence::verify_proof",
        "evidence::validate_policy",
        "collateral::binding_matches",
        "collateral::effective_policy_matches",
    ] {
        assert!(h.contains(gate));
    }
    let p = crate::collateral::policy("wallet", "fixture-key", &json!([{"id":"guardian.near"}]), 1)
        .unwrap();
    assert!(p["rules"]["transaction_types"]
        .as_array()
        .unwrap()
        .contains(&json!("withdraw")));
    assert!(!p["approval"]["excluded_types"]
        .as_array()
        .unwrap()
        .contains(&json!("call")));
    assert_eq!(p["capabilities"]["intents_call"]["allowed"], false);
}

#[test]
fn registered_recipient_still_requires_native_gas_before_unshield() {
    let mut h = Fixture::new();
    h.obs.as_mut().unwrap().registered = true;
    h.obs.as_mut().unwrap().native = "0".into();
    assert!(drive(&mut h, &journal(), "key").is_err());
    assert!(h.posts.is_empty());
}

#[test]
fn malformed_or_changed_verified_hop_is_not_a_recovery_permission() {
    for change in 0..5 {
        let mut h = Fixture::new();
        h.status = Some((Step::Storage, "pending_approval".into()));
        let j = journal();
        drive(&mut h, &j, "key").unwrap();
        let k = format!("{}/exact/unshield/verified", j.key());
        let mut v: Value = serde_json::from_slice(h.data.get(&k).unwrap()).unwrap();
        match change {
            0 => v = Value::Null,
            1 => v["unknown_state"] = json!(true),
            2 => v["provider"]["status"] = json!("processing"),
            3 => v["provider"]["request_id"] = json!("ffffffff-ffff-ffff-ffff-ffffffffffff"),
            _ => v["observation"]["confidential"] = json!("999"),
        }
        h.data.insert(k, serde_json::to_vec(&v).unwrap());
        let count = h.posts.len();
        assert!(drive(&mut h, &j, "key").is_err());
        assert_eq!(h.posts.len(), count);
    }
}
