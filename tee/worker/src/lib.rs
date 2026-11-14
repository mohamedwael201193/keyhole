//! KEYHOLE worker core: pure, host-independent logic (unit-tested natively).
//! The OutLayer host glue lives in main.rs.
pub mod provenance;
pub mod mint_payout;
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
    let mut req: SignedRequest = serde_json::from_str(&auth.message)
        .map_err(|_| err("bad_message", "signed message must be JSON {op, account_id, ts_ms, params}"))?;
    // Sign-in-and-sign-message (near-connect, https://github.com/hot-dao/near-selector (@hot-labs/near-connect README, "Initialize connection to wallet and sign in"; docs: https://docs.near.org/web3-apps/tutorials/wallet-login)):
    // the message is built before the account is known, so a `session` request may leave account_id empty. The account is
    // then the NEP-413 signer, which the caller still proves with the full-access-key check
    // (https://docs.near.org/web3-apps/backend/backend). Every other op must name its account.
    if req.op == "session" && req.account_id.is_empty() { req.account_id = auth.account_id.clone(); }
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
    /// Keys that start with `prefix`. Used only to find nonce records to prune.
    fn list_prefix(&mut self, prefix: &str) -> Result<Vec<String>, Error>;
    /// The record at `key`; empty when there is none.
    fn read(&mut self, key: &str) -> Result<Vec<u8>, Error>;
    /// Remove the record at `key`, if there is one.
    fn remove(&mut self, key: &str) -> Result<(), Error>;
}

/// Per-holder namespace. Account ids cannot contain '/', so prefixes cannot collide.
pub fn hkey(account: &str, rest: &str) -> String {
    format!("h/{}/{}", account, rest)
}

/// How long a nonce record is kept after its first use, in chain time.
///
/// Replay is refused in two ways. The nonce record refuses a second use, and a request whose signed
/// `ts_ms` is more than MAX_SKEW_MS from chain time is refused as `expired`. A request is accepted only
/// when `|ts_ms - chain_now| <= MAX_SKEW_MS`, and the record stores the chain time of the first use `t0`,
/// so `ts_ms <= t0 + MAX_SKEW_MS`. A replay of the same request can pass the freshness check only while
/// `chain_now <= ts_ms + MAX_SKEW_MS <= t0 + 2 * MAX_SKEW_MS`. Past that point the replay is refused as
/// `expired` whether or not the record exists, so a record older than that may be deleted. One extra
/// MAX_SKEW_MS is kept as a margin against chain-time jitter between reads.
pub const NONCE_RETAIN_MS: u64 = 3 * MAX_SKEW_MS;

/// Replay protection: each (account, nonce) is accepted once, ever. Records are kept (no pruning on the call path).
pub fn consume_nonce(st: &mut dyn Store, account: &str, nonce: &[u8; 32], now_ms: u64) -> Result<(), Error> {
    let fresh = st.set_if_absent(&hkey(account, &format!("n/{}", hex::encode(nonce))), now_ms.to_string().as_bytes())?;
    // No pruning on this path. Build ebeb6a34 pruned here with a storage key listing, and on OutLayer that
    // listing blocked every signed call until the 60 s execution limit. `prune_nonces` stays a pure helper,
    // not called by any op, until a bounded way to list keys is proven on the platform.
    if fresh { Ok(()) } else { Err(err("replay", "this signed request was already used; sign a new one")) }
}

/// Deletes this account's nonce records older than NONCE_RETAIN_MS. A record that cannot be read as a
/// time is kept. Returns how many were removed. Only keys under `h/<account>/n/` are touched.
pub fn prune_nonces(st: &mut dyn Store, account: &str, now_ms: u64) -> Result<u32, Error> {
    let mut removed = 0;
    for key in st.list_prefix(&hkey(account, "n/"))? {
        let raw = st.read(&key)?;
        let Some(first_used) = std::str::from_utf8(&raw).ok().and_then(|s| s.parse::<u64>().ok()) else { continue };
        if first_used.saturating_add(NONCE_RETAIN_MS) < now_ms {
            st.remove(&key)?;
            removed += 1;
        }
    }
    Ok(removed)
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

/// Dollars for messages: 2 decimals when cent-exact, else 4 (truncated), or 6 below $0.0001, so a sub-cent cap never reads "$0.00".
pub fn fmt_usd(micro: u64) -> String {
    let (i, f) = (micro / 1_000_000, micro % 1_000_000);
    if f % 10_000 == 0 { format!("{}.{:02}", i, f / 10_000) }
    else if micro >= 100 { format!("{}.{:04}", i, f / 100) }
    else { format!("{}.{:06}", i, f) }
}

pub fn sha256_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

/// Successful swaps (and copies) this holder made: count, total USD paid (micro, priced at trade time),
/// summed output per token in base units, and the first trade time.
pub fn pnl_aggregate(entries: &[serde_json::Value]) -> (u64, u64, std::collections::BTreeMap<String, u128>, u64) {
    let mut outs = std::collections::BTreeMap::new();
    let (mut n, mut cost, mut since) = (0u64, 0u64, 0u64);
    for e in entries {
        let kind = e.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if !(kind == "swap" || kind == "copy") || e.get("status").and_then(|v| v.as_str()) != Some("success") { continue; }
        let Some(tout) = e.get("token_out").and_then(|v| v.as_str()) else { continue };
        let amt: u128 = e.get("amount_out").and_then(|v| v.as_str().map(|x| x.to_string()).or_else(|| v.as_u64().map(|x| x.to_string())))
            .and_then(|x| x.parse().ok()).unwrap_or(0);
        if amt == 0 { continue; }
        *outs.entry(tout.to_string()).or_insert(0u128) += amt;
        cost = cost.saturating_add(e.get("usd_in_micro").and_then(|v| v.as_u64()).unwrap_or(0));
        let ts = e.get("ts_ms").and_then(|v| v.as_u64()).unwrap_or(0);
        if since == 0 || (ts > 0 && ts < since) { since = ts; }
        n += 1;
    }
    (n, cost, outs, since)
}

/// Holder-published PnL statement, signed by the enclave minter key. It carries totals only:
/// no balances, no per-trade amounts, no tokens. Keys sorted, no spaces.
#[allow(clippy::too_many_arguments)]
pub fn pnl_canonical(token_id: &str, owner: &str, trades: u64, cost: u64, value_now: u64, since_ms: u64, log_head: &str, ts_ms: u64) -> String {
    let pnl = value_now as i128 - cost as i128;
    format!(
        "{{\"cost_usd_micro\":{},\"kind\":\"keyhole-pnl-v1\",\"log_head\":\"{}\",\"method\":\"mark-to-market of each trade's output vs the USD paid at trade time\",\"owner\":\"{}\",\"pnl_usd_micro\":{},\"since_ms\":{},\"token_id\":\"{}\",\"trades\":{},\"ts_ms\":{},\"value_now_usd_micro\":{}}}",
        cost, log_head, owner, pnl, since_ms, token_id, trades, ts_ms, value_now
    )
}
/// "0.049974300000" -> 49974 micro-dollars (truncating). Rejects negatives/garbage.
pub fn parse_usd_micro(s: &str) -> Option<u64> {
    let (i, f) = s.split_once('.').unwrap_or((s, ""));
    // Digits only on both sides (no sign, no spaces, no trailing junk after the 6th decimal).
    if i.is_empty() || !i.bytes().all(|c| c.is_ascii_digit()) || !f.bytes().all(|c| c.is_ascii_digit()) { return None; }
    let i: u64 = i.parse().ok()?;
    let mut f6: String = f.chars().take(6).collect();
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
    /// Function-call access key: zero-deposit calls to `receiver`, only `methods`, gas paid from `allowance`.
    AddFcKey { pk: [u8; 32], allowance: u128, receiver: &'a str, methods: &'a [&'a str] },
    DeleteKey { pk: [u8; 32] },
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
            Action::AddFcKey { pk, allowance, receiver, methods } => {
                v.push(5);
                v.push(0);
                v.extend_from_slice(pk);
                v.extend_from_slice(&0u64.to_le_bytes()); // access key nonce
                v.push(0); // FunctionCall permission
                v.push(1); // Some(allowance)
                v.extend_from_slice(&allowance.to_le_bytes());
                borsh_string(&mut v, receiver);
                v.extend_from_slice(&(methods.len() as u32).to_le_bytes());
                for m in methods.iter() { borsh_string(&mut v, m); }
            }
            Action::DeleteKey { pk } => {
                v.push(6);
                v.push(0);
                v.extend_from_slice(pk);
            }
        }
    }
    v
}

/// Address parsing only; this does NOT authorize a withdrawal. Use `assert_withdraw_to` for that.
pub fn validate_chain_address(chain: &str, to: &str) -> Result<(), Error> {
    let ok = match chain {
        "near" => is_valid_account_id(to),
        "sol" => is_sol_address(to),
        "eth" | "base" | "arb" | "op" | "bsc" | "pol" | "avax" | "gnosis" => is_evm_address(to),
        _ => return Err(err("bad_params", "params.chain is not a supported withdraw chain")),
    };
    if ok { Ok(()) } else { Err(err("bad_params", "params.to is not a valid address for params.chain")) }
}

/// Standard self-exit policy. Address syntax alone is NOT proof of destination ownership.
/// NEP-413 proves the NEAR account; EIP-191 proves the same 0x holder on allowlisted EVM chains.
pub fn self_withdraw_destination(holder:&str,chain:&str,requested:Option<&str>,scheme:&str)->Result<String,Error>{
    if scheme!="nep413"||chain!="near"||!is_valid_account_id(holder){return Err(err("destination_policy","withdrawals require the current holder NEAR account"));}
    if requested.is_some_and(|to|to!=holder){return Err(err("destination_policy","withdrawals pay only the current holder"));}
    validate_chain_address(chain,holder)?;Ok(holder.to_owned())
}

/// A withdrawal pays only the verified current NFT holder's own NEAR account.
/// `current_owner` must come from nft_token at final finality, never request params.
/// Authentication alone is not sufficient: the owner may have changed since it ran.
pub fn assert_withdraw_to(chain: &str, to: &str, signer: &str, current_owner: Option<&str>) -> Result<(), Error> {
    if !owner_is(current_owner, signer) {
        return Err(err("not_owner", "only the current key holder can withdraw"));
    }
    if chain != "near" || to != signer {
        return Err(err("bad_params", "withdrawals pay only the current holder's NEAR account on NEAR"));
    }
    validate_chain_address("near", to)
}

/// Solana address: base58 that decodes to exactly 32 bytes.
pub fn is_sol_address(a: &str) -> bool {
    bs58::decode(a).into_vec().map(|b| b.len() == 32).unwrap_or(false)
}

/// EVM address: `0x` and 40 hex digits. All-lower or all-upper hex is accepted as is. Mixed case must carry the
/// EIP-55 checksum, so a mistyped address is refused instead of paid.
pub fn is_evm_address(a: &str) -> bool {
    let Some(h) = a.strip_prefix("0x") else { return false };
    if h.len() != 40 || !h.bytes().all(|b| b.is_ascii_hexdigit()) { return false; }
    let mixed = h.bytes().any(|b| b.is_ascii_lowercase()) && h.bytes().any(|b| b.is_ascii_uppercase());
    !mixed || eip55(&h.to_ascii_lowercase()) == h
}

/// EIP-55 checksum of 40 lowercase hex digits (without `0x`): a letter is upper-case when the matching nibble of
/// keccak256(lowercase hex) is 8 or more. Returns the digits only.
pub fn eip55(lower_hex: &str) -> String {
    use sha3::Keccak256;
    let ch = Keccak256::digest(lower_hex.as_bytes());
    lower_hex.chars().enumerate().map(|(i, c)| {
        let nib = (ch[i / 2] >> if i % 2 == 0 { 4 } else { 0 }) & 0xf;
        if c.is_ascii_alphabetic() && nib >= 8 { c.to_ascii_uppercase() } else { c }
    }).collect()
}

/// The refusal for a key that is not listed for sale, as `record` answers it.
pub const NOT_LISTED_MSG: &str = "A key's record is public only while it is listed for sale.";

/// The sale listing a public record names: the seller and the price as a decimal yocto string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordListing {
    pub seller: String,
    pub price_yocto: String,
}

