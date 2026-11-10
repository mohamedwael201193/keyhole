//! P2 forced failures: malformed or out-of-window inputs must be refused, never defaulted.
use super::*;

macro_rules! usd_rows { ($($name:ident: $s:expr => $want:expr;)*) => { $(#[test] fn $name() { assert_eq!(parse_usd_micro($s), $want, "{:?}", $s); })* } }
usd_rows! {
    usd_int: "1" => Some(1_000_000);
    usd_cents: "0.99" => Some(990_000);
    usd_micro: "0.000001" => Some(1);
    usd_truncates_7th: "0.0000019" => Some(1);
    usd_trailing_dot: "5." => Some(5_000_000);
    usd_big: "123456.789" => Some(123_456_789_000);
    usd_empty: "" => None;
    usd_dot_only: "." => None;
    usd_leading_dot: ".5" => None;
    usd_plus: "+1" => None;
    usd_minus: "-1" => None;
    usd_space: " 1" => None;
    usd_trailing_space: "1 " => None;
    usd_junk_after_6: "0.1234567x" => None;
    usd_letter_frac: "1.5a" => None;
    usd_two_dots: "1.2.3" => None;
    usd_exp: "1e3" => None;
    usd_comma: "1,5" => None;
    usd_nan: "NaN" => None;
    usd_overflow: "18446744073710" => None;
    usd_unicode_digit: "\u{0661}" => None;
}

macro_rules! fresh_rows { ($($name:ident: $ts:expr, $now:expr => $ok:expr;)*) => { $(#[test] fn $name() { assert_eq!(check_freshness($ts, $now).is_ok(), $ok); })* } }
const N: u64 = 1_800_000_000_000;
fresh_rows! {
    fresh_now: N, N => true;
    fresh_old_edge: N - MAX_SKEW_MS, N => true;
    fresh_too_old: N - MAX_SKEW_MS - 1, N => false;
    fresh_future_edge: N + MAX_SKEW_MS, N => true;
    fresh_too_future: N + MAX_SKEW_MS + 1, N => false;
    fresh_zero: 0, N => false;
    fresh_day_old: N - 86_400_000, N => false;
}
#[test] fn expired_code() { assert_eq!(check_freshness(0, N).unwrap_err().code, "expired"); }

macro_rules! to_rows { ($($name:ident: $chain:expr, $to:expr => $ok:expr;)*) => { $(#[test] fn $name() { assert_eq!(validate_chain_address($chain, $to).is_ok(), $ok, "{} {:?}", $chain, $to); })* } }
to_rows! {
    near_self: "near", "a.near" => true;
    near_other: "near", "b.near" => true;
    near_sub: "near", "x.a.near" => true;
    near_implicit: "near", "015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443" => true;
    near_case: "near", "A.near" => false;
    near_space: "near", "a.near " => false;
    near_empty: "near", "" => false;
    near_bad_edge: "near", ".a.near" => false;
    evm_checksum: "base", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" => true;
    evm_lower: "eth", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" => true;
    evm_upper: "avax", "0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED" => true;
    evm_bad_checksum: "arb", "0x5aaEb6053F3E94C9b9A09f33669435E7Ef1BeAed" => false;
    evm_short: "op", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1bea" => false;
    evm_no_prefix: "pol", "5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" => false;
    evm_non_hex: "bsc", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaeg" => false;
    evm_near_name: "gnosis", "alice.near" => false;
    sol_system: "sol", "11111111111111111111111111111111" => true;
    sol_short: "sol", "1111" => false;
    sol_bad_char: "sol", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl" => false;
    sol_evm_address: "sol", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" => false;
    unknown_chain: "doge", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" => false;
    chain_is_exact: "BASE", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" => false;
}

#[test] fn tiers_outside_1_3_have_no_limits() { for t in [0u8, 4, 9, 255] { assert!(limits_for_tier(t).is_none(), "{t}"); } }
