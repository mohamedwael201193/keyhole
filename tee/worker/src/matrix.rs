//! Table-driven checks of the worker's pure policy code. Each test is one row: one input and
//! the exact answer the enclave must give. Run with `cargo test --locked`.
use crate::*;
use ed25519_dalek::{Signer, SigningKey};
use std::collections::HashMap;

#[derive(Default)]
struct Mem(HashMap<String, i64>, HashMap<String, Vec<u8>>);
impl Store for Mem {
    fn set_if_absent(&mut self, k: &str, v: &[u8]) -> Result<bool, Error> {
        if self.1.contains_key(k) { return Ok(false); }
        self.1.insert(k.into(), v.to_vec());
        Ok(true)
    }
    fn incr(&mut self, k: &str, d: i64) -> Result<i64, Error> {
        let e = self.0.entry(k.into()).or_insert(0);
        *e += d;
        Ok(*e)
    }
    fn list_prefix(&mut self, p: &str) -> Result<Vec<String>, Error> { Ok(self.1.keys().filter(|k| k.starts_with(p)).cloned().collect()) }
    fn read(&mut self, k: &str) -> Result<Vec<u8>, Error> { Ok(self.1.get(k).cloned().unwrap_or_default()) }
    fn remove(&mut self, k: &str) -> Result<(), Error> { self.1.remove(k); Ok(()) }
}
fn code<T: std::fmt::Debug>(r: Result<T, Error>) -> &'static str { match r { Ok(_) => "ok", Err(e) => e.code } }

