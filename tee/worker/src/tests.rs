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
        scheme: String::new(),
        address: String::new(),
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
fn policy_table_refuses_over_cap_locally() {
    let table = [
        (1u8, 1_000_000u64, 5_000_000u64, 6i64),
        (2, 10_000_000, 50_000_000, 12),
        (3, 100_000_000, 500_000_000, 30),
    ];
    for (tier, per_tx, daily, per_min) in table {
        let l = limits_for_tier(tier).unwrap();
        assert_eq!((l.per_tx_usd_micro, l.daily_usd_micro, l.per_minute_calls), (per_tx, daily, per_min));
        let mut st = Mem::default();
        assert_eq!(enforce_caps(&mut st, "alice.near", &l, per_tx + 1, 0, true).unwrap_err().code, "over_cap_per_tx");
        assert_eq!(st.incr(&hkey("alice.near", "spent/0"), 0).unwrap(), 0);
    }
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

#[test]
fn tx_encoding_matches_near_api_js() {
    // reference bytes produced by near-api-js transactions.createTransaction(...).encode()
    let want = "0a000000616c6963652e6e6561720007070707070707070707070707070707070707070707070707070707070707077b00000000000000090000006b6579732e6e65617209090909090909090909090909090909090909090909090909090909090909090200000002080000006e66745f6d696e74070000007b2261223a317d00e057eb481b0000000040b2bac9e0191e020000000000000305000000000000000000000000000000";
    let got = encode_tx("alice.near", &[7; 32], 123, "keys.near", &[9; 32], &[
        Action::FunctionCall { method: "nft_mint", args: br#"{"a":1}"#, gas: 30_000_000_000_000, deposit: 10_000_000_000_000_000_000_000 },
        Action::Transfer { deposit: 5 },
    ]);
    assert_eq!(hex::encode(got), want);
}

#[test]
fn signed_tx_verifies() {
    use ed25519_dalek::Verifier;
    let tx = encode_tx("a.near", &sk(3).verifying_key().to_bytes(), 1, "b.near", &[0; 32], &[Action::Transfer { deposit: 1 }]);
    let s = sign_tx(&[3; 32], &tx);
    assert_eq!(&s[..tx.len()], &tx[..]);
    assert_eq!(s[tx.len()], 0);
    let sig = ed25519_dalek::Signature::from_bytes(s[tx.len() + 1..].try_into().unwrap());
    sk(3).verifying_key().verify(&Sha256::digest(&tx), &sig).unwrap();
}

#[test]
fn withdraw_refuses_any_destination_but_the_signer() {
    assert!(assert_withdraw_to("alice.near", "alice.near").is_ok());
    let other = assert_withdraw_to("alice.near", "bob.near").unwrap_err();
    assert_eq!(other.code, "bad_params");
    assert!(other.message.contains("signed this request"));
    assert!(assert_withdraw_to("alice.near", "alice.near ").is_err());
    assert!(assert_withdraw_to("alice.near", "").is_err());
}

fn art_file_hash(n: u8) -> String {
    let path = format!("{}/../../web/public/heirloom/keys/k{n:02}.webp", env!("CARGO_MANIFEST_DIR"));
    B64.encode(Sha256::digest(std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"))))
}

#[test]
fn eip191_recovers_the_fixed_vector_and_rejects_a_tamper() {
    // personal_sign over the intent JSON. Key 4c0883a6…2318, address 0x2c7536e3…5c23.
    // Signature v = 28. Produced with keccak256 of the EIP-191 prefix and secp256k1 (prehash off).
    let address = "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23";
    let message = r#"{"op":"status","account_id":"0x2c7536e3605d9c16a7a3d7b1898e529396a65c23","ts_ms":1700000000000,"params":{},"nonce":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","recipient":"keyhole"}"#;
    let signature = "0xda2cc385817dcb2341a8bef2f0b65524f245f3f730f0ac60ba563983a94cbcb520dfb828255f599428df0cd3af064297f485df1b067339489975274153e22fed1c";
    let auth = Auth {
        scheme: "eip191".into(),
        address: address.into(),
        account_id: address.into(),
        signature: signature.into(),
        nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".into(),
        message: message.into(),
        recipient: "keyhole".into(),
        ..Auth::default()
    };
    let (req, nonce) = verify_eip191(&auth, "keyhole").unwrap();
    assert_eq!(req.op, "status");
    assert_eq!(req.account_id, address);
    assert_eq!(req.ts_ms, 1_700_000_000_000);
    assert_eq!(nonce, [0u8; 32]);
    assert_eq!(recover_eip191_address(message, signature).unwrap(), address);
    let mut tampered = auth.clone();
    tampered.message = message.replace("status", "withdraw");
    assert_eq!(verify_eip191(&tampered, "keyhole").unwrap_err().code, "bad_signature");
    let mut other = auth.clone();
    other.account_id = "0x0000000000000000000000000000000000000001".into();
    other.address = other.account_id.clone();
    assert_eq!(verify_eip191(&other, "keyhole").unwrap_err().code, "bad_signature");
}

#[test]
fn mint_media_matches_the_site_picture_and_file_hash() {
    // Same pictures as web/lib/traits.ts for these token ids (tier 1).
    let cases = [
        ("0", "k08.webp"),
        ("k0642e7964b2fb515", "k08.webp"),
        ("k5f4750858f328940", "k03.webp"),
        ("k857b6b68facc0f94", "k03.webp"),
    ];
    for (id, file) in cases {
        let (url, hash) = bronze_media("keyhole-devmo.near", id);
        assert_eq!(url, format!("https://keyhole-seven.vercel.app/heirloom/keys/{file}"));
        let n = file[1..3].parse::<u8>().unwrap();
        assert_eq!(hash, art_file_hash(n));
    }
    let mut saw_five = false;
    for i in 0..400u32 {
        let (url, hash) = bronze_media("keyhole-devmo.near", &format!("probe{i}"));
        if url.ends_with("k05.webp") {
            assert_eq!(hash, art_file_hash(5));
            saw_five = true;
            break;
        }
    }
    assert!(saw_five, "bronze pool never selected picture 5");
}

#[test]
fn transfer_then_old_signature_is_not_owner() {
    let err = admit_request("alice.near", "bob.near", true, true).unwrap_err();
    assert_eq!(err.code, "not_owner");
    // still the owner, but the nonce was already used
    assert_eq!(admit_request("alice.near", "alice.near", true, false).unwrap_err().code, "replay");
    // expired is reported before ownership, so a stale request is not mistaken for a transfer
    assert_eq!(admit_request("alice.near", "bob.near", false, true).unwrap_err().code, "expired");
    admit_request("bob.near", "bob.near", true, true).unwrap();
}

#[test]
fn transfer_while_withdraw_is_pending_does_not_send() {
    let err = settle_if_owner(false).unwrap_err();
    assert_eq!(err.code, "not_owner");
    assert!(err.message.contains("funds stay"));
    settle_if_owner(true).unwrap();
}

#[test]
fn provenance_chain_verifies_and_rejects_a_tampered_owner() {
    let mut log = Vec::new();
    append_event(&mut log, "mint", "kabc", "alice.near", 10, "mint");
    append_event(&mut log, "deposit", "kabc", "alice.near", 20, "deposit");
    let head = append_event(&mut log, "transfer", "kabc", "bob.near", 30, "transfer");
    assert_eq!(verify_chain(&log).unwrap(), head);
    let secret = [7u8; 32];
    let sig = sign_head(&secret, &head);
    let public = SigningKey::from_bytes(&secret).verifying_key().to_bytes();
    assert!(verify_head(&public, &head, &sig));
    assert!(!verify_head(&public, &head, &("00".repeat(64))));
    log[1].owner = "carol.near".into();
    assert_eq!(verify_chain(&log).unwrap_err().code, "bad_log");
}

#[test]
fn random_transfer_and_withdraw_never_pays_the_previous_holder() {
    let mut owner = "A".to_string();
    let mut used = std::collections::HashSet::new();
    let mut paid = 0u32;
    let mut log = Vec::new();
    let mut state = 0x1234_5678u32;
    for step in 0..64u32 {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        match state % 5 {
            0 => {
                owner = if owner == "A" { "B" } else { "A" }.into();
                append_event(&mut log, "transfer", "k1", &owner, step as u64, "transfer");
            }
            _ => {
                let signer = if state.is_multiple_of(2) { "A" } else { "B" };
                let fresh = used.insert((signer, step));
                match admit_request(signer, &owner, true, fresh) {
                    Ok(()) => {
                        settle_if_owner(signer == owner).unwrap();
                        if signer == owner { paid += 1; }
                        append_event(&mut log, "withdraw", "k1", signer, step as u64, "withdraw");
                    }
                    Err(e) => {
                        assert!(e.code == "not_owner" || e.code == "replay");
                        if signer != owner { assert_eq!(e.code, "not_owner"); }
                    }
                }
            }
        }
    }
    verify_chain(&log).unwrap();
    assert!(paid > 0);
}

#[test]
fn mint_gas_and_minter_balance() {
    assert_eq!(MINT_GAS, 20_000_000_000_000);
    assert!(!minter_can_mint(MINT_DEPOSIT_YOCTO));
    // 0.014 NEAR is not enough: 20 Tgas is prepaid at 1e9 yocto/gas (0.02 NEAR) on top of the deposit.
    assert!(!minter_can_mint(MINT_DEPOSIT_YOCTO + 2_000_000_000_000_000_000_000));
    assert!(minter_can_mint(MINT_DEPOSIT_YOCTO + MINT_FEE_BUFFER_YOCTO));
    assert!(MINT_FEE_BUFFER_YOCTO >= MINT_GAS as u128 * 1_000_000_000);
    assert!(owner_is(Some("alice.near"), "alice.near"));
    assert!(!owner_is(Some("bob.near"), "alice.near"));
    assert!(!owner_is(None, "alice.near"));
}
