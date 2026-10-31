//! KEYHOLE worker core: pure, host-independent logic (unit-tested natively).
//! The OutLayer host glue lives in main.rs.
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// NEP-413 tag: 2^31 + 413.
pub const NEP413_TAG: u32 = 2_147_484_061;
/// Max clock skew between the signed `ts_ms` and the chain's final block time.
pub const MAX_SKEW_MS: u64 = 5 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Error {
    pub code: &'static str,
    pub message: String,
}
pub fn err(code: &'static str, message: impl Into<String>) -> Error {
    Error { code, message: message.into() }
}

/// What a wallet returns from `signMessage` (NEP-413), plus the account.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct Auth {
    pub account_id: String,
    /// "ed25519:<base58>"
    pub public_key: String,
    /// base64, 64 bytes
    pub signature: String,
    /// base64, 32 bytes
    pub nonce: String,
    /// the exact signed message (a JSON string, see SignedRequest)
    pub message: String,
    pub recipient: String,
    #[serde(default)]
    pub callback_url: Option<String>,
    /// Empty or "nep413" is a NEAR signature. "eip191" is MetaMask personal_sign.
    #[serde(default)]
    pub scheme: String,
    /// Lowercase 0x address. Required when scheme is eip191.
    #[serde(default)]
    pub address: String,
}

/// The JSON the holder signs. The worker only acts on fields inside the signature.
#[derive(Debug, Clone, Deserialize)]
pub struct SignedRequest {
    pub op: String,
    pub account_id: String,
    pub ts_ms: u64,
    #[serde(default)]
    pub params: serde_json::Value,
}

fn borsh_string(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(&(s.len() as u32).to_le_bytes());
    out.extend_from_slice(s.as_bytes());
}

/// Borsh(NEP413_TAG) || Borsh(payload{message, nonce, recipient, callbackUrl})
pub fn nep413_bytes(message: &str, nonce: &[u8; 32], recipient: &str, callback_url: Option<&str>) -> Vec<u8> {
    let mut v = Vec::with_capacity(64 + message.len() + recipient.len());
    v.extend_from_slice(&NEP413_TAG.to_le_bytes());
    borsh_string(&mut v, message);
    v.extend_from_slice(nonce);
    borsh_string(&mut v, recipient);
    match callback_url {
        None => v.push(0),
        Some(c) => {
            v.push(1);
            borsh_string(&mut v, c);
        }
    }
    v
}

pub fn parse_ed25519_pk(pk: &str) -> Result<[u8; 32], Error> {
    let b58 = pk.strip_prefix("ed25519:").ok_or_else(|| err("bad_public_key", "public_key must start with ed25519:"))?;
    let raw = bs58::decode(b58).into_vec().map_err(|_| err("bad_public_key", "public_key is not base58"))?;
    raw.try_into().map_err(|_| err("bad_public_key", "public_key must be 32 bytes"))
}

pub fn is_valid_account_id(a: &str) -> bool {
    let ok_len = (2..=64).contains(&a.len());
    let ok_chars = a.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'_' || c == b'.');
    let no_edge = !a.starts_with(['.', '-', '_']) && !a.ends_with(['.', '-', '_']) && !a.contains("..");
    ok_len && ok_chars && no_edge
}

