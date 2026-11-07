//! Hardening tests: withdraw needs a wallet signature, the swap slippage bound, refused calls give
//! their spend back, NEP-413 callbackUrl, nonce pruning, and chain_sign guards.
use crate::*;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::json;
use std::collections::HashMap;

/// Counters (`n`) and records (`b`) kept apart, like the host storage: `incr` never reads a record.
#[derive(Default)]
struct Mem { n: HashMap<String, i64>, b: HashMap<String, Vec<u8>> }
impl Store for Mem {
    fn set_if_absent(&mut self, k: &str, v: &[u8]) -> Result<bool, Error> {
        if self.b.contains_key(k) { return Ok(false); }
        self.b.insert(k.into(), v.to_vec());
        Ok(true)
    }
    fn incr(&mut self, k: &str, d: i64) -> Result<i64, Error> {
        let e = self.n.entry(k.into()).or_insert(0);
        *e += d;
        Ok(*e)
    }
    fn list_prefix(&mut self, p: &str) -> Result<Vec<String>, Error> {
        Ok(self.b.keys().filter(|k| k.starts_with(p)).cloned().collect())
    }
    fn read(&mut self, k: &str) -> Result<Vec<u8>, Error> { Ok(self.b.get(k).cloned().unwrap_or_default()) }
    fn remove(&mut self, k: &str) -> Result<(), Error> { self.b.remove(k); Ok(()) }
}

