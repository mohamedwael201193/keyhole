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
    /// Production near:rpc cost model for the canary (exact-exit) drive, in
    /// host calls. Round 4: the model is cache-aware, using the real
    /// per-run `read_cache`. `validate_dispatch` replays the production
      /// read sequence (9 distinct keys: control, project, list_versions,
      /// version_count, value_op, nft_token, block, binding, loan) through
      /// the cache, so only the first call costs anything. `observe` = 4
      /// fresh reads (mt, ft, storage_bal, view_account) + the
    /// storage_balance_bounds, cached after the first observe. `now_ms` =
    /// the cached final block (1 on the first read, 0 after).
    /// `original_delivery` = 1 (rpc::tx_status), `post_step` = 0
    /// (wasi:http). The before-observe reuse (round 4) means the drive
    /// calls `observe` only 4 times (baseline + 3 after-observes). The
    /// host allows 100 near:rpc calls per run. This is a model of the
    /// production cost, not a live measurement: the mock Host does not
    /// touch the RPC.
    rpc_cost: usize,
    deny: bool,
    clock: u64,
    poll_error: bool,
    write_fail: Option<String>,
    duplicate: bool,
    /// Round 7: provider row type returned for the Storage hop. The live
    /// provider returns "storage_deposit" for POST /wallet/v1/storage-deposit;
    /// None keeps the documented "call" spelling (the old fixture default).
    storage_row_type: Option<&'static str>,
    final_delta: Option<i128>,
    bad_result: Option<Value>,
    storage_noop: bool,
    receipt: Option<Value>,
    spent_recipient: bool,
    finish_fail: bool,
    one_hop_per_call: bool,
    call_start_posts: usize,
    zero_time: bool,
}
impl Fixture {
    /// Row type the fixture provider reports for a hop: the Storage override
    /// when set, else the step's documented `request_type()`.
    fn row_type(&self, step: Step) -> &'static str {
        if step == Step::Storage {
            self.storage_row_type.unwrap_or(step.request_type())
        } else {
            step.request_type()
        }
    }
    fn new() -> Self {
        // Round 4: the per-run read cache is a thread_local shared by all
        // tests on this thread; reset it so each test starts from an
        // empty cache (as a fresh production run does).
        crate::read_cache::invalidate();
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
            return Err(err("pledged", "control changed"));
        }
        // Round 4: replay the production validate_dispatch read sequence
        // (guarded_host.rs) through the real per-run read cache, in
        // production order. Only the first call costs anything (9
        // distinct keys); later calls are all cache hits. The block is
        // read via chain_now_ms (the cached final block).
        for (contract, method, args) in [
            ("keyhole-devmo.near", "get_control_state", "{\"token_id\":\"k1\"}"),
            ("registry", "get_project", "{\"project_id\":\"p000000000000004b\"}"),
            ("registry", "list_versions", "{\"project_id\":\"p000000000000004b\"}"),
            ("registry", "get_version_count", "{\"project_id\":\"p000000000000004b\"}"),
            ("keyhole-devmo.near", "get_value_op", "{\"token_id\":\"k1\",\"op_id\":\"1:abc\"}"),
            ("keyhole-devmo.near", "get_control_state", "{\"token_id\":\"k1\"}"),
            ("keyhole-devmo.near", "nft_token", "{\"token_id\":\"k1\"}"),
            ("keyhole-devmo.near", "get_collateral_binding", "{\"token_id\":\"k1\"}"),
            ("keyhole-devmo.near", "get_loan", "{\"token_id\":\"k1\"}"),
        ] {
            if crate::read_cache::get_view(contract, method, args).is_none() {
                self.rpc_cost += 1;
                crate::read_cache::put_view(contract, method, args, json!(null));
            }
        }
        if crate::read_cache::get_block().is_none() {
            self.rpc_cost += 1;
            crate::read_cache::put_block(crate::read_cache::BlockCache {
                hash: [0; 32],
                height: None,
                timestamp_ms: self.clock,
            });
        }
        Ok(())
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
fn intent_hash()->String{bs58::encode([4u8;32]).into_string()}
fn delivery(j:&Journal,amount:&str)->Value{
    let hash=bs58::encode([3u8;32]).into_string();
    let mut v=crate::receipts::fixture(&hash,"relay.near","intents.near","");
    let log=json!({"standard":"dip4","version":"0.4.3","event":"ft_withdraw","data":[{"intent_hash":intent_hash(),"account_id":j.wallet_id,"token":TOKEN,"receiver_id":j.owner,"amount":"100"}]}).to_string();
    v["receipts_outcome"][0]["outcome"]["logs"]=json!([format!("EVENT_JSON:{log}")]);
    v["receipts_outcome"][0]["outcome"]["receipt_ids"]=json!(["ft"]);
    let log=json!({"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{"old_owner_id":"intents.near","new_owner_id":j.owner,"amount":amount}]}).to_string();
    v["receipts_outcome"].as_array_mut().unwrap().push(json!({"id":"ft","outcome":{"executor_id":TOKEN,"receipt_ids":[],"status":{"SuccessValue":""},"logs":[format!("EVENT_JSON:{log}")]}}));v
}
impl Host for Fixture {
    fn time_left_ms(&mut self) -> u64 {
        if self.zero_time || (self.one_hop_per_call && self.posts.len() > self.call_start_posts) {
            0
        } else {
            u64::MAX
        }
    }
    fn original_delivery(&mut self,j:&Journal,_intent:&str)->Result<Value,Error>{
        self.rpc_cost += 1;
        Ok(self.receipt.clone().unwrap_or_else(||delivery(j,&self.final_delta.unwrap_or(100).to_string())))
    }
    fn now_ms(&mut self) -> Result<u64, Error> {
        // Round 4: the final block is cached per run (read_cache). The
        // first read costs 1; later reads are hits.
        if crate::read_cache::get_block().is_none() {
            self.rpc_cost += 1;
            crate::read_cache::put_block(crate::read_cache::BlockCache {
                hash: [0; 32],
                height: None,
                timestamp_ms: self.clock,
            });
        }
        Ok(self.clock)
    }
    fn observe(&mut self, _j: &Journal, _key: &str) -> Result<Observation, Error> {
        // Round 4: 4 fresh reads (mt_balance_of, ft_balance_of,
        // storage_balance_of, view_account — never cached) + the
        // storage_balance_bounds, cached after the first observe.
        self.rpc_cost += 4;
        if crate::read_cache::get_view("keyhole-devmo.near", "storage_balance_bounds", "{}")
            .is_none()
        {
            self.rpc_cost += 1;
            crate::read_cache::put_view(
                "keyhole-devmo.near",
                "storage_balance_bounds",
                "{}",
                json!(null),
            );
        }
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
                .unwrap_or(json!({"delivered":guarded::ASSET,"intent_hash":intent_hash()}))
        } else {
            json!({})
        };
        self.rows.insert(
            id.clone(),
            json!({"request_id":id,"type":self.row_type(step),"status":status,"result":result}),
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
                    o.recipient = if self.spent_recipient {"0".into()} else {(7i128 + self.final_delta.unwrap_or(100)).to_string()};
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
            reply["type"] = json!(self.row_type(step));
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
    assert_eq!(drive(&mut h, &j, "key").unwrap()["status"],"awaiting_continuation");
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

#[test]
fn successful_original_receipt_reconciles_after_recipient_spends(){
 let mut h=Fixture::new();h.spent_recipient=true;let j=journal();
 assert_eq!(drive(&mut h,&j,"key").unwrap()["status"],"success");
 assert_eq!(h.obs.as_ref().unwrap().recipient,"0");assert_eq!(h.finish_calls,1);assert_eq!(h.posts.len(),3);
}
#[test]
fn canary_drive_rpc_cost_stays_well_under_host_cap(){
 // A full 3-hop drive (the canary path) must stay well under the host's 100
 // near:rpc calls per run. The count is the production-cost model on the
 // Fixture, now cache-aware (round 4): validate_dispatch replays the
 // production read sequence through the real per-run read cache (9 on
 // the first call, 0 after), observe is 4 fresh reads + the cached
 // storage_balance_bounds, now_ms is the cached block, and the
 // before-observe reuse means observe runs only 4 times (baseline + 3
 // after-observes). Measured here: 27 (validate#1 9 + baseline 5 +
 // 3 after-observes 12 + original_delivery 1). NOTE: within the full
 // canary the drive is 26, not 27 — get_value_op is already cached from
 // confirm_admission's post-send re-read, so validate#1 is 8 there.
 // The full canary (op handler 21 + drive 26 + finish 7 + op tail 1)
 // is 55 — see op_cost_tests.rs. The round-2 comment that claimed a
 // modeled canary total of ~51 was wrong: it omitted validate_dispatch
 // and the op handler, and the true uncached canary is ~150
 // (round-4 report §3).
 let mut h=Fixture::new();h.spent_recipient=true;let j=journal();
 assert_eq!(drive(&mut h,&j,"key").unwrap()["status"],"success");
 assert_eq!(h.posts.len(),3);assert_eq!(h.finish_calls,1);
 eprintln!("canary drive modelled rpc_cost={}",h.rpc_cost);
 assert_eq!(h.rpc_cost,27,"drive rpc_cost changed; see the round-4 report §3");
 assert!(h.rpc_cost<50,"rpc_cost={}",h.rpc_cost);
}
#[test]
fn original_receipt_negative_graphs_and_failed_descendants_never_finish(){
 let j=journal();let good=delivery(&j,"100");
 let mut cases=vec![];
 for (ptr,value) in [
 ("/final_execution_status",json!("EXECUTED_OPTIMISTIC")),
 ("/transaction/receiver_id",json!("other.near")),
 ("/receipts_outcome/1/outcome/executor_id",json!("other.near")),
 ("/receipts_outcome/1/outcome/status",json!({"Failure":{}})),
 ("/receipts_outcome/0/outcome/receipt_ids",json!([])),
 ("/receipts_outcome/0/outcome/logs",json!([])),
 ("/receipts_outcome/1/outcome/logs",json!([])),
 ]{let mut v=good.clone();*v.pointer_mut(ptr).unwrap()=value;cases.push(v);}
 for (field,value) in [("intent_hash",json!(bs58::encode([9u8;32]).into_string())),("account_id",json!("cd".repeat(32))),("receiver_id",json!("other.near")),("token",json!("wrong.near")),("amount",json!("99")),("msg",json!("callback"))]{
  let mut v=good.clone();let log=v["receipts_outcome"][0]["outcome"]["logs"][0].as_str().unwrap();let mut e:Value=serde_json::from_str(log.strip_prefix("EVENT_JSON:").unwrap()).unwrap();e["data"][0][field]=value;v["receipts_outcome"][0]["outcome"]["logs"]=json!([format!("EVENT_JSON:{e}")]);cases.push(v);
 }
 for v in cases {let mut h=Fixture::new();h.receipt=Some(v);assert!(drive(&mut h,&j,"key").is_err());assert_eq!(h.finish_calls,0);assert_eq!(h.posts.len(),3);}
}
fn continuation(h:&mut Fixture,j:&Journal,step:&str)->Value {
 let r=drive(h,j,"key").unwrap();assert_eq!(r["status"],"awaiting_continuation");assert_eq!(r["continuation"]["step"],step);
 let mut c=r["continuation"].clone();c["deadline_ms"]=json!(h.clock+100);c
}
#[test]
fn slow_unshield_then_slow_guardian_both_finish_with_fresh_unsent_hop_consent(){
 let j=journal();let mut h=Fixture::new();h.status=Some((Step::Unshield,"processing".into()));
 drive(&mut h,&j,"key").unwrap();h.clock=400_000;
 let id=h.rows.keys().next().unwrap().clone();h.rows.get_mut(&id).unwrap()["status"]=json!("success");
 h.obs.as_mut().unwrap().confidential="900".into();h.obs.as_mut().unwrap().intents="120".into();
 let c=continuation(&mut h,&j,"storage");h.status=Some((Step::Storage,"pending_approval".into()));
 assert_eq!(drive_continued(&mut h,&j,"key",Some(&c)).unwrap()["status"],"processing");assert_eq!(h.posts.len(),2);
 h.clock=800_000;let id=h.rows.iter().find(|(_,r)|r["type"]=="call").unwrap().0.clone();h.rows.get_mut(&id).unwrap()["status"]=json!("success");h.obs.as_mut().unwrap().registered=true;
 let c=continuation(&mut h,&j,"withdraw");assert_eq!(h.posts.len(),2);
 assert_eq!(drive_continued(&mut h,&j,"key",Some(&c)).unwrap()["status"],"success");
 drive(&mut h,&j,"key").unwrap();assert_eq!(h.posts.len(),3);assert_eq!(h.finish_calls,2);
}
#[test]
fn expired_or_changed_continuation_cannot_send_or_release(){
 let j=journal();let mut h=Fixture::new();h.clock=3000;let good=continuation(&mut h,&j,"unshield");
 for (f,v) in [("step",json!("withdraw")),("value_op_id",json!("wrong")),("action_hash",json!("b".repeat(64))),("original_provider_id",json!("other")),("deadline_ms",json!(2999)),("amount",json!("200"))]{let mut c=good.clone();c[f]=v;assert!(drive_continued(&mut h,&j,"key",Some(&c)).is_err());assert!(h.posts.is_empty());assert_eq!(h.finish_calls,0);}
}
#[test]
fn missing_receipt_then_original_get_recovery_after_spending_and_expiry(){
 let j=journal();let mut h=Fixture::new();h.receipt=Some(Value::Null);
 assert!(drive(&mut h,&j,"key").is_err());assert_eq!(h.posts.len(),3);assert_eq!(h.finish_calls,0);
 h.clock=900_000;h.obs.as_mut().unwrap().recipient="0".into();h.receipt=None;
 assert_eq!(drive(&mut h,&j,"key").unwrap()["status"],"success");assert_eq!(h.posts.len(),3);assert_eq!(h.finish_calls,1);
}
#[test]
fn delayed_original_unshield_refund_completes_after_expiry_without_new_hop(){
 let j=journal();let mut h=Fixture::new();h.status=Some((Step::Unshield,"processing".into()));
 drive(&mut h,&j,"key").unwrap();h.clock=900_000;
 h.rows.values_mut().next().unwrap()["status"]=json!("refunded");
 assert_eq!(drive(&mut h,&j,"key").unwrap()["status"],"failed");assert_eq!(h.posts.len(),1);assert_eq!(h.finish_calls,1);
}

#[test]
fn hop_rows_accept_documented_types_and_name_the_failed_predicate() {
    let id = "12345678-1234-1234-1234-123456789abc";
    for (step, ok, bad) in [
        (Step::Unshield, ["confidential", "confidential_unshield"], "withdraw"),
        (Step::Storage, ["call", "storage_deposit"], "confidential"),
        (Step::Withdraw, ["withdraw", "withdraw"], "confidential_unshield"),
    ] {
        for ty in ok {
            let v = json!({"request_id":id,"type":ty,"status":"success"});
            assert_eq!(row(&v, id, step).unwrap(), "success");
        }
        let v = json!({"request_id":id,"type":bad,"status":"success"});
        let e = row(&v, id, step).unwrap_err();
        assert_eq!(e.code, "exit_provider");
        assert!(e.message.contains("type_ok=false") && e.message.contains(&format!("type={bad}")), "{}", e.message);
    }
    // identity and error stay strict; a JSON null error member is not an error
    let other = "87654321-4321-4321-4321-123456789abc";
    let v = json!({"request_id":other,"type":"withdraw","status":"success"});
    assert!(row(&v, id, Step::Withdraw).unwrap_err().message.contains("id_match=false"));
    let v = json!({"request_id":id,"type":"withdraw","status":"success","error":"x"});
    assert!(row(&v, id, Step::Withdraw).unwrap_err().message.contains("error_present=true"));
    let v = json!({"request_id":id,"type":"withdraw","status":"success","error":null});
    assert_eq!(row(&v, id, Step::Withdraw).unwrap(), "success");
    // unshield-only spelling never opens the other hops
    assert!(!Step::Storage.request_types().contains(&"confidential_unshield"));
    assert!(!Step::Withdraw.request_types().contains(&"confidential_unshield"));
}
#[test]
fn storage_deposit_row_is_accepted_and_wrong_type_still_rejected() {
    // Round 7: exact reconcile #4 shape (LOANS_EXEC_REPORT_RUN9 §3d) —
    // step=storage, id matches, type=storage_deposit, no error. Pre-fix
    // row() returned exit_provider "original request identity/type/error
    // mismatch: ... type=storage_deposit type_ok=false"; post-fix it
    // returns the row's status.
    let id = "12345678-1234-1234-1234-123456789abc";
    for (status, want) in [
        ("success", "success"),
        ("completed", "success"),
        ("processing", "processing"),
        ("failed", "failed"),
    ] {
        let v = json!({"request_id":id,"type":"storage_deposit","status":status});
        assert_eq!(row(&v, id, Step::Storage).unwrap(), want, "status {status}");
    }
    // The wrong type for the storage step is still refused with the same
    // mismatch error naming the failed predicate.
    let v = json!({"request_id":id,"type":"withdraw","status":"success"});
    let e = row(&v, id, Step::Storage).unwrap_err();
    assert_eq!(e.code, "exit_provider");
    assert!(
        e.message.contains("step=storage")
            && e.message.contains("id_match=true")
            && e.message.contains("type=withdraw")
            && e.message.contains("type_ok=false")
            && e.message.contains("error_present=false"),
        "{}",
        e.message
    );
    // And the old "call" spelling still works (no regression for rows
    // the provider reports that way).
    let v = json!({"request_id":id,"type":"call","status":"success"});
    assert_eq!(row(&v, id, Step::Storage).unwrap(), "success");
}

#[test]
fn storage_deposit_duplicate_is_the_right_operation() {
    // Round 7: a duplicate_idempotency_key reply whose row type is the
    // observed storage_deposit is the right operation, not an error —
    // the drive completes on the original GET evidence.
    let mut h = Fixture::new();
    h.duplicate = true;
    h.storage_row_type = Some("storage_deposit");
    assert_eq!(
        drive(&mut h, &journal(), "key").unwrap()["status"],
        "success"
    );
    assert_eq!(h.posts.len(), 3);
    // A duplicate referring to a row of a type outside the storage
    // allowlist still fails closed with the duplicate error.
    let mut h = Fixture::new();
    h.duplicate = true;
    h.storage_row_type = Some("withdraw");
    let e = drive(&mut h, &journal(), "key").unwrap_err();
    assert_eq!(e.code, "exit_provider");
    assert!(e.message.contains("duplicate refers to wrong operation"), "{}", e.message);
    assert_eq!(h.posts.len(), 2);
    assert_eq!(h.finish_calls, 0);
}

#[test]
fn live_storage_resume_stored_storage_deposit_row_advances_past_storage() {
    // Round 7: live resume simulation for op 3:6896… (RUN9 §3-§5). The
    // storage request id + dispatch marker are already stored (first drive
    // posts unshield + storage; the storage row is storage_deposit and
    // still processing), then a later reconcile re-fetches the SAME stored
    // id — never re-posts — and the drive must advance past storage to
    // withdraw and finish. The recipient storage was already registered
    // live, mirrored here by setting registered=true on resume.
    let mut h = Fixture::new();
    h.storage_row_type = Some("storage_deposit");
    h.status = Some((Step::Storage, "processing".into()));
    let j = journal();
    assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "processing");
    assert_eq!(h.posts.len(), 2);
    assert_eq!(h.posts[1].0, Step::Storage);
    let stored: String = read(&mut h, &format!("{}/exact/storage/provider", j.key()))
        .unwrap()
        .unwrap();
    assert!(guarded::uuid(&stored));
    // Provider settles the stored storage request between calls.
    h.rows.get_mut(&stored).unwrap()["status"] = json!("success");
    assert_eq!(h.rows[&stored]["type"], "storage_deposit");
    h.obs.as_mut().unwrap().registered = true;
    h.status = None;
    assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "success");
    assert_eq!(h.posts.len(), 3, "storage was never re-posted");
    assert_eq!(h.posts[2].0, Step::Withdraw);
    assert_eq!(h.finish_calls, 1);
    let stored_after: String = read(&mut h, &format!("{}/exact/storage/provider", j.key()))
        .unwrap()
        .unwrap();
    assert_eq!(stored, stored_after, "same stored request id throughout");
}

#[test]
fn exact_exit_policy_gate_is_enrolled_only_with_exit_not_enrolled_for_collateral() {
    let host = include_str!("exact_exit_host.rs");
    let f = host.split("fn exact_exit_policy(").nth(1).unwrap().split("let proof = evidence::load_proof").next().unwrap();
    assert!(f.contains("\"confinement_v1\"") && f.contains("exit_not_enrolled"));
    assert!(f.contains("control.pledged") && f.contains("get_loan") && f.contains("get_collateral_binding"));
    // the standard exit keeps its guards: policy check still precedes the spend reservation
    let main = include_str!("main.rs").split("fn op_withdraw(").nth(1).unwrap().split("fn load_prov(").next().unwrap();
    assert!(main.find("exact_exit_policy(").unwrap() < main.find("charge_spend(").unwrap());
    assert!(main.contains("assert_withdraw_to(") && main.contains("assert_not_listed(") && main.contains("guard_begin("));
}

#[test]
fn each_call_does_at_most_one_hop_and_resumes_without_resending() {
    let mut h = Fixture::new();
    h.one_hop_per_call = true;
    let j = journal();
    let mut seen = Vec::new();
    for i in 0..6 {
        h.call_start_posts = h.posts.len();
        let r = drive(&mut h, &j, "key").unwrap();
        seen.push((r["status"].as_str().unwrap().to_string(), h.posts.len()));
        if r["status"] == "success" {
            break;
        }
        assert_eq!(r["status"], "processing", "call {i}: {r}");
        assert_eq!(r["reason"], "time_budget");
        assert_eq!(r["admission_finished"], false);
        // the provider settles the posted hop between calls (readbacks follow the hop)
        let ids: Vec<String> = h.rows.keys().cloned().collect();
        for id in ids {
            h.rows.get_mut(&id).unwrap()["status"] = json!("success");
        }
        let o = h.obs.as_mut().unwrap();
        match h.posts.len() {
            1 => {
                o.confidential = "900".into();
                o.intents = "120".into();
            }
            2 => o.registered = true,
            _ => {}
        }
    }
    assert_eq!(h.posts.len(), 3, "exactly one POST per hop across all calls: {seen:?}");
    assert_eq!(seen.last().unwrap().0, "success", "{seen:?}");
    let steps: Vec<Step> = h.posts.iter().map(|p| p.0).collect();
    assert_eq!(steps, vec![Step::Unshield, Step::Storage, Step::Withdraw]);
}
#[test]
fn out_of_time_before_any_work_posts_nothing_and_pauses() {
    let mut h = Fixture::new();
    h.zero_time = true;
    let j = journal();
    let r = drive(&mut h, &j, "key").unwrap();
    assert_eq!(r["status"], "processing");
    assert_eq!(r["step"], "unshield");
    assert!(h.posts.is_empty() && h.finish_calls == 0);
    h.zero_time = false;
    assert_eq!(drive(&mut h, &j, "key").unwrap()["status"], "success");
    assert_eq!(h.posts.len(), 3);
}