/// Cryptographic NEP-413 check + binding of the signed request to the account.
/// Does NOT check that the key belongs to the account (needs RPC) nor replay (needs storage).
pub fn verify_nep413(auth: &Auth, expected_recipient: &str) -> Result<(SignedRequest, [u8; 32]), Error> {
    if !is_valid_account_id(&auth.account_id) {
        return Err(err("bad_account", "account_id is not a valid NEAR account id"));
    }
    if auth.recipient != expected_recipient {
        return Err(err("wrong_recipient", format!("signature was made for '{}', expected '{}'", auth.recipient, expected_recipient)));
    }
    let pk = parse_ed25519_pk(&auth.public_key)?;
    let nonce: [u8; 32] = B64
        .decode(&auth.nonce)
        .ok()
        .and_then(|n| n.try_into().ok())
        .ok_or_else(|| err("bad_nonce", "nonce must be 32 bytes, base64"))?;
    let sig: [u8; 64] = B64
        .decode(&auth.signature)
        .ok()
        .and_then(|s| s.try_into().ok())
        .ok_or_else(|| err("bad_signature", "signature must be 64 bytes, base64"))?;
    let hash = Sha256::digest(nep413_bytes(&auth.message, &nonce, &auth.recipient, auth.callback_url.as_deref()));
    let vk = VerifyingKey::from_bytes(&pk).map_err(|_| err("bad_public_key", "invalid ed25519 point"))?;
    vk.verify_strict(&hash, &Signature::from_bytes(&sig))
        .map_err(|_| err("bad_signature", "signature does not match message"))?;
    let req: SignedRequest = serde_json::from_str(&auth.message)
        .map_err(|_| err("bad_message", "signed message must be JSON {op, account_id, ts_ms, params}"))?;
    if req.account_id != auth.account_id {
        return Err(err("account_mismatch", "signed account_id differs from the claimed account"));
    }
    Ok((req, nonce))
}

#[derive(Debug, Deserialize)]
struct Eip191Body {
    op: String,
    account_id: String,
    ts_ms: u64,
    #[serde(default)]
    params: serde_json::Value,
    nonce: String,
    recipient: String,
}

/// EIP-191 personal_sign digest: keccak256("\x19Ethereum Signed Message:\n" || len || message).
pub fn eip191_digest(message: &str) -> [u8; 32] {
    use sha3::{Digest, Keccak256};
    let msg = message.as_bytes();
    let prefix = format!("\u{19}Ethereum Signed Message:\n{}", msg.len());
    let mut h = Keccak256::new();
    h.update(prefix.as_bytes());
    h.update(msg);
    h.finalize().into()
}

fn decode_sig65(signature: &str) -> Result<[u8; 65], Error> {
    let hexed = signature.strip_prefix("0x").unwrap_or(signature);
    if hexed.len() != 130 || !hexed.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(err("bad_signature", "eip191 signature must be 65 bytes, 0x hex"));
    }
    let raw = hex::decode(hexed).map_err(|_| err("bad_signature", "eip191 signature must be 65 bytes, 0x hex"))?;
    raw.try_into().map_err(|_| err("bad_signature", "eip191 signature must be 65 bytes, 0x hex"))
}

/// Recover the lowercase 0x address from a personal_sign signature.
pub fn recover_eip191_address(message: &str, signature: &str) -> Result<String, Error> {
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
    use sha3::{Digest, Keccak256};
    let raw = decode_sig65(signature)?;
    let v = raw[64];
    let rec = if v >= 27 { v - 27 } else { v };
    if rec > 1 { return Err(err("bad_signature", "eip191 recovery id is out of range")); }
    let sig = Signature::from_slice(&raw[..64]).map_err(|_| err("bad_signature", "eip191 signature is not a valid secp256k1 signature"))?;
    let recid = RecoveryId::from_byte(rec).ok_or_else(|| err("bad_signature", "eip191 recovery id is out of range"))?;
    let digest = eip191_digest(message);
    let vk = VerifyingKey::recover_from_prehash(&digest, &sig, recid)
        .map_err(|_| err("bad_signature", "eip191 signature does not recover"))?;
    let point = vk.to_encoded_point(false);
    let hash = Keccak256::digest(&point.as_bytes()[1..]);
    Ok(format!("0x{}", hex::encode(&hash[12..])))
}

fn is_eth_implicit(a: &str) -> bool {
    let rest = a.strip_prefix("0x").unwrap_or("");
    rest.len() == 40 && rest.bytes().all(|c| c.is_ascii_hexdigit()) && a.bytes().all(|c| !c.is_ascii_uppercase())
}

