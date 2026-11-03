//! Scoped beat key: byte-exact AddKey/DeleteKey encoding (golden vectors from near-api-js) and the op guards.
use crate::*;

const ADD: &str = "060000006d2e6e6561720001010101010101010101010101010101010101010101010101010101010101010500000000000000060000006d2e6e65617209090909090909090909090909090909090909090909090909090909090909090100000005000707070707070707070707070707070707070707070707070707070707070707000000000000000000010000407ba5f06381960a000000000000120000006b6579686f6c652d6465766d6f2e6e656172010000000400000062656174";
const DEL: &str = "060000006d2e6e6561720001010101010101010101010101010101010101010101010101010101010101010500000000000000060000006d2e6e65617209090909090909090909090909090909090909090909090909090909090909090100000006000707070707070707070707070707070707070707070707070707070707070707";
fn tx(a: Action) -> String { hex::encode(encode_tx("m.near", &[1; 32], 5, "m.near", &[9; 32], &[a])) }
fn b58(k: [u8; 32]) -> String { format!("ed25519:{}", bs58::encode(k).into_string()) }

#[test] fn add_key_matches_near_api_js_bytes() {
    assert_eq!(tx(Action::AddFcKey { pk: [7; 32], allowance: BEAT_KEY_ALLOWANCE_YOCTO, receiver: "keyhole-devmo.near", methods: &BEAT_KEY_METHODS }), ADD);
}
#[test] fn delete_key_matches_near_api_js_bytes() { assert_eq!(tx(Action::DeleteKey { pk: [7; 32] }), DEL); }
#[test] fn scope_is_exactly_beat_with_005_near() {
    assert_eq!(BEAT_KEY_METHODS, ["beat"]);
    assert_eq!(BEAT_KEY_ALLOWANCE_YOCTO, 5 * 10u128.pow(22));
}
#[test] fn allowance_is_some_not_unlimited() {
    // Option tag 1 (Some) right after the FunctionCall permission tag; None (0) would mean unlimited gas spend.
    let h = hex::decode(tx(Action::AddFcKey { pk: [7; 32], allowance: 1234, receiver: "r.near", methods: &["beat"] })).unwrap();
    let at = h.windows(32).position(|w| w == [7u8; 32]).unwrap() + 32 + 8 + 1;
    assert_eq!(h[at], 1);
    assert_eq!(&h[at + 1..at + 17], &1234u128.to_le_bytes());
}
#[test] fn add_key_is_never_full_access() {
    let h = hex::decode(tx(Action::AddFcKey { pk: [7; 32], allowance: 1, receiver: "r.near", methods: &["beat"] })).unwrap();
    let at = h.windows(32).position(|w| w == [7u8; 32]).unwrap() + 32 + 8; // after pk and access-key nonce
    assert_eq!(h[at], 0, "permission must be FunctionCall (0), not FullAccess (1)");
}
#[test] fn only_the_owner_manages_the_key() {
    assert!(assert_owner("keyhole-devmo.near", "keyhole-devmo.near").is_ok());
    for who in ["attacker.near", "keyhole-devmo.near.evil", "KEYHOLE-DEVMO.NEAR", "", "015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443"] {
        assert_eq!(assert_owner(who, "keyhole-devmo.near").unwrap_err().code, "not_owner", "{who}");
    }
}
#[test] fn parses_a_valid_ed25519_key() { assert_eq!(parse_beat_key(&b58([7; 32]), &[1; 32]).unwrap(), [7; 32]); }
#[test] fn refuses_the_minters_own_key() {
    assert_eq!(parse_beat_key(&b58([1; 32]), &[1; 32]).unwrap_err().code, "bad_public_key");
}
#[test] fn refuses_malformed_keys() {
    let short = format!("ed25519:{}", bs58::encode([7u8; 31]).into_string());
    let long = format!("ed25519:{}", bs58::encode([7u8; 33]).into_string());
    let secp = format!("secp256k1:{}", bs58::encode([7u8; 64]).into_string());
    for k in [String::new(), "ed25519:".into(), "ed25519:0OIl".into(), short, long, secp, bs58::encode([7u8; 32]).into_string()] {
        assert_eq!(parse_beat_key(&k, &[1; 32]).unwrap_err().code, "bad_public_key", "{k}");
    }
}
