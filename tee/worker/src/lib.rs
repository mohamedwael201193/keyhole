//! KEYHOLE worker core: pure, host-independent logic (unit-tested natively).
//! The OutLayer host glue lives in main.rs.
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
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

#[cfg(test)]
mod tests;