/// personal_sign over the intent JSON. Recovered address must be the account id.
/// Replay, caps and rate limits stay with the caller, the same as NEP-413.
pub fn verify_eip191(auth: &Auth, expected_recipient: &str) -> Result<(SignedRequest, [u8; 32]), Error> {
    if auth.scheme != "eip191" { return Err(err("no_auth", "expected scheme eip191")); }
    let account = auth.account_id.to_ascii_lowercase();
    let address = auth.address.to_ascii_lowercase();
    if !is_eth_implicit(&account) {
        return Err(err("bad_account", "ethereum account id must be a lowercase 0x address"));
    }
    if account != address {
        return Err(err("account_mismatch", "address differs from the account id"));
    }
    if auth.recipient != expected_recipient {
        return Err(err("wrong_recipient", format!("signature was made for '{}', expected '{}'", auth.recipient, expected_recipient)));
    }
    let nonce: [u8; 32] = B64
        .decode(&auth.nonce)
        .ok()
        .and_then(|n| n.try_into().ok())
        .ok_or_else(|| err("bad_nonce", "nonce must be 32 bytes, base64"))?;
    let recovered = recover_eip191_address(&auth.message, &auth.signature)?;
    if recovered != account {
        return Err(err("bad_signature", "signature does not recover to this account"));
    }
    let body: Eip191Body = serde_json::from_str(&auth.message)
        .map_err(|_| err("bad_message", "signed message must be JSON {op, account_id, ts_ms, params, nonce, recipient}"))?;
    if body.account_id.to_ascii_lowercase() != account {
        return Err(err("account_mismatch", "signed account_id differs from the claimed account"));
    }
    if body.nonce != auth.nonce {
        return Err(err("bad_message", "signed nonce differs from auth.nonce"));
    }
    if body.recipient != auth.recipient {
        return Err(err("wrong_recipient", "signed recipient differs from auth.recipient"));
    }
    Ok((SignedRequest { op: body.op, account_id: account, ts_ms: body.ts_ms, params: body.params }, nonce))
}

pub fn check_freshness(ts_ms: u64, chain_now_ms: u64) -> Result<(), Error> {
    if ts_ms + MAX_SKEW_MS < chain_now_ms || ts_ms > chain_now_ms + MAX_SKEW_MS {
        return Err(err("expired", "request timestamp is more than 5 minutes from chain time; sign a new request"));
    }
    Ok(())
}

/// Minimal key-value store the host provides (OutLayer encrypted storage).
pub trait Store {
    fn set_if_absent(&mut self, key: &str, val: &[u8]) -> Result<bool, Error>;
    fn incr(&mut self, key: &str, delta: i64) -> Result<i64, Error>;
}

/// Per-holder namespace. Account ids cannot contain '/', so prefixes cannot collide.
pub fn hkey(account: &str, rest: &str) -> String {
    format!("h/{}/{}", account, rest)
}

