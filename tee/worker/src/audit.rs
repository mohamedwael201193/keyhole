//! Regression tests for the 2026-11-03 audit findings (see docs/AUDIT_2026-11-03.md).
use super::*;

// 2.1 full-access check parses JSON; substrings in method names or receivers never pass.
const FA: &str = r#"{"block_hash":"x","block_height":1,"nonce":5,"permission":"FullAccess"}"#;
#[test] fn full_access_key_passes() { assert!(is_full_access(FA)); }
#[test] fn full_access_inside_rpc_result_envelope_passes() { assert!(is_full_access(r#"{"result":{"nonce":1,"permission":"FullAccess"}}"#)); }
#[test] fn fc_key_with_method_named_full_access_fails() {
    assert!(!is_full_access(r#"{"nonce":1,"permission":{"FunctionCall":{"allowance":null,"receiver_id":"x.near","method_names":["FullAccess"]}}}"#));
}
#[test] fn fc_key_with_receiver_named_full_access_fails() {
    assert!(!is_full_access(r#"{"nonce":1,"permission":{"FunctionCall":{"allowance":"1","receiver_id":"FullAccess","method_names":[]}}}"#));
}
#[test] fn lowercase_or_padded_permission_fails() {
    for p in ["fullaccess", "FullAccess ", " FullAccess", "FULLACCESS"] {
        assert!(!is_full_access(&format!(r#"{{"permission":"{p}"}}"#)), "{p}");
    }
}
#[test] fn rpc_error_text_mentioning_full_access_fails() {
    for raw in ["", "FullAccess", "error: key is not FullAccess", r#"{"error":"FullAccess"}"#, r#"{"permission":["FullAccess"]}"#, r#"{"permission":{"FullAccess":{}}}"#] {
        assert!(!is_full_access(raw), "{raw}");
    }
}

// 2.5 an account with several keys must name one.
#[test] fn one_key_needs_no_token_id() { assert!(pick_token(None, 1).is_ok()); assert!(pick_token(None, 0).is_ok()); }
#[test] fn several_keys_without_token_id_is_refused() { assert_eq!(pick_token(None, 2).unwrap_err().code, "bad_params"); }
#[test] fn several_keys_with_token_id_is_fine() { assert!(pick_token(Some("k0000000000000001"), 3).is_ok()); }

// 2.4 executable quote may not be priced above the dry quote that passed the caps.
#[test] fn wet_equal_or_cheaper_than_dry_passes() { assert_eq!(assert_wet_within_dry(990_000, Some(990_000)).unwrap(), 990_000); assert_eq!(assert_wet_within_dry(990_000, Some(980_000)).unwrap(), 980_000); }
#[test] fn wet_above_dry_is_refused() { assert_eq!(assert_wet_within_dry(990_000, Some(1_500_000)).unwrap_err().code, "quote_moved"); assert_eq!(assert_wet_within_dry(990_000, Some(990_001)).unwrap_err().code, "quote_moved"); }
#[test] fn wet_without_usd_is_refused() { assert_eq!(assert_wet_within_dry(1, None).unwrap_err().code, "upstream"); }

// 2.3 chain_sign has a per-key daily count enforced through the same bounded counter as other quotas.
#[derive(Default)] struct Mem(std::collections::HashMap<String, Vec<u8>>);
impl Store for Mem {
    fn set_if_absent(&mut self, k: &str, v: &[u8]) -> Result<bool, Error> { if self.0.contains_key(k) { return Ok(false); } self.0.insert(k.into(), v.to_vec()); Ok(true) }
    fn incr(&mut self, k: &str, d: i64) -> Result<i64, Error> {
        let n = std::str::from_utf8(&self.0.get(k).cloned().unwrap_or_default()).ok().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0) + d;
        self.0.insert(k.into(), n.to_string().into_bytes()); Ok(n)
    }
}
#[test] fn chain_sign_daily_count_stops_at_the_limit() {
    let mut st = Mem::default();
    for _ in 0..CHAIN_SIGN_PER_DAY { bump_within(&mut st, "t/k/chainsig/1", 1, CHAIN_SIGN_PER_DAY, "chainsig_quota", "x".into()).unwrap(); }
    assert_eq!(bump_within(&mut st, "t/k/chainsig/1", 1, CHAIN_SIGN_PER_DAY, "chainsig_quota", "x".into()).unwrap_err().code, "chainsig_quota");
    assert!(bump_within(&mut st, "t/k/chainsig/2", 1, CHAIN_SIGN_PER_DAY, "chainsig_quota", "x".into()).is_ok(), "next day resets");
}
#[test] fn chain_sign_is_refused_while_locked() {
    let raw = lock_value("a.near", 10_000);
    assert_eq!(assert_unlocked(raw.as_bytes(), "a.near", 5_000).unwrap_err().code, "locked");
}

// 2.8 wallet registration claim.
#[test] fn no_claim_or_garbage_claim_is_free() { assert!(wallet_claim_free(b"", 1)); assert!(wallet_claim_free(b"x", 1)); }
#[test] fn fresh_claim_blocks_a_second_registration() { assert!(!wallet_claim_free(b"1000", 1000 + WALLET_CLAIM_TTL_MS)); }
#[test] fn abandoned_claim_can_be_taken_over() { assert!(wallet_claim_free(b"1000", 1001 + WALLET_CLAIM_TTL_MS)); }
