//! KEYHOLE OutLayer worker (wasm32-wasip2). Reads one JSON request on stdin, prints one JSON reply.
//! Ops: info | status | quote | mint | account | balance | swap | copy | withdraw | history | sweep_minter.
//! All ops except `info` and `sweep_minter` require a NEP-413 signature by the holder.
#[cfg(target_arch = "wasm32")]
mod host {
    use keyhole_worker::*;
    use serde_json::{json, Value};
    use std::io::Read;
    wit_bindgen::generate!({ world: "keyhole", path: "wit", generate_all });
    use near::rpc::api as rpc;
    use near::storage::api as storage;

    const VERSION: &str = "keyhole-worker/0.2.0";
    const OL: &str = "https://api.outlayer.ai";
    const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
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

    /// The key this account holds now, confirmed with `nft_token.owner_id`. A key received by
    /// transfer has a token id that was derived from the minting account, not from this one.
    fn held_token(account: &str) -> Result<Option<String>, Error> {
        let v = view(&keys_contract(), "nft_tokens_for_owner", json!({"account_id": account, "from_index": "0", "limit": 1}))?;
        let Some(first) = v.as_array().and_then(|a| a.first()) else { return Ok(None); };
        let Some(tid) = first.get("token_id").and_then(|t| t.as_str()) else { return Ok(None); };
        let tok = view(&keys_contract(), "nft_token", json!({"token_id": tid}))?;
        Ok(owner_is(tok.get("owner_id").and_then(|t| t.as_str()), account).then(|| tid.to_string()))
    }

    fn holds_key(account: &str) -> Result<bool, Error> { Ok(held_token(account)?.is_some()) }

    fn yocto_of(v: &Value) -> u128 {
        v.pointer("/amount").or(v.pointer("/result/amount"))
            .and_then(|n| n.as_str().map(|s| s.to_string()).or_else(|| n.as_u64().map(|u| u.to_string())))
            .and_then(|s| s.parse().ok()).unwrap_or(0)
    }

    struct Ctx { account: String, req: SignedRequest, now_ms: u64, tier: Option<u8>, token: Option<String> }

    impl Ctx {
        /// Token for the per-key log: the key held now, else the id this account would mint.
        fn token_id(&self) -> String { self.token.clone().unwrap_or_else(|| token_id_for(&self.account)) }
    }