/// The listing decision for `record`. `listing` is the `nft_listing` answer: `null` (not listed) or a missing method
/// gives `not_listed`. An object gives the seller and price. Any other RPC error, or an answer that is neither, fails
/// closed as `rpc`. Unlike `listing_blocks` (which lets an unlisted key move), a record is only ever for a listed key.
pub fn record_listing(listing: Result<&serde_json::Value, &str>) -> Result<RecordListing, Error> {
    match listing {
        Err(e) if is_method_not_found(e) => Err(err("not_listed", NOT_LISTED_MSG)),
        Err(e) => Err(err("rpc", format!("could not read the sale listing: {}", e.chars().take(200).collect::<String>()))),
        Ok(serde_json::Value::Null) => Err(err("not_listed", NOT_LISTED_MSG)),
        Ok(v) if v.is_object() => {
            let seller = v.get("seller").and_then(|x| x.as_str()).filter(|x| is_valid_account_id(x))
                .ok_or_else(|| err("rpc", "the sale listing names no valid seller"))?;
            let price = v.get("price").and_then(|x| x.as_str().map(str::to_string).or_else(|| x.as_u64().map(|n| n.to_string())))
                .filter(|x| !x.is_empty() && x.bytes().all(|b| b.is_ascii_digit()))
                .ok_or_else(|| err("rpc", "the sale listing names no price"))?;
            Ok(RecordListing { seller: seller.to_string(), price_yocto: price })
        }
        Ok(_) => Err(err("rpc", "could not read the sale listing: unexpected answer")),
    }
}

/// JSON string literal for `s`, with every escape the JSON grammar needs.
fn json_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
}

/// Canonical bytes of a public record (`record` op). Keys are in alphabetical order, no spaces, every string escaped.
/// The totals are the PnL figures `pnl_aggregate` gives, with `outs` as per-asset output amounts (strings).
#[allow(clippy::too_many_arguments)]
pub fn record_canonical(token_id: &str, owner: &str, tier: u8, seller: &str, listing_price_yocto: &str, settled_swaps: u32,
    volume_usd_micro: u64, trades: u64, cost_usd_micro: u64, outs: &std::collections::BTreeMap<String, u128>, since_ms: u64,
    log_head: &str, ts_ms: u64) -> String {
    let outs_json: Vec<String> = outs.iter().map(|(asset, amt)| format!("{}:\"{}\"", json_str(asset), amt)).collect();
    format!(
        "{{\"cost_usd_micro\":{},\"kind\":\"keyhole-record-v1\",\"listing_price_yocto\":{},\"log_head\":{},\"outs\":{{{}}},\"owner\":{},\"seller\":{},\"settled_swaps\":{},\"since_ms\":{},\"tier\":{},\"token_id\":{},\"trades\":{},\"ts_ms\":{},\"volume_usd_micro\":{}}}",
        cost_usd_micro, json_str(listing_price_yocto), json_str(log_head), outs_json.join(","), json_str(owner), json_str(seller),
        settled_swaps, since_ms, tier, json_str(token_id), trades, ts_ms, volume_usd_micro
    )
}

/// Attached gas for `nft_mint`. 20 Tgas. Unused gas is refunded. 10 Tgas is not used:
/// this mint writes the token, metadata, enumeration, tier, and a log, and a short
/// attach fails the whole mint.
pub const MINT_GAS: u64 = 20_000_000_000_000;
/// Attached deposit for that mint, in yoctoNEAR. Matches the call in `op_mint`.
pub const MINT_DEPOSIT_YOCTO: u128 = 12_000_000_000_000_000_000_000;
/// Kept on the minter on top of the deposit. NEAR charges the attached gas up front at the
/// protocol gas price (20 Tgas x 1e9 yocto = 0.02 NEAR, mostly refunded), and the minter's own
/// storage (~0.002 NEAR) cannot be spent. A smaller buffer lets the RPC reject the tx with
/// NotEnoughBalance instead of answering `minter_low_balance`.
pub const MINT_FEE_BUFFER_YOCTO: u128 = 22_000_000_000_000_000_000_000;

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