fn grant_with(max_usd_micro: u64) -> SessionGrant {
    SessionGrant {
        account: "alice.near".into(),
        token_id: "k1".into(),
        iat_ms: 0,
        exp_ms: SESSION_MAX_MS,
        max_usd_micro,
        scope: SESSION_OPS.iter().map(|s| s.to_string()).collect(),
    }
}
fn session_call(op: &str) -> SessionAuth {
    SessionAuth {
        scheme: "session".into(),
        token: B64.encode([9u8; 32]),
        message: format!(r#"{{"op":"{op}","account_id":"alice.near","ts_ms":1000,"params":{{}}}}"#),
        nonce: B64.encode([5u8; 32]),
        recipient: "keyhole".into(),
    }
}

// ---------- 1. withdraw (and chain_sign) need a fresh wallet signature, never a session ----------

#[test]
fn withdraw_is_not_a_session_op() {
    assert!(!SESSION_OPS.contains(&"withdraw"));
    let g = grant_with(1_000_000);
    assert!(!g.scope.iter().any(|s| s == "withdraw"));
    assert_eq!(verify_session_request(&session_call("withdraw"), &g, "keyhole", "withdraw").unwrap_err().code, "session_scope");
}
#[test]
fn a_session_cannot_be_granted_withdraw_by_signing_for_it() {
    let req = SignedRequest {
        op: "session".into(),
        account_id: "alice.near".into(),
        ts_ms: 1000,
        params: json!({"max_usd_micro": 1_000_000, "scope": ["withdraw", "swap"]}),
    };
    let g = grant_from_request(&req, "k1", 1000).unwrap();
    assert_eq!(g.scope, vec!["swap".to_string()]);
}
#[test]
fn chain_sign_is_never_a_session_op() {
    assert!(!SESSION_OPS.contains(&"chain_sign"));
    assert_eq!(verify_session_request(&session_call("chain_sign"), &grant_with(1_000_000), "keyhole", "chain_sign").unwrap_err().code, "session_scope");
}
#[test]
fn swap_stays_in_session_scope() {
    assert!(SESSION_OPS.contains(&"swap"));
    assert!(verify_session_request(&session_call("swap"), &grant_with(1_000_000), "keyhole", "swap").is_ok());
}

// ---------- 2. swap slippage bound ----------

#[test]
fn default_slippage_is_one_percent() {
    assert_eq!(DEFAULT_MAX_SLIPPAGE_BPS, 100);
    assert_eq!(MAX_SLIPPAGE_BPS, 500);
}
#[test]
fn client_min_out_zero_or_garbage_is_refused() {
    for v in [json!("0"), json!(0), json!(""), json!("-1"), json!("1.5"), json!("12x"), json!(true), json!([])] {
        assert_eq!(client_min_out(&v).unwrap_err().code, "bad_params", "{v}");
    }
}
#[test]
fn client_min_out_positive_is_passed_through() {
    assert_eq!(client_min_out(&json!("123456")).unwrap(), 123_456);
    assert_eq!(client_min_out(&json!(7)).unwrap(), 7);
}
#[test]
fn missing_min_out_is_derived_at_the_default_slippage() {
    assert_eq!(derive_min_out(1_000_000, None).unwrap(), 990_000);
    assert_eq!(derive_min_out(1_000_000, Some(995_000)).unwrap(), 995_000, "a tighter floor from the quote wins");
    assert_eq!(derive_min_out(1_000_000, Some(900_000)).unwrap(), 990_000, "a looser quote floor does not loosen the bound");
}
#[test]
fn derive_refuses_when_nothing_usable_is_quoted() {
    assert_eq!(derive_min_out(0, None).unwrap_err().code, "upstream");
    assert_eq!(derive_min_out(1, None).unwrap_err().code, "upstream", "rounds to a zero floor");
}
#[test]
fn null_client_min_is_the_same_as_absent() {
    assert!(client_min_out_field(None).unwrap().is_none());
    assert!(client_min_out_field(Some(&serde_json::Value::Null)).unwrap().is_none());
    assert_eq!(client_min_out_field(Some(&json!("5"))).unwrap(), Some(5));
    assert_eq!(client_min_out_field(Some(&json!("0"))).unwrap_err().code, "bad_params");
}

// ---------- 3. a refused call gives its budget and daily spend back ----------

fn limits1() -> Limits { limits_for_tier(1).unwrap() }

#[test]
fn refused_by_daily_cap_leaves_session_budget_unchanged() {
    let mut st = Mem::default();
    let g = grant_with(2_000_000);
    let cap = cap_id("k1");
    st.incr(&hkey(&cap, "spent/0"), 5_000_000).unwrap(); // the key's day is full
    let e = charge_spend(&mut st, &cap, &limits1(), Some(("sid", &g)), 1_000_000, 0).unwrap_err();
    assert_eq!(e.code, "over_cap_daily");
    assert_eq!(st.incr(&session_key("sid", "spent"), 0).unwrap(), 0, "session budget not burned");
    assert_eq!(st.incr(&hkey(&cap, "spent/0"), 0).unwrap(), 5_000_000, "daily spend unchanged");
}
#[test]
fn refused_by_per_trade_cap_leaves_both_unchanged() {
    let mut st = Mem::default();
    let g = grant_with(2_000_000);
    let cap = cap_id("k1");
    assert_eq!(charge_spend(&mut st, &cap, &limits1(), Some(("sid", &g)), 1_000_001, 0).unwrap_err().code, "over_cap_per_tx");
    assert_eq!(st.incr(&session_key("sid", "spent"), 0).unwrap(), 0);
    assert_eq!(st.incr(&hkey(&cap, "spent/0"), 0).unwrap(), 0);
}
#[test]
fn refused_by_session_cap_leaves_daily_spend_unchanged() {
    let mut st = Mem::default();
    let g = grant_with(2_000_000);
    let cap = cap_id("k1");
    charge_spend(&mut st, &cap, &limits1(), Some(("sid", &g)), 1_000_000, 0).unwrap();
    assert_eq!(charge_spend(&mut st, &cap, &limits1(), Some(("sid", &g)), 1_500_000, 0).unwrap_err().code, "session_cap");
    assert_eq!(st.incr(&session_key("sid", "spent"), 0).unwrap(), 1_000_000);
    assert_eq!(st.incr(&hkey(&cap, "spent/0"), 0).unwrap(), 1_000_000, "the refused trade was not counted");
}
#[test]
fn failed_send_gives_both_budgets_back() {
    for status in ["failed", "error", "refunded"] {
        let mut st = Mem::default();
        let g = grant_with(2_000_000);
        let cap = cap_id("k1");
        let c = charge_spend(&mut st, &cap, &limits1(), Some(("sid", &g)), 1_000_000, 0).unwrap();
        c.settle(&mut st, status);
        assert_eq!(st.incr(&session_key("sid", "spent"), 0).unwrap(), 0, "{status}");
        assert_eq!(st.incr(&hkey(&cap, "spent/0"), 0).unwrap(), 0, "{status}");
    }
}
#[test]
fn pending_or_success_keeps_the_charge() {
    for status in ["pending", "processing", "success", "needs_review"] {
        let mut st = Mem::default();
        let g = grant_with(2_000_000);
        let cap = cap_id("k1");
        let c = charge_spend(&mut st, &cap, &limits1(), Some(("sid", &g)), 1_000_000, 0).unwrap();
        c.settle(&mut st, status);
        assert_eq!(st.incr(&session_key("sid", "spent"), 0).unwrap(), 1_000_000, "{status}");
        assert_eq!(st.incr(&hkey(&cap, "spent/0"), 0).unwrap(), 1_000_000, "{status}");
    }
}
#[test]
fn a_wallet_call_charges_only_the_daily_counter() {
    let mut st = Mem::default();
    let cap = cap_id("k1");
    let c = charge_spend(&mut st, &cap, &limits1(), None, 1_000_000, 0).unwrap();
    assert_eq!(st.incr(&hkey(&cap, "spent/0"), 0).unwrap(), 1_000_000);
    assert_eq!(st.incr(&session_key("sid", "spent"), 0).unwrap(), 0);
    c.settle(&mut st, "failed");
    assert_eq!(st.incr(&hkey(&cap, "spent/0"), 0).unwrap(), 0);
}
#[test]
fn a_release_on_a_new_day_hits_the_day_it_was_charged() {
    let mut st = Mem::default();
    let cap = cap_id("k1");
    let c = charge_spend(&mut st, &cap, &limits1(), None, 1_000_000, 0).unwrap();
    c.settle(&mut st, "error");
    assert_eq!(st.incr(&hkey(&cap, "spent/0"), 0).unwrap(), 0);
    assert_eq!(st.incr(&hkey(&cap, "spent/1"), 0).unwrap(), 0, "no spend ever touched the next day");
}

// ---------- 4. NEP-413 callbackUrl is part of the signed payload ----------

fn wallet_key() -> SigningKey { SigningKey::from_bytes(&[11u8; 32]) }
fn wallet_auth(msg: &str, nonce: [u8; 32], rcp: &str, cb: Option<&str>) -> Auth {
    let k = wallet_key();
    let h = Sha256::digest(nep413_bytes(msg, &nonce, rcp, cb));
    Auth {
        account_id: "alice.near".into(),
        public_key: format!("ed25519:{}", bs58::encode(k.verifying_key().to_bytes()).into_string()),
        signature: B64.encode(k.sign(&h).to_bytes()),
        nonce: B64.encode(nonce),
        message: msg.into(),
        recipient: rcp.into(),
        callback_url: cb.map(|s| s.to_string()),
        scheme: String::new(),
        address: String::new(),
    }
}
const MSG: &str = r#"{"op":"swap","account_id":"alice.near","ts_ms":1000,"params":{}}"#;

#[test]
fn callback_absent_verifies() {
    assert!(verify_nep413(&wallet_auth(MSG, [1; 32], "keyhole", None), "keyhole").is_ok());
}
#[test]
fn callback_present_verifies_with_the_signed_value() {
    let a = wallet_auth(MSG, [1; 32], "keyhole", Some("https://app.example/cb?x=1"));
    assert!(verify_nep413(&a, "keyhole").is_ok());
}
#[test]
fn callback_from_the_web_json_field_verifies() {
    let a = wallet_auth(MSG, [1; 32], "keyhole", Some("https://app.example/cb"));
    let j = json!({"account_id": a.account_id, "public_key": a.public_key, "signature": a.signature, "nonce": a.nonce,
        "message": a.message, "recipient": a.recipient, "callback_url": "https://app.example/cb"});
    let back: Auth = serde_json::from_value(j).unwrap();
    assert_eq!(back.callback_url.as_deref(), Some("https://app.example/cb"));
    assert!(verify_nep413(&back, "keyhole").is_ok());
}
#[test]
fn callback_changed_after_signing_is_refused() {
    let mut a = wallet_auth(MSG, [1; 32], "keyhole", Some("https://a.example"));
    a.callback_url = Some("https://b.example".into());
    assert_eq!(verify_nep413(&a, "keyhole").unwrap_err().code, "bad_signature");
}
#[test]
fn callback_dropped_after_signing_is_refused() {
    let mut a = wallet_auth(MSG, [1; 32], "keyhole", Some("https://a.example"));
    a.callback_url = None;
    assert_eq!(verify_nep413(&a, "keyhole").unwrap_err().code, "bad_signature");
}
#[test]
fn callback_added_after_signing_is_refused() {
    let mut a = wallet_auth(MSG, [1; 32], "keyhole", None);
    a.callback_url = Some("https://a.example".into());
    assert_eq!(verify_nep413(&a, "keyhole").unwrap_err().code, "bad_signature");
}
#[test]
fn empty_callback_is_not_the_same_as_none() {
    let a = wallet_auth(MSG, [1; 32], "keyhole", Some(""));
    assert!(verify_nep413(&a, "keyhole").is_ok());
    let mut b = a.clone();
    b.callback_url = None;
    assert_eq!(verify_nep413(&b, "keyhole").unwrap_err().code, "bad_signature");
    assert_ne!(nep413_bytes(MSG, &[1; 32], "keyhole", Some("")), nep413_bytes(MSG, &[1; 32], "keyhole", None));
}
#[test]
fn callback_is_an_option_string_in_the_payload() {
    let b = nep413_bytes("m", &[2; 32], "keyhole", Some("x"));
    assert_eq!(&b[b.len() - 6..], &[1, 1, 0, 0, 0, b'x'], "Some tag, u32 length, bytes");
    assert_eq!(nep413_bytes("m", &[2; 32], "keyhole", None).last(), Some(&0));
}

// ---------- 5. nonce store pruning, replay still refused inside the window ----------

const T0: u64 = 1_800_000_000_000;
fn nonce_key(acct: &str, n: u8) -> String { hkey(acct, &format!("n/{}", hex::encode([n; 32]))) }

#[test]
fn retention_is_twice_the_skew() {
    assert_eq!(NONCE_RETAIN_MS, 2 * MAX_SKEW_MS);
}
#[test]
fn replay_is_refused_inside_the_window_and_at_its_edge() {
    let mut st = Mem::default();
    consume_nonce(&mut st, "alice.near", &[1; 32], T0).unwrap();
    assert_eq!(consume_nonce(&mut st, "alice.near", &[1; 32], T0 + MAX_SKEW_MS).unwrap_err().code, "replay");
    assert_eq!(consume_nonce(&mut st, "alice.near", &[1; 32], T0 + NONCE_RETAIN_MS).unwrap_err().code, "replay",
        "at the retention edge the record is still there");
}
#[test]
fn expired_nonce_record_is_pruned_and_the_new_one_kept() {
    let mut st = Mem::default();
    consume_nonce(&mut st, "alice.near", &[1; 32], T0).unwrap();
    assert!(st.b.contains_key(&nonce_key("alice.near", 1)));
    consume_nonce(&mut st, "alice.near", &[2; 32], T0 + NONCE_RETAIN_MS + 1).unwrap();
    assert!(!st.b.contains_key(&nonce_key("alice.near", 1)), "old record removed");
    assert!(st.b.contains_key(&nonce_key("alice.near", 2)), "new record kept");
}
#[test]
fn pruning_never_touches_another_holder() {
    let mut st = Mem::default();
    consume_nonce(&mut st, "bob.near", &[1; 32], T0).unwrap();
    consume_nonce(&mut st, "alice.near", &[2; 32], T0 + 10 * NONCE_RETAIN_MS).unwrap();
    assert!(st.b.contains_key(&hkey("bob.near", &format!("n/{}", hex::encode([1u8; 32])))));
}
#[test]
fn unreadable_record_is_kept() {
    let mut st = Mem::default();
    st.b.insert(hkey("alice.near", "n/junk"), b"not a time".to_vec());
    prune_nonces(&mut st, "alice.near", T0 + 10 * NONCE_RETAIN_MS).unwrap();
    assert!(st.b.contains_key(&hkey("alice.near", "n/junk")));
}
#[test]
fn pruning_removes_nothing_inside_the_window() {
    let mut st = Mem::default();
    consume_nonce(&mut st, "alice.near", &[1; 32], T0).unwrap();
    consume_nonce(&mut st, "alice.near", &[2; 32], T0 + NONCE_RETAIN_MS).unwrap();
    assert_eq!(prune_nonces(&mut st, "alice.near", T0 + NONCE_RETAIN_MS).unwrap(), 0);
    assert!(st.b.contains_key(&nonce_key("alice.near", 1)));
}
#[test]
fn a_pruned_nonce_fails_the_freshness_check_on_replay() {
    // First use at chain time T0 accepts a request whose signed ts is within 5 min of T0. A replay can
    // pass freshness only while chain time <= ts + 5 min <= T0 + 10 min, so after that the record is pruned.
    for ts_off in (-(MAX_SKEW_MS as i64)..=(MAX_SKEW_MS as i64)).step_by(15_000) {
        let ts = (T0 as i64 + ts_off) as u64;
        assert!(check_freshness(ts, T0).is_ok(), "first use accepted, offset {ts_off}");
        for extra in [1u64, 1_000, 60_000, MAX_SKEW_MS] {
            let replay_at = T0 + NONCE_RETAIN_MS + extra;
            assert_eq!(check_freshness(ts, replay_at).unwrap_err().code, "expired", "offset {ts_off} extra {extra}");
        }
    }
}

// ---------- 6. chain_sign: fresh signature, lock and cooldown refuse, daily count ----------

#[test]
fn chain_sign_refused_while_locked() {
    let lock = lock_value("alice.near", 10_000);
    assert_eq!(assert_unlocked(lock.as_bytes(), "alice.near", 9_999).unwrap_err().code, "locked");
    assert!(assert_unlocked(lock.as_bytes(), "alice.near", 10_000).is_ok());
}
#[test]
fn chain_sign_refused_during_the_post_transfer_cooldown() {
    let mut evs = Vec::new();
    append_event(&mut evs, "mint", "k1", "a", 0, "m");
    append_event(&mut evs, "transfer", "k1", "b", 1_000, "t");
    assert_eq!(assert_no_cooldown(&evs, "b", 1_001).unwrap_err().code, "cooldown");
}
#[test]
fn chain_sign_daily_count_is_checked_before_and_counted_after() {
    let mut st = Mem::default();
    let k = tkey("k1", "chainsig/0");
    for _ in 0..CHAIN_SIGN_PER_DAY {
        assert_quota_room(&mut st, &k, CHAIN_SIGN_PER_DAY, "chainsig_quota", "q".into()).unwrap();
        bump_within(&mut st, &k, 1, CHAIN_SIGN_PER_DAY, "chainsig_quota", "q".into()).unwrap();
    }
    assert_eq!(assert_quota_room(&mut st, &k, CHAIN_SIGN_PER_DAY, "chainsig_quota", "q".into()).unwrap_err().code, "chainsig_quota");
    assert_eq!(st.incr(&k, 0).unwrap(), CHAIN_SIGN_PER_DAY);
}