/// Replay protection: each (account, nonce) is accepted once, ever.
pub fn consume_nonce(st: &mut dyn Store, account: &str, nonce: &[u8; 32], now_ms: u64) -> Result<(), Error> {
    let fresh = st.set_if_absent(&hkey(account, &format!("n/{}", hex::encode(nonce))), now_ms.to_string().as_bytes())?;
    if fresh { Ok(()) } else { Err(err("replay", "this signed request was already used; sign a new one")) }
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Limits {
    pub per_tx_usd_micro: u64,
    pub daily_usd_micro: u64,
    pub per_minute_calls: i64,
}
/// Defaults by key tier (1 = Bronze, 2 = Silver, 3 = Gold). USD in micro-dollars.
pub fn limits_for_tier(tier: u8) -> Option<Limits> {
    match tier {
        1 => Some(Limits { per_tx_usd_micro: 1_000_000, daily_usd_micro: 5_000_000, per_minute_calls: 6 }),
        2 => Some(Limits { per_tx_usd_micro: 10_000_000, daily_usd_micro: 50_000_000, per_minute_calls: 12 }),
        3 => Some(Limits { per_tx_usd_micro: 100_000_000, daily_usd_micro: 500_000_000, per_minute_calls: 30 }),
        _ => None,
    }
}
pub const GLOBAL_PER_MINUTE: i64 = 120;
pub const GLOBAL_MINTS_PER_DAY: i64 = 25;

/// Counter-based limiter: increments, and rolls back if over.
pub fn bump_within(st: &mut dyn Store, key: &str, delta: i64, max: i64, code: &'static str, msg: String) -> Result<i64, Error> {
    let v = st.incr(key, delta)?;
    if v > max {
        st.incr(key, -delta)?;
        return Err(err(code, msg));
    }
    Ok(v)
}

pub fn rate_limit(st: &mut dyn Store, account: &str, lim: &Limits, now_ms: u64) -> Result<(), Error> {
    let minute = now_ms / 60_000;
    bump_within(st, &format!("g/rl/{}", minute), 1, GLOBAL_PER_MINUTE, "busy", "service is busy, retry in a minute".into())?;
    bump_within(st, &hkey(account, &format!("rl/{}", minute)), 1, lim.per_minute_calls, "rate_limited",
        format!("max {} requests per minute for your key tier", lim.per_minute_calls))?;
    Ok(())
}

/// Policy check for a value-moving action. `usd_micro` comes from the quote, not the caller.
pub fn enforce_caps(st: &mut dyn Store, account: &str, lim: &Limits, usd_micro: u64, now_ms: u64, commit: bool) -> Result<u64, Error> {
    if usd_micro > lim.per_tx_usd_micro {
        return Err(err("over_cap_per_tx", format!("amount ${} exceeds your per-trade cap ${}", fmt_usd(usd_micro), fmt_usd(lim.per_tx_usd_micro))));
    }
    let day = now_ms / 86_400_000;
    let key = hkey(account, &format!("spent/{}", day));
    if commit {
        let v = bump_within(st, &key, usd_micro as i64, lim.daily_usd_micro as i64, "over_cap_daily",
            format!("would exceed your daily cap ${} (UTC day)", fmt_usd(lim.daily_usd_micro)))?;
        Ok(v as u64)
    } else {
        let v = st.incr(&key, 0)?;
        if v as u64 + usd_micro > lim.daily_usd_micro {
            return Err(err("over_cap_daily", format!("would exceed your daily cap ${} (UTC day)", fmt_usd(lim.daily_usd_micro))));
        }
        Ok(v as u64)
    }
}

pub fn fmt_usd(micro: u64) -> String {
    format!("{}.{:02}", micro / 1_000_000, (micro % 1_000_000) / 10_000)
}
/// "0.049974300000" -> 49974 micro-dollars (truncating). Rejects negatives/garbage.
pub fn parse_usd_micro(s: &str) -> Option<u64> {
    let (i, f) = s.split_once('.').unwrap_or((s, ""));
    let i: u64 = i.parse().ok()?;
    let mut f6: String = f.chars().take(6).collect();
    if !f6.chars().all(|c| c.is_ascii_digit()) { return None; }
    while f6.len() < 6 { f6.push('0'); }
    Some(i.checked_mul(1_000_000)? + f6.parse::<u64>().ok()?)
}

/// Implicit account id (hex of the ed25519 public key).
pub fn implicit_account(pk: &[u8; 32]) -> String {
    hex::encode(pk)
}
/// Token id for a newly minted key: deterministic per holder (one key per account by default).
pub fn token_id_for(account: &str) -> String {
    let h = Sha256::digest(account.as_bytes());
    format!("k{}", &hex::encode(h)[..16])
}

pub enum Action<'a> {
    FunctionCall { method: &'a str, args: &'a [u8], gas: u64, deposit: u128 },
    Transfer { deposit: u128 },
}

/// Borsh-encoded NEAR Transaction (V0): signer, ed25519 pk, nonce, receiver, block hash, actions.
pub fn encode_tx(signer: &str, pk: &[u8; 32], nonce: u64, receiver: &str, block_hash: &[u8; 32], actions: &[Action]) -> Vec<u8> {
    let mut v = Vec::new();
    borsh_string(&mut v, signer);
    v.push(0);
    v.extend_from_slice(pk);
    v.extend_from_slice(&nonce.to_le_bytes());
    borsh_string(&mut v, receiver);
    v.extend_from_slice(block_hash);
    v.extend_from_slice(&(actions.len() as u32).to_le_bytes());
    for a in actions {
        match a {
            Action::FunctionCall { method, args, gas, deposit } => {
                v.push(2);
                borsh_string(&mut v, method);
                v.extend_from_slice(&(args.len() as u32).to_le_bytes());
                v.extend_from_slice(args);
                v.extend_from_slice(&gas.to_le_bytes());
                v.extend_from_slice(&deposit.to_le_bytes());
            }
            Action::Transfer { deposit } => {
                v.push(3);
                v.extend_from_slice(&deposit.to_le_bytes());
            }
        }
    }
    v
}