/// Per-key settlement epoch. Bumped when the enclave first sees a new owner (transfer or sale).
/// A value-move stamped with epoch `E` must not settle if the key's epoch is no longer `E`.
/// See https://docs.near.org/protocol/accounts-contracts/access-keys (ownership as the control plane)
/// and the Track 10 mid-payout requirement.
pub fn bump_epoch(current: u64) -> u64 {
    current.saturating_add(1)
}

/// Parse an epoch stored as decimal ASCII bytes. Missing or empty storage is epoch 0.
pub fn epoch_from_bytes(raw: &[u8]) -> u64 {
    if raw.is_empty() { return 0; }
    std::str::from_utf8(raw).ok().and_then(|s| s.parse().ok()).unwrap_or(0)
}

pub fn epoch_to_bytes(epoch: u64) -> Vec<u8> {
    epoch.to_string().into_bytes()
}

/// Refuse to settle a value-move whose stamped epoch no longer matches the key's current epoch.
/// Funds that have not yet left custody stay in the account.
pub fn settle_if_epoch(stamped: u64, current: u64) -> Result<(), Error> {
    if stamped == current {
        Ok(())
    } else {
        Err(err(
            "epoch_void",
            "the key's settlement epoch moved before this request settled; aborted, funds stay in the account",
        ))
    }
}

/// After a custody move: ownership loss or an epoch bump both turn a success/pending into `needs_review`.
pub fn after_move_status_epoch(status: &str, still_owner: bool, stamped: u64, current: u64) -> String {
    let base = after_move_status(status, still_owner);
    if base == "needs_review" { return base; }
    let moved = matches!(status, "success" | "pending" | "processing" | "submitted");
    if moved && stamped != current { "needs_review".into() } else { base }
}

fn zero_hash() -> String { "0".repeat(64) }

/// One row of the per-key log. `detail_hash` commits to the private detail.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ProvEvent {
    pub i: u64,
    pub prev: String,
    pub kind: String,
    pub token_id: String,
    pub owner: String,
    pub ts_ms: u64,
    pub detail_hash: String,
    #[serde(default = "provenance::legacy_version")]
    pub v: u8,
    #[serde(default)]
    pub contract: String,
    #[serde(default)]
    pub owner_epoch: u64,
}

pub fn detail_hash(detail: &str) -> String {
    hex::encode(Sha256::digest(detail.as_bytes()))
}

/// Field order is fixed so a verifier in another language recomputes the same bytes.
pub fn event_canonical(ev: &ProvEvent) -> String {
    if ev.v == 2 { return provenance::canonical_v2(ev); }
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
        v: 1, contract: String::new(), owner_epoch: 0,
    };
    let h = event_hash(&ev);
    log.push(ev);
    h
}

pub fn verify_chain(log: &[ProvEvent]) -> Result<String, Error> {
    let mut prev = zero_hash();
    for (i, ev) in log.iter().enumerate() {
        if ev.v != 1 && ev.v != 2 { return Err(err("bad_log", "unsupported commitment version")); }
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


// ---------- Sessions: NEAR's documented backend-auth pattern ----------
// https://docs.near.org/web3-apps/backend/backend#backend-auth-with-a-near-wallet
// The wallet signs ONE NEP-413 message (nonce, recipient, full-access key check, as documented).
// The backend (here: the enclave) verifies it and issues a session. Later calls present the session
// token instead of a new wallet signature. Nothing beyond NEP-413 + a server-issued token is used.

/// Longest a session may live.
pub const SESSION_MAX_MS: u64 = 30 * 60 * 1000;
/// Largest spend cap a session may carry (USD micro); tier and holder caps still apply on top.
pub const SESSION_MAX_USD_MICRO: u64 = 1_000_000_000;
/// Ops a session may run. `limits` only lowers caps. Withdraw, raising limits, lock, prove, mint, chain_sign
/// and the other custody moves always need a fresh wallet signature (NEP-413 or EIP-191), never a session token.
/// A bearer token that can move funds out of the account would be a second key, so withdraw is not in scope.
pub const SESSION_OPS: &[&str] = &["status", "quote", "account", "balance", "swap", "copy", "history", "pnl", "limits", "dashboard", "level_up", "session_revoke"];

/// `auth` for scheme "session".
#[derive(Debug, Clone, Deserialize)]
pub struct SessionAuth {
    pub scheme: String,
    /// base64 32-byte token the enclave issued for op "session".
    pub token: String,
    /// JSON {op, account_id, ts_ms, params} for this call.
    pub message: String,
    /// base64 32 bytes, single use (replay protection, same store as wallet nonces).
    pub nonce: String,
    pub recipient: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionGrant {
    pub account: String,
    pub token_id: String,
    pub iat_ms: u64,
    pub exp_ms: u64,
    pub max_usd_micro: u64,
    pub scope: Vec<String>,
}

/// sha256 of the token, hex: the only form the enclave stores.
pub fn session_id(token: &[u8; 32]) -> String { hex::encode(Sha256::digest(token)) }
pub fn session_key(id: &str, rest: &str) -> String { format!("s/{}/{}", id, rest) }

/// Build the grant from the wallet-signed `session` request. Expiry is now + min(asked, 30 min).
pub fn grant_from_request(req: &SignedRequest, token_id: &str, now_ms: u64) -> Result<SessionGrant, Error> {
    if req.op != "session" { return Err(err("bad_session", "a session starts from a signed 'session' request")); }
    if token_id.is_empty() || token_id.len() > 64 { return Err(err("bad_session", "token_id missing")); }
    if let Some(t) = req.params.get("token_id").and_then(|v| v.as_str()) { if t != token_id { return Err(err("session_token", "the signed token_id is not the key this account holds")); } }
    let ttl = req.params.get("ttl_ms").and_then(|v| v.as_u64()).unwrap_or(SESSION_MAX_MS);
    if ttl == 0 || ttl > SESSION_MAX_MS { return Err(err("session_too_long", "a session may last at most 30 minutes")); }
    let max_usd_micro = req.params.get("max_usd_micro").and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|x| x.parse().ok())))
        .filter(|m| *m > 0 && *m <= SESSION_MAX_USD_MICRO).ok_or_else(|| err("bad_session", "max_usd_micro must be 1..=1000000000"))?;
    let scope: Vec<String> = match req.params.get("scope") {
        None => SESSION_OPS.iter().map(|x| x.to_string()).collect(),
        Some(v) => v.as_array().ok_or_else(|| err("bad_session", "scope must be a list of ops"))?
            .iter().filter_map(|x| x.as_str()).filter(|x| SESSION_OPS.contains(x)).map(|x| x.to_string()).collect(),
    };
    if scope.is_empty() { return Err(err("bad_session", "scope has no allowed ops")); }
    Ok(SessionGrant { account: req.account_id.clone(), token_id: token_id.to_string(), iat_ms: now_ms, exp_ms: now_ms + ttl, max_usd_micro, scope })
}

/// Expiry check at use time.
pub fn check_grant_time(g: &SessionGrant, now_ms: u64) -> Result<(), Error> {
    if g.exp_ms <= g.iat_ms || g.exp_ms - g.iat_ms > SESSION_MAX_MS { return Err(err("session_too_long", "a session may last at most 30 minutes")); }
    if now_ms >= g.exp_ms { return Err(err("session_expired", "this session has expired; unlock again with one wallet signature")); }
    Ok(())
}

