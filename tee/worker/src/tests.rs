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
    fn list_prefix(&mut self, p: &str) -> Result<Vec<String>, Error> { Ok(self.0.keys().filter(|k| k.starts_with(p)).cloned().collect()) }
    fn read(&mut self, k: &str) -> Result<Vec<u8>, Error> { Ok(self.0.get(k).cloned().unwrap_or_default()) }
    fn remove(&mut self, k: &str) -> Result<(), Error> { self.0.remove(k); Ok(()) }
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
    assert_eq!(fmt_usd(49_974), "0.0499");
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
fn address_parser_requires_a_valid_address_for_its_chain() {
    // Address parsing is separate from holder-only withdrawal authorization.
    assert!(validate_chain_address("near", "bob.near").is_ok());
    assert!(validate_chain_address("base", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed").is_ok());
    assert!(validate_chain_address("sol", "11111111111111111111111111111111").is_ok());
    // Shape errors and unknown chains are refused with bad_params.
    let bad = validate_chain_address("near", "bob.near ").unwrap_err();
    assert_eq!(bad.code, "bad_params");
    assert!(validate_chain_address("near", "").is_err());
    assert!(validate_chain_address("doge", "bob.near").is_err());
    assert!(validate_chain_address("base", "bob.near").is_err());
}

#[test]
fn eip55_matches_the_spec_vectors() {
    // EIP-55 examples: the checksum of each lowercase address.
    for want in ["0x52908400098527886E0F7030069857D2E4169EE7", "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
        "0xde709f2102306220921060314715629080e2fb77", "0x27b1fdb04752bbc536007a920d24acb045561c26",
        "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
        "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB", "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb"] {
        let lower = want.trim_start_matches("0x").to_ascii_lowercase();
        assert_eq!(format!("0x{}", eip55(&lower)), want);
        assert!(is_evm_address(want), "{want}");
    }
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

impl Kv for Mem {
    fn get(&self, k: &str) -> Vec<u8> { self.0.get(k).cloned().unwrap_or_default() }
    fn set(&mut self, k: &str, v: &[u8]) { self.0.insert(k.into(), v.to_vec()); }
}

/// Model of the custody API: api_key -> USDC units.
fn wallet_for(st: &mut Mem, token: &str, owner: &str, ledger: &mut HashMap<String, u128>, n: &mut u32) -> String {
    let rec = match custody_lookup(st, token, owner).unwrap() {
        Some(r) => r,
        None => {
            *n += 1;
            let r = format!("wk_{}", n).into_bytes();
            st.set_if_absent(&tkey(token, "wallet"), &r).unwrap();
            st.get(&tkey(token, "wallet"))
        }
    };
    let k = String::from_utf8(rec).unwrap();
    ledger.entry(k.clone()).or_insert(0);
    k
}

#[test]
fn transfer_moves_the_confidential_account_to_the_new_holder() {
    let mut st = Mem::default();
    let mut ledger = HashMap::new();
    let mut n = 0;
    let t = token_id_for("alice.near");
    // Alice mints and funds the key's account.
    let wa = wallet_for(&mut st, &t, "alice.near", &mut ledger, &mut n);
    *ledger.get_mut(&wa).unwrap() += 100;
    let mut log = vec![];
    log.push(serde_json::json!({"kind": "deposit", "amount": "100", "by": "alice.near"}));
    // nft_transfer alice -> bob. Bob's first call reaches the same wallet and balance.
    let owner = "bob.near";
    admit_request("bob.near", owner, true, true).unwrap();
    let wb = wallet_for(&mut st, &t, "bob.near", &mut ledger, &mut n);
    assert_eq!(wa, wb);
    assert_eq!(ledger[&wb], 100);
    // Bob withdraws 10 to himself.
    assert_withdraw_to("near", "bob.near", "bob.near", Some(owner)).unwrap();
    settle_if_owner(owner == "bob.near").unwrap();
    *ledger.get_mut(&wb).unwrap() -= 10;
    log.push(serde_json::json!({"kind": "withdraw", "amount": "10", "by": "bob.near"}));
    assert_eq!(ledger[&wb], 90);
    // Alice: fresh signature is not_owner, so she reaches no wallet.
    assert_eq!(admit_request("alice.near", owner, true, true).unwrap_err().code, "not_owner");
    // Bob replays his own signed withdraw: replay.
    let nonce = [9u8; 32];
    consume_nonce(&mut st, "bob.near", &nonce, 1).unwrap();
    assert_eq!(consume_nonce(&mut st, "bob.near", &nonce, 2).unwrap_err().code, "replay");
    // History privacy: Bob sees only his rows, Alice's deposit row is not returned.
    let h = history_for(&log, "bob.near");
    assert_eq!(h.len(), 1);
    assert_eq!(h[0]["kind"], "withdraw");
    assert!(history_for(&log, "carol.near").is_empty());
    assert_eq!(n, 1, "exactly one custody wallet was created");
}

#[test]
fn legacy_wallet_migrates_once_to_one_token() {
    let mut st = Mem::default();
    st.set(&hkey("alice.near", "wallet"), b"wk_legacy");
    st.set(&hkey("alice.near", "log"), br#"[{"kind":"swap"}]"#);
    let t1 = token_id_for("alice.near");
    assert_eq!(custody_lookup(&mut st, &t1, "alice.near").unwrap().unwrap(), b"wk_legacy");
    // Idempotent.
    assert_eq!(custody_lookup(&mut st, &t1, "alice.near").unwrap().unwrap(), b"wk_legacy");
    // A second key held by the same account does not get the same wallet.
    assert!(custody_lookup(&mut st, "kother", "alice.near").unwrap().is_none());
    // The legacy log moved with `by` = the owner at migration, so a buyer cannot read it.
    let log: Vec<serde_json::Value> = serde_json::from_slice(&st.get(&tkey(&t1, "log"))).unwrap();
    assert_eq!(log[0]["by"], "alice.near");
    assert!(history_for(&log, "bob.near").is_empty());
    // After a transfer the new owner finds the migrated wallet via the token.
    assert_eq!(custody_lookup(&mut st, &t1, "bob.near").unwrap().unwrap(), b"wk_legacy");
}

#[test]
fn seller_lock_binds_only_the_owner_who_set_it() {
    let v = lock_value("alice.near", 1_000);
    assert_eq!(assert_unlocked(v.as_bytes(), "alice.near", 999).unwrap_err().code, "locked");
    assert!(assert_unlocked(v.as_bytes(), "alice.near", 1_000).is_ok());
    assert!(assert_unlocked(v.as_bytes(), "bob.near", 10).is_ok(), "a transfer ends the lock");
    assert!(assert_unlocked(b"", "alice.near", 10).is_ok());
    assert!(active_lock(lock_value("a|b.near", 5).as_bytes(), "a|b.near", 1).is_some());
}

// Sale listing (nft_listing). A listed key refuses every value move; reads are never refused.
const VALUE_OPS: [&str; 4] = ["withdraw", "swap", "copy", "chain_sign"];
const NON_MOVING_OPS: [&str; 10] = ["balance", "history", "pnl", "dashboard", "account", "prove", "status", "provenance", "quote", "lock"];
const NOT_FOUND: &str = "wasm execution failed with error: FunctionCallError(MethodResolveError(MethodNotFound))";

#[test]
fn listed_key_refuses_every_value_move() {
    let listed = serde_json::json!({"token_id": "k0000000000000001", "seller": "alice.near", "price": "1000"});
    for op in VALUE_OPS {
        let e = listing_blocks(op, Ok(&listed)).unwrap_err();
        assert_eq!(e.code, "listed", "{op}");
        assert_eq!(e.message, "This key is listed for sale; unlist it to move funds.", "{op}");
    }
}

#[test]
fn unlisted_key_passes_every_value_move() {
    for op in VALUE_OPS {
        assert!(listing_blocks(op, Ok(&serde_json::Value::Null)).is_ok(), "{op}");
    }
}

#[test]
fn method_not_found_counts_as_not_listed() {
    // A v2.3 keys contract has no nft_listing: the worker must keep selling and moving funds on it.
    for raw in [NOT_FOUND, "MethodNotFound", "contract method not found: nft_listing", "method_not_found"] {
        for op in VALUE_OPS {
            assert!(listing_blocks(op, Err(raw)).is_ok(), "{op} / {raw}");
        }
    }
}

#[test]
fn other_listing_errors_fail_closed() {
    // Anything that is not a method miss, including a plain "not found" (no such account), refuses with `rpc`.
    for raw in ["", "AccountDoesNotExist", "account not found", "request timed out", "HANDLER_ERROR"] {
        for op in VALUE_OPS {
            let e = listing_blocks(op, Err(raw)).unwrap_err();
            assert_eq!(e.code, "rpc", "{op} / {raw}");
        }
    }
    // An answer that is neither null nor a listing object is not treated as unlisted.
    for odd in [serde_json::json!("x"), serde_json::json!([1]), serde_json::json!(7), serde_json::json!(true)] {
        assert_eq!(listing_blocks("withdraw", Ok(&odd)).unwrap_err().code, "rpc", "{odd}");
    }
}

#[test]
fn reads_are_never_refused_for_a_listing() {
    let listed = serde_json::json!({"token_id": "k0000000000000001", "seller": "alice.near", "price": "1000"});
    for op in NON_MOVING_OPS {
        assert!(listing_blocks(op, Ok(&listed)).is_ok(), "{op}");
        assert!(listing_blocks(op, Err("AccountDoesNotExist")).is_ok(), "{op} is not checked, so an RPC error does not refuse it");
    }
    assert!(!is_value_move("balance") && !is_value_move("prove") && !is_value_move("dashboard"));
    assert!(VALUE_OPS.iter().all(|op| is_value_move(op)));
}

#[test]
fn wet_quote_is_refused_while_listed() {
    let listed = serde_json::json!({"token_id": "k0000000000000001", "seller": "alice.near", "price": "1000"});
    let e = listing_blocks_ex("quote", true, Ok(&listed)).unwrap_err();
    assert_eq!(e.code, "listed");
    assert!(listing_blocks_ex("quote", false, Ok(&listed)).is_ok(), "dry quote stays readable");
    assert!(is_value_move_or_wet_quote("quote", true));
    assert!(!is_value_move_or_wet_quote("quote", false));
    assert!(!is_value_move("quote"));
}

#[test]
fn settlement_epoch_voids_a_stale_stamp() {
    assert_eq!(bump_epoch(0), 1);
    assert_eq!(bump_epoch(u64::MAX), u64::MAX);
    assert_eq!(epoch_from_bytes(b""), 0);
    assert_eq!(epoch_from_bytes(b"7"), 7);
    assert_eq!(epoch_from_bytes(b"nope"), 0);
    assert_eq!(epoch_to_bytes(42), b"42");
    settle_if_epoch(3, 3).unwrap();
    assert_eq!(settle_if_epoch(3, 4).unwrap_err().code, "epoch_void");
    assert_eq!(after_move_status_epoch("success", true, 1, 1), "success");
    assert_eq!(after_move_status_epoch("success", true, 1, 2), "needs_review");
    assert_eq!(after_move_status_epoch("success", false, 1, 1), "needs_review");
    assert_eq!(after_move_status_epoch("failed", true, 1, 9), "failed");
}

/// Epoch check at settle time. Complements the ownership predicate: a transfer that bumps the
/// epoch voids any in-flight settle stamped with the old epoch (funds not yet sent stay put).
#[test]
fn invariant_a_payout_settles_only_on_matching_settlement_epoch() {
    let mut r = Rng(99);
    for _ in 0..3000 {
        let stamped = r.below(5);
        let current = if r.below(3) == 0 { stamped } else { r.below(5) };
        let ok = settle_if_epoch(stamped, current).is_ok();
        assert_eq!(ok, stamped == current);
    }
}

#[test]
fn balance_proof_names_a_threshold_and_verifies() {
    let bals = serde_json::json!([{"token": "nep141:usdc", "amount": "40000"}, {"token": "nep141:usdc", "amount": "5"}, {"token": "x", "amount": "9"}]);
    assert_eq!(balance_of(&bals, "nep141:usdc"), 40005);
    assert_eq!(balance_of(&serde_json::json!([{"token":"a","balance": 7}]), "a"), 7);
    let st = proof_canonical("kabc", "bob.near", "nep141:usdc", "10000", true, 0, &"0".repeat(64), 5);
    assert!(!st.contains("40005"), "the balance itself is never in the statement");
    let secret = [3u8; 32];
    let sig = sign_head(&secret, &st);
    let public = SigningKey::from_bytes(&secret).verifying_key().to_bytes();
    assert!(verify_head(&public, &st, &sig));
    assert!(!verify_head(&public, &st.replace("true", "false"), &sig));
}

#[test]
fn re_mint_after_transfer_is_refused_before_sending() {
    assert_eq!(assert_mint_id_free(Some("bob.near")).unwrap_err().code, "already_minted");
    assert!(assert_mint_id_free(None).is_ok());
}

fn tier1() -> Limits { limits_for_tier(1).unwrap() }

#[test]
fn holder_cut_applies_now_and_raise_waits_a_day() {
    let p = set_policy(tier1(), None, "a.near", 10_000, 50_000, 1_000).unwrap();
    assert!(p.pending.is_none());
    let e = effective_limits(tier1(), Some(&p), 1_000);
    assert_eq!((e.per_tx_usd_micro, e.daily_usd_micro), (10_000, 50_000));
    let mut st = Mem::default();
    assert_eq!(enforce_caps(&mut st, "k1", &e, 20_000, 1_000, true).unwrap_err().code, "over_cap_per_tx");
    let r = set_policy(tier1(), Some(&p), "a.near", 1_000_000, 5_000_000, 2_000).unwrap();
    assert_eq!(r.pending.as_ref().unwrap().effective_ms, 2_000 + RAISE_DELAY_MS);
    assert_eq!(effective_limits(tier1(), Some(&r), 2_000 + RAISE_DELAY_MS - 1).per_tx_usd_micro, 10_000);
    assert_eq!(effective_limits(tier1(), Some(&r), 2_000 + RAISE_DELAY_MS).per_tx_usd_micro, 1_000_000);
    // a cut while a raise is pending cancels the raise
    let c = set_policy(tier1(), Some(&r), "a.near", 5_000, 5_000, 3_000).unwrap();
    assert!(c.pending.is_none());
    assert_eq!(effective_limits(tier1(), Some(&c), 9 * RAISE_DELAY_MS).per_tx_usd_micro, 5_000);
}

#[test]
fn holder_limits_stay_within_the_tier_and_bind_only_their_owner() {
    assert_eq!(set_policy(tier1(), None, "a", 2_000_000, 5_000_000, 0).unwrap_err().code, "bad_params");
    assert_eq!(set_policy(tier1(), None, "a", 0, 5_000_000, 0).unwrap_err().code, "bad_params");
    assert_eq!(set_policy(tier1(), None, "a", 20, 10, 0).unwrap_err().code, "bad_params");
    let p = set_policy(tier1(), None, "seller.near", 10, 10, 0).unwrap();
    let raw = serde_json::to_vec(&p).unwrap();
    assert!(policy_for(&raw, "seller.near").is_some());
    assert!(policy_for(&raw, "buyer.near").is_none());
    assert_eq!(effective_limits(tier1(), policy_for(&raw, "buyer.near").as_ref(), 0).per_tx_usd_micro, 1_000_000);
}

#[test]
fn withdraw_waits_after_a_transfer_only_for_the_new_owner() {
    let mut evs = Vec::new();
    append_event(&mut evs, "mint", "k1", "a", 0, "mint");
    assert!(assert_no_cooldown(&evs, "a", 1).is_ok());
    append_event(&mut evs, "transfer", "k1", "b", 1_000, "transfer");
    assert_eq!(assert_no_cooldown(&evs, "b", 1_000 + TRANSFER_COOLDOWN_MS - 1).unwrap_err().code, "cooldown");
    assert!(assert_no_cooldown(&evs, "b", 1_000 + TRANSFER_COOLDOWN_MS).is_ok());
    assert!(assert_no_cooldown(&evs, "a", 1_001).is_ok());
}

#[test]
fn fmt_usd_keeps_sub_cent_amounts_readable() {
    assert_eq!(fmt_usd(1_000_000), "1.00");
    assert_eq!(fmt_usd(20_000), "0.02");
    assert_eq!(fmt_usd(1_000), "0.0010");
    assert_eq!(fmt_usd(2_000), "0.0020");
    assert_eq!(fmt_usd(49_974), "0.0499");
    assert_eq!(fmt_usd(50), "0.000050");
    assert_eq!(fmt_usd(0), "0.00");
}

#[test]
fn pnl_counts_only_successful_trades_and_signs_totals_only() {
    let log = serde_json::json!([
        {"kind":"swap","status":"success","token_out":"nep141:wrap.near","amount_out":"1000","usd_in_micro":20000,"ts_ms":50},
        {"kind":"swap","status":"success","token_out":"nep141:wrap.near","amount_out":"500","usd_in_micro":10000,"ts_ms":40},
        {"kind":"swap","status":"failed","token_out":"nep141:wrap.near","amount_out":"999","usd_in_micro":5,"ts_ms":10},
        {"kind":"withdraw","status":"success","token":"x","amount":"7","usd_micro":3}
    ]);
    let (n, cost, outs, since) = pnl_aggregate(log.as_array().unwrap());
    assert_eq!((n, cost, since), (2, 30000, 40));
    assert_eq!(outs.get("nep141:wrap.near"), Some(&1500u128));
    let st = pnl_canonical("kabc", "bob.near", n, cost, 25000, since, &"0".repeat(64), 99);
    assert!(st.contains("\"pnl_usd_micro\":-5000"));
    assert!(!st.contains("wrap.near") && !st.contains("1500"), "no assets or amounts in the statement");
    let v: serde_json::Value = serde_json::from_str(&st).unwrap();
    assert_eq!(v["kind"], "keyhole-pnl-v1");
    let secret = [5u8; 32];
    let sig = sign_head(&secret, &st);
    let public = SigningKey::from_bytes(&secret).verifying_key().to_bytes();
    assert!(verify_head(&public, &st, &sig));
}

// ---------- public record (`record`): listed keys only, from a log that verifies ----------
#[test]
fn record_statement_has_a_fixed_field_order_and_no_extra_fields() {
    let mut outs = std::collections::BTreeMap::new();
    outs.insert("nep141:wrap.near".to_string(), 1500u128);
    let head = "0".repeat(64);
    let st = record_canonical("k5f4750858f328940", "bob.near", 2, "alice.near", "2500", 12, 7_500_000, 3, 30_000, &outs, 40, &head, 99);
    assert_eq!(st, format!("{{\"cost_usd_micro\":30000,\"kind\":\"keyhole-record-v1\",\"listing_price_yocto\":\"2500\",\"log_head\":\"{head}\",\"outs\":{{\"nep141:wrap.near\":\"1500\"}},\"owner\":\"bob.near\",\"seller\":\"alice.near\",\"settled_swaps\":12,\"since_ms\":40,\"tier\":2,\"token_id\":\"k5f4750858f328940\",\"trades\":3,\"ts_ms\":99,\"volume_usd_micro\":7500000}}"));
    let v: serde_json::Value = serde_json::from_str(&st).unwrap();
    assert_eq!(v.as_object().unwrap().len(), 14);
    assert!(!st.contains(" "), "no spaces");
}

#[test]
fn record_statement_escapes_every_string() {
    let mut outs = std::collections::BTreeMap::new();
    outs.insert("nep141:a\"b\\c".to_string(), 5u128);
    let st = record_canonical("k5f4750858f328940", "o\"w\\ner", 1, "s.near", "10", 0, 0, 0, 0, &outs, 0, "h\n", 1);
    let v: serde_json::Value = serde_json::from_str(&st).expect("the statement is JSON the browser can parse");
    assert_eq!(v["owner"], "o\"w\\ner");
    assert_eq!(v["log_head"], "h\n");
    assert_eq!(v["outs"]["nep141:a\"b\\c"], "5");
}

#[test]
fn record_statement_with_no_trades_has_empty_outs() {
    let st = record_canonical("k5f4750858f328940", "bob.near", 1, "alice.near", "1", 0, 0, 0, 0, &Default::default(), 0, &"0".repeat(64), 1);
    assert!(st.contains("\"outs\":{}"), "{st}");
}

#[test]
fn record_is_refused_unless_the_key_is_listed() {
    assert_eq!(record_listing(Ok(&serde_json::Value::Null)).unwrap_err().code, "not_listed");
    for raw in ["MethodNotFound", "method not found", "Method_Not_Found"] {
        let e = record_listing(Err(raw)).unwrap_err();
        assert_eq!(e.code, "not_listed", "{raw}");
        assert_eq!(e.message, NOT_LISTED_MSG);
    }
    // Any other RPC error, or an answer that is neither null nor a listing, fails closed.
    for raw in ["HandlerError: panicked", "UnknownAccount", "timeout"] {
        assert_eq!(record_listing(Err(raw)).unwrap_err().code, "rpc", "{raw}");
    }
    assert_eq!(record_listing(Ok(&serde_json::json!([1]))).unwrap_err().code, "rpc");
    assert_eq!(record_listing(Ok(&serde_json::json!("alice.near"))).unwrap_err().code, "rpc");
}

#[test]
fn record_reads_seller_and_price_from_a_listing() {
    let ok = record_listing(Ok(&serde_json::json!({"token_id": "k5f4750858f328940", "seller": "alice.near", "price": "2500"}))).unwrap();
    assert_eq!(ok, RecordListing { seller: "alice.near".into(), price_yocto: "2500".into() });
    let num = record_listing(Ok(&serde_json::json!({"seller": "alice.near", "price": 2500}))).unwrap();
    assert_eq!(num.price_yocto, "2500");
    for bad in [serde_json::json!({"seller": "alice.near", "price": "2.5"}), serde_json::json!({"seller": "alice.near", "price": ""}),
        serde_json::json!({"seller": "alice.near", "price": "-1"}), serde_json::json!({"seller": "alice.near"}),
        serde_json::json!({"seller": "Alice.near", "price": "2500"}), serde_json::json!({"price": "2500"})] {
        assert_eq!(record_listing(Ok(&bad)).unwrap_err().code, "rpc", "{bad}");
    }
}

#[test]
fn record_is_refused_for_a_log_that_does_not_verify() {
    let t = "k5f4750858f328940";
    let mut log = Vec::new();
    append_event(&mut log, "mint", t, "bob.near", 1, "mint");
    append_event(&mut log, "swap", t, "bob.near", 2, "swap USDC 5");
    append_event(&mut log, "withdraw", t, "bob.near", 3, "withdraw 1 USDC");
    assert!(verify_chain(&log).is_ok());
    let mut owner_changed = log.clone();
    owner_changed[0].owner = "mallory.near".into();
    assert_eq!(verify_chain(&owner_changed).unwrap_err().code, "bad_log");
    let mut relinked = log.clone();
    relinked[2].prev = "0".repeat(64);
    assert_eq!(verify_chain(&relinked).unwrap_err().code, "bad_log");
    let mut renumbered = log.clone();
    renumbered[1].i = 5;
    assert_eq!(verify_chain(&renumbered).unwrap_err().code, "bad_log");
}

#[test]
fn record_is_not_a_session_op() {
    assert!(!SESSION_OPS.contains(&"record"));
}

// ---------- invariant tests: seeded random sequences, thousands of steps each ----------
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 { self.0 ^= self.0 << 13; self.0 ^= self.0 >> 7; self.0 ^= self.0 << 17; self.0 }
    fn below(&mut self, n: u64) -> u64 { self.next() % n }
}

#[test]
fn invariant_caps_never_exceeded_across_random_trades_and_rollbacks() {
    for seed in 1..=20u64 {
        let mut r = Rng(seed * 7919);
        let mut st = Mem::default();
        let lim = limits_for_tier(1 + (seed % 3) as u8).unwrap();
        let mut committed: HashMap<u64, u64> = HashMap::new();
        for step in 0..2000u64 {
            let now = step * 3_600_000 / 7; // crosses several UTC days
            let day = now / 86_400_000;
            let amt = r.below(lim.per_tx_usd_micro * 2) + 1;
            match enforce_caps(&mut st, "h", &lim, amt, now, true) {
                Ok(_) => {
                    assert!(amt <= lim.per_tx_usd_micro, "per-trade cap");
                    if r.below(4) == 0 { st.incr(&hkey("h", &format!("spent/{day}")), -(amt as i64)).unwrap(); } // failed trade rolled back
                    else { *committed.entry(day).or_default() += amt; }
                }
                Err(e) => assert!(e.code == "over_cap_per_tx" || e.code == "over_cap_daily"),
            }
            assert!(committed.get(&day).copied().unwrap_or(0) <= lim.daily_usd_micro, "daily cap, seed {seed} step {step}");
            assert_eq!(st.incr(&hkey("h", &format!("spent/{day}")), 0).unwrap() as u64, committed.get(&day).copied().unwrap_or(0), "counter equals committed");
        }
    }
}

#[test]
fn invariant_each_signed_nonce_is_accepted_at_most_once() {
    let mut r = Rng(42);
    let mut st = Mem::default();
    let mut seen = std::collections::HashSet::new();
    for i in 0..5000u64 {
        let mut n = [0u8; 32];
        n[0] = r.below(64) as u8; // small space forces many repeats
        n[1] = r.below(16) as u8;
        let acct = if r.below(2) == 0 { "a.near" } else { "b.near" };
        let ok = consume_nonce(&mut st, acct, &n, i).is_ok();
        assert_eq!(ok, seen.insert((acct, n)), "replay accepted or fresh nonce refused at {i}");
    }
}

#[test]
fn invariant_cooldown_binds_only_the_latest_transferee() {
    let mut r = Rng(9);
    for _ in 0..500 {
        let owners = ["a", "b", "c"];
        let mut evs = vec![];
        let mut last: Option<(&str, u64)> = None;
        for i in 0..(1 + r.below(8)) {
            let o = owners[r.below(3) as usize];
            let kind = if r.below(3) == 0 { "swap" } else { "transfer" };
            let ts = i * 1000 + r.below(500);
            evs.push(ProvEvent { i, prev: String::new(), kind: kind.into(), token_id: "k".into(), owner: o.into(), ts_ms: ts, detail_hash: String::new(), v:1, contract:String::new(), owner_epoch:0 });
            if kind == "transfer" { last = Some((o, ts)); }
        }
        for o in owners {
            let want = last.filter(|(w, _)| *w == o).map(|(_, ts)| ts + TRANSFER_COOLDOWN_MS);
            assert_eq!(cooldown_until(&evs, o), want);
        }
    }
}

#[test]
fn invariant_lock_binds_only_its_owner_and_only_until_it_ends() {
    let mut r = Rng(77);
    for _ in 0..3000 {
        let until = r.below(1_000_000);
        let setter = if r.below(2) == 0 { "seller" } else { "other" };
        let raw = lock_value(setter, until);
        let now = r.below(1_200_000);
        for who in ["seller", "other", "buyer"] {
            let locked = assert_unlocked(raw.as_bytes(), who, now).is_err();
            assert_eq!(locked, who == setter && now < until, "who={who} setter={setter} now={now} until={until}");
        }
    }
}

#[test]
fn invariant_holder_limits_never_exceed_tier_and_raises_wait_a_day() {
    let mut r = Rng(5);
    let tier = limits_for_tier(2).unwrap();
    let mut cur: Option<HolderPolicy> = None;
    let mut now = 0u64;
    for _ in 0..3000 {
        now += r.below(20_000_000);
        let pt = r.below(tier.per_tx_usd_micro * 2) + 1;
        let d = pt + r.below(tier.daily_usd_micro * 2);
        let before = effective_limits(tier, cur.as_ref(), now);
        if let Ok(p) = set_policy(tier, cur.as_ref(), "h", pt, d, now) {
            let after = effective_limits(tier, Some(&p), now);
            assert!(after.per_tx_usd_micro <= tier.per_tx_usd_micro && after.daily_usd_micro <= tier.daily_usd_micro, "above tier");
            assert!(after.per_tx_usd_micro <= before.per_tx_usd_micro, "instant per-trade raise");
            assert!(after.daily_usd_micro <= before.daily_usd_micro, "instant daily raise");
            let later = effective_limits(tier, Some(&p), now + RAISE_DELAY_MS);
            assert!(later.per_tx_usd_micro <= tier.per_tx_usd_micro);
            cur = Some(p);
        }
        // a different owner is never bound by this policy
        let raw = serde_json::to_vec(&cur).unwrap_or_default();
        assert!(policy_for(&raw, "someone-else").is_none());
    }
}

/// Predicate test over `admit_request` (owner at authorization) and `settle_if_owner`
/// (owner at settlement). It does not start a send, so it does not cover a payout that is
/// already in flight when the key moves. The mainnet run in docs/evidence/mid-payout shows
/// that case: the payout completed to the holder who signed it.
#[test]
fn invariant_a_payout_settles_only_if_its_signer_owns_the_key_at_auth_and_at_settle() {
    let mut r = Rng(1234);
    for _ in 0..5000 {
        let signer = if r.below(2) == 0 { "alice" } else { "bob" };
        let owner_at_auth = if r.below(2) == 0 { "alice" } else { "bob" };
        let owner_at_settle = if r.below(3) == 0 { "carol" } else { owner_at_auth };
        let admitted = admit_request(signer, owner_at_auth, true, true).is_ok();
        assert_eq!(admitted, signer == owner_at_auth);
        if admitted {
            let settled = settle_if_owner(owner_at_settle == signer).is_ok();
            assert_eq!(settled, owner_at_settle == signer, "paid out after the key moved");
        }
    }
}

// ---- RED review R1: cooldown must survive a non-withdraw call by the new holder ----
fn sold_to_b(first: &str) -> Vec<ProvEvent> {
    let mut evs = Vec::new();
    append_event(&mut evs, "mint", "k1", "a", 0, "mint");
    append_event(&mut evs, "deposit", "k1", "a", 10, "dep");
    append_synced(&mut evs, first, "k1", "b", 1_000, first);
    evs
}
#[test]
fn r1_swap_before_withdraw_still_starts_the_cooldown() {
    let evs = sold_to_b("swap");
    assert_eq!(evs[2].kind, "transfer");
    assert_eq!(assert_no_cooldown(&evs, "b", 1_001).unwrap_err().code, "cooldown");
}
#[test]
fn r1_every_write_kind_by_a_new_holder_records_the_transfer_first() {
    for k in ["swap", "copy", "deposit", "lock", "limits", "withdraw"] {
        let evs = sold_to_b(k);
        assert_eq!(evs.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), ["mint", "deposit", "transfer", k], "{k}");
        assert_eq!(cooldown_until(&evs, "b"), Some(1_000 + TRANSFER_COOLDOWN_MS), "{k}");
        assert!(verify_chain(&evs).is_ok(), "{k}");
    }
}
#[test]
fn r1_same_holder_writes_add_no_transfer_row() {
    let mut evs = Vec::new();
    append_event(&mut evs, "mint", "k1", "a", 0, "mint");
    assert_eq!(append_synced(&mut evs, "swap", "k1", "a", 5, "s").len(), 1);
    assert_eq!(evs.len(), 2);
    assert_eq!(cooldown_until(&evs, "a"), None);
}
#[test]
fn r1_explicit_transfer_and_mint_are_never_doubled() {
    assert!(!needs_transfer_event(Some("a"), "transfer", "b"));
    assert!(!needs_transfer_event(Some("a"), "mint", "b"));
    assert!(!needs_transfer_event(None, "swap", "b"));
    assert!(needs_transfer_event(Some("a"), "lock", "b"));
}

// ---- RED review R3 / R4 ----
#[test]
fn r3_cap_is_refunded_only_on_a_final_failure() {
    for st in ["failed", "error", "refunded"] { assert!(cap_refund_on(st), "{st}"); }
    for st in ["success", "pending", "processing", "needs_review", "", "unknown"] { assert!(!cap_refund_on(st), "{st}"); }
}
#[test]
fn r4_wallet_polling_fits_inside_the_gateway_timeout() {
    assert!(WALLET_POLLS as u64 * WALLET_POLL_SECS + 5 < GATEWAY_TIMEOUT_SECS);
}

#[path = "matrix.rs"]
mod matrix;
#[path = "beatkey.rs"]
mod beatkey;
#[path = "audit.rs"]
mod audit;
#[path = "p2matrix.rs"]
mod p2matrix;
#[path = "p2golden.rs"]
mod p2golden;
#[path = "p2beat.rs"]
mod p2beat;
#[path = "p2fail.rs"]
mod p2fail;

#[path = "session.rs"]
mod session;
#[path = "worker_hardening.rs"]
mod worker_hardening;

#[path = "level.rs"]
mod level;

#[test]
fn holder_withdraw_pays_only_self_on_near() {
    assert!(assert_withdraw_to("near", "alice.near", "alice.near", Some("alice.near")).is_ok());
    let implicit = "a".repeat(64);
    assert!(assert_withdraw_to("near", &implicit, &implicit, Some(&implicit)).is_ok());
}
#[test]
fn holder_withdraw_rejects_another_receiver() {
    assert_eq!(assert_withdraw_to("near", "bob.near", "alice.near", Some("alice.near")).unwrap_err().code, "bad_params");
}
#[test]
fn holder_withdraw_rejects_non_owner_and_missing_token() {
    for owner in [Some("alice.near"), None] {
        assert_eq!(assert_withdraw_to("near", "bob.near", "bob.near", owner).unwrap_err().code, "not_owner");
    }
}
#[test]
fn holder_withdraw_rejects_old_holder_after_transfer() {
    let before = Some("alice.near");
    assert!(assert_withdraw_to("near", "alice.near", "alice.near", before).is_ok());
    let after = Some("bob.near");
    assert_eq!(assert_withdraw_to("near", "alice.near", "alice.near", after).unwrap_err().code, "not_owner");
    assert_eq!(assert_withdraw_to("near", "alice.near", "bob.near", after).unwrap_err().code, "bad_params");
    assert!(assert_withdraw_to("near", "bob.near", "bob.near", after).is_ok());
}
#[test]
fn holder_withdraw_rejects_mismatched_chain_even_with_valid_external_address() {
    for (chain, to) in [("base", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), ("sol", "11111111111111111111111111111111"), ("eth", "alice.near"), ("NEAR", "alice.near")] {
        assert_eq!(assert_withdraw_to(chain, to, "alice.near", Some("alice.near")).unwrap_err().code, "bad_params");
    }
}

#[test]
fn host_withdraw_checks_final_owner_before_custody_and_derives_send_receiver() {
    let src = include_str!("main.rs");
    let view = src.split("fn view(").nth(1).unwrap().split("fn holder_tier").next().unwrap();
    assert!(view.contains("&args.to_string(), \"final\""));
    let op = src.split("fn op_withdraw(").nth(1).unwrap().split("fn load_prov(").next().unwrap();
    let guard = op.find("assert_withdraw_to(&chain, &to, &c.account, nft.get(\"owner_id\")").unwrap();
    assert!(op[..guard].contains("let nft = view(&keys_contract(), \"nft_token\""));
    assert!(guard < op.find("c.wallet()?").unwrap());
    assert!(guard < op.find("charge_spend(").unwrap());
    assert!(op.find("settle_gate(").unwrap() < op.find("let r = wallet_op(").unwrap());
    assert!(op.contains("json!({\"chain\": \"near\", \"to\": c.account"));
}