/// Withdraw may pay only the account that signed the request.
pub fn assert_withdraw_to(signer: &str, to: &str) -> Result<(), Error> {
    if to != signer {
        return Err(err("bad_params", "params.to must be the account that signed this request"));
    }
    Ok(())
}

/// Attached gas for `nft_mint`. 20 Tgas. Unused gas is refunded. 10 Tgas is not used:
/// this mint writes the token, metadata, enumeration, tier, and a log, and a short
/// attach fails the whole mint.
pub const MINT_GAS: u64 = 20_000_000_000_000;
/// Attached deposit for that mint, in yoctoNEAR. Matches the call in `op_mint`.
pub const MINT_DEPOSIT_YOCTO: u128 = 12_000_000_000_000_000_000_000;
/// Kept on the minter for the fee after the deposit is attached.
const MINT_FEE_BUFFER_YOCTO: u128 = 2_000_000_000_000_000_000_000;

/// True when the minter balance can attach `MINT_DEPOSIT_YOCTO` and still pay the fee.
pub fn minter_can_mint(balance_yocto: u128) -> bool {
    balance_yocto >= MINT_DEPOSIT_YOCTO.saturating_add(MINT_FEE_BUFFER_YOCTO)
}

/// `owner_id` from `nft_token` is exactly the signer.
pub fn owner_is(owner_id: Option<&str>, account: &str) -> bool {
    owner_id == Some(account)
}

/// Admit a signed request. Ownership is checked before the nonce is consumed, so a
/// signature made by the previous holder is `not_owner`, not `replay`.
pub fn admit_request(signer: &str, current_owner: &str, time_ok: bool, nonce_fresh: bool) -> Result<(), Error> {
    if !time_ok {
        return Err(err("expired", "request timestamp is more than 5 minutes from chain time; sign a new request"));
    }
    if signer != current_owner {
        return Err(err("not_owner", "only the current key holder can authorize this"));
    }
    if !nonce_fresh {
        return Err(err("replay", "this signed request was already used; sign a new one"));
    }
    Ok(())
}

/// Re-read ownership immediately before a swap or withdraw is sent.
/// A transfer in between aborts the send. Funds stay in the custody account.
pub fn settle_if_owner(still_owner: bool) -> Result<(), Error> {
    if still_owner {
        Ok(())
    } else {
        Err(err("not_owner", "the key moved before this request settled; aborted, funds stay in the account"))
    }
}

fn zero_hash() -> String { "0".repeat(64) }

/// One row of the per-key log. `detail_hash` commits to the private detail.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProvEvent {
    pub i: u64,
    pub prev: String,
    pub kind: String,
    pub token_id: String,
    pub owner: String,
    pub ts_ms: u64,
    pub detail_hash: String,
}

pub fn detail_hash(detail: &str) -> String {
    hex::encode(Sha256::digest(detail.as_bytes()))
}

/// Field order is fixed so a verifier in another language recomputes the same bytes.
pub fn event_canonical(ev: &ProvEvent) -> String {
    format!(
        "{{\"detail_hash\":\"{}\",\"i\":{},\"kind\":\"{}\",\"owner\":\"{}\",\"prev\":\"{}\",\"token_id\":\"{}\",\"ts_ms\":{}}}",
        ev.detail_hash, ev.i, ev.kind, ev.owner, ev.prev, ev.token_id, ev.ts_ms
    )
}

pub fn event_hash(ev: &ProvEvent) -> String {
    hex::encode(Sha256::digest(event_canonical(ev).as_bytes()))
}