/// Decode the token; returns its id (sha256 hex).
pub fn parse_session_token(t: &str) -> Result<String, Error> {
    let b: [u8; 32] = B64.decode(t).ok().and_then(|x| x.try_into().ok()).ok_or_else(|| err("bad_session", "session token must be 32 bytes, base64"))?;
    Ok(session_id(&b))
}

/// Check a session request against its grant: recipient, scope, op, account and token.
pub fn verify_session_request(s: &SessionAuth, g: &SessionGrant, expected_recipient: &str, op: &str) -> Result<(SignedRequest, [u8; 32]), Error> {
    if s.recipient != expected_recipient { return Err(err("wrong_recipient", "session request made for another recipient")); }
    if !SESSION_OPS.contains(&op) || !g.scope.iter().any(|x| x == op) { return Err(err("session_scope", "this action needs a fresh wallet signature, not a session")); }
    let nonce: [u8; 32] = B64.decode(&s.nonce).ok().and_then(|n| n.try_into().ok()).ok_or_else(|| err("bad_nonce", "nonce must be 32 bytes, base64"))?;
    let req: SignedRequest = serde_json::from_str(&s.message).map_err(|_| err("bad_message", "session message must be JSON {op, account_id, ts_ms, params}"))?;
    if req.op != op { return Err(err("op_mismatch", format!("request op '{}' but called '{}'", req.op, op))); }
    if req.account_id != g.account { return Err(err("account_mismatch", "session request names another account")); }
    if let Some(t) = req.params.get("token_id").and_then(|v| v.as_str()) {
        if t != g.token_id { return Err(err("session_token", "this session is for another key")); }
    }
    Ok((req, nonce))
}

/// Charge `usd` to a session; refuses (and undoes) past the grant's cap.
pub fn session_charge(st: &mut dyn Store, id: &str, g: &SessionGrant, usd: u64) -> Result<u64, Error> {
    let k = session_key(id, "spent");
    let now = st.incr(&k, usd as i64)?;
    if now as u64 > g.max_usd_micro {
        let _ = st.incr(&k, -(usd as i64));
        return Err(err("session_cap", "this session's spend cap is used up; unlock a new session or sign in your wallet"));
    }
    Ok(now as u64)
}

/// Wall-clock budget of one worker call. OutLayer's default max_execution_seconds is 60 (callers
/// here send no override), so the worker plans for 50 s: no new phase starts without room for it,
/// and a call that runs out of room returns a resumable pending result instead of being killed.
pub mod budget {
    use std::cell::Cell;
    /// Round 4: raised from 50 s to 150 s. The 50 s budget was set for a
    /// 60 s client; the client now allows 180 s (the host cap), and the
    /// worker itself was aborting the exit at 50 s even with a 180 s
    /// client. 150 s leaves a 30 s margin under the 180 s host cap for
    /// host overhead and the response.
    pub const TOTAL_MS: u64 = 150_000;
    /// The reservation (spend charge) is made only if the call is still this young.
    /// Round 4: raised from 20 s to 60 s (3x, in step with TOTAL_MS).
    /// The preflight is 13 cached reads; at ~3 s per RPC that is ~39 s
    /// (52 s at 4 s/RPC — gate trips only at ~4.6 s/RPC). Remaining 90 s covers begin + drive + finish.
    pub const PRE_CHARGE_MAX_MS: u64 = 60_000;
    /// begin_value_op (a NONE send + short status polls, never a FINAL wait
    /// inside one host call — the host caps every near:rpc call at 30 s)
    /// needs at least this much room. Unchanged: a begin needs ~8-15 s.
    pub const BEGIN_MIN_LEFT_MS: u64 = 25_000;
    /// One exit hop (validate, FINAL readbacks, POST, re-read) needs at least this much room.
    /// Unchanged: a hop needs ~15 s, and 22 s is a safe minimum.
    pub const HOP_MIN_LEFT_MS: u64 = 22_000;
    thread_local! {
        static START: Cell<Option<std::time::Instant>> = const { Cell::new(None) };
        static FAKE_ELAPSED: Cell<Option<u64>> = const { Cell::new(None) };
    }
    pub fn start() {
        START.with(|s| s.set(Some(std::time::Instant::now())));
    }
    pub fn set_elapsed_for_test(ms: Option<u64>) {
        FAKE_ELAPSED.with(|f| f.set(ms));
    }
    pub fn elapsed_ms() -> u64 {
        if let Some(v) = FAKE_ELAPSED.with(|f| f.get()) {
            return v;
        }
        START.with(|s| s.get().map(|t| t.elapsed().as_millis() as u64).unwrap_or(0))
    }
    pub fn left_ms() -> u64 {
        TOTAL_MS.saturating_sub(elapsed_ms())
    }
    pub fn pre_charge_ok() -> bool {
        elapsed_ms() <= PRE_CHARGE_MAX_MS
    }
    pub fn begin_ok() -> bool {
        left_ms() >= BEGIN_MIN_LEFT_MS
    }
}

/// A spend held against the session cap (when the call runs in a session) and the key's daily cap.
/// Every refusal before the send gives it back at once (`charge_spend`). A send that failed for good
/// gives it back in `settle`. A send still pending or under review keeps it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Charge {
    day_key: String,
    session_id: Option<String>,
    usd: u64,
}

impl Charge { pub fn usd_micro(&self)->u64 { self.usd } }

/// Hold `usd` for one swap or withdraw. Both counters move only when the whole hold succeeds: the
/// session is charged first, and if the daily check then refuses, the session charge is undone too.
pub fn charge_spend(st: &mut dyn Store, cap: &str, lim: &Limits, session: Option<(&str, &SessionGrant)>, usd: u64, now_ms: u64) -> Result<Charge, Error> {
    if let Some((id, g)) = session { session_charge(st, id, g, usd)?; }
    if let Err(e) = enforce_caps(st, cap, lim, usd, now_ms, true) {
        if let Some((id, _)) = session { let _ = st.incr(&session_key(id, "spent"), -(usd as i64)); }
        return Err(e);
    }
    Ok(Charge {
        day_key: hkey(cap, &format!("spent/{}", now_ms / 86_400_000)),
        session_id: session.map(|(id, _)| id.to_string()),
        usd,
    })
}

