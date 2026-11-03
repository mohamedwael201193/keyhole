//! P2 matrices for the audit fixes: each row is a distinct input that must keep its verdict.
use super::*;

macro_rules! fa_rows { ($($name:ident: $raw:expr => $want:expr;)*) => { $(#[test] fn $name() { assert_eq!(is_full_access($raw), $want, "{}", $raw); })* } }
fa_rows! {
    fa_plain: r#"{"permission":"FullAccess"}"# => true;
    fa_with_nonce_first: r#"{"nonce":9,"permission":"FullAccess","block_height":3}"# => true;
    fa_rpc_envelope: r#"{"jsonrpc":"2.0","result":{"permission":"FullAccess"}}"# => true;
    fa_whitespace_json: "{ \"permission\" : \"FullAccess\" }" => true;
    fa_fc_method_fullaccess: r#"{"permission":{"FunctionCall":{"allowance":null,"receiver_id":"a.near","method_names":["FullAccess"]}}}"# => false;
    fa_fc_method_list_contains: r#"{"permission":{"FunctionCall":{"allowance":"1","receiver_id":"a.near","method_names":["beat","FullAccess"]}}}"# => false;
    fa_fc_receiver_fullaccess: r#"{"permission":{"FunctionCall":{"allowance":"1","receiver_id":"FullAccess","method_names":[]}}}"# => false;
    fa_fc_receiver_fullaccess_near: r#"{"permission":{"FunctionCall":{"allowance":"1","receiver_id":"fullaccess.near","method_names":[]}}}"# => false;
    fa_fc_no_methods: r#"{"permission":{"FunctionCall":{"allowance":"1","receiver_id":"keyhole-devmo.near","method_names":[]}}}"# => false;
    fa_lowercase: r#"{"permission":"fullaccess"}"# => false;
    fa_upper: r#"{"permission":"FULLACCESS"}"# => false;
    fa_trailing_space: r#"{"permission":"FullAccess "}"# => false;
    fa_leading_space: r#"{"permission":" FullAccess"}"# => false;
    fa_array: r#"{"permission":["FullAccess"]}"# => false;
    fa_object_key: r#"{"permission":{"FullAccess":null}}"# => false;
    fa_bool: r#"{"permission":true}"# => false;
    fa_null: r#"{"permission":null}"# => false;
    fa_missing: r#"{"nonce":1}"# => false;
    fa_other_field: r#"{"perm":"FullAccess"}"# => false;
    fa_nested_wrong_place: r#"{"data":{"permission":"FullAccess"}}"# => false;
    fa_error_object: r#"{"error":{"message":"FullAccess"}}"# => false;
    fa_empty: "" => false;
    fa_bare_word: "FullAccess" => false;
    fa_quoted_string: "\"FullAccess\"" => false;
    fa_truncated_json: r#"{"permission":"FullAccess""# => false;
    fa_number: "42" => false;
    fa_unicode_lookalike: "{\"permission\":\"FullAcce\u{0455}s\"}" => false;
    fa_escaped_equal: r#"{"permission":"Full\u0041ccess"}"# => true;
}

macro_rules! pick_rows { ($($name:ident: $named:expr, $owned:expr => $ok:expr;)*) => { $(#[test] fn $name() { assert_eq!(pick_token($named, $owned).is_ok(), $ok); })* } }
pick_rows! {
    pick_none_0: None, 0 => true;
    pick_none_1: None, 1 => true;
    pick_none_2: None, 2 => false;
    pick_none_3: None, 3 => false;
    pick_none_100: None, 100 => false;
    pick_none_max: None, u64::MAX => false;
    pick_named_1: Some("k0000000000000001"), 1 => true;
    pick_named_2: Some("k0000000000000001"), 2 => true;
    pick_named_9: Some("k0000000000000001"), 9 => true;
    pick_named_0: Some("k0000000000000001"), 0 => true;
}

macro_rules! wet_rows { ($($name:ident: $dry:expr, $wet:expr => $code:expr;)*) => { $(#[test] fn $name() {
    let r = assert_wet_within_dry($dry, $wet);
    match $code { None => assert!(r.is_ok()), Some(c) => assert_eq!(r.unwrap_err().code, c) }
})* } }
wet_rows! {
    wet_equal: 1_000_000, Some(1_000_000) => None::<&str>;
    wet_cheaper: 1_000_000, Some(999_999) => None::<&str>;
    wet_zero: 1_000_000, Some(0) => None::<&str>;
    wet_one_micro_more: 1_000_000, Some(1_000_001) => Some("quote_moved");
    wet_double: 500_000, Some(1_000_000) => Some("quote_moved");
    wet_audit_case: 990_000, Some(1_500_000) => Some("quote_moved");
    wet_from_zero_dry: 0, Some(1) => Some("quote_moved");
    wet_max: 1, Some(u64::MAX) => Some("quote_moved");
    wet_missing_usd: 1_000_000, None => Some("upstream");
    wet_missing_zero_dry: 0, None => Some("upstream");
}

#[test] fn wet_returns_the_wet_value_when_lower() { assert_eq!(assert_wet_within_dry(10, Some(7)).unwrap(), 7); }

macro_rules! claim_rows { ($($name:ident: $raw:expr, $now:expr => $free:expr;)*) => { $(#[test] fn $name() { assert_eq!(wallet_claim_free($raw, $now), $free); })* } }
claim_rows! {
    claim_empty: b"", 5 => true;
    claim_garbage: b"abc", 5 => true;
    claim_negative: b"-1", 5 => true;
    claim_just_now: b"1000", 1000 => false;
    claim_one_ms: b"1000", 1001 => false;
    claim_at_ttl: b"1000", 1000 + WALLET_CLAIM_TTL_MS => false;
    claim_after_ttl: b"1000", 1001 + WALLET_CLAIM_TTL_MS => true;
    claim_future_stamp: b"5000", 1000 => false;
    claim_zero_stamp_late: b"0", WALLET_CLAIM_TTL_MS + 1 => true;
}

#[test] fn mint_id_free_when_no_owner() { assert!(assert_mint_id_free(None).is_ok()); }
#[test] fn mint_id_taken_by_anyone_is_already_minted() {
    for o in ["a.near", "keyhole-devmo.near", "0xf76e6b0920e9332ff4410f6dd53f01722abc71a3", ""] {
        assert_eq!(assert_mint_id_free(Some(o)).unwrap_err().code, "already_minted", "{o}");
    }
}

macro_rules! lock_rows { ($($name:ident: $owner:expr, $until:expr, $who:expr, $now:expr => $locked:expr;)*) => { $(#[test] fn $name() {
    let raw = lock_value($owner, $until);
    assert_eq!(assert_unlocked(raw.as_bytes(), $who, $now).is_err(), $locked);
})* } }
lock_rows! {
    lock_owner_inside: "a.near", 10_000, "a.near", 9_999 => true;
    lock_owner_at_end: "a.near", 10_000, "a.near", 10_000 => false;
    lock_owner_after: "a.near", 10_000, "a.near", 20_000 => false;
    lock_new_owner_inside: "a.near", 10_000, "b.near", 5_000 => false;
    lock_hex_owner: "3bde8ce5eb4e15403d49ba9512a98070db68958b39f378816f7862cee6168447", 10, "3bde8ce5eb4e15403d49ba9512a98070db68958b39f378816f7862cee6168447", 1 => true;
    lock_evm_owner: "0xf76e6b0920e9332ff4410f6dd53f01722abc71a3", 10, "0xf76e6b0920e9332ff4410f6dd53f01722abc71a3", 9 => true;
}
#[test] fn lock_garbage_is_unlocked() { for raw in [&b""[..], b"x", b"a.near|", b"a.near|x", b"|5"] { assert!(assert_unlocked(raw, "a.near", 1).is_ok()); } }

#[test] fn chain_sign_quota_is_small_and_positive() { assert!((1..=10).contains(&CHAIN_SIGN_PER_DAY)); }