pub fn append_event(log: &mut Vec<ProvEvent>, kind: &str, token_id: &str, owner: &str, ts_ms: u64, detail: &str) -> String {
    let prev = log.last().map(event_hash).unwrap_or_else(zero_hash);
    let ev = ProvEvent {
        i: log.len() as u64,
        prev,
        kind: kind.to_string(),
        token_id: token_id.to_string(),
        owner: owner.to_string(),
        ts_ms,
        detail_hash: detail_hash(detail),
    };
    let h = event_hash(&ev);
    log.push(ev);
    h
}

pub fn verify_chain(log: &[ProvEvent]) -> Result<String, Error> {
    let mut prev = zero_hash();
    for (i, ev) in log.iter().enumerate() {
        if ev.i != i as u64 { return Err(err("bad_log", "event index does not match its place in the chain")); }
        if ev.prev != prev { return Err(err("bad_log", "event prev does not match the previous hash")); }
        prev = event_hash(ev);
    }
    Ok(prev)
}

pub fn sign_head(secret: &[u8; 32], head_hex: &str) -> String {
    let signing = SigningKey::from_bytes(secret);
    hex::encode(signing.sign(head_hex.as_bytes()).to_bytes())
}

pub fn verify_head(public: &[u8; 32], head_hex: &str, sig_hex: &str) -> bool {
    let Ok(raw) = hex::decode(sig_hex) else { return false };
    let Ok(raw) = <[u8; 64]>::try_from(raw) else { return false };
    let Ok(vk) = VerifyingKey::from_bytes(public) else { return false };
    vk.verify(head_hex.as_bytes(), &Signature::from_bytes(&raw)).is_ok()
}

/// Bronze pictures, same order as `POOLS.Bronze` in `web/lib/traits.ts`.
const BRONZE_ART: [u8; 3] = [3, 5, 8];

/// Base64 sha256 of `web/public/heirloom/keys/k01.webp` … `k10.webp` (NEP-177 `media_hash`).
const ART_MEDIA_HASH: [&str; 10] = [
    "9HSWMftzPmAPsHnX52j2CxUHKywOQxlTq0q+eaI5bYQ=",
    "a1sYMw3PPb+2OqyflFv+eDb20wa3ki3/+3MBAic5TnM=",
    "B54eqfNqqSN7SQwrj92CZIE0I8wuzKAPeoFTGEKEOcc=",
    "osCIIvNp8wELBdLaygJ8AEmJ/VXzK2dlZ5zMFOCcPIg=",
    "anYO1n9BD73N0+2k3SJF/NK3hBda0WVx1Xqzg1hwetw=",
    "pqmT7QdN6gLnZLiaYTFomKGRMjQbDCASMyDB+2CUnR8=",
    "DD6iCLxdUHUBxrxvKlfcw4yXgVFQyLsIc/G7NQtLNPg=",
    "wkprKA5JUUtPRrxG0EkmaTnfHFgW1Zv469wlZN4eyJg=",
    "7ZgN2xk3ZYqi70SDV4Geg+Seebq8lhBN4NKsnR1cxkg=",
    "QRajTrZBIkgUZctGgq7zMP68X9/Tr88VQF7EpuD0kKA=",
];

/// Key art for a tier-1 mint. Picture is `pool[sha256(contract_id + token_id)[0] % 3]`.
pub fn bronze_media(contract_id: &str, token_id: &str) -> (String, &'static str) {
    let digest = Sha256::digest(format!("{contract_id}{token_id}").as_bytes());
    let art = BRONZE_ART[(digest[0] as usize) % BRONZE_ART.len()];
    let url = format!("https://keyhole-seven.vercel.app/heirloom/keys/k{art:02}.webp");
    (url, ART_MEDIA_HASH[(art as usize) - 1])
}

/// SignedTransaction = tx || ed25519 signature over sha256(tx).
pub fn sign_tx(sk: &[u8; 32], tx: &[u8]) -> Vec<u8> {
    use ed25519_dalek::Signer;
    let k = ed25519_dalek::SigningKey::from_bytes(sk);
    let sig = k.sign(&Sha256::digest(tx));
    let mut v = tx.to_vec();
    v.push(0);
    v.extend_from_slice(&sig.to_bytes());
    v
}

#[cfg(test)]
mod tests;