impl Charge {
    /// Give the whole hold back: the session budget and the day's spend.
    pub fn release(&self, st: &mut dyn Store) {
        if let Some(id) = &self.session_id { let _ = st.incr(&session_key(id, "spent"), -(self.usd as i64)); }
        let _ = st.incr(&self.day_key, -(self.usd as i64));
    }
    /// After the wallet answers: give the hold back only on a final failure (see `cap_refund_on`).
    pub fn settle(&self, st: &mut dyn Store, status: &str) {
        if cap_refund_on(status) { self.release(st); }
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
#[path = "op_cost_tests.rs"]
mod op_cost_tests;
#[cfg(test)]
mod p2harden;

// ---------- custody bound to the key (token_id), not to the NEAR account ----------

/// Enclave storage key for state that belongs to a key: `t/<token_id>/<rest>`.
pub fn tkey(token: &str, rest: &str) -> String {
    format!("t/{}/{}", token, rest)
}

/// Id used for the per-day spend caps of a key. NEAR account ids cannot contain `:`,
/// so this never collides with a holder's own `h/<account>/…` keys.
pub fn cap_id(token: &str) -> String {
    format!("tok:{}", token)
}

/// Storage with reads, for the custody record and its one-time migration.
pub trait Kv: Store {
    fn get(&self, key: &str) -> Vec<u8>;
    fn set(&mut self, key: &str, val: &[u8]);
}

/// The custody wallet record of `token`, or `None` when the key has none yet.
///
/// One-time migration: builds up to b3fa1a39 kept the wallet under `h/<account>/wallet`.
/// When the current owner of `token` still has such a legacy wallet, it moves to this
/// token once. `h/<owner>/migrated` is claimed first with `set_if_absent`, so a legacy
/// wallet is bound to at most one token even if two calls race. The legacy trade log
/// is copied with `by` set to that owner, so a later holder does not read its rows.
pub fn custody_lookup<K: Kv>(kv: &mut K, token: &str, owner: &str) -> Result<Option<Vec<u8>>, Error> {
    let k = tkey(token, "wallet");
    let v = kv.get(&k);
    if !v.is_empty() {
        return Ok(Some(v));
    }
    let legacy = kv.get(&hkey(owner, "wallet"));
    if legacy.is_empty() {
        return Ok(None);
    }
    let mk = hkey(owner, "migrated");
    kv.set_if_absent(&mk, token.as_bytes())?;
    if kv.get(&mk) != token.as_bytes() {
        return Ok(None);
    }
    kv.set_if_absent(&k, &legacy)?;
    let lk = tkey(token, "log");
    if kv.get(&lk).is_empty() {
        let old: Vec<serde_json::Value> = serde_json::from_slice(&kv.get(&hkey(owner, "log"))).unwrap_or_default();
        let tagged: Vec<serde_json::Value> = old.into_iter().map(|mut e| {
            if let Some(o) = e.as_object_mut() { o.entry("by").or_insert_with(|| serde_json::json!(owner)); }
            e
        }).collect();
        if !tagged.is_empty() {
            kv.set(&lk, serde_json::to_string(&tagged).unwrap_or_else(|_| "[]".into()).as_bytes());
        }
    }
    Ok(Some(kv.get(&k)))
}

/// Trade-log rows the signer may read: only rows that signer wrote.
pub fn history_for(entries: &[serde_json::Value], signer: &str) -> Vec<serde_json::Value> {
    entries.iter().filter(|e| e.get("by").and_then(|b| b.as_str()) == Some(signer)).cloned().collect()
}

/// Longest seller lock, in hours.
pub const MAX_LOCK_HOURS: u64 = 168;

/// Stored lock value: `<owner>|<until_ms>`.
pub fn lock_value(owner: &str, until_ms: u64) -> String {
    format!("{}|{}", owner, until_ms)
}

/// `Some(until_ms)` while a lock set by `owner` is still running. A lock set by a
/// previous owner does not bind the new owner, so a transfer clears it.
pub fn active_lock(raw: &[u8], owner: &str, now_ms: u64) -> Option<u64> {
    let s = std::str::from_utf8(raw).ok()?;
    let (who, until) = s.rsplit_once('|')?;
    let until: u64 = until.parse().ok()?;
    (who == owner && now_ms < until).then_some(until)
}

/// Refuse a swap or withdraw while the owner's lock runs. A holder cannot lift a lock
/// early, so a buyer who checked a `prove` statement knows funds cannot leave before then.
pub fn assert_unlocked(raw: &[u8], owner: &str, now_ms: u64) -> Result<(), Error> {
    match active_lock(raw, owner, now_ms) {
        Some(until) => Err(err("locked", format!("this key is locked for sale until {} (unix ms); swap and withdraw resume then or after a transfer", until))),
        None => Ok(()),
    }
}

/// Refusal text for a value move while the key is listed for sale (code `listed`).
pub const LISTED_MSG: &str = "This key is listed for sale; unlist it to move funds.";

/// Ops that move value out of the key's account, or sign for it. They are refused while the key is listed.
/// Reads (balance, history, pnl, dashboard, account, prove, ...) are not here and are never refused for a listing.
/// `quote` with `execute: true` is a value move too: see `is_value_move_or_wet_quote`.
pub fn is_value_move(op: &str) -> bool {
    matches!(op, "withdraw" | "exact_near_exit_v1" | "swap" | "copy" | "chain_sign")
}

/// True for every listing-frozen op, including a wet quote (`quote` with `execute: true`).
/// A dry quote (`execute: false` or omitted) stays readable while listed.
pub fn is_value_move_or_wet_quote(op: &str, execute: bool) -> bool {
    is_value_move(op) || (op == "quote" && execute)
}

/// True for the NEAR RPC error of a view on a method the contract does not have (a v2.3 keys contract has no `nft_listing`).
/// Compared with letters and digits only, so `MethodNotFound` and `method not found` both match.
fn is_method_not_found(rpc_error: &str) -> bool {
    let norm: String = rpc_error.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
    norm.contains("methodnotfound")
}

/// The listing decision for one op. `listing` is the `nft_listing` answer: `Ok` with `null` when the key is not
/// listed, an object when it is, or `Err` with the RPC error text. A missing method counts as not listed, so a
/// v2.3 keys contract keeps working. Any other error, or an answer that is neither null nor an object, fails closed.
pub fn listing_blocks(op: &str, listing: Result<&serde_json::Value, &str>) -> Result<(), Error> {
    listing_blocks_ex(op, false, listing)
}

/// Like `listing_blocks`, but a wet quote (`op == "quote"` and `execute`) is treated as a value move.
pub fn listing_blocks_ex(op: &str, execute: bool, listing: Result<&serde_json::Value, &str>) -> Result<(), Error> {
    if !is_value_move_or_wet_quote(op, execute) { return Ok(()); }
    match listing {
        Err(e) if is_method_not_found(e) => Ok(()),
        Err(e) => Err(err("rpc", format!("could not read the sale listing, nothing was sent: {}", e.chars().take(200).collect::<String>()))),
        Ok(serde_json::Value::Null) => Ok(()),
        Ok(v) if v.is_object() => Err(err("listed", LISTED_MSG)),
        Ok(_) => Err(err("rpc", "could not read the sale listing, nothing was sent: unexpected answer")),
    }
}

/// Amount of `asset` in a custody balance list (`[{token, amount}]` or `[{token, balance}]`).
pub fn balance_of(balances: &serde_json::Value, asset: &str) -> u128 {
    balances.as_array().into_iter().flatten()
        .filter(|b| b.get("token").and_then(|t| t.as_str()) == Some(asset))
        .filter_map(|b| b.get("amount").or(b.get("balance")))
        .filter_map(|a| a.as_str().map(|s| s.to_string()).or_else(|| a.as_u64().map(|u| u.to_string())))
        .filter_map(|s| s.parse::<u128>().ok())
        .sum()
}

/// Canonical bytes of a balance proof. Field order is fixed for the verifier script.
/// It names a threshold and a yes/no answer, never the balance itself.
#[allow(clippy::too_many_arguments)]
pub fn proof_canonical(token_id: &str, owner: &str, asset: &str, min: &str, holds: bool, locked_until: u64, log_head: &str, ts_ms: u64) -> String {
    format!(
        "{{\"asset\":\"{}\",\"holds_at_least\":{},\"kind\":\"keyhole-balance-proof-v1\",\"locked_until_ms\":{},\"log_head\":\"{}\",\"min\":\"{}\",\"owner\":\"{}\",\"token_id\":\"{}\",\"ts_ms\":{}}}",
        asset, holds, locked_until, log_head, min, owner, token_id, ts_ms
    )
}

/// The token id a new mint would use is taken: `already_minted`, not an on-chain panic.
pub fn assert_mint_id_free(existing_owner: Option<&str>) -> Result<(), Error> {
    match existing_owner {
        Some(_) => Err(err("already_minted", "this account already minted its key and moved it; one mint per account")),
        None => Ok(()),
    }
}

/// A raise of a holder limit waits this long; a cut applies at once.
pub const RAISE_DELAY_MS: u64 = 86_400_000;
/// After the enclave first sees a new owner, withdraw waits this long. Swaps inside the account still run.
pub const TRANSFER_COOLDOWN_MS: u64 = 600_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PendingLimits { pub per_tx_usd_micro: u64, pub daily_usd_micro: u64, pub effective_ms: u64 }

/// Limits a holder set on their own key, at or under the tier caps. Bound to the owner who set them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HolderPolicy { pub owner: String, pub per_tx_usd_micro: u64, pub daily_usd_micro: u64, pub pending: Option<PendingLimits> }

/// The stored policy, if `owner` set it. A policy set by a previous owner does not bind the new owner.
pub fn policy_for(raw: &[u8], owner: &str) -> Option<HolderPolicy> {
    serde_json::from_slice::<HolderPolicy>(raw).ok().filter(|p| p.owner == owner)
}

/// Tier caps narrowed by the holder's policy. A pending raise counts once its time has come.
pub fn effective_limits(tier: Limits, pol: Option<&HolderPolicy>, now_ms: u64) -> Limits {
    let Some(p) = pol else { return tier; };
    let (pt, d) = match &p.pending {
        Some(n) if now_ms >= n.effective_ms => (n.per_tx_usd_micro, n.daily_usd_micro),
        _ => (p.per_tx_usd_micro, p.daily_usd_micro),
    };
    Limits { per_tx_usd_micro: pt.min(tier.per_tx_usd_micro), daily_usd_micro: d.min(tier.daily_usd_micro), per_minute_calls: tier.per_minute_calls }
}

/// New policy after a holder asks for `per_tx`/`daily`. Each must be > 0 and within the tier,
/// and per_tx <= daily. A cut (both at or under what is in force) applies now and cancels a
/// pending raise. Anything higher waits RAISE_DELAY_MS, so a stolen signature cannot lift caps and drain at once.
pub fn set_policy(tier: Limits, cur: Option<&HolderPolicy>, owner: &str, per_tx: u64, daily: u64, now_ms: u64) -> Result<HolderPolicy, Error> {
    if per_tx == 0 || daily == 0 || per_tx > daily {
        return Err(err("bad_params", "limits must be above 0 and per-trade at or under per-day"));
    }
    if per_tx > tier.per_tx_usd_micro || daily > tier.daily_usd_micro {
        return Err(err("bad_params", format!("limits must be within your tier: ${} per trade, ${} per day", fmt_usd(tier.per_tx_usd_micro), fmt_usd(tier.daily_usd_micro))));
    }
    let now = effective_limits(tier, cur, now_ms);
    if per_tx <= now.per_tx_usd_micro && daily <= now.daily_usd_micro {
        Ok(HolderPolicy { owner: owner.into(), per_tx_usd_micro: per_tx, daily_usd_micro: daily, pending: None })
    } else {
        Ok(HolderPolicy { owner: owner.into(), per_tx_usd_micro: now.per_tx_usd_micro, daily_usd_micro: now.daily_usd_micro,
            pending: Some(PendingLimits { per_tx_usd_micro: per_tx, daily_usd_micro: daily, effective_ms: now_ms + RAISE_DELAY_MS }) })
    }
}

/// End of the post-transfer withdraw cooldown for `owner`, if the latest transfer made them owner.
/// True when an event by `owner` would be the first the log sees from a new holder. Every write
/// path records the change of hands first, so the withdraw cooldown cannot be skipped by doing a
/// swap, deposit, lock or limits call before the first withdraw (found in the RED review, R1).
pub fn needs_transfer_event(last_owner: Option<&str>, kind: &str, owner: &str) -> bool {
    kind != "transfer" && kind != "mint" && matches!(last_owner, Some(o) if o != owner)
}

/// Appends `kind`, preceded by a `transfer` row when the holder changed since the last row.
pub fn append_synced(log: &mut Vec<ProvEvent>, kind: &str, token_id: &str, owner: &str, ts_ms: u64, detail: &str) -> Vec<String> {
    let mut added = Vec::new();
    if needs_transfer_event(log.last().map(|e| e.owner.as_str()), kind, owner) {
        append_event(log, "transfer", token_id, owner, ts_ms, "transfer");
        added.push("transfer".to_string());
    }
    append_event(log, kind, token_id, owner, ts_ms, detail);
    added.push(detail.to_string());
    added
}

/// Wallet polls x 3 s stay under the web gateway's 55 s timeout, so a reply is never lost to a
/// timeout while the swap or withdraw still runs (RED review R4).
pub const WALLET_POLLS: u32 = 15;
pub const WALLET_POLL_SECS: u64 = 3;
pub const GATEWAY_TIMEOUT_SECS: u64 = 55;

/// The day's spend is given back only when the wallet reports a final failure. A send that is still
/// pending or under review keeps its charge, so it cannot be repeated past the cap (RED review R3).
pub fn cap_refund_on(status: &str) -> bool {
    matches!(status, "failed" | "error" | "refunded")
}

pub fn cooldown_until(evs: &[ProvEvent], owner: &str) -> Option<u64> {
    let last = evs.iter().rev().find(|e| e.kind == "transfer")?;
    (last.owner == owner).then_some(last.ts_ms + TRANSFER_COOLDOWN_MS)
}

/// Refuse a withdraw during the cooldown that follows a transfer.
pub fn assert_no_cooldown(evs: &[ProvEvent], owner: &str, now_ms: u64) -> Result<(), Error> {
    match cooldown_until(evs, owner) {
        Some(until) if now_ms < until => Err(err("cooldown", format!("this key changed hands recently; withdraw opens at {} (unix ms). Swaps inside the account still work", until))),
        _ => Ok(()),
    }
}

pub mod chainsig;

/// Scoped beat key: the only method a function-call key on the TEE minter may call, and its gas allowance.
pub const BEAT_KEY_METHODS: [&str; 1] = ["beat"];
pub const BEAT_KEY_ALLOWANCE_YOCTO: u128 = 50_000_000_000_000_000_000_000; // 0.05 NEAR
/// Owner-only ops (signed by the keys contract owner account).
pub fn assert_owner(signer: &str, owner: &str) -> Result<(), Error> {
    if signer != owner { return Err(err("not_owner", "only the keys contract owner can manage the beat key")); }
    Ok(())
}
/// Parse `ed25519:<base58 32 bytes>`; refuses the minter's own key so it can never be deleted or downgraded.
pub fn parse_beat_key(s: &str, minter_pk: &[u8; 32]) -> Result<[u8; 32], Error> {
    let raw = s.strip_prefix("ed25519:").and_then(|b| bs58::decode(b).into_vec().ok()).filter(|v| v.len() == 32)
        .ok_or_else(|| err("bad_public_key", "params.public_key must be ed25519:<base58 32 bytes>"))?;
    let pk: [u8; 32] = raw.try_into().unwrap();
    if &pk == minter_pk { return Err(err("bad_public_key", "that is the minter's own full-access key")); }
    Ok(pk)
}


/// `view_access_key` result: true only when `permission` is the JSON string "FullAccess".
/// A function-call key is an object and never passes, whatever its method names or receiver are.
pub fn is_full_access(raw: &str) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else { return false };
    let p = v.get("permission").or_else(|| v.pointer("/result/permission"));
    matches!(p, Some(serde_json::Value::String(s)) if s == "FullAccess")
}

/// Nonce from a `view_access_key` body. Accepts the flattened result *or* a JSON-RPC
/// `{ "result": { "nonce": … } }` envelope — the same shapes `is_full_access` already allows.
/// Numeric strings are accepted; `as_u64` alone misses both the envelope and string forms.
pub fn access_key_nonce(raw: &str) -> Option<u64> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let n = v.get("nonce").or_else(|| v.pointer("/result/nonce"))?;
    match n {
        serde_json::Value::Number(num) => num.as_u64(),
        serde_json::Value::String(s) if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) => s.parse().ok(),
        _ => None,
    }
}