    /// Signature -> key ownership -> freshness -> op binding -> tier -> rate limit -> nonce (replay).
    fn authenticate(input: &Value, op: &str, need_key: bool) -> Result<Ctx, Error> {
        let auth: Auth = serde_json::from_value(input.get("auth").cloned().unwrap_or(Value::Null))
            .map_err(|_| err("no_auth", "missing `auth`: sign the request with your NEAR wallet (NEP-413 signMessage)"))?;
        let eip191 = auth.scheme == "eip191";
        let (req, nonce) = if eip191 { verify_eip191(&auth, &recipient())? } else { verify_nep413(&auth, &recipient())? };
        if req.op != op { return Err(err("op_mismatch", format!("signed op '{}' but called '{}'", req.op, op))); }
        if !eip191 {
            let (ak, e) = rpc::view_access_key(&auth.account_id, &auth.public_key, "final");
            if !e.is_empty() || !ak.contains("FullAccess") {
                return Err(err("key_not_owned", "the signing key is not a full-access key of this account"));
            }
        }
        let account = req.account_id.clone();
        let now_ms = chain_now_ms()?;
        check_freshness(req.ts_ms, now_ms)?;
        let tier = holder_tier(&account)?;
        let token = if need_key { held_token(&account)? } else { None };
        if need_key && token.is_none() {
            return Err(err("not_owner", "only the current key holder can authorize this"));
        }
        let lim = limits_for_tier(tier.unwrap_or(1)).unwrap();
        rate_limit(&mut Host, &account, &lim, now_ms)?;
        consume_nonce(&mut Host, &account, &nonce, now_ms)?;
        Ok(Ctx { account, req, now_ms, tier, token })
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

    /// Build, sign (inside the enclave) and broadcast a tx; returns tx hash or a readable error.
    fn send(signer: &str, sk_str: &str, receiver: &str, actions: &[Action]) -> Result<String, Error> {
        let raw = bs58::decode(sk_str.trim_start_matches("ed25519:")).into_vec().map_err(|_| err("signer", "bad key"))?;
        let sk: [u8; 32] = raw[..32].try_into().unwrap();
        let pk: [u8; 32] = raw[32..64].try_into().unwrap();
        let pk_str = format!("ed25519:{}", bs58::encode(pk).into_string());
        let (ak, e) = rpc::view_access_key(signer, &pk_str, "final");
        if !e.is_empty() { return Err(err("signer", format!("access key: {}", e))); }
        let ak: Value = serde_json::from_str(&ak).unwrap_or_default();
        let nonce = ak.pointer("/nonce").or(ak.pointer("/result/nonce")).and_then(|v| v.as_u64()).ok_or_else(|| err("signer", "no nonce"))?;
        let (b, e) = rpc::block("final");
        if !e.is_empty() { return Err(err("rpc", e)); }
        let b: Value = serde_json::from_str(&b).unwrap_or_default();
        let h = b.pointer("/header/hash").or(b.pointer("/result/header/hash")).and_then(|v| v.as_str()).ok_or_else(|| err("rpc", "no block hash"))?;
        let bh: [u8; 32] = bs58::decode(h).into_vec().ok().and_then(|v| v.try_into().ok()).ok_or_else(|| err("rpc", "bad block hash"))?;
        let tx = encode_tx(signer, &pk, nonce + 1, receiver, &bh, actions);
        let signed = sign_tx(&sk, &tx);
        use base64::Engine;
        let (r, e) = rpc::send_tx(&base64::engine::general_purpose::STANDARD.encode(&signed), "FINAL");
        if !e.is_empty() { return Err(err("tx_failed", e.chars().take(300).collect::<String>())); }
        let v: Value = serde_json::from_str(&r).unwrap_or_default();
        let st = v.pointer("/status").or(v.pointer("/result/status")).cloned().unwrap_or_default();
        if st.get("Failure").is_some() { return Err(err("tx_failed", st.to_string().chars().take(300).collect::<String>())); }
        if let Some(e) = v.get("error") { return Err(err("tx_failed", e.to_string().chars().take(300).collect::<String>())); }
        let hash = v.pointer("/transaction/hash").or(v.pointer("/result/transaction/hash")).or(v.pointer("/transaction_outcome/id"))
            .and_then(|x| x.as_str()).map(|x| x.to_string())
            .or_else(|| if !r.trim().is_empty() && !r.trim_start().starts_with('{') { Some(r.trim().trim_matches('"').to_string()) } else { None });
        match hash { Some(h) if !h.is_empty() => Ok(h), _ => Err(err("tx_failed", format!("no tx hash; rpc said: {}", r.chars().take(300).collect::<String>()))) }
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
        let (mid, msk) = minter()?;
        let (acct_raw, e) = rpc::view_account(&mid, "final");
        if !e.is_empty() { return Err(err("rpc", e)); }
        let acct: Value = serde_json::from_str(&acct_raw).unwrap_or_default();
        if !minter_can_mint(yocto_of(&acct)) {
            return Err(err("minter_low_balance", "the minter account cannot cover this mint"));
        }
        let day = c.now_ms / 86_400_000;
        bump_within(&mut Host, &format!("g/mints/{}", day), 1, GLOBAL_MINTS_PER_DAY, "mint_quota", "daily free-mint quota reached, try tomorrow (UTC)".into())?;
        let tid = token_id_for(&c.account);
        let (media, media_hash) = bronze_media(&keys_contract(), &tid);
        let args = json!({"token_id": tid, "receiver_id": c.account, "tier": 1,
            "metadata": {"title": "KEYHOLE Key · Bronze", "description": "Viewing key to a confidential account. Holder-only, attested in a TEE.", "copies": 1, "media": media, "media_hash": media_hash}});
        let a = args.to_string();
        // 0.012 NEAR covers the longer metadata (media URL + hash). Excess is refunded.
        let r = send(&mid, &msk, &keys_contract(), &[Action::FunctionCall { method: "nft_mint", args: a.as_bytes(), gas: MINT_GAS, deposit: MINT_DEPOSIT_YOCTO }]);
        if let Err(e) = r {
            let _ = Host.incr(&format!("g/mints/{}", day), -1);
            return Err(err("mint_failed", e.message));
        }
        let tx = r.unwrap();
        prov_append(&tid, "mint", &c.account, c.now_ms, &format!("mint {tx}"));
        Ok(json!({"ok": true, "op": "mint", "account": c.account, "token_id": tid, "tier": 1, "tx": tx, "minter": mid}))
    }


    // ---------- per-holder confidential wallets (one OutLayer custody wallet per holder) ----------
    fn http(method: &str, url: &str, bearer: Option<&str>, body: Option<&Value>) -> Result<(u16, Value), Error> {
        let c = wasi_http_client::Client::new();
        let auth = bearer.map(|b| format!("Bearer {}", b));
        let b = body.map(|b| b.to_string()).unwrap_or_default();
        let mut rq = if method == "GET" { c.get(url) } else { c.post(url) };
        if let Some(a) = auth.as_deref() { rq = rq.header("Authorization", a); }
        if method != "GET" { rq = rq.header("Content-Type", "application/json").body(b.as_bytes()); }
        let resp = rq.connect_timeout(std::time::Duration::from_secs(20)).send().map_err(|_| err("upstream", "OutLayer wallet API unreachable, retry"))?;
        let st = resp.status();
        let raw = resp.body().unwrap_or_default();
        Ok((st, serde_json::from_slice(&raw).unwrap_or(json!({"raw": String::from_utf8_lossy(&raw).chars().take(200).collect::<String>()}))))
    }

    /// Returns (api_key, intents_user_id). The api key is created and kept inside the enclave only.
    fn holder_wallet(account: &str) -> Result<(String, String), Error> {
        let k = hkey(account, "wallet");
        let (v, _) = storage::get(&k);
        if !v.is_empty() {
            let j: Value = serde_json::from_slice(&v).map_err(|_| err("storage", "wallet record corrupt"))?;
            return Ok((s(&j, "api_key").unwrap_or_default(), s(&j, "near_account_id").unwrap_or_default()));
        }
        let (st, j) = http("POST", &format!("{}/register", OL), None, None)?;
        let (Some(key), Some(id)) = (s(&j, "api_key"), s(&j, "near_account_id")) else {
            return Err(err("upstream", format!("wallet registration failed ({})", st)));
        };
        let rec = json!({"api_key": key, "near_account_id": id, "wallet_id": j.get("wallet_id")}).to_string();
        Host.set_if_absent(&k, rec.as_bytes())?;
        let (v, _) = storage::get(&k);
        let j: Value = serde_json::from_slice(&v).map_err(|_| err("storage", "wallet record missing"))?;
        Ok((s(&j, "api_key").unwrap_or_default(), s(&j, "near_account_id").unwrap_or_default()))
    }

    /// Submit a wallet op and poll until it settles (max ~90 s).
    fn wallet_op(key: &str, path: &str, body: Value) -> Result<Value, Error> {
        let (st, j) = http("POST", &format!("{}{}", OL, path), Some(key), Some(&body))?;
        if st >= 300 {
            let code = j.get("error").and_then(|e| e.as_str()).unwrap_or("error").to_string();
            if code.contains("policy") { return Err(err("policy_denied", "refused by the wallet's OutLayer policy")); }
            return Err(err("upstream", format!("wallet {} {}: {}", path, st, j.get("message").and_then(|m| m.as_str()).unwrap_or(&code))));
        }
        let Some(id) = s(&j, "request_id") else { return Ok(j) };
        let mut last = j;
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_secs(3));
            if let Ok((_, r)) = http("GET", &format!("{}/wallet/v1/requests/{}", OL, id), Some(key), None) {
                let stt = s(&r, "status").unwrap_or_default();
                last = r;
                if ["success", "failed", "error", "refunded", "needs_review"].contains(&stt.as_str()) { break; }
            }
        }
        Ok(last)
    }

    /// USD value (micro) of `amount` of `token`, priced by a dry 1Click quote into USDC.
    fn usd_of(token: &str, amount: &str, refund: &str, now_ms: u64) -> Result<u64, Error> {
        if token == USDC { return amount.parse::<u64>().map_err(|_| err("bad_params", "amount must be an integer")); }
        let q = oneclick_quote(&json!({"dry": true, "swapType": "EXACT_INPUT", "slippageTolerance": 100, "originAsset": token,
            "destinationAsset": USDC, "amount": amount, "depositType": "INTENTS", "refundTo": refund, "refundType": "INTENTS",
            "recipient": refund, "recipientType": "INTENTS", "deadline": iso(now_ms + 3_600_000)}))?;
        q.pointer("/quote/amountInUsd").and_then(|v| v.as_str()).and_then(parse_usd_micro).ok_or_else(|| err("upstream", "no USD price for token"))
    }

    fn log_push(account: &str, entry: Value) {
        let k = hkey(account, "log");
        let (v, _) = storage::get(&k);
        let mut a: Vec<Value> = serde_json::from_slice(&v).unwrap_or_default();
        a.push(entry);
        if a.len() > 100 { a.remove(0); }
        let _ = storage::set(&k, serde_json::to_string(&a).unwrap().as_bytes());
    }

    fn digits(p: &Value, k: &str) -> Result<String, Error> {
        let v = s(p, k).ok_or_else(|| err("bad_params", format!("missing params.{}", k)))?;
        if v.is_empty() || !v.bytes().all(|b| b.is_ascii_digit()) { return Err(err("bad_params", format!("params.{} must be an integer string in base units", k))); }
        Ok(v)
    }

    fn op_account(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "account", true)?;
        let (key, id) = holder_wallet(&c.account)?;
        let mut out = json!({"ok": true, "op": "account", "account": c.account, "confidential_id": id,
            "fund": "send a confidential transfer to confidential_id, or ask for a cross-chain deposit address with params {chain, token, amount}"});
        if let Some(chain) = s(&c.req.params, "chain") {
            let body = json!({"chain": chain, "token": s(&c.req.params, "token").unwrap_or_else(|| "USDC".into()), "amount": digits(&c.req.params, "amount")?});
            let (st, j) = http("POST", &format!("{}/wallet/v1/confidential/deposit/cross-chain", OL), Some(&key), Some(&body))?;
            if st >= 300 { return Err(err("upstream", format!("deposit address failed ({})", st))); }
            out["deposit"] = json!({"deposit_address": j.get("deposit_address"), "amount": j.get("amount"), "expires_at": j.get("expires_at"), "hint": j.get("hint")});
            prov_append(&c.token_id(), "deposit", &c.account, c.now_ms, &body.to_string());
        }
        Ok(out)
    }

    fn op_balance(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "balance", true)?;
        let (key, id) = holder_wallet(&c.account)?;
        let (_, j) = http("GET", &format!("{}/wallet/v1/confidential/balance", OL), Some(&key), None)?;
        Ok(json!({"ok": true, "op": "balance", "account": c.account, "confidential_id": id, "balances": j.get("balances").cloned().unwrap_or(json!([]))}))
    }

    fn op_swap(input: &Value, op: &str) -> Result<Value, Error> {
        let c = authenticate(input, op, true)?;
        let p = &c.req.params;
        let lim = limits_for_tier(c.tier.unwrap()).ok_or_else(|| err("no_key", "unknown tier"))?;
        let tin = s(p, "token_in").ok_or_else(|| err("bad_params", "missing params.token_in"))?;
        let tout = s(p, "token_out").ok_or_else(|| err("bad_params", "missing params.token_out"))?;
        if tin == tout { return Err(err("bad_params", "token_in and token_out must differ")); }
        let amt = digits(p, "amount_in")?;
        let (key, id) = holder_wallet(&c.account)?;
        let usd = usd_of(&tin, &amt, &id, c.now_ms)?;
        enforce_caps(&mut Host, &c.account, &lim, usd, c.now_ms, true)?;
        let day_key = hkey(&c.account, &format!("spent/{}", c.now_ms / 86_400_000));
        if let Err(e) = settle_if_owner(holds_key(&c.account)?) {
            let _ = Host.incr(&day_key, -(usd as i64));
            return Err(e);
        }
        let mut body = json!({"token_in": tin, "token_out": tout, "amount_in": amt});
        if let Some(m) = s(p, "min_amount_out") { body["min_amount_out"] = json!(m); }
        let r = wallet_op(&key, "/wallet/v1/confidential/swap", body);
        let r = match r { Ok(r) => r, Err(e) => { let _ = Host.incr(&day_key, -(usd as i64)); return Err(e); } };
        let status = s(&r, "status").unwrap_or_default();
        if status != "success" { let _ = Host.incr(&day_key, -(usd as i64)); }
        let amount_out = r.pointer("/result/amount_out").cloned().unwrap_or(Value::Null);
        log_push(&c.account, json!({"ts_ms": c.now_ms, "kind": op, "token_in": tin, "token_out": tout, "amount_in": amt, "amount_out": amount_out,
            "usd_in_micro": usd, "status": status, "source": p.get("source")}));
        if status == "success" { prov_append(&c.token_id(), op, &c.account, c.now_ms, &format!("{op} {tin} {amt}")); }
        Ok(json!({"ok": status == "success", "op": op, "account": c.account, "status": status, "amount_out": amount_out, "usd_in_micro": usd,
            "request_id": r.get("request_id"), "intent_hash": r.pointer("/result/intent_hash")}))
    }

    fn op_withdraw(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "withdraw", true)?;
        let p = &c.req.params;
        let lim = limits_for_tier(c.tier.unwrap()).ok_or_else(|| err("no_key", "unknown tier"))?;
        let (chain, to, token) = (s(p, "chain").ok_or_else(|| err("bad_params", "missing params.chain"))?,
            s(p, "to").ok_or_else(|| err("bad_params", "missing params.to"))?, s(p, "token").ok_or_else(|| err("bad_params", "missing params.token"))?);
        assert_withdraw_to(&c.account, &to)?;
        let amt = digits(p, "amount")?;
        let (key, id) = holder_wallet(&c.account)?;
        let usd = usd_of(&token, &amt, &id, c.now_ms)?;
        enforce_caps(&mut Host, &c.account, &lim, usd, c.now_ms, true)?;
        let day_key = hkey(&c.account, &format!("spent/{}", c.now_ms / 86_400_000));
        if let Err(e) = settle_if_owner(holds_key(&c.account)?) {
            let _ = Host.incr(&day_key, -(usd as i64));
            return Err(e);
        }
        let r = wallet_op(&key, "/wallet/v1/confidential/withdraw", json!({"chain": chain, "to": to, "amount": amt, "token": token}));
        let r = match r { Ok(r) => r, Err(e) => { let _ = Host.incr(&day_key, -(usd as i64)); return Err(e); } };
        let status = s(&r, "status").unwrap_or_default();
        if status != "success" { let _ = Host.incr(&day_key, -(usd as i64)); }
        log_push(&c.account, json!({"ts_ms": c.now_ms, "kind": "withdraw", "token": token, "amount": amt, "chain": chain, "usd_micro": usd, "status": status}));
        if status == "success" { prov_append(&c.token_id(), "withdraw", &c.account, c.now_ms, &format!("withdraw {amt} {token} to {to}")); }
        let tx_hash = r.pointer("/result/tx_hash").or(r.pointer("/tx_hash")).or(r.pointer("/result/transaction_hash")).cloned().unwrap_or(Value::Null);
        let fee = r.pointer("/result/fee").or(r.pointer("/fee")).cloned().unwrap_or(Value::Null);
        Ok(json!({"ok": status == "success", "op": "withdraw", "status": status, "request_id": r.get("request_id"),
            "tx_hash": tx_hash, "amount": amt, "to": to, "fee": fee}))
    }

    fn load_prov(token: &str) -> Vec<(ProvEvent, String)> {
        let (v, _) = storage::get(&format!("p/{token}"));
        let raw: Vec<Value> = serde_json::from_slice(&v).unwrap_or_default();
        raw.into_iter().filter_map(|j| {
            Some((ProvEvent {
                i: j.get("i")?.as_u64()?,
                prev: s(&j, "prev")?,
                kind: s(&j, "kind")?,
                token_id: s(&j, "token_id")?,
                owner: s(&j, "owner")?,
                ts_ms: j.get("ts_ms")?.as_u64()?,
                detail_hash: s(&j, "detail_hash")?,
            }, s(&j, "detail").unwrap_or_default()))
        }).collect()
    }

    fn save_prov(token: &str, rows: &[(ProvEvent, String)]) {
        let v: Vec<Value> = rows.iter().map(|(ev, detail)| json!({
            "i": ev.i, "prev": ev.prev, "kind": ev.kind, "token_id": ev.token_id,
            "owner": ev.owner, "ts_ms": ev.ts_ms, "detail_hash": ev.detail_hash, "detail": detail,
        })).collect();
        let _ = storage::set(&format!("p/{token}"), serde_json::to_string(&v).unwrap_or_else(|_| "[]".into()).as_bytes());
    }

    fn prov_append(token: &str, kind: &str, owner: &str, ts: u64, detail: &str) {
        let mut rows = load_prov(token);
        let mut evs: Vec<ProvEvent> = rows.iter().map(|(e, _)| e.clone()).collect();
        append_event(&mut evs, kind, token, owner, ts, detail);
        if let Some(ev) = evs.pop() { rows.push((ev, detail.to_string())); save_prov(token, &rows); }
    }

    fn prov_sync_owner(token: &str, owner: &str, ts: u64) {
        let rows = load_prov(token);
        if rows.last().map(|(e, _)| e.owner.as_str()) == Some(owner) || rows.is_empty() { return; }
        prov_append(token, "transfer", owner, ts, "transfer");
    }

    fn minter_secret(msk: &str) -> Result<[u8; 32], Error> {
        let raw = bs58::decode(msk.trim_start_matches("ed25519:")).into_vec().map_err(|_| err("signer", "bad key"))?;
        raw.get(..32).and_then(|s| s.try_into().ok()).ok_or_else(|| err("signer", "bad key"))
    }

    /// `detail_for`: return the private detail only on rows this account wrote, so a new holder
    /// never reads a previous holder's deposit or withdraw detail (the hash still chains).
    fn prov_body(token: &str, detail_for: Option<&str>) -> Result<Value, Error> {
        let rows = load_prov(token);
        let evs: Vec<ProvEvent> = rows.iter().map(|(e, _)| e.clone()).collect();
        let head = verify_chain(&evs).unwrap_or_else(|_| "0".repeat(64));
        let (mid, msk) = minter()?;
        let sig = sign_head(&minter_secret(&msk)?, &head);
        let events: Vec<Value> = rows.iter().map(|(ev, detail)| {
            let mut row = json!({"i": ev.i, "hash": event_hash(ev), "kind": ev.kind, "owner": ev.owner, "prev": ev.prev, "ts_ms": ev.ts_ms, "detail_hash": ev.detail_hash});
            if detail_for == Some(ev.owner.as_str()) { row["detail"] = json!(detail); }
            row
        }).collect();
        Ok(json!({"token_id": token, "head": head, "sig": sig, "minter": mid, "events": events}))
    }

    fn op_provenance(input: &Value) -> Result<Value, Error> {
        let tid = s(input, "token_id").filter(|t| t.starts_with('k') && t.len() <= 40 && t.chars().all(|c| c.is_ascii_alphanumeric()))
            .ok_or_else(|| err("bad_params", "token_id required"))?;
        let tok = view(&keys_contract(), "nft_token", json!({"token_id": tid}))?;
        if let Some(owner) = tok.get("owner_id").and_then(|v| v.as_str()) {
            if let Ok(now) = chain_now_ms() { prov_sync_owner(&tid, owner, now); }
        }
        let body = prov_body(&tid, None)?;
        let mut out = json!({"ok": true, "op": "provenance"});
        if let Value::Object(map) = body { if let Value::Object(o) = &mut out { o.extend(map); } }
        Ok(out)
    }

    fn op_history(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "history", true)?;
        let (v, _) = storage::get(&hkey(&c.account, "log"));
        let a: Vec<Value> = serde_json::from_slice(&v).unwrap_or_default();
        let tid = c.token_id();
        let chain = prov_body(&tid, Some(&c.account)).unwrap_or(json!({}));
        Ok(json!({"ok": true, "op": "history", "account": c.account, "entries": a, "log": chain}))
    }

    /// Permissionless: if this enclave's minter is no longer the contract's minter, move its NEAR
    /// to the current minter (keeps a small reserve for the account's own storage).
    fn op_sweep_minter() -> Result<Value, Error> {
        let (mid, msk) = minter()?;
        let cfg = view(&keys_contract(), "config", json!({}))?;
        let cur = s(&cfg, "minter").unwrap_or_default();
        if cur == mid { return Err(err("still_minter", "this enclave is the current minter; nothing to sweep")); }
        if !is_valid_account_id(&cur) { return Err(err("rpc", "contract minter unreadable")); }
        let (a, e) = rpc::view_account(&mid, "final");
        if !e.is_empty() { return Err(err("rpc", e)); }
        let a: Value = serde_json::from_str(&a).unwrap_or_default();
        let amount: u128 = a.pointer("/amount").or(a.pointer("/result/amount")).and_then(|v| v.as_str().map(|x| x.to_string()).or_else(|| v.as_u64().map(|n| n.to_string()))).and_then(|v| v.parse().ok()).unwrap_or(0);
        let reserve: u128 = 12_000_000_000_000_000_000_000; // 0.012 NEAR: storage + pessimistic-gas-price fee
        if amount <= reserve { return Err(err("empty", format!("nothing to sweep (balance {} yocto)", amount))); }
        let send_amt = amount - reserve;
        let tx = send(&mid, &msk, &cur, &[Action::Transfer { deposit: send_amt }])?;
        Ok(json!({"ok": true, "op": "sweep_minter", "from": mid, "to": cur, "yocto": send_amt.to_string(), "tx": tx}))
    }

    fn op_info() -> Result<Value, Error> {
        let (mid, _) = minter()?;
        Ok(json!({"ok": true, "op": "info", "version": VERSION, "keys_contract": keys_contract(), "nep413_recipient": recipient(),
            "minter_account": mid, "limits": {"1": limits_for_tier(1), "2": limits_for_tier(2), "3": limits_for_tier(3)},
            "ops": ["info","status","quote","mint","account","balance","swap","copy","withdraw","history","provenance","sweep_minter"], "global_per_minute": GLOBAL_PER_MINUTE, "global_mints_per_day": GLOBAL_MINTS_PER_DAY,
            "sign": "NEP-413 signMessage: message = JSON {op, account_id, ts_ms, params}, recipient = nep413_recipient, nonce = 32 random bytes"}))
    }

    pub fn run() {
        let mut raw = String::new();
        std::io::stdin().read_to_string(&mut raw).ok();
        let input: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        let op = input.get("op").and_then(|v| v.as_str()).unwrap_or("");
        let r = match op {
            "info" => op_info(),
            "provenance" => op_provenance(&input),
            "status" => op_status(&input),
            "quote" => op_quote(&input),
            "mint" => op_mint(&input),
            "account" => op_account(&input),
            "balance" => op_balance(&input),
            "swap" => op_swap(&input, "swap"),
            "copy" => op_swap(&input, "copy"),
            "withdraw" => op_withdraw(&input),
            "history" => op_history(&input),
            "sweep_minter" => op_sweep_minter(),
            _ => Err(err("unknown_op", "op must be one of: info, status, quote, mint, account, balance, swap, copy, withdraw, history, provenance, sweep_minter")),
        };
        let out = match r { Ok(v) => v, Err(e) => json!({"ok": false, "error": e}) };
        println!("{}", out);
    }
}

fn main() {
    #[cfg(target_arch = "wasm32")]
    host::run();
}
