use super::*;
use ed25519_dalek::{Signer, SigningKey};
use std::collections::HashMap;

#[derive(Default)]
struct Mem(HashMap<String, Vec<u8>>);
impl Store for Mem {
    fn set_if_absent(&mut self, k: &str, v: &[u8]) -> Result<bool, Error> {
        if self.0.contains_key(k) { return Ok(false); }
        self.0.insert(k.into(), v.to_vec());
        Ok(true)
    }
    fn incr(&mut self, k: &str, d: i64) -> Result<i64, Error> {
        let cur: i64 = self.0.get(k).map(|b| String::from_utf8_lossy(b).parse().unwrap()).unwrap_or(0);
        self.0.insert(k.into(), (cur + d).to_string().into_bytes());
        Ok(cur + d)
    }
}

const RCP: &str = "keyhole";
fn sk(seed: u8) -> SigningKey { SigningKey::from_bytes(&[seed; 32]) }
fn signed(seed: u8, account: &str, msg: &str, nonce: [u8; 32], recipient: &str) -> Auth {
    let k = sk(seed);
    let h = Sha256::digest(nep413_bytes(msg, &nonce, recipient, None));
    Auth {
        account_id: account.into(),
        public_key: format!("ed25519:{}", bs58::encode(k.verifying_key().to_bytes()).into_string()),
        signature: B64.encode(k.sign(&h).to_bytes()),
        nonce: B64.encode(nonce),
        message: msg.into(),
        recipient: recipient.into(),
        callback_url: None,
    }
}
fn msg(acct: &str) -> String { format!(r#"{{"op":"quote","account_id":"{}","ts_ms":1000,"params":{{}}}}"#, acct) }

#[test]
fn tag_value() { assert_eq!(NEP413_TAG, (1u32 << 31) + 413); }

#[test]
fn payload_layout() {
    let b = nep413_bytes("hi", &[7; 32], "app", None);
    assert_eq!(&b[0..4], &2147484061u32.to_le_bytes());
    assert_eq!(&b[4..8], &2u32.to_le_bytes());
    assert_eq!(&b[8..10], b"hi");
    assert_eq!(&b[10..42], &[7u8; 32]);
    assert_eq!(&b[42..46], &3u32.to_le_bytes());
    assert_eq!(&b[46..49], b"app");
    assert_eq!(b[49], 0);
    assert_eq!(b.len(), 50);
}

#[test]
fn valid_signature_passes() {
    let a = signed(1, "alice.near", &msg("alice.near"), [9; 32], RCP);
    let (r, n) = verify_nep413(&a, RCP).unwrap();
    assert_eq!(r.op, "quote");
    assert_eq!(n, [9; 32]);
}

#[test]
fn tampered_message_fails() {
    let mut a = signed(1, "alice.near", &msg("alice.near"), [9; 32], RCP);
    a.message = msg("alice.near").replace("quote", "mintx");
    assert_eq!(verify_nep413(&a, RCP).unwrap_err().code, "bad_signature");
}

#[test]
fn other_key_fails() {
    let mut a = signed(1, "alice.near", &msg("alice.near"), [9; 32], RCP);
    a.public_key = signed(2, "x.near", "x", [0; 32], RCP).public_key;
    assert_eq!(verify_nep413(&a, RCP).unwrap_err().code, "bad_signature");
}

#[test]
fn wrong_recipient_fails() {
    // signature made for another app must not be accepted (phishing replay across apps)
    let a = signed(1, "alice.near", &msg("alice.near"), [9; 32], "evil-app");
    assert_eq!(verify_nep413(&a, RCP).unwrap_err().code, "wrong_recipient");
    let mut b = a.clone();
    b.recipient = RCP.into(); // relabel: signature no longer matches
    assert_eq!(verify_nep413(&b, RCP).unwrap_err().code, "bad_signature");
}

#[test]
fn account_mismatch_fails() {
    // bob signs a message naming alice
    let a = signed(1, "bob.near", &msg("alice.near"), [9; 32], RCP);
    assert_eq!(verify_nep413(&a, RCP).unwrap_err().code, "account_mismatch");
}

#[test]
fn bad_inputs_have_clear_codes() {
    let mut a = signed(1, "alice.near", &msg("alice.near"), [9; 32], RCP);
    a.nonce = B64.encode([1u8; 16]);
    assert_eq!(verify_nep413(&a, RCP).unwrap_err().code, "bad_nonce");
    let mut b = signed(1, "Alice.near", &msg("Alice.near"), [9; 32], RCP);
    assert_eq!(verify_nep413(&b, RCP).unwrap_err().code, "bad_account");
    b.account_id = "alice.near".into();
    b.public_key = "secp256k1:abc".into();
    assert_eq!(verify_nep413(&b, RCP).unwrap_err().code, "bad_public_key");
}

#[test]
fn replay_rejected() {
    let mut st = Mem::default();
    consume_nonce(&mut st, "alice.near", &[5; 32], 1).unwrap();
    assert_eq!(consume_nonce(&mut st, "alice.near", &[5; 32], 2).unwrap_err().code, "replay");
    // same nonce for a different holder is a different record (isolation)
    consume_nonce(&mut st, "bob.near", &[5; 32], 3).unwrap();
}

#[test]
fn freshness_window() {
    let now = 10_000_000;
    check_freshness(now, now).unwrap();
    check_freshness(now - MAX_SKEW_MS, now).unwrap();
    assert_eq!(check_freshness(now - MAX_SKEW_MS - 1, now).unwrap_err().code, "expired");
    assert_eq!(check_freshness(now + MAX_SKEW_MS + 1, now).unwrap_err().code, "expired");
}

#[test]
fn over_cap_per_tx_refused() {
    let mut st = Mem::default();
    let l = limits_for_tier(1).unwrap();
    let e = enforce_caps(&mut st, "alice.near", &l, 1_000_001, 0, true).unwrap_err();
    assert_eq!(e.code, "over_cap_per_tx");
    assert!(e.message.contains("$1.00"));
    enforce_caps(&mut st, "alice.near", &l, 1_000_000, 0, true).unwrap();
}

#[test]
fn over_cap_daily_refused_and_rolled_back() {
    let mut st = Mem::default();
    let l = limits_for_tier(1).unwrap();
    for _ in 0..5 { enforce_caps(&mut st, "alice.near", &l, 1_000_000, 0, true).unwrap(); }
    assert_eq!(enforce_caps(&mut st, "alice.near", &l, 1, 0, true).unwrap_err().code, "over_cap_daily");
    assert_eq!(st.incr(&hkey("alice.near", "spent/0"), 0).unwrap(), 5_000_000); // rollback kept total exact
    // dry check does not spend
    assert_eq!(enforce_caps(&mut st, "alice.near", &l, 1, 0, false).unwrap_err().code, "over_cap_daily");
    // other holder unaffected; next UTC day resets
    enforce_caps(&mut st, "bob.near", &l, 1_000_000, 0, true).unwrap();
    enforce_caps(&mut st, "alice.near", &l, 1_000_000, 86_400_000, true).unwrap();
}

#[test]
fn rate_limit_per_holder() {
    let mut st = Mem::default();
    let l = limits_for_tier(1).unwrap();
    for _ in 0..6 { rate_limit(&mut st, "alice.near", &l, 0).unwrap(); }
    assert_eq!(rate_limit(&mut st, "alice.near", &l, 0).unwrap_err().code, "rate_limited");
    rate_limit(&mut st, "bob.near", &l, 0).unwrap();
    rate_limit(&mut st, "alice.near", &l, 60_000).unwrap();
}

#[test]
fn global_rate_limit() {
    let mut st = Mem::default();
    let l = limits_for_tier(3).unwrap();
    let mut ok = 0;
    for i in 0..200 { if rate_limit(&mut st, &format!("u{}.near", i), &l, 0).is_ok() { ok += 1; } }
    assert_eq!(ok, GLOBAL_PER_MINUTE);
}

#[test]
fn tiers_and_usd_parsing() {
    assert!(limits_for_tier(0).is_none() && limits_for_tier(4).is_none());
    assert_eq!(parse_usd_micro("0.049974300000"), Some(49_974));
    assert_eq!(parse_usd_micro("12"), Some(12_000_000));
    assert_eq!(parse_usd_micro("-1"), None);
    assert_eq!(parse_usd_micro("1.2x"), None);
    assert_eq!(fmt_usd(49_974), "0.04");
}

#[test]
fn account_ids() {
    for ok in ["alice.near", "a1", "sub.alice.near", "e662b78b0000000000000000000000000000000000000000000000000000abcd"] { assert!(is_valid_account_id(ok), "{}", ok); }
    for bad in ["A.near", "a", ".a", "a..b", "a/b", "h/x"] { assert!(!is_valid_account_id(bad), "{}", bad); }
    assert_eq!(token_id_for("alice.near").len(), 17);
}