/// Hash from a `block` body. Accepts flattened `{ "header": { "hash": … } }`
/// or a JSON-RPC `{ "result": { "header": { "hash": … } } }` envelope — the same
/// shapes `chain_now_ms` already allows for the timestamp. The pre-#208 send path
/// used both pointers; dropping the envelope would fail after the nonce is read.
pub fn final_block_hash(raw: &str) -> Option<[u8; 32]> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let h = v.pointer("/header/hash").or_else(|| v.pointer("/result/header/hash"))?.as_str()?;
    bs58::decode(h).into_vec().ok().and_then(|b| b.try_into().ok())
}

/// Parse a `rpc::block("final")` response into the shared per-run block
/// cache entry (round 4). Returns `None` if the response is missing the
/// hash or the timestamp, in which case the caller must not cache it
/// (a partial entry would serve a zero timestamp or hash). Accepts both
/// the flattened and the JSON-RPC-envelope shapes.
pub fn parse_final_block(raw: &str) -> Option<read_cache::BlockCache> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let hash = final_block_hash(raw)?;
    let ts = v
        .pointer("/header/timestamp")
        .or_else(|| v.pointer("/result/header/timestamp"))
        .and_then(|t| t.as_u64().or_else(|| t.as_str().and_then(|s| s.parse().ok())))?;
    Some(read_cache::BlockCache {
        hash,
        height: native_send::block_height(raw),
        timestamp_ms: ts / 1_000_000,
    })
}

