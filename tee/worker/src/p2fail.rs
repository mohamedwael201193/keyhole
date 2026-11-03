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

macro_rules! to_rows { ($($name:ident: $signer:expr, $to:expr => $ok:expr;)*) => { $(#[test] fn $name() { assert_eq!(assert_withdraw_to($signer, $to).is_ok(), $ok); })* } }
to_rows! {
    to_self: "a.near", "a.near" => true;
    to_other: "a.near", "b.near" => false;
    to_case: "a.near", "A.near" => false;
    to_space: "a.near", "a.near " => false;
    to_sub: "a.near", "x.a.near" => false;
    to_empty: "a.near", "" => false;
    to_treasury: "a.near", "keyhole-devmo.near" => false;
}

#[test] fn tiers_outside_1_3_have_no_limits() { for t in [0u8, 4, 9, 255] { assert!(limits_for_tier(t).is_none(), "{t}"); } }
