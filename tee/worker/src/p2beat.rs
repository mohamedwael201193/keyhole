//! P2 beat-key matrix: owner check and public-key parsing, one row per input.
use super::*;

fn b58(bytes: &[u8]) -> String { format!("ed25519:{}", bs58::encode(bytes).into_string()) }
const MINTER: [u8; 32] = [7u8; 32];

macro_rules! owner_rows { ($($name:ident: $signer:expr, $owner:expr => $ok:expr;)*) => { $(#[test] fn $name() { assert_eq!(assert_owner($signer, $owner).is_ok(), $ok); })* } }
owner_rows! {
    owner_same: "keyhole-devmo.near", "keyhole-devmo.near" => true;
    owner_other: "a.near", "keyhole-devmo.near" => false;
    owner_case: "KEYHOLE-devmo.near", "keyhole-devmo.near" => false;
    owner_suffix: "x.keyhole-devmo.near", "keyhole-devmo.near" => false;
    owner_prefix: "keyhole-devmo.nea", "keyhole-devmo.near" => false;
    owner_space: "keyhole-devmo.near ", "keyhole-devmo.near" => false;
    owner_empty: "", "keyhole-devmo.near" => false;
    owner_minter_implicit: "015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443", "keyhole-devmo.near" => false;
    owner_evm: "0xf76e6b0920e9332ff4410f6dd53f01722abc71a3", "keyhole-devmo.near" => false;
}

macro_rules! key_rows { ($($name:ident: $s:expr => $ok:expr;)*) => { $(#[test] fn $name() { assert_eq!(parse_beat_key(&$s, &MINTER).is_ok(), $ok, "{}", $s); })* } }
key_rows! {
    key_valid_ones: b58(&[1u8; 32]) => true;
    key_valid_zero: b58(&[0u8; 32]) => true;
    key_valid_ff: b58(&[0xffu8; 32]) => true;
    key_minter_refused: b58(&MINTER) => false;
    key_31_bytes: b58(&[1u8; 31]) => false;
    key_33_bytes: b58(&[1u8; 33]) => false;
    key_64_bytes: b58(&[1u8; 64]) => false;
    key_empty_body: "ed25519:".to_string() => false;
    key_no_prefix: bs58::encode([1u8; 32]).into_string() => false;
    key_secp_prefix: format!("secp256k1:{}", bs58::encode([1u8; 64]).into_string()) => false;
    key_upper_prefix: format!("ED25519:{}", bs58::encode([1u8; 32]).into_string()) => false;
    key_bad_char_0: "ed25519:0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl".to_string() => false;
    key_space: format!("ed25519: {}", bs58::encode([1u8; 32]).into_string()) => false;
    key_trailing_space: format!("{} ", b58(&[1u8; 32])) => false;
    key_hex_body: format!("ed25519:{}", "01".repeat(32)) => false;
    key_empty: String::new() => false;
}

#[test] fn parsed_key_round_trips() { let k = [9u8; 32]; assert_eq!(parse_beat_key(&b58(&k), &MINTER).unwrap(), k); }
#[test] fn minter_refusal_code_is_bad_public_key() { assert_eq!(parse_beat_key(&b58(&MINTER), &MINTER).unwrap_err().code, "bad_public_key"); }
#[test] fn not_owner_code() { assert_eq!(assert_owner("a.near", "b.near").unwrap_err().code, "not_owner"); }
#[test] fn every_distinct_key_parses_distinctly() {
    let a = parse_beat_key(&b58(&[1u8; 32]), &MINTER).unwrap();
    let b = parse_beat_key(&b58(&[2u8; 32]), &MINTER).unwrap();
    assert_ne!(a, b);
}