/// Parse a `gas_price` host response into the price in yocto. Round 8: the
/// OutLayer host returns the gas price as a BARE JSON string on success
/// (`"100000000"`, host_functions_sync.rs:729-747), and the live NEAR RPC
/// returns `{"result":{"gas_price":"100000000"}}` — neither is the object
/// `guarded::decimal` expects, so `provision_native_budget` failed every time
/// with "missing/string gas_price" (Run 14 S11, call 103d999d-...). Accepts a
/// digit string, a bare JSON number, `{"gas_price":…}`, and `{"result":…}`
/// (one level of unwrapping). Any body carrying an "error" key is rejected:
/// the host returns the whole error envelope as the result string when
/// `result.gas_price` is absent (host_functions_sync.rs:743-744), so an error
/// body must never parse as a price. Digits only; a parsed value is cached as
/// a u128 (read_cache), never as a Value.
pub fn gas_price_of(raw: &str) -> Result<u128, Error> {
    let v: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| err("rpc", "invalid gas price"))?;
    if v.get("error").is_some() {
        return Err(err("rpc", "gas price error"));
    }
    gas_price_value(&v).ok_or_else(|| err("guard_state", "missing/string gas_price"))
}

fn gas_price_value(v: &serde_json::Value) -> Option<u128> {
    use serde_json::Value;
    match v {
        Value::String(s) if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) => {
            s.parse().ok()
        }
        Value::Number(n) => n.as_u64().map(u128::from),
        Value::Object(_) => {
            if let Some(g) = v.get("gas_price") {
                return gas_price_value(g);
            }
            v.get("result").and_then(gas_price_value)
        }
        _ => None,
    }
}

/// Parse a `view_account` response (full JSON-RPC envelope or flattened
/// result) into (amount_yocto, storage_usage_bytes). The amount is a decimal
/// string; storage_usage is a NUMBER (proven live: the minter envelope
/// carries `"storage_usage":315`, not a string).
pub fn view_account_budget(raw: &str) -> Result<(u128, u64), Error> {
    let v: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| err("rpc", "invalid account"))?;
    let account = v.get("result").cloned().unwrap_or(v);
    let amount = guarded::decimal(&account, "amount")?;
    let storage_usage = account["storage_usage"]
        .as_u64()
        .ok_or_else(|| err("rpc", "missing storage usage"))?;
    Ok((amount, storage_usage))
}

/// Pure minter-budget check from `provision_native_budget`
/// (collateral_host.rs). The minter must hold its storage backing (1e19
/// yocto/byte) plus the deposit, the fee and a 0.001 NEAR reserve, and
/// deposit+fee must fit the 0.1 NEAR transaction ceiling.
pub fn native_budget_ok(amount: u128, storage_usage: u64, deposit: u128, fee: u128) -> Result<(), Error> {
    let backing = (storage_usage as u128)
        .checked_mul(10_000_000_000_000_000_000)
        .ok_or_else(|| err("collateral_quote", "storage overflow"))?;
    let total = backing
        .checked_add(deposit)
        .and_then(|t| t.checked_add(fee))
        .and_then(|t| t.checked_add(1_000_000_000_000_000_000_000))
        .ok_or_else(|| err("collateral_quote", "budget overflow"))?;
    let ceiling = 100_000_000_000_000_000_000_000u128;
    if deposit.checked_add(fee).map(|d| d > ceiling).unwrap_or(true) || amount < total {
        return Err(err(
            "collateral_quote",
            "minter reserve or transaction ceiling insufficient",
        ));
    }
    Ok(())
}

/// Full native-budget check for a `view_account` body: parse the envelope,
/// compute the fee from the gas price (240 Tgas), and run the budget check.
/// This is exactly what `provision_native_budget` does after the gas price.
pub fn native_budget_check(account_raw: &str, deposit: u128, gas_price: u128) -> Result<(), Error> {
    let (amount, storage_usage) = view_account_budget(account_raw)?;
    let fee = gas_price
        .checked_mul(240_000_000_000_000)
        .ok_or_else(|| err("collateral_quote", "gas overflow"))?;
    native_budget_ok(amount, storage_usage, deposit, fee)
}

/// Which key a request operates: the one named in the signed params, or the only one held.
/// Holding several keys without naming one is refused, so a buyer never runs the wrong account.
pub fn pick_token(named: Option<&str>, owned: u64) -> Result<(), Error> {
    if named.is_none() && owned > 1 {
        return Err(err("bad_params", "this account holds several keys: sign params.token_id to choose one"));
    }
    Ok(())
}

/// Default bound on how far a swap may fill below the fresh quote, in basis points (100 = 1%). Used when
/// the caller sends no `min_amount_out`. Same unit as 1Click `slippageTolerance`: near-intents
/// rules/api-quote.md ("Max acceptable slippage in basis points ... Affects minAmountOut"), and
/// rules/api-confidential-swaps.md (a confidential swap is a normal quote with `confidentiality` set).
pub const DEFAULT_MAX_SLIPPAGE_BPS: u64 = 100;
/// Ceiling for the default bound. Matches the quote op's `slippage_bps` limit.
pub const MAX_SLIPPAGE_BPS: u64 = 500;
const _: () = assert!(DEFAULT_MAX_SLIPPAGE_BPS <= MAX_SLIPPAGE_BPS && MAX_SLIPPAGE_BPS <= 10_000);

/// A client-sent `min_amount_out`, in destination base units. Zero or non-integer is refused: a zero floor
/// would let the swap fill at any price.
pub fn client_min_out(v: &serde_json::Value) -> Result<u128, Error> {
    let n: Option<u128> = match v {
        serde_json::Value::String(s) if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) => s.parse().ok(),
        serde_json::Value::Number(n) => n.as_u64().map(u128::from),
        _ => None,
    };
    match n {
        Some(0) => Err(err("bad_params", "min_amount_out must be above 0")),
        Some(m) => Ok(m),
        None => Err(err("bad_params", "min_amount_out must be an integer string in base units")),
    }
}

/// The `min_amount_out` field as sent: absent or null means none, anything else must pass `client_min_out`.
pub fn client_min_out_field(v: Option<&serde_json::Value>) -> Result<Option<u128>, Error> {
    match v {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(x) => client_min_out(x).map(Some),
    }
}

/// The floor for a swap with no client `min_amount_out`: the fresh quote's output less DEFAULT_MAX_SLIPPAGE_BPS,
/// or the quote's own `minAmountOut` when that is higher (a tighter floor). Refused when the floor is zero.
pub fn derive_min_out(quoted_out: u128, api_min: Option<u128>) -> Result<u128, Error> {
    let by_bps = quoted_out.saturating_mul((10_000 - DEFAULT_MAX_SLIPPAGE_BPS) as u128) / 10_000;
    let floor = by_bps.max(api_min.unwrap_or(0));
    if floor == 0 {
        return Err(err("upstream", "the quote has no output to bound slippage against"));
    }
    Ok(floor)
}

/// The executable quote may not be priced above the dry quote the caps were checked against.
pub fn assert_wet_within_dry(dry_usd: u64, wet_usd: Option<u64>) -> Result<u64, Error> {
    match wet_usd {
        Some(w) if w <= dry_usd => Ok(w),
        Some(_) => Err(err("quote_moved", "the executable quote is priced above the checked quote; nothing was committed, retry")),
        None => Err(err("upstream", "executable quote has no USD value; cannot apply caps")),
    }
}