// ---------- NEAR account ids (who may sign) ----------
macro_rules! account_ids { ($($n:ident: $id:expr => $ok:expr;)*) => { $( #[test] fn $n() { assert_eq!(is_valid_account_id(&$id), $ok, "{:?}", $id); } )* } }
account_ids! {
    acct_two_chars_ok: "ab" => true;
    acct_one_char_refused: "a" => false;
    acct_empty_refused: "" => false;
    acct_named_ok: "alice.near" => true;
    acct_sub_account_ok: "app.alice.near" => true;
    acct_dash_underscore_ok: "a-b_c.near" => true;
    acct_64_chars_ok: "a".repeat(64) => true;
    acct_65_chars_refused: "a".repeat(65) => false;
    acct_implicit_hex_ok: "015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443" => true;
    acct_eth_implicit_ok: "0xf76e6b0920e9332ff4410f6dd53f01722abc71a3" => true;
    acct_uppercase_refused: "Alice.near" => false;
    acct_leading_dot_refused: ".alice" => false;
    acct_trailing_dot_refused: "alice." => false;
    acct_leading_dash_refused: "-alice" => false;
    acct_trailing_dash_refused: "alice-" => false;
    acct_leading_underscore_refused: "_alice" => false;
    acct_double_dot_refused: "a..near" => false;
    acct_space_refused: "a lice" => false;
    acct_slash_refused: "a/b" => false;
    acct_colon_refused: "tok:k1" => false;
    acct_at_refused: "a@b.near" => false;
    acct_unicode_refused: "älice.near" => false;
}

// ---------- signed-time window (5 minutes either side of chain time) ----------
const NOW: u64 = 1_800_000_000_000;
macro_rules! fresh { ($($n:ident: $ts:expr, $now:expr => $want:expr;)*) => { $( #[test] fn $n() { assert_eq!(code(check_freshness($ts, $now)), $want); } )* } }
fresh! {
    fresh_same_ms: NOW, NOW => "ok";
    fresh_oldest_allowed: NOW - MAX_SKEW_MS, NOW => "ok";
    fresh_one_ms_too_old: NOW - MAX_SKEW_MS - 1, NOW => "expired";
    fresh_newest_allowed: NOW + MAX_SKEW_MS, NOW => "ok";
    fresh_one_ms_too_new: NOW + MAX_SKEW_MS + 1, NOW => "expired";
    fresh_a_day_old: NOW - 86_400_000, NOW => "expired";
    fresh_zero_ts_on_young_chain: 0, MAX_SKEW_MS => "ok";
    fresh_zero_ts_late: 0, MAX_SKEW_MS + 1 => "expired";
}

// ---------- per-trade and per-day caps, per tier ----------
macro_rules! caps_for_tier { ($m:ident, $tier:expr) => { mod $m {
    use super::*;
    fn lim() -> Limits { limits_for_tier($tier).unwrap() }
    const T: u64 = 1_800_000_000_000;
    #[test] fn at_per_trade_cap_passes() { let mut s = Mem::default(); assert_eq!(code(enforce_caps(&mut s, "k", &lim(), lim().per_tx_usd_micro, T, true)), "ok"); }
    #[test] fn one_micro_over_per_trade_is_refused() { let mut s = Mem::default(); assert_eq!(code(enforce_caps(&mut s, "k", &lim(), lim().per_tx_usd_micro + 1, T, true)), "over_cap_per_tx"); }
    #[test] fn filling_the_day_exactly_passes_then_one_more_micro_is_refused() {
        let mut s = Mem::default(); let l = lim(); let n = l.daily_usd_micro / l.per_tx_usd_micro;
        for _ in 0..n { enforce_caps(&mut s, "k", &l, l.per_tx_usd_micro, T, true).unwrap(); }
        assert_eq!(code(enforce_caps(&mut s, "k", &l, 1, T, true)), "over_cap_daily");
    }
    #[test] fn a_refused_trade_does_not_count_toward_the_day() {
        let mut s = Mem::default(); let l = lim();
        let n = l.daily_usd_micro / l.per_tx_usd_micro;
        for _ in 0..n - 1 { enforce_caps(&mut s, "k", &l, l.per_tx_usd_micro, T, true).unwrap(); }
        enforce_caps(&mut s, "k", &l, l.per_tx_usd_micro - 1, T, true).unwrap();
        let before = s.incr(&hkey("k", &format!("spent/{}", T / 86_400_000)), 0).unwrap();
        assert_eq!(code(enforce_caps(&mut s, "k", &l, l.per_tx_usd_micro, T, true)), "over_cap_daily");
        assert_eq!(s.incr(&hkey("k", &format!("spent/{}", T / 86_400_000)), 0).unwrap(), before);
    }
    #[test] fn a_dry_check_records_nothing() {
        let mut s = Mem::default(); let l = lim();
        enforce_caps(&mut s, "k", &l, l.per_tx_usd_micro, T, false).unwrap();
        assert_eq!(enforce_caps(&mut s, "k", &l, 0, T, false).unwrap(), 0);
    }
    #[test] fn the_next_utc_day_starts_fresh() {
        let mut s = Mem::default(); let l = lim(); let n = l.daily_usd_micro / l.per_tx_usd_micro;
        for _ in 0..n { enforce_caps(&mut s, "k", &l, l.per_tx_usd_micro, T, true).unwrap(); }
        let next = (T / 86_400_000 + 1) * 86_400_000;
        assert_eq!(code(enforce_caps(&mut s, "k", &l, l.per_tx_usd_micro, next, true)), "ok");
    }
    #[test] fn another_key_has_its_own_day() {
        let mut s = Mem::default(); let l = lim(); let n = l.daily_usd_micro / l.per_tx_usd_micro;
        for _ in 0..n { enforce_caps(&mut s, &cap_id("k1"), &l, l.per_tx_usd_micro, T, true).unwrap(); }
        assert_eq!(code(enforce_caps(&mut s, &cap_id("k2"), &l, l.per_tx_usd_micro, T, true)), "ok");
    }
    #[test] fn calls_up_to_the_minute_limit_pass_and_the_next_is_refused() {
        let mut s = Mem::default(); let l = lim();
        for _ in 0..l.per_minute_calls { rate_limit(&mut s, "a.near", &l, T).unwrap(); }
        assert_eq!(code(rate_limit(&mut s, "a.near", &l, T)), "rate_limited");
    }
    #[test] fn the_next_minute_opens_again() {
        let mut s = Mem::default(); let l = lim();
        for _ in 0..l.per_minute_calls { rate_limit(&mut s, "a.near", &l, T).unwrap(); }
        assert_eq!(code(rate_limit(&mut s, "a.near", &l, (T / 60_000 + 1) * 60_000)), "ok");
    }
    #[test] fn one_holder_at_the_limit_does_not_block_another() {
        let mut s = Mem::default(); let l = lim();
        for _ in 0..l.per_minute_calls { rate_limit(&mut s, "a.near", &l, T).unwrap(); }
        assert_eq!(code(rate_limit(&mut s, "b.near", &l, T)), "ok");
    }
    #[test] fn a_refused_call_does_not_use_up_the_next_minute() {
        let mut s = Mem::default(); let l = lim();
        for _ in 0..l.per_minute_calls + 3 { let _ = rate_limit(&mut s, "a.near", &l, T); }
        assert_eq!(s.incr(&hkey("a.near", &format!("rl/{}", T / 60_000)), 0).unwrap(), l.per_minute_calls);
    }
} } }
caps_for_tier!(caps_bronze, 1);
caps_for_tier!(caps_silver, 2);
caps_for_tier!(caps_gold, 3);

