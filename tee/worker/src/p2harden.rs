use super::*;
use std::collections::HashMap;
#[derive(Default)]
struct Mem(HashMap<String, i64>, HashMap<String, Vec<u8>>);
impl Store for Mem {
    fn set_if_absent(&mut self, k: &str, v: &[u8]) -> Result<bool, Error> { if self.1.contains_key(k) { return Ok(false); } self.1.insert(k.into(), v.to_vec()); Ok(true) }
    fn incr(&mut self, k: &str, d: i64) -> Result<i64, Error> { let e = self.0.entry(k.into()).or_insert(0); *e += d; Ok(*e) }
    fn list_prefix(&mut self, p: &str) -> Result<Vec<String>, Error> { Ok(self.1.keys().filter(|k| k.starts_with(p)).cloned().collect()) }
    fn read(&mut self, k: &str) -> Result<Vec<u8>, Error> { Ok(self.1.get(k).cloned().unwrap_or_default()) }
    fn remove(&mut self, k: &str) -> Result<(), Error> { self.1.remove(k); Ok(()) }
}
fn lim() -> Limits { limits_for_tier(1).unwrap() }

#[test]
fn replay_does_not_consume_rate_budget() {
    let mut m = Mem::default();
    let n = [7u8; 32];
    admit(&mut m, "a.near", &lim(), &n, 60_000).unwrap();
    let before = m.0.clone();
    for _ in 0..50 { assert_eq!(admit(&mut m, "a.near", &lim(), &n, 60_000).unwrap_err().code, "replay"); }
    assert_eq!(m.0, before, "replays must not touch any rate counter");
}

#[test]
fn fresh_nonces_still_rate_limited() {
    let mut m = Mem::default();
    let l = lim();
    let mut refused = false;
    for i in 0..(l.per_minute_calls + 2) { let mut n = [0u8; 32]; n[0] = i as u8; n[1] = 1; if admit(&mut m, "a.near", &l, &n, 60_000).is_err() { refused = true; } }
    assert!(refused);
}

#[test]
fn quota_room_reads_without_bumping_and_failed_call_costs_nothing() {
    let mut m = Mem::default();
    let k = "t/x/chainsig/1";
    for _ in 0..10 { assert_quota_room(&mut m, k, 2, "chainsig_quota", "q".into()).unwrap(); } // e.g. 10 MPC failures
    assert_eq!(m.0.get(k).copied().unwrap_or(0), 0);
    bump_within(&mut m, k, 1, 2, "chainsig_quota", "q".into()).unwrap();
    bump_within(&mut m, k, 1, 2, "chainsig_quota", "q".into()).unwrap();
    assert_eq!(assert_quota_room(&mut m, k, 2, "chainsig_quota", "q".into()).unwrap_err().code, "chainsig_quota");
}

#[test]
fn quote_parties_pinned_to_signer() {
    assert!(assert_quote_parties("a.near", "a.near", "a.near").is_ok());
    assert_eq!(assert_quote_parties("a.near", "evil.near", "a.near").unwrap_err().code, "wrong_recipient");
    assert_eq!(assert_quote_parties("a.near", "a.near", "evil.near").unwrap_err().code, "wrong_recipient");
}

#[test]
fn owner_change_during_move_is_needs_review() {
    assert_eq!(after_move_status("success", false), "needs_review");
    assert_eq!(after_move_status("pending", false), "needs_review");
    assert_eq!(after_move_status("success", true), "success");
    assert_eq!(after_move_status("failed", false), "failed");
}

#[test]
fn beat_key_owner_from_contract_config() {
    let cfg = serde_json::json!({"owner": "keyhole-devmo.near", "minter": "015a", "treasury": "keyhole-devmo.near"});
    assert_eq!(config_owner(&cfg).as_deref(), Some("keyhole-devmo.near"));
    assert_eq!(config_owner(&serde_json::json!({})), None);
    assert_eq!(config_owner(&serde_json::json!({"owner": ""})), None);
    assert!(assert_owner("mallory.near", &config_owner(&cfg).unwrap()).is_err());
}