/// Chain Signatures requests per key per UTC day (each costs the minter gas).
pub const CHAIN_SIGN_PER_DAY: i64 = 5;

/// First custody-wallet registration is claimed before calling OutLayer, so two parallel first
/// requests cannot register two wallets. A claim older than this is treated as abandoned.
pub const WALLET_CLAIM_TTL_MS: u64 = 120_000;
pub fn wallet_claim_free(existing: &[u8], now_ms: u64) -> bool {
    std::str::from_utf8(existing).ok().and_then(|s| s.parse::<u64>().ok())
        .map(|t| now_ms.saturating_sub(t) > WALLET_CLAIM_TTL_MS).unwrap_or(true)
}

/// True when a holder-limits update queued a new raise (which must wait and needs a wallet signature).
pub fn session_limits_raise(cur: Option<&HolderPolicy>, new: &HolderPolicy) -> bool {
    match (&new.pending, cur.and_then(|c| c.pending.as_ref())) {
        (None, _) => false,
        (Some(n), Some(o)) => !(n.per_tx_usd_micro == o.per_tx_usd_micro && n.daily_usd_micro == o.daily_usd_micro && n.effective_ms == o.effective_ms),
        (Some(_), None) => true,
    }
}

/// base64 (standard) for values the enclave returns.
pub fn b64(b: &[u8]) -> String { B64.encode(b) }
// ---------------- hardening (round-2 judge panel P1-2/4/5/9) ----------------

/// Admission order: the nonce is consumed first, so a replayed request is refused as `replay`
/// without spending the holder's per-minute budget or the global one.
pub fn admit(st: &mut dyn Store, account: &str, lim: &Limits, nonce: &[u8; 32], now_ms: u64) -> Result<(), Error> {
    consume_nonce(st, account, nonce, now_ms)?;
    rate_limit(st, account, lim, now_ms)
}

/// Read-only quota check: refuses when `key` already reached `max`. Pair with `bump_within`
/// after the guarded action succeeded, so a failed upstream call does not burn quota.
pub fn assert_quota_room(st: &mut dyn Store, key: &str, max: i64, code: &'static str, msg: String) -> Result<(), Error> {
    if st.incr(key, 0)? >= max { return Err(err(code, msg)); }
    Ok(())
}

/// A quote may only send proceeds to, and refund to, the signing holder.
pub fn assert_quote_parties(signer: &str, recipient: &str, refund_to: &str) -> Result<(), Error> {
    if recipient != signer { return Err(err("wrong_recipient", "params.recipient must be the account that signed this request")); }
    if refund_to != signer { return Err(err("wrong_recipient", "params.refund_to must be the account that signed this request")); }
    Ok(())
}

/// Status reported after a custody move. If the key changed hands while the move ran,
/// a success or pending result is reported as `needs_review` instead of a plain success.
pub fn after_move_status(status: &str, still_owner: bool) -> String {
    let moved = matches!(status, "success" | "pending" | "processing" | "submitted");
    if !still_owner && moved { "needs_review".into() } else { status.into() }
}

/// The keys contract owner from its `config` view (`{"owner": ...}`).
pub fn config_owner(cfg: &serde_json::Value) -> Option<String> {
    cfg.get("owner").and_then(|o| o.as_str()).filter(|o| !o.is_empty()).map(|o| o.to_string())
}

// ---------- earned tiers: a key rises on its own settled history ----------

/// Tier rules: (tier, min settled swaps and copies, min volume in USD micro). Both must be met.
/// Bronze (tier 1) is the mint. A higher tier raises the caps (`limits_for_tier`), so it needs real history.
pub const TIER_RULES: &[(u8, u32, u64)] = &[(2, 10, 5_000_000), (3, 40, 50_000_000)];
/// Attached gas for `nft_set_tier` (a tier write and one metadata event). No deposit is attached.
pub const LEVEL_UP_GAS: u64 = 10_000_000_000_000;

/// The highest tier whose rule the counts meet. Never below `current`: tiers only rise.
pub fn earned_tier(current: u8, settled_swaps: u32, volume_usd_micro: u64) -> u8 {
    TIER_RULES
        .iter()
        .filter(|(_, n, v)| settled_swaps >= *n && volume_usd_micro >= *v)
        .map(|(t, _, _)| *t)
        .fold(current, u8::max)
}

/// Where a key stands against its next tier. At the top tier `next` is None and the targets are 0.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TierProgress {
    pub current: u8,
    pub next: Option<u8>,
    pub swaps: u32,
    pub volume_usd_micro: u64,
    pub swaps_needed: u32,
    pub volume_needed_usd_micro: u64,
    pub swaps_done: bool,
    pub volume_done: bool,
    pub met: bool,
}

/// Progress toward the lowest tier above `current`, from the counts the key has settled so far.
pub fn tier_progress(current: u8, settled_swaps: u32, volume_usd_micro: u64) -> TierProgress {
    let rule = TIER_RULES.iter().filter(|(t, _, _)| *t > current).min_by_key(|(t, _, _)| *t);
    let (next, swaps_needed, volume_needed_usd_micro) = match rule {
        Some((t, n, v)) => (Some(*t), *n, *v),
        None => (None, 0, 0),
    };
    let swaps_done = settled_swaps >= swaps_needed;
    let volume_done = volume_usd_micro >= volume_needed_usd_micro;
    TierProgress {
        current,
        next,
        swaps: settled_swaps,
        volume_usd_micro,
        swaps_needed,
        volume_needed_usd_micro,
        swaps_done,
        volume_done,
        met: next.is_some() && swaps_done && volume_done,
    }
}

/// Counts a key's trade-log rows that count toward a tier: kind `swap` or `copy` with status `success`, each adding one swap and its `usd_in_micro` (0 if absent).
/// The log keeps only its last 100 rows (`log_push`), and the count is per key, so rows from any holder of the key count.
pub fn level_counts(entries: &[serde_json::Value]) -> (u32, u64) {
    let (mut n, mut usd) = (0u32, 0u64);
    for e in entries {
        let kind = e.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if !(kind == "swap" || kind == "copy") || e.get("status").and_then(|v| v.as_str()) != Some("success") { continue; }
        n = n.saturating_add(1);
        usd = usd.saturating_add(e.get("usd_in_micro").and_then(|v| v.as_u64()).unwrap_or(0));
    }
    (n, usd)
}

/// What a key's record shows: the verified chain head, the progress, and the tier it earns (never below `current`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LevelAssessment {
    pub log_head: String,
    pub progress: TierProgress,
    pub earned: u8,
}

/// Verifies the key's provenance chain, then counts its trade log. A chain that does not verify is refused
/// with `bad_log` and nothing is counted. The trade log has no hash chain of its own, so it is read only
/// through this check.
pub fn assess_level(prov: &[ProvEvent], trades: &[serde_json::Value], current: u8) -> Result<LevelAssessment, Error> {
    let log_head = verify_chain(prov)?;
    let (swaps, volume) = level_counts(trades);
    Ok(LevelAssessment {
        log_head,
        progress: tier_progress(current, swaps, volume),
        earned: earned_tier(current, swaps, volume),
    })
}

pub mod guarded;

/// Epoch-scoped durable ownership cooldown, separate from the public provenance format.
pub mod ownership_sync;

pub mod pledge_inventory;

/// Audited enclave-only collateral provisioning.
pub mod collateral;

pub mod receipts;
pub mod native_send;

/// Two-phase confinement evidence; loan certificate ABI is unchanged.
pub mod collateral_evidence;

pub mod rpc_view;
pub mod withdrawal_protection;

pub mod exact_exit;
pub mod exact_receipt;

/// Per-run read cache (round 4): memoizes identical view calls so the
/// canary lands at ~52 near:rpc calls instead of ~150. See read_cache.rs.
pub mod read_cache;