#[test] fn tier_0_has_no_limits() { assert!(limits_for_tier(0).is_none()); }
#[test] fn tier_4_has_no_limits() { assert!(limits_for_tier(4).is_none()); }
#[test] fn tiers_grow_tenfold() {
    let (a, b, c) = (limits_for_tier(1).unwrap(), limits_for_tier(2).unwrap(), limits_for_tier(3).unwrap());
    assert_eq!((b.per_tx_usd_micro / a.per_tx_usd_micro, c.daily_usd_micro / b.daily_usd_micro), (10, 10));
}
#[test] fn every_tier_keeps_per_trade_under_per_day() {
    for t in 1..=3 { let l = limits_for_tier(t).unwrap(); assert!(l.per_tx_usd_micro <= l.daily_usd_micro); }
}
#[test] fn service_wide_minute_limit_says_busy() {
    let mut s = Mem::default(); let l = limits_for_tier(3).unwrap();
    for i in 0..GLOBAL_PER_MINUTE { rate_limit(&mut s, &format!("u{i}.near"), &l, NOW).unwrap(); }
    assert_eq!(code(rate_limit(&mut s, "late.near", &l, NOW)), "busy");
}

// ---------- holder limits (cut now, raise after 24 h) ----------
fn b() -> Limits { limits_for_tier(1).unwrap() }
fn pol(pt: u64, d: u64) -> HolderPolicy { HolderPolicy { owner: "a.near".into(), per_tx_usd_micro: pt, daily_usd_micro: d, pending: None } }
macro_rules! policy_refused { ($($n:ident: $pt:expr, $d:expr;)*) => { $( #[test] fn $n() { assert_eq!(code(set_policy(b(), None, "a.near", $pt, $d, NOW)), "bad_params"); } )* } }
policy_refused! {
    limits_zero_per_trade_refused: 0, 1_000_000;
    limits_zero_per_day_refused: 1, 0;
    limits_per_trade_above_per_day_refused: 2_000, 1_000;
    limits_per_trade_above_tier_refused: 1_000_001, 5_000_000;
    limits_per_day_above_tier_refused: 1_000_000, 5_000_001;
}
#[test] fn limits_cut_applies_at_once() {
    let p = set_policy(b(), Some(&pol(1_000_000, 5_000_000)), "a.near", 100_000, 200_000, NOW).unwrap();
    assert_eq!((p.per_tx_usd_micro, p.daily_usd_micro, p.pending), (100_000, 200_000, None));
}
#[test] fn limits_same_values_apply_at_once() {
    assert!(set_policy(b(), Some(&pol(100_000, 200_000)), "a.near", 100_000, 200_000, NOW).unwrap().pending.is_none());
}
#[test] fn limits_raise_waits_a_day_and_keeps_current_caps() {
    let p = set_policy(b(), Some(&pol(100_000, 200_000)), "a.near", 500_000, 900_000, NOW).unwrap();
    assert_eq!((p.per_tx_usd_micro, p.daily_usd_micro), (100_000, 200_000));
    assert_eq!(p.pending.unwrap().effective_ms, NOW + RAISE_DELAY_MS);
}
#[test] fn limits_raise_is_not_in_force_one_ms_early() {
    let p = set_policy(b(), Some(&pol(100_000, 200_000)), "a.near", 500_000, 900_000, NOW).unwrap();
    assert_eq!(effective_limits(b(), Some(&p), NOW + RAISE_DELAY_MS - 1).per_tx_usd_micro, 100_000);
}
#[test] fn limits_raise_is_in_force_on_time() {
    let p = set_policy(b(), Some(&pol(100_000, 200_000)), "a.near", 500_000, 900_000, NOW).unwrap();
    let e = effective_limits(b(), Some(&p), NOW + RAISE_DELAY_MS);
    assert_eq!((e.per_tx_usd_micro, e.daily_usd_micro), (500_000, 900_000));
}
#[test] fn limits_cut_cancels_a_pending_raise() {
    let raised = set_policy(b(), Some(&pol(100_000, 200_000)), "a.near", 500_000, 900_000, NOW).unwrap();
    let cut = set_policy(b(), Some(&raised), "a.near", 50_000, 100_000, NOW + 1).unwrap();
    assert!(cut.pending.is_none());
    assert_eq!(effective_limits(b(), Some(&cut), NOW + RAISE_DELAY_MS * 2).per_tx_usd_micro, 50_000);
}
#[test] fn limits_never_exceed_the_tier_even_if_stored_higher() {
    let e = effective_limits(b(), Some(&pol(9_000_000, 90_000_000)), NOW);
    assert_eq!((e.per_tx_usd_micro, e.daily_usd_micro), (1_000_000, 5_000_000));
}
#[test] fn limits_keep_the_tier_minute_rate() { assert_eq!(effective_limits(b(), Some(&pol(1, 1)), NOW).per_minute_calls, 6); }
#[test] fn limits_of_a_previous_owner_do_not_bind_the_buyer() {
    let raw = serde_json::to_vec(&pol(1, 1)).unwrap();
    assert!(policy_for(&raw, "buyer.near").is_none());
    assert!(policy_for(&raw, "a.near").is_some());
}
#[test] fn limits_garbage_storage_reads_as_no_policy() { assert!(policy_for(b"not json", "a.near").is_none()); }

