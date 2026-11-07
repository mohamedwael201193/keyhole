//! Sessions per https://docs.near.org/web3-apps/backend/backend#backend-auth-with-a-near-wallet :
//! one NEP-413 signature, then an enclave-issued token (30 min, one key, spend cap, scoped).
use super::*;

const T: u64 = 1_800_000_000_000;
fn sreq(acct: &str, params: &str) -> SignedRequest {
    let m = format!(r#"{{"op":"session","account_id":"{acct}","ts_ms":{T},"params":{params}}}"#);
    verify_nep413(&signed(1, acct, &m, [3; 32], RCP), RCP).unwrap().0
}
fn grant(acct: &str, tid: &str) -> SessionGrant { grant_from_request(&sreq(acct, r#"{"max_usd_micro":2000000}"#), tid, T).unwrap() }
fn call(op: &str, acct: &str, params: &str, nonce: [u8; 32]) -> SessionAuth {
    SessionAuth { scheme: "session".into(), token: B64.encode([9u8; 32]), message: format!(r#"{{"op":"{op}","account_id":"{acct}","ts_ms":{T},"params":{params}}}"#), nonce: B64.encode(nonce), recipient: RCP.into() }
}

#[test] fn grant_defaults() { let g = grant("alice.near", "k1"); assert_eq!(g.exp_ms, T + SESSION_MAX_MS); assert_eq!(g.max_usd_micro, 2_000_000); assert_eq!(g.scope.len(), SESSION_OPS.len()); assert_eq!(g.account, "alice.near"); }
#[test] fn max_is_thirty_minutes() { assert_eq!(SESSION_MAX_MS, 1_800_000); }
#[test] fn grant_shorter_ttl() { assert_eq!(grant_from_request(&sreq("a.near", r#"{"max_usd_micro":1,"ttl_ms":60000}"#), "k1", T).unwrap().exp_ms, T + 60_000); }
#[test] fn grant_too_long() { assert_eq!(grant_from_request(&sreq("a.near", r#"{"max_usd_micro":1,"ttl_ms":1800001}"#), "k1", T).unwrap_err().code, "session_too_long"); }
#[test] fn grant_zero_ttl() { assert_eq!(grant_from_request(&sreq("a.near", r#"{"max_usd_micro":1,"ttl_ms":0}"#), "k1", T).unwrap_err().code, "session_too_long"); }
#[test] fn grant_cap_required() { assert_eq!(grant_from_request(&sreq("a.near", "{}"), "k1", T).unwrap_err().code, "bad_session"); }
#[test] fn grant_cap_bounds() { for bad in ["0", "1000000001"] { assert_eq!(grant_from_request(&sreq("a.near", &format!(r#"{{"max_usd_micro":{bad}}}"#)), "k1", T).unwrap_err().code, "bad_session", "{bad}"); } }
#[test] fn grant_cap_as_string() { assert_eq!(grant_from_request(&sreq("a.near", r#"{"max_usd_micro":"5"}"#), "k1", T).unwrap().max_usd_micro, 5); }
#[test] fn grant_must_be_session_op() { let mut r = sreq("a.near", r#"{"max_usd_micro":1}"#); r.op = "swap".into(); assert_eq!(grant_from_request(&r, "k1", T).unwrap_err().code, "bad_session"); }
#[test] fn grant_needs_held_token() { assert_eq!(grant_from_request(&sreq("a.near", r#"{"max_usd_micro":1}"#), "", T).unwrap_err().code, "bad_session"); }
#[test] fn grant_signed_token_must_match_held() { assert_eq!(grant_from_request(&sreq("a.near", r#"{"max_usd_micro":1,"token_id":"k2"}"#), "k1", T).unwrap_err().code, "session_token"); }
#[test] fn grant_scope_narrowed() { let g = grant_from_request(&sreq("a.near", r#"{"max_usd_micro":1,"scope":["swap","chain_sign","prove","lock"]}"#), "k1", T).unwrap(); assert_eq!(g.scope, vec!["swap".to_string()]); }
#[test] fn grant_scope_empty_after_narrowing() { assert_eq!(grant_from_request(&sreq("a.near", r#"{"max_usd_micro":1,"scope":["prove"]}"#), "k1", T).unwrap_err().code, "bad_session"); }
#[test] fn grant_wallet_sig_tamper_fails() { let mut a = signed(1, "a.near", r#"{"op":"session","account_id":"a.near","ts_ms":1,"params":{"max_usd_micro":1}}"#, [3; 32], RCP); a.message = a.message.replace(":1}", ":999}"); assert_eq!(verify_nep413(&a, RCP).unwrap_err().code, "bad_signature"); }
#[test] fn grant_roundtrips_storage_json() { let g = grant("a.near", "k1"); let back: SessionGrant = serde_json::from_str(&serde_json::to_string(&g).unwrap()).unwrap(); assert_eq!(back, g); }

#[test] fn time_ok() { assert!(check_grant_time(&grant("a.near", "k1"), T + 1).is_ok()); }
#[test] fn time_expired() { assert_eq!(check_grant_time(&grant("a.near", "k1"), T + SESSION_MAX_MS).unwrap_err().code, "session_expired"); }
#[test] fn time_forged_long_grant() { let mut g = grant("a.near", "k1"); g.exp_ms = g.iat_ms + SESSION_MAX_MS + 1; assert_eq!(check_grant_time(&g, T).unwrap_err().code, "session_too_long"); }

#[test] fn token_hash_is_stored_not_token() { let id = session_id(&[9; 32]); assert_eq!(id.len(), 64); assert_ne!(id, hex::encode([9u8; 32])); assert_eq!(parse_session_token(&B64.encode([9u8; 32])).unwrap(), id); }
#[test] fn token_bad_length() { assert_eq!(parse_session_token(&B64.encode([9u8; 31])).unwrap_err().code, "bad_session"); }
#[test] fn token_not_base64() { assert!(parse_session_token("!!!").is_err()); }

#[test] fn request_ok() { let g = grant("a.near", "k1"); let (r, n) = verify_session_request(&call("swap", "a.near", r#"{"token_id":"k1"}"#, [5; 32]), &g, RCP, "swap").unwrap(); assert_eq!(r.op, "swap"); assert_eq!(n, [5; 32]); }
#[test] fn request_without_token_param() { assert!(verify_session_request(&call("balance", "a.near", "{}", [5; 32]), &grant("a.near", "k1"), RCP, "balance").is_ok()); }
#[test] fn withdraw_refused_in_session() { assert_eq!(verify_session_request(&call("withdraw", "a.near", "{}", [5; 32]), &grant("a.near", "k1"), RCP, "withdraw").unwrap_err().code, "session_scope"); }
#[test] fn dashboard_in_scope() { assert!(verify_session_request(&call("dashboard", "a.near", "{}", [5; 32]), &grant("a.near", "k1"), RCP, "dashboard").is_ok()); }
#[test] fn wrong_token() { assert_eq!(verify_session_request(&call("swap", "a.near", r#"{"token_id":"k2"}"#, [5; 32]), &grant("a.near", "k1"), RCP, "swap").unwrap_err().code, "session_token"); }
#[test] fn wrong_account() { assert_eq!(verify_session_request(&call("swap", "b.near", "{}", [5; 32]), &grant("a.near", "k1"), RCP, "swap").unwrap_err().code, "account_mismatch"); }
#[test] fn op_mismatch() { assert_eq!(verify_session_request(&call("balance", "a.near", "{}", [5; 32]), &grant("a.near", "k1"), RCP, "swap").unwrap_err().code, "op_mismatch"); }
#[test] fn wrong_recipient() { let mut r = call("swap", "a.near", "{}", [5; 32]); r.recipient = "evil".into(); assert_eq!(verify_session_request(&r, &grant("a.near", "k1"), RCP, "swap").unwrap_err().code, "wrong_recipient"); }
#[test] fn bad_nonce() { let mut r = call("swap", "a.near", "{}", [5; 32]); r.nonce = B64.encode([1u8; 8]); assert_eq!(verify_session_request(&r, &grant("a.near", "k1"), RCP, "swap").unwrap_err().code, "bad_nonce"); }
#[test] fn bad_message() { let mut r = call("swap", "a.near", "{}", [5; 32]); r.message = "nope".into(); assert_eq!(verify_session_request(&r, &grant("a.near", "k1"), RCP, "swap").unwrap_err().code, "bad_message"); }
#[test] fn out_of_scope_ops_refused() {
    let g = grant("a.near", "k1");
    for op in ["prove", "lock", "mint", "chain_sign", "add_beat_key", "del_beat_key", "sweep_minter", "session", "chain_address"] {
        assert_eq!(verify_session_request(&call(op, "a.near", "{}", [5; 32]), &g, RCP, op).unwrap_err().code, "session_scope", "{op}");
    }
}
#[test] fn narrowed_scope_refuses_other_ops() { let g = grant_from_request(&sreq("a.near", r#"{"max_usd_micro":1,"scope":["balance"]}"#), "k1", T).unwrap(); assert_eq!(verify_session_request(&call("withdraw", "a.near", "{}", [5; 32]), &g, RCP, "withdraw").unwrap_err().code, "session_scope"); }
#[test] fn replay_refused_by_nonce_store() { let mut st = Mem::default(); consume_nonce(&mut st, "a.near", &[5; 32], T).unwrap(); assert_eq!(consume_nonce(&mut st, "a.near", &[5; 32], T).unwrap_err().code, "replay"); }

#[test] fn charge_within_cap_then_refuse() {
    let mut st = Mem::default(); let g = grant("a.near", "k1"); let id = session_id(&[9; 32]);
    assert_eq!(session_charge(&mut st, &id, &g, 1_500_000).unwrap(), 1_500_000);
    assert_eq!(session_charge(&mut st, &id, &g, 600_000).unwrap_err().code, "session_cap");
    assert_eq!(session_charge(&mut st, &id, &g, 500_000).unwrap(), 2_000_000, "the refused charge was undone");
}
#[test] fn charge_is_per_session() { let mut st = Mem::default(); let g = grant("a.near", "k1"); session_charge(&mut st, &session_id(&[1; 32]), &g, 2_000_000).unwrap(); assert!(session_charge(&mut st, &session_id(&[2; 32]), &g, 2_000_000).is_ok()); }
#[test] fn storage_namespace() { assert!(session_key("ab", "grant").starts_with("s/ab/")); }
#[test] fn limits_lowering_is_not_a_raise() { let p = set_policy(limits_for_tier(1).unwrap(), None, "a.near", 100_000, 200_000, T).unwrap(); assert!(!session_limits_raise(None, &p)); }
#[test] fn limits_raise_is_flagged() { let t = limits_for_tier(1).unwrap(); let low = set_policy(t, None, "a.near", 100_000, 200_000, T).unwrap(); let up = set_policy(t, Some(&low), "a.near", 500_000, 900_000, T + 1).unwrap(); assert!(session_limits_raise(Some(&low), &up)); }
#[test] fn eip191_account_grant() { let r = SignedRequest { op: "session".into(), account_id: "0xabc".into(), ts_ms: T, params: serde_json::json!({"max_usd_micro": "1000000"}) }; assert_eq!(grant_from_request(&r, "k1", T).unwrap().account, "0xabc"); }

// Sign-in-and-sign-message: the session request is signed before the account is known.
fn blank(op: &str) -> String { format!(r#"{{"op":"{op}","account_id":"","ts_ms":{T},"params":{{"max_usd_micro":5000000}}}}"#) }
#[test] fn signin_session_takes_signer_account() { let r = verify_nep413(&signed(1, "alice.near", &blank("session"), [4; 32], RCP), RCP).unwrap().0; assert_eq!(r.account_id, "alice.near"); assert_eq!(grant_from_request(&r, "k1", T).unwrap().account, "alice.near"); }
#[test] fn signin_blank_account_only_for_session() { assert_eq!(verify_nep413(&signed(1, "alice.near", &blank("swap"), [4; 32], RCP), RCP).unwrap_err().code, "account_mismatch"); }
#[test] fn signin_blank_still_needs_valid_signature() { let mut a = signed(1, "alice.near", &blank("session"), [4; 32], RCP); a.account_id = "bob.near".into(); assert_eq!(verify_nep413(&a, RCP).unwrap().0.account_id, "bob.near"); /* bob must then pass the full-access-key check in authenticate */ }
#[test] fn signin_blank_wrong_recipient() { assert!(verify_nep413(&signed(1, "alice.near", &blank("session"), [4; 32], "other"), RCP).is_err()); }
