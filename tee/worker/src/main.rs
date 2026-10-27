//! KEYHOLE OutLayer worker (wasm32-wasip2). Reads one JSON request on stdin, prints one JSON reply.
//! Ops: info | status | quote | mint. All ops except `info` require a NEP-413 signature by the holder.
#[cfg(target_arch = "wasm32")]
mod host {
    use keyhole_worker::*;
    use serde_json::{json, Value};
    use std::io::Read;
    wit_bindgen::generate!({ world: "keyhole", path: "wit", generate_all });
    use near::rpc::api as rpc;
    use near::storage::api as storage;

    const VERSION: &str = "keyhole-worker/0.1.0";
    fn cfg(k: &str, d: &str) -> String { std::env::var(k).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| d.to_string()) }
    fn keys_contract() -> String { cfg("KEYS_CONTRACT", "keyhole-devmo.near") }
    fn recipient() -> String { cfg("NEP413_RECIPIENT", "keyhole") }

    struct Host;
    impl Store for Host {
        fn set_if_absent(&mut self, k: &str, v: &[u8]) -> Result<bool, Error> {
            let (ok, e) = storage::set_if_absent(k, v);
            if !e.is_empty() { return Err(err("storage", e)); }
            Ok(ok)
        }
        fn incr(&mut self, k: &str, d: i64) -> Result<i64, Error> {
            let (v, e) = if d < 0 { storage::decrement(k, -d) } else { storage::increment(k, d) };
            if !e.is_empty() { return Err(err("storage", e)); }
            Ok(v)
        }
    }

    fn chain_now_ms() -> Result<u64, Error> {
        let (r, e) = rpc::block("final");
        if !e.is_empty() { return Err(err("rpc", format!("block: {}", e))); }
        let v: Value = serde_json::from_str(&r).map_err(|_| err("rpc", "block: bad json"))?;
        let ts = v.pointer("/header/timestamp").or(v.pointer("/result/header/timestamp"))
            .and_then(|t| t.as_u64().or_else(|| t.as_str().and_then(|s| s.parse().ok())))
            .ok_or_else(|| err("rpc", "block: no timestamp"))?;
        Ok(ts / 1_000_000)
    }

    fn view(contract: &str, method: &str, args: Value) -> Result<Value, Error> {
        let (r, e) = rpc::view(contract, method, &args.to_string(), "final");
        if !e.is_empty() { return Err(err("rpc", format!("{}: {}", method, e))); }
        Ok(serde_json::from_str(&r).unwrap_or(Value::Null))
    }

    fn holder_tier(account: &str) -> Result<Option<u8>, Error> {
        Ok(view(&keys_contract(), "holder_tier", json!({"account_id": account}))?.as_u64().map(|t| t as u8))
    }

    struct Ctx { account: String, req: SignedRequest, now_ms: u64, tier: Option<u8> }

    /// Signature -> key ownership -> freshness -> op binding -> tier -> rate limit -> nonce (replay).
    fn authenticate(input: &Value, op: &str, need_key: bool) -> Result<Ctx, Error> {
        let auth: Auth = serde_json::from_value(input.get("auth").cloned().unwrap_or(Value::Null))
            .map_err(|_| err("no_auth", "missing `auth`: sign the request with your NEAR wallet (NEP-413 signMessage)"))?;
        let (req, nonce) = verify_nep413(&auth, &recipient())?;
        if req.op != op { return Err(err("op_mismatch", format!("signed op '{}' but called '{}'", req.op, op))); }
        let (ak, e) = rpc::view_access_key(&auth.account_id, &auth.public_key, "final");
        if !e.is_empty() || !ak.contains("FullAccess") {
            return Err(err("key_not_owned", "the signing key is not a full-access key of this account"));
        }
        let now_ms = chain_now_ms()?;
        check_freshness(req.ts_ms, now_ms)?;
        let tier = holder_tier(&auth.account_id)?;
        if need_key && tier.is_none() {
            return Err(err("no_key", format!("{} does not hold a KEYHOLE key; mint one first (op: mint)", auth.account_id)));
        }
        let lim = limits_for_tier(tier.unwrap_or(1)).unwrap();
        rate_limit(&mut Host, &auth.account_id, &lim, now_ms)?;
        consume_nonce(&mut Host, &auth.account_id, &nonce, now_ms)?;
        Ok(Ctx { account: auth.account_id, req, now_ms, tier })
    }

    /// Minter key is generated inside the TEE on first use and kept in encrypted storage.
    /// Only its public key / implicit account ever leaves the enclave.
    fn minter() -> Result<(String, String), Error> {
        let k = "w/minter_sk_v1";
        let (mut sk, e) = storage::get(k);
        if !e.is_empty() && !e.to_lowercase().contains("not found") { return Err(err("storage", e)); }
        if sk.len() != 32 {
            let mut seed = [0u8; 32];
            getrandom::fill(&mut seed).map_err(|_| err("rng", "no randomness"))?;
            Host.set_if_absent(k, &seed)?;
            sk = storage::get(k).0;
            if sk.len() != 32 { return Err(err("storage", "minter key missing")); }
        }
        let sk: [u8; 32] = sk.try_into().unwrap();
        let signing = ed25519_dalek::SigningKey::from_bytes(&sk);
        let pk = signing.verifying_key().to_bytes();
        let mut full = [0u8; 64];
        full[..32].copy_from_slice(&sk);
        full[32..].copy_from_slice(&pk);
        Ok((implicit_account(&pk), format!("ed25519:{}", bs58::encode(full).into_string())))
    }

    fn iso(ms: u64) -> String {
        let s = ms / 1000;
        let (days, rem) = ((s / 86400) as i64, s % 86400);
        let z = days + 719468; let era = z.div_euclid(146097); let doe = z - era * 146097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1; let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
        format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", y, m, d, rem / 3600, rem % 3600 / 60, rem % 60)
    }

    fn oneclick_quote(body: &Value) -> Result<Value, Error> {
        let jwt = std::env::var("ONECLICK_JWT").unwrap_or_default();
        if jwt.is_empty() { return Err(err("config", "1Click key not configured")); }
        let auth = format!("Bearer {}", jwt);
        let b = body.to_string();
        let resp = wasi_http_client::Client::new().post("https://1click.chaindefuser.com/v0/quote")
            .header("Authorization", auth.as_str()).header("Content-Type", "application/json")
            .body(b.as_bytes()).connect_timeout(std::time::Duration::from_secs(20)).send()
            .map_err(|_| err("upstream", "1Click unreachable, retry"))?;
        let st = resp.status();
        let raw = resp.body().unwrap_or_default();
        let v: Value = serde_json::from_slice(&raw).unwrap_or(json!({"raw": String::from_utf8_lossy(&raw).chars().take(300).collect::<String>()}));
        if st >= 300 { return Err(err("upstream", format!("1Click {}: {}", st, v.get("message").and_then(|m| m.as_str()).unwrap_or("error")))); }
        Ok(v)
    }

    fn s(p: &Value, k: &str) -> Option<String> { p.get(k).and_then(|v| v.as_str()).map(|v| v.to_string()) }

    fn op_quote(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "quote", true)?;
        let p = &c.req.params;
        let lim = limits_for_tier(c.tier.unwrap()).ok_or_else(|| err("no_key", "unknown tier"))?;
        let conf = s(p, "confidentiality").unwrap_or_else(|| "basic".into());
        if conf != "basic" && conf != "advanced" { return Err(err("bad_params", "confidentiality must be basic or advanced")); }
        let slip = p.get("slippage_bps").and_then(|v| v.as_u64()).unwrap_or(100);
        if slip > 500 { return Err(err("bad_params", "slippage_bps max 500")); }
        let need = |k: &str| s(p, k).ok_or_else(|| err("bad_params", format!("missing params.{}", k)));
        let amount = need("amount")?;
        if amount.is_empty() || !amount.bytes().all(|b| b.is_ascii_digit()) { return Err(err("bad_params", "amount must be an integer string in base units")); }
        let mut body = json!({
            "dry": true, "swapType": "EXACT_INPUT", "slippageTolerance": slip,
            "originAsset": need("origin_asset")?, "destinationAsset": need("destination_asset")?, "amount": amount,
            "depositType": s(p, "deposit_type").unwrap_or_else(|| "ORIGIN_CHAIN".into()),
            "refundTo": need("refund_to")?, "refundType": s(p, "refund_type").unwrap_or_else(|| "ORIGIN_CHAIN".into()),
            "recipient": need("recipient")?, "recipientType": s(p, "recipient_type").unwrap_or_else(|| "DESTINATION_CHAIN".into()),
            "deadline": iso(c.now_ms + 3_600_000), "confidentiality": conf, "referral": "keyhole",
        });
        // Policy uses the USD value priced by the solver network, never a number from the caller.
        let dry = oneclick_quote(&body)?;
        let usd = dry.pointer("/quote/amountInUsd").and_then(|v| v.as_str()).and_then(parse_usd_micro)
            .ok_or_else(|| err("upstream", "quote has no USD value; cannot apply caps"))?;
        let execute = p.get("execute").and_then(|v| v.as_bool()).unwrap_or(false);
        let spent = enforce_caps(&mut Host, &c.account, &lim, usd, c.now_ms, execute)?;
        let mut out = json!({"ok": true, "op": "quote", "account": c.account, "tier": c.tier, "usd_micro": usd,
            "limits": lim, "spent_today_usd_micro": spent, "policy": "passed"});
        if !execute {
            out["quote"] = dry["quote"].clone();
            return Ok(out);
        }
        body["dry"] = json!(false);
        match oneclick_quote(&body) {
            Ok(real) => {
                out["quote"] = real["quote"].clone();
                out["deposit_address"] = real.pointer("/quote/depositAddress").cloned().unwrap_or(Value::Null);
                Ok(out)
            }
            Err(e) => { let _ = Host.incr(&hkey(&c.account, &format!("spent/{}", c.now_ms / 86_400_000)), -(usd as i64)); Err(e) }
        }
    }

    fn op_status(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "status", false)?;
        let lim = c.tier.and_then(limits_for_tier);
        let spent = Host.incr(&hkey(&c.account, &format!("spent/{}", c.now_ms / 86_400_000)), 0)?;
        Ok(json!({"ok": true, "op": "status", "account": c.account, "tier": c.tier, "limits": lim, "spent_today_usd_micro": spent}))
    }

    fn op_mint(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "mint", false)?;
        if c.tier.is_some() { return Err(err("already_holder", "this account already holds a KEYHOLE key")); }
        let day = c.now_ms / 86_400_000;
        bump_within(&mut Host, &format!("g/mints/{}", day), 1, GLOBAL_MINTS_PER_DAY, "mint_quota", "daily free-mint quota reached, try tomorrow (UTC)".into())?;
        let first = Host.set_if_absent(&hkey(&c.account, "minted"), c.now_ms.to_string().as_bytes())?;
        if !first { return Err(err("already_minted", "a key was already minted for this account")); }
        let (mid, msk) = minter()?;
        let tid = token_id_for(&c.account);
        let args = json!({"token_id": tid, "receiver_id": c.account, "tier": 1,
            "metadata": {"title": "KEYHOLE Key · Bronze", "description": "Viewing key to a confidential account. Holder-only, attested in a TEE.", "copies": 1}});
        let (tx, e) = rpc::call(&mid, &msk, &keys_contract(), "nft_mint", &args.to_string(), "10000000000000000000000", "30000000000000", "FINAL");
        if !e.is_empty() {
            let _ = storage::delete(&hkey(&c.account, "minted"));
            let _ = Host.incr(&format!("g/mints/{}", day), -1);
            return Err(err("mint_failed", e.chars().take(300).collect::<String>()));
        }
        Ok(json!({"ok": true, "op": "mint", "account": c.account, "token_id": tid, "tier": 1, "tx": tx, "minter": mid}))
    }

    fn op_info() -> Result<Value, Error> {
        let (mid, _) = minter()?;
        Ok(json!({"ok": true, "op": "info", "version": VERSION, "keys_contract": keys_contract(), "nep413_recipient": recipient(),
            "minter_account": mid, "limits": {"1": limits_for_tier(1), "2": limits_for_tier(2), "3": limits_for_tier(3)},
            "global_per_minute": GLOBAL_PER_MINUTE, "global_mints_per_day": GLOBAL_MINTS_PER_DAY,
            "sign": "NEP-413 signMessage: message = JSON {op, account_id, ts_ms, params}, recipient = nep413_recipient, nonce = 32 random bytes"}))
    }

    pub fn run() {
        let mut raw = String::new();
        std::io::stdin().read_to_string(&mut raw).ok();
        let input: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        let op = input.get("op").and_then(|v| v.as_str()).unwrap_or("");
        let r = match op {
            "info" => op_info(),
            "status" => op_status(&input),
            "quote" => op_quote(&input),
            "mint" => op_mint(&input),
            _ => Err(err("unknown_op", "op must be one of: info, status, quote, mint")),
        };
        let out = match r { Ok(v) => v, Err(e) => json!({"ok": false, "error": e}) };
        println!("{}", out);
    }
}

fn main() {
    #[cfg(target_arch = "wasm32")]
    host::run();
}