// ---------- sale lock ----------
macro_rules! lock { ($($n:ident: $raw:expr, $who:expr, $now:expr => $want:expr;)*) => { $( #[test] fn $n() { assert_eq!(active_lock($raw.as_bytes(), $who, $now), $want); } )* } }
lock! {
    lock_runs_for_its_owner: lock_value("a.near", 1_000), "a.near", 999 => Some(1_000);
    lock_ends_on_time: lock_value("a.near", 1_000), "a.near", 1_000 => None;
    lock_does_not_bind_the_next_owner: lock_value("a.near", 1_000), "b.near", 1 => None;
    lock_empty_storage_is_unlocked: String::new(), "a.near", 1 => None;
    lock_without_separator_is_unlocked: "a.near".to_string(), "a.near", 1 => None;
    lock_non_numeric_until_is_unlocked: "a.near|soon".to_string(), "a.near", 1 => None;
}
#[test] fn lock_refusal_code_is_locked() { assert_eq!(code(assert_unlocked(lock_value("a.near", 10).as_bytes(), "a.near", 5)), "locked"); }
#[test] fn lock_after_expiry_allows_moves() { assert_eq!(code(assert_unlocked(lock_value("a.near", 10).as_bytes(), "a.near", 10)), "ok"); }

// ---------- dollar amounts ----------
macro_rules! usd { ($($n:ident: $s:expr => $want:expr;)*) => { $( #[test] fn $n() { assert_eq!(parse_usd_micro($s), $want); } )* } }
usd! {
    usd_whole_dollar: "1" => Some(1_000_000);
    usd_half: "0.5" => Some(500_000);
    usd_six_decimals: "1.234567" => Some(1_234_567);
    usd_seventh_decimal_truncated: "1.2345678" => Some(1_234_567);
    usd_trailing_dot: "3." => Some(3_000_000);
    usd_letters_refused: "abc" => None;
    usd_letters_in_fraction_refused: "1.2a" => None;
    usd_empty_refused: "" => None;
    usd_missing_integer_refused: ".5" => None;
    usd_negative_refused: "-1" => None;
    usd_overflow_refused: "18446744073710" => None;
}
macro_rules! fmt { ($($n:ident: $m:expr => $want:expr;)*) => { $( #[test] fn $n() { assert_eq!(fmt_usd($m), $want); } )* } }
fmt! {
    fmt_zero: 0 => "0.00";
    fmt_one_dollar: 1_000_000 => "1.00";
    fmt_cents: 1_230_000 => "1.23";
    fmt_sub_cent_four_places: 1_234_500 => "1.2345";
    fmt_tenth_of_a_cent: 1_000 => "0.0010";
    fmt_smallest_four_place: 100 => "0.0001";
    fmt_below_four_places_shows_six: 99 => "0.000099";
    fmt_one_micro: 1 => "0.000001";
}

// ---------- who can be paid, who can mint ----------
#[test] fn withdraw_to_other_near_account_ok() { assert_eq!(code(assert_withdraw_to("near", "b.near")), "ok"); }
#[test] fn withdraw_to_case_variant_refused() { assert_eq!(code(assert_withdraw_to("near", "A.near")), "bad_params"); }
#[test] fn withdraw_to_empty_refused() { assert_eq!(code(assert_withdraw_to("near", "")), "bad_params"); }
#[test] fn withdraw_to_unknown_chain_refused() { assert_eq!(code(assert_withdraw_to("doge", "b.near")), "bad_params"); }
#[test] fn withdraw_to_checksummed_evm_address_on_near_refused() { assert_eq!(code(assert_withdraw_to("near", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")), "bad_params"); }
#[test] fn minter_exact_minimum_can_mint() { assert!(minter_can_mint(MINT_DEPOSIT_YOCTO + MINT_FEE_BUFFER_YOCTO)); }
#[test] fn minter_one_yocto_short_cannot_mint() { assert!(!minter_can_mint(MINT_DEPOSIT_YOCTO + MINT_FEE_BUFFER_YOCTO - 1)); }
#[test] fn minter_empty_cannot_mint() { assert!(!minter_can_mint(0)); }
#[test] fn mint_id_taken_is_already_minted() { assert_eq!(code(assert_mint_id_free(Some("x.near"))), "already_minted"); }
#[test] fn mint_id_free_is_ok() { assert_eq!(code(assert_mint_id_free(None)), "ok"); }

// ---------- order of refusals ----------
#[test] fn admit_expired_is_reported_before_not_owner() { assert_eq!(code(admit_request("a", "b", false, false)), "expired"); }
#[test] fn admit_not_owner_is_reported_before_replay() { assert_eq!(code(admit_request("a", "b", true, false)), "not_owner"); }
#[test] fn admit_replay_for_the_owner() { assert_eq!(code(admit_request("a", "a", true, false)), "replay"); }
#[test] fn admit_all_good() { assert_eq!(code(admit_request("a", "a", true, true)), "ok"); }
#[test] fn settle_after_transfer_is_refused() { assert_ne!(code(settle_if_owner(false)), "ok"); }
#[test] fn owner_is_needs_an_exact_match() {
    assert!(owner_is(Some("a.near"), "a.near"));
    assert!(!owner_is(Some("a.near"), "b.near"));
    assert!(!owner_is(None, "a.near"));
}

// ---------- ids and storage namespaces ----------
#[test] fn token_id_shape() { let t = token_id_for("alice.near"); assert_eq!(t.len(), 17); assert!(t.starts_with('k') && t[1..].chars().all(|c| c.is_ascii_hexdigit())); }
#[test] fn token_id_is_stable() { assert_eq!(token_id_for("alice.near"), token_id_for("alice.near")); }
#[test] fn token_id_differs_per_account() { assert_ne!(token_id_for("alice.near"), token_id_for("alice.near.x")); }
#[test] fn key_and_holder_namespaces_cannot_collide() {
    assert_ne!(hkey(&cap_id("k1"), "spent/1"), hkey("k1", "spent/1"));
    assert!(!is_valid_account_id(&cap_id("k1")));
    assert!(tkey("k1", "lock").starts_with("t/") && hkey("k1", "lock").starts_with("h/"));
}
#[test] fn nonce_store_is_per_account() {
    let mut s = Mem::default();
    consume_nonce(&mut s, "a.near", &[1; 32], 0).unwrap();
    assert_eq!(code(consume_nonce(&mut s, "b.near", &[1; 32], 0)), "ok");
    assert_eq!(code(consume_nonce(&mut s, "a.near", &[1; 32], 0)), "replay");
}

// ---------- NEP-413 tamper vectors (each field the wallet signs) ----------
fn sign(msg: &str, nonce: [u8; 32], rcp: &str, cb: Option<&str>) -> Auth {
    let k = SigningKey::from_bytes(&[5; 32]);
    let h = Sha256::digest(nep413_bytes(msg, &nonce, rcp, cb));
    Auth { account_id: "alice.near".into(), public_key: format!("ed25519:{}", bs58::encode(k.verifying_key().to_bytes()).into_string()),
        signature: B64.encode(k.sign(&h).to_bytes()), nonce: B64.encode(nonce), message: msg.into(), recipient: rcp.into(),
        callback_url: cb.map(String::from), scheme: String::new(), address: String::new() }
}
const M: &str = r#"{"op":"swap","account_id":"alice.near","ts_ms":1,"params":{}}"#;
fn v(a: &Auth) -> &'static str { code(verify_nep413(a, "keyhole")) }
#[test] fn nep413_untouched_passes() { assert_eq!(v(&sign(M, [3; 32], "keyhole", None)), "ok"); }
#[test] fn nep413_other_nonce_than_signed() { let mut a = sign(M, [3; 32], "keyhole", None); a.nonce = B64.encode([4u8; 32]); assert_eq!(v(&a), "bad_signature"); }
#[test] fn nep413_callback_added_after_signing() { let mut a = sign(M, [3; 32], "keyhole", None); a.callback_url = Some("https://x".into()); assert_eq!(v(&a), "bad_signature"); }
#[test] fn nep413_signed_with_callback_verifies_with_it() { assert_eq!(v(&sign(M, [3; 32], "keyhole", Some("https://x"))), "ok"); }
#[test] fn nep413_one_signature_bit_flipped() { let mut a = sign(M, [3; 32], "keyhole", None); let mut s = B64.decode(&a.signature).unwrap(); s[10] ^= 1; a.signature = B64.encode(s); assert_eq!(v(&a), "bad_signature"); }
#[test] fn nep413_short_signature() { let mut a = sign(M, [3; 32], "keyhole", None); a.signature = B64.encode([0u8; 63]); assert_eq!(v(&a), "bad_signature"); }
#[test] fn nep413_signature_not_base64() { let mut a = sign(M, [3; 32], "keyhole", None); a.signature = "***".into(); assert_eq!(v(&a), "bad_signature"); }
#[test] fn nep413_public_key_not_base58() { let mut a = sign(M, [3; 32], "keyhole", None); a.public_key = "ed25519:0OIl".into(); assert_eq!(v(&a), "bad_public_key"); }
#[test] fn nep413_public_key_31_bytes() { let mut a = sign(M, [3; 32], "keyhole", None); a.public_key = format!("ed25519:{}", bs58::encode([1u8; 31]).into_string()); assert_eq!(v(&a), "bad_public_key"); }
#[test] fn nep413_signed_text_not_json() { assert_eq!(v(&sign("hello", [3; 32], "keyhole", None)), "bad_message"); }
#[test] fn nep413_signed_json_missing_ts() { assert_eq!(v(&sign(r#"{"op":"swap","account_id":"alice.near"}"#, [3; 32], "keyhole", None)), "bad_message"); }
#[test] fn nep413_signed_for_another_account() { assert_eq!(v(&sign(r#"{"op":"swap","account_id":"bob.near","ts_ms":1}"#, [3; 32], "keyhole", None)), "account_mismatch"); }
#[test] fn nep413_signed_for_another_app() { let a = sign(M, [3; 32], "other-app", None); assert_eq!(v(&a), "wrong_recipient"); }
#[test] fn nep413_recipient_relabelled_after_signing() { let mut a = sign(M, [3; 32], "other-app", None); a.recipient = "keyhole".into(); assert_eq!(v(&a), "bad_signature"); }
#[test] fn nep413_op_comes_from_the_signed_text() { let (r, _) = verify_nep413(&sign(M, [3; 32], "keyhole", None), "keyhole").unwrap(); assert_eq!(r.op, "swap"); }
