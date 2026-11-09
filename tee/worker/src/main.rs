//! KEYHOLE OutLayer worker (wasm32-wasip2). Reads one JSON request on stdin, prints one JSON reply.
//! Ops: info | status | quote | mint | account | balance | swap | copy | withdraw | history | provenance | record | lock | prove | sweep_minter.
//! All ops except `info`, `provenance`, `record` and `sweep_minter` require a NEP-413 signature by the holder.
#[cfg(target_arch = "wasm32")]
mod host {
    use keyhole_worker::*;
    use keyhole_worker::guarded::{self, Control, Journal, Terminal};
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
        fn list_prefix(&mut self, p: &str) -> Result<Vec<String>, Error> {
            let (j, e) = storage::list_keys(p);
            if !e.is_empty() { return Err(err("storage", e)); }
            serde_json::from_str(&j).map_err(|_| err("storage", "key list is not JSON"))
        }
        fn read(&mut self, k: &str) -> Result<Vec<u8>, Error> {
            let (v, e) = storage::get(k);
            if !e.is_empty() && !e.to_lowercase().contains("not found") { return Err(err("storage", e)); }
            Ok(v)
        }
        fn remove(&mut self, k: &str) -> Result<(), Error> {
            let (_, e) = storage::delete(k);
            if !e.is_empty() { return Err(err("storage", e)); }
            Ok(())
        }
    }

    impl Kv for Host {
        fn get(&self, k: &str) -> Vec<u8> { storage::get(k).0 }
        fn set(&mut self, k: &str, v: &[u8]) { let _ = storage::set(k, v); }
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

    /// The tier the keys contract holds for this key (`nft_tier`, read live with finality final).
    fn nft_tier_of(token: &str) -> Result<u8, Error> {
        view(&keys_contract(), "nft_tier", json!({"token_id": token}))?.as_u64()
            .filter(|t| (1..=3).contains(t)).map(|t| t as u8)
            .ok_or_else(|| err("no_key", "the keys contract reports no tier for this key"))
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

    /// `nft_token(token_id).owner_id == account`, read live with finality final.
    fn owns(token: &str, account: &str) -> Result<bool, Error> {
        let tok = view(&keys_contract(), "nft_token", json!({"token_id": token}))?;
        Ok(owner_is(tok.get("owner_id").and_then(|t| t.as_str()), account))
    }

    /// `nft_listing(token_id)` read live with finality final: the parsed answer, or the RPC error text.
    /// Not `view()`, which hides the error text that `listing_blocks` needs to tell a missing method apart.
    fn listing_read(token: &str) -> Result<Value, String> {
        let (r, e) = rpc::view(&keys_contract(), "nft_listing", &json!({"token_id": token}).to_string(), "final");
        if !e.is_empty() { return Err(e); }
        serde_json::from_str(&r).map_err(|_| "listing answer is not JSON".to_string())
    }

    /// Refuses a value-moving op while the key is listed for sale. Called before any spend is held.
    /// Reads never reach the RPC call. Pass `execute: true` for a wet quote.
    fn assert_not_listed(op: &str, token: &str) -> Result<(), Error> {
        assert_not_listed_ex(op, token, false)
    }
    fn assert_not_listed_ex(op: &str, token: &str, execute: bool) -> Result<(), Error> {
        if !is_value_move_or_wet_quote(op, execute) { return Ok(()); }
        let read = listing_read(token);
        listing_blocks_ex(op, execute, read.as_ref().map_err(String::as_str))
    }

    /// Current settlement epoch for a key (enclave storage). Missing means 0.
    fn epoch_of(token: &str) -> u64 {
        epoch_from_bytes(&Host.get(&tkey(token, "epoch")))
    }

    /// Persist epoch. Called when ownership changes.
    fn set_epoch(token: &str, epoch: u64) {
        Host.set(&tkey(token, "epoch"), &epoch_to_bytes(epoch));
    }

    /// Stamp a value-move with the current epoch, then refuse if owner or epoch drift before the send.
    fn settle_gate(token: &str, account: &str, stamped: u64) -> Result<(), Error> {
        owns(token, account).and_then(settle_if_owner)?;
        let control=guard_control(token)?;control.admit()?;
        settle_if_epoch(stamped, control.epoch)
    }

    fn yocto_of(v: &Value) -> u128 {
        v.pointer("/amount").or(v.pointer("/result/amount"))
            .and_then(|n| n.as_str().map(|s| s.to_string()).or_else(|| n.as_u64().map(|u| u.to_string())))
            .and_then(|s| s.parse().ok()).unwrap_or(0)
    }

    struct Ctx { account: String, req: SignedRequest, now_ms: u64, tier: Option<u8>, token: Option<String>, session: Option<(String, SessionGrant)> }

    impl Ctx {
        /// The key this request acts on: the key held now, else the id this account would mint.
        fn token_id(&self) -> String { self.token.clone().unwrap_or_else(|| token_id_for(&self.account)) }
        /// The custody wallet bound to that key.
        fn wallet(&self) -> Result<(String, String), Error> { holder_wallet(&self.token_id(), &self.account) }
        fn cap(&self) -> String { cap_id(&self.token_id()) }
    }

    // Signature -> key ownership -> freshness -> op binding -> tier -> nonce (replay) -> rate limit.
    thread_local! {
        // Account and key that passed authentication in this call, echoed in `bind`.
        static BIND: std::cell::RefCell<Option<(String, Option<String>)>> = const { std::cell::RefCell::new(None) };
    }

    fn authenticate(input: &Value, op: &str, need_key: bool) -> Result<Ctx, Error> {
        if input.pointer("/auth/scheme").and_then(|v| v.as_str()) == Some("session") {
            return authenticate_session(input, op);
        }
        let auth: Auth = serde_json::from_value(input.get("auth").cloned().unwrap_or(Value::Null))
            .map_err(|_| err("no_auth", "missing `auth`: sign the request with your NEAR wallet (NEP-413 signMessage)"))?;
        let eip191 = auth.scheme == "eip191";
        let (req, nonce) = if eip191 { verify_eip191(&auth, &recipient())? } else { verify_nep413(&auth, &recipient())? };
        if req.op != op { return Err(err("op_mismatch", format!("signed op '{}' but called '{}'", req.op, op))); }
        if !eip191 {
            let (ak, e) = rpc::view_access_key(&auth.account_id, &auth.public_key, "final");
            if !e.is_empty() || !is_full_access(&ak) {
                return Err(err("key_not_owned", "the signing key is not a full-access key of this account"));
            }
        }
        let account = req.account_id.clone();
        let now_ms = chain_now_ms()?;
        check_freshness(req.ts_ms, now_ms)?;
        let tier = holder_tier(&account)?;
        // A holder of several keys names one in the signed params; otherwise the first key held.
        let token = if !need_key && tier.is_none() { None } else if let Some(t) = s(&req.params, "token_id") {
            if owns(&t, &account)? { Some(t) } else { None }
        } else {
            if tier.is_some() {
                let n = view(&keys_contract(), "nft_supply_for_owner", json!({"account_id": account}))?;
                pick_token(None, n.as_str().and_then(|x| x.parse().ok()).unwrap_or(0))?;
            }
            held_token(&account)?
        };
        if need_key && token.is_none() {
            return Err(err("not_owner", "only the current key holder can authorize this"));
        }
        let lim = limits_for_tier(tier.unwrap_or(1)).unwrap();
        // Nonce first: a replay is refused without spending the rate budget (P1-9).
        admit(&mut Host, &account, &lim, &nonce, now_ms)?;
        BIND.with(|b| *b.borrow_mut() = Some((account.clone(), token.clone())));
        Ok(Ctx { account, req, now_ms, tier, token, session: None })
    }

    /// Session call (docs.near.org/web3-apps/backend/backend pattern): the token the enclave issued after one NEP-413
    /// signature. Every call re-checks expiry, scope, revocation, freshness, a single-use nonce, and that the account
    /// still holds the key (a sale ends the session).
    fn authenticate_session(input: &Value, op: &str) -> Result<Ctx, Error> {
        let sa: SessionAuth = serde_json::from_value(input.get("auth").cloned().unwrap_or(Value::Null))
            .map_err(|_| err("no_auth", "session auth must carry {token, message, nonce, recipient}"))?;
        let id = parse_session_token(&sa.token)?;
        let raw = Host.get(&session_key(&id, "grant"));
        let g: SessionGrant = serde_json::from_slice(&raw).map_err(|_| err("session_unknown", "no such session; unlock with one wallet signature"))?;
        if !Host.get(&session_key(&id, "revoked")).is_empty() { return Err(err("session_revoked", "this session was revoked; unlock again")); }
        let now_ms = chain_now_ms()?;
        check_grant_time(&g, now_ms)?;
        let (req, nonce) = verify_session_request(&sa, &g, &recipient(), op)?;
        check_freshness(req.ts_ms, now_ms)?;
        let account = g.account.clone();
        if !owns(&g.token_id, &account)? { return Err(err("not_owner", "this account no longer holds the key the session was made for")); }
        guarded::session_epoch(&Store::read(&mut Host,&session_key(&id,"guard_epoch"))?,guard_control(&g.token_id)?.epoch)?;
        let tier = holder_tier(&account)?;
        let lim = limits_for_tier(tier.unwrap_or(1)).unwrap();
        admit(&mut Host, &account, &lim, &nonce, now_ms)?;
        BIND.with(|b| *b.borrow_mut() = Some((account.clone(), Some(g.token_id.clone()))));
        Ok(Ctx { account, req, now_ms, tier, token: Some(g.token_id.clone()), session: Some((id, g)) })
    }

    /// Start a session: one NEP-413 / EIP-191 wallet signature over {op:"session", params:{max_usd_micro, ttl_ms?, scope?}}.
    /// Returns a random token; only its sha256 is stored. Follows the documented backend-auth flow.
    fn op_session(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "session", true)?;
        let g = grant_from_request(&c.req, &c.token_id(), c.now_ms)?;
        let control=guard_control(&c.token_id())?;
        if control.transfer_pending{return Err(err("transfer_pending","wait for title settlement before creating a session"));}
        let mut t = [0u8; 32];
        getrandom::fill(&mut t).map_err(|_| err("rng", "no randomness"))?;
        let id = session_id(&t);
        guarded::put_once(&mut Host,&session_key(&id,"grant"),&serde_json::to_vec(&g).map_err(|_|err("storage","grant encoding"))?)?;
        guarded::put_once(&mut Host,&session_key(&id,"guard_epoch"),&control.epoch.to_be_bytes())?;
        Ok(json!({"ok": true, "op": "session", "account": c.account, "token_id": g.token_id, "session_token": b64(&t),
            "exp_ms": g.exp_ms, "max_usd_micro": g.max_usd_micro, "scope": g.scope, "owner_epoch":control.epoch.to_string()}))
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
        send_full(signer, sk_str, receiver, actions).map(|(h, _)| h)
    }

    /// Like `send`, also returning the final outcome JSON (for calls whose return value matters).
    fn send_full(signer: &str, sk_str: &str, receiver: &str, actions: &[Action]) -> Result<(String, Value), Error> {
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
        match hash { Some(h) if !h.is_empty() => Ok((h, v)), _ => Err(err("tx_failed", format!("no tx hash; rpc said: {}", r.chars().take(300).collect::<String>()))) }
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

    /// Tier caps narrowed by the holder's own limits (see `set_policy`).
    fn limits_now(c: &Ctx) -> Result<Limits, Error> {
        let tier = limits_for_tier(c.tier.unwrap_or(0)).ok_or_else(|| err("no_key", "unknown tier"))?;
        let pol = policy_for(&Host.get(&tkey(&c.token_id(), "policy")), &c.account);
        Ok(effective_limits(tier, pol.as_ref(), c.now_ms))
    }

    fn op_quote(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "quote", true)?;
        let p = &c.req.params;
        let execute=p.get("execute").and_then(Value::as_bool).unwrap_or(false);
        if execute{guard_preflight(&c)?;}
        let lim = limits_now(&c)?;
        // No quotes on a key locked for sale; proceeds and refunds go only to the signer (P1-4c, P1-9).
        assert_unlocked(&Host.get(&tkey(&c.token_id(), "lock")), &c.account, c.now_ms)?;
        assert_quote_parties(&c.account, &s(p, "recipient").unwrap_or_default(), &s(p, "refund_to").unwrap_or_default())?;
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
        // Wet quotes move custody funds via an INTENTS deposit; refuse them while listed (H-1).
        if execute {
            assert_not_listed_ex("quote", &c.token_id(), true)?;
        }
        let spent=enforce_caps(&mut Host,&c.cap(),&lim,usd,c.now_ms,false)?;
        let mut out=json!({"ok":true,"op":"quote","account":c.account,"tier":c.tier,"usd_micro":usd,"limits":lim,"spent_today_usd_micro":spent,"policy":"passed"});
        if !execute{out["quote"]=dry["quote"].clone();return Ok(out);}
        body["dry"]=json!(false);
        let charge=charge_spend(&mut Host,&c.cap(),&lim,c.session.as_ref().map(|(id,g)|(id.as_str(),g)),usd,c.now_ms)?;
        let j=guard_begin(&c,input,"quote",body.clone(),Some(charge))?;
        if !guarded::put_once(&mut Host,&format!("{}/dispatch",j.key()),b"1")?{return Err(err("replay","quote already dispatched"));}
        let real=oneclick_quote(&body).map_err(|_|err("needs_review",format!("quote-only outcome unknown; admission {} remains locked",j.op_id)))?;
        let wet=real.pointer("/quote/amountInUsd").and_then(Value::as_str).and_then(parse_usd_micro);
        let valid=assert_wet_within_dry(usd,wet).is_ok()&&real.pointer("/quote/depositAddress").and_then(Value::as_str).is_some();
        let t=Terminal{success:valid,refund_charge:!valid,provider_id:format!("quote-only:{}",sha256_hex(&real.to_string()))};
        let finished=guard_finish(&j,&t)?;
        if !valid{return Err(err("quote_changed",format!("quote rejected; admission_finished={finished}; operation {}",j.op_id)));}
        out["quote"]=real["quote"].clone();out["deposit_address"]=real.pointer("/quote/depositAddress").cloned().unwrap_or(Value::Null);
        out["value_op_id"]=json!(j.op_id);out["admission_finished"]=json!(finished);out["quote_only"]=json!(true);Ok(out)
    }

    fn op_status(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "status", false)?;
        let tier_lim = c.tier.and_then(limits_for_tier);
        let lim = if c.token.is_some() { limits_now(&c).ok().or(tier_lim) } else { tier_lim };
        let pol = c.token.as_ref().and_then(|t| policy_for(&Host.get(&tkey(t, "policy")), &c.account));
        let cool = c.token.as_ref().and_then(|t| {
            prov_sync_owner(t, &c.account, c.now_ms);
            let evs: Vec<ProvEvent> = load_prov(t).into_iter().map(|(e, _)| e).collect();
            cooldown_until(&evs, &c.account).filter(|u| *u > c.now_ms)
        });
        let spent = Host.incr(&hkey(&c.cap(), &format!("spent/{}", c.now_ms / 86_400_000)), 0)?;
        let locked = c.token.as_ref().and_then(|t| active_lock(&Host.get(&tkey(t, "lock")), &c.account, c.now_ms));
        let epoch=match c.token.as_ref(){Some(t)=>guard_control(t)?.epoch,None=>0};
        Ok(json!({"ok": true, "op": "status", "account": c.account, "tier": c.tier, "limits": lim, "tier_limits": tier_lim,
            "holder_limits": pol, "withdraw_cooldown_until_ms": cool, "locked_until_ms": locked, "spent_today_usd_micro": spent,
            "settlement_epoch": epoch,"owner_epoch":epoch.to_string()}))
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
        let tid = token_id_for(&c.account);
        // An account that minted and then moved its key would reuse this id: refuse before the quota is touched.
        let existing = view(&keys_contract(), "nft_token", json!({"token_id": tid}))?;
        assert_mint_id_free(existing.get("owner_id").and_then(|o| o.as_str()))?;
        let day = c.now_ms / 86_400_000;
        bump_within(&mut Host, &format!("g/mints/{}", day), 1, GLOBAL_MINTS_PER_DAY, "mint_quota", "daily free-mint quota reached, try tomorrow (UTC)".into())?;
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
        http_idempotent(method,url,bearer,body,None)
    }
    fn http_idempotent(method: &str, url: &str, bearer: Option<&str>, body: Option<&Value>, idempotency:Option<&str>) -> Result<(u16, Value), Error> {
        let c = wasi_http_client::Client::new();
        let auth = bearer.map(|b| format!("Bearer {}", b));
        let b = body.map(|b| b.to_string()).unwrap_or_default();
        let mut rq = if method == "GET" { c.get(url) } else { c.post(url) };
        if let Some(a) = auth.as_deref() { rq = rq.header("Authorization", a); }
        if let Some(id)=idempotency { rq=rq.header("X-Idempotency-Key",id).header("X-Answer-Within","0"); }
        if method != "GET" { rq = rq.header("Content-Type", "application/json").body(b.as_bytes()); }
        let resp = rq.connect_timeout(std::time::Duration::from_secs(20)).send().map_err(|_| err("upstream", "OutLayer wallet API unreachable, retry"))?;
        let st = resp.status();
        let raw = resp.body().unwrap_or_default();
        Ok((st, serde_json::from_slice(&raw).unwrap_or(json!({"raw": String::from_utf8_lossy(&raw).chars().take(200).collect::<String>()}))))
    }

    /// Returns (api_key, intents_user_id) of the custody wallet bound to `token`. The api key is
    /// created and kept inside the enclave only. Whoever owns the token operates this wallet, so
    /// transferring the NFT transfers the confidential account.
    fn holder_wallet(token: &str, owner: &str) -> Result<(String, String), Error> {
        let k = tkey(token, "wallet");
        if let Some(v) = custody_lookup(&mut Host, token, owner)? {
            let j: Value = serde_json::from_slice(&v).map_err(|_| err("storage", "wallet record corrupt"))?;
            return Ok((s(&j, "api_key").unwrap_or_default(), s(&j, "near_account_id").unwrap_or_default()));
        }
        let ck = tkey(token, "wallet_claim");
        let now = chain_now_ms().unwrap_or(0);
        if !Host.set_if_absent(&ck, now.to_string().as_bytes())? {
            if !wallet_claim_free(&Host.get(&ck), now) { return Err(err("busy", "this key's wallet is being created, retry in a moment")); }
            Host.set(&ck, now.to_string().as_bytes());
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

    include!("guarded_host.rs");

    /// USD value (micro) of `amount` of `token`, priced by a dry 1Click quote into USDC.
    fn usd_of(token: &str, amount: &str, refund: &str, now_ms: u64) -> Result<u64, Error> {
        if token == USDC { return amount.parse::<u64>().map_err(|_| err("bad_params", "amount must be an integer")); }
        let q = oneclick_quote(&json!({"dry": true, "swapType": "EXACT_INPUT", "slippageTolerance": 100, "originAsset": token,
            "destinationAsset": USDC, "amount": amount, "depositType": "INTENTS", "refundTo": refund, "refundType": "INTENTS",
            "recipient": refund, "recipientType": "INTENTS", "deadline": iso(now_ms + 3_600_000)}))?;
        q.pointer("/quote/amountInUsd").and_then(|v| v.as_str()).and_then(parse_usd_micro).ok_or_else(|| err("upstream", "no USD price for token"))
    }

    fn log_push(token: &str, by: &str, mut entry: Value) {
        entry["by"] = json!(by);
        let k = tkey(token, "log");
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
        let (key, id) = c.wallet()?;
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
        let (key, id) = c.wallet()?;
        let (_, j) = http("GET", &format!("{}/wallet/v1/confidential/balance", OL), Some(&key), None)?;
        Ok(json!({"ok": true, "op": "balance", "account": c.account, "confidential_id": id, "balances": j.get("balances").cloned().unwrap_or(json!([]))}))
    }

    /// Fresh dry quote `tin` -> `tout` for `amt`, priced at DEFAULT_MAX_SLIPPAGE_BPS. Same request shape as
    /// `usd_of`. Its `quote.amountOut` and `quote.minAmountOut` (near-intents rules/api-quote.md, "Response
    /// Fields") bound the fill when the caller sends no `min_amount_out`.
    fn swap_quote(tin: &str, tout: &str, amt: &str, id: &str, now_ms: u64) -> Result<Value, Error> {
        oneclick_quote(&json!({"dry": true, "swapType": "EXACT_INPUT", "slippageTolerance": DEFAULT_MAX_SLIPPAGE_BPS,
            "originAsset": tin, "destinationAsset": tout, "amount": amt, "depositType": "INTENTS", "refundTo": id,
            "refundType": "INTENTS", "recipient": id, "recipientType": "INTENTS", "deadline": iso(now_ms + 3_600_000)}))
    }

    fn op_swap(input: &Value, op: &str) -> Result<Value, Error> {
        let c = authenticate(input, op, true)?;
        guard_preflight(&c)?;
        let p = &c.req.params;
        let lim = limits_now(&c)?;
        let tin = s(p, "token_in").ok_or_else(|| err("bad_params", "missing params.token_in"))?;
        let tout = s(p, "token_out").ok_or_else(|| err("bad_params", "missing params.token_out"))?;
        if tin == tout { return Err(err("bad_params", "token_in and token_out must differ")); }
        let amt = digits(p, "amount_in")?;
        // A client floor is checked before anything is priced or held. Zero is refused.
        let client_min = client_min_out_field(p.get("min_amount_out"))?;
        let (key, id) = guarded_wallet(&c.token_id())?;
        let usd = usd_of(&tin, &amt, &id, c.now_ms)?;
        assert_unlocked(&Host.get(&tkey(&c.token_id(), "lock")), &c.account, c.now_ms)?;
        // A key listed for sale is frozen for value moves until it is sold or unlisted (before any spend is held).
        assert_not_listed(op, &c.token_id())?;
        let stamped = guard_control(&c.token_id())?.epoch;
        // The floor the wallet must respect. Without one from the caller, it comes from a fresh quote.
        let min_out = match client_min {
            Some(m) => m,
            None => {
                let q = swap_quote(&tin, &tout, &amt, &id, c.now_ms)?;
                let quoted = q.pointer("/quote/amountOut").and_then(|v| v.as_str()).and_then(|x| x.parse::<u128>().ok()).unwrap_or(0);
                let api_min = q.pointer("/quote/minAmountOut").and_then(|v| v.as_str()).and_then(|x| x.parse::<u128>().ok());
                derive_min_out(quoted, api_min)?
            }
        };
        // Everything below holds the spend. Each refusal before the send gives it back (charge_spend and release).
        let charge = charge_spend(&mut Host, &c.cap(), &lim, c.session.as_ref().map(|(i, g)| (i.as_str(), g)), usd, c.now_ms)?;
        if let Err(e) = settle_gate(&c.token_id(), &c.account, stamped) {
            charge.release(&mut Host);
            return Err(e);
        }
        // Re-read listing once more immediately before the send (check-then-act window).
        if let Err(e) = assert_not_listed(op, &c.token_id()) {
            charge.release(&mut Host);
            return Err(e);
        }
        let body = json!({"token_in": tin, "token_out": tout, "amount_in": amt, "min_amount_out": min_out.to_string()});
        let j=guard_begin(&c,input,op,body,Some(charge))?;
        let r=guard_provider(&j,&key,false).map_err(|_|err("needs_review",format!("custody outcome unknown; reconcile {}",j.op_id)))?;
        let raw_status = s(&r, "status").unwrap_or_default();
        let still = owns(&c.token_id(), &c.account).unwrap_or(false);
        let status = after_move_status_epoch(&raw_status, still, stamped, guard_control(&c.token_id())?.epoch);
        let amount_out = r.pointer("/result/amount_out").cloned().unwrap_or(Value::Null);
        log_push(&c.token_id(), &c.account, json!({"ts_ms": c.now_ms, "kind": op, "token_in": tin, "token_out": tout, "amount_in": amt, "amount_out": amount_out,
            "usd_in_micro": usd, "status": status, "epoch": stamped, "source": p.get("source")}));
        if status == "success" { prov_append(&c.token_id(), op, &c.account, c.now_ms, &format!("{op} {tin} {amt}")); }
        Ok(json!({"ok": status == "success", "op": op, "account": c.account, "status": status, "amount_out": amount_out, "usd_in_micro": usd,
            "min_amount_out": min_out.to_string(), "settlement_epoch": stamped, "value_op_id":j.op_id,"admission_finished":r.get("admission_finished"), "request_id": r.get("request_id"), "intent_hash": r.pointer("/result/intent_hash")}))
    }

    fn op_withdraw(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "withdraw", true)?;
        guard_preflight(&c)?;
        let p = &c.req.params;
        let lim = limits_now(&c)?;
        let (chain, to, token) = (s(p, "chain").ok_or_else(|| err("bad_params", "missing params.chain"))?,
            s(p, "to").ok_or_else(|| err("bad_params", "missing params.to"))?, s(p, "token").ok_or_else(|| err("bad_params", "missing params.token"))?);
        // `to` is checked for shape on `chain` only. The NEP-413 message signed above already contains params.to, so
        // the holder has signed this destination explicitly.
        assert_withdraw_to(&chain, &to)?;
        prov_sync_owner(&c.token_id(), &c.account, c.now_ms);
        let evs: Vec<ProvEvent> = load_prov(&c.token_id()).into_iter().map(|(e, _)| e).collect();
        assert_no_cooldown(&evs, &c.account, c.now_ms)?;
        let amt = digits(p, "amount")?;
        let (key, id) = guarded_wallet(&c.token_id())?;
        let usd = usd_of(&token, &amt, &id, c.now_ms)?;
        assert_unlocked(&Host.get(&tkey(&c.token_id(), "lock")), &c.account, c.now_ms)?;
        assert_not_listed("withdraw", &c.token_id())?;
        let stamped = guard_control(&c.token_id())?.epoch;
        // Holds the spend; every refusal before the send gives it back (see charge_spend).
        let charge = charge_spend(&mut Host, &c.cap(), &lim, c.session.as_ref().map(|(i, g)| (i.as_str(), g)), usd, c.now_ms)?;
        if let Err(e) = settle_gate(&c.token_id(), &c.account, stamped) {
            charge.release(&mut Host);
            return Err(e);
        }
        if let Err(e) = assert_not_listed("withdraw", &c.token_id()) {
            charge.release(&mut Host);
            return Err(e);
        }
        let j=guard_begin(&c,input,"withdraw",json!({"chain":chain,"to":to,"amount":amt,"token":token}),Some(charge))?;
        let r=guard_provider(&j,&key,false).map_err(|_|err("needs_review",format!("custody outcome unknown; reconcile {}",j.op_id)))?;
        let raw_status = s(&r, "status").unwrap_or_default();
        // Re-read ownership and settlement epoch after the move: either drift reports needs_review.
        let still = owns(&c.token_id(), &c.account).unwrap_or(false);
        let status = after_move_status_epoch(&raw_status, still, stamped, guard_control(&c.token_id())?.epoch);
        log_push(&c.token_id(), &c.account, json!({"ts_ms": c.now_ms, "kind": "withdraw", "token": token, "amount": amt, "chain": chain, "usd_micro": usd, "status": status, "epoch": stamped}));
        if status == "success" { prov_append(&c.token_id(), "withdraw", &c.account, c.now_ms, &format!("withdraw {amt} {token} to {to}")); }
        let tx_hash = r.pointer("/result/tx_hash").or(r.pointer("/tx_hash")).or(r.pointer("/result/transaction_hash")).cloned().unwrap_or(Value::Null);
        let fee = r.pointer("/result/fee").or(r.pointer("/fee")).cloned().unwrap_or(Value::Null);
        Ok(json!({"ok": status == "success", "op": "withdraw", "status": status, "settlement_epoch": stamped, "value_op_id":j.op_id,"admission_finished":r.get("admission_finished"), "request_id": r.get("request_id"),
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
        let n = evs.len();
        let details = append_synced(&mut evs, kind, token, owner, ts, detail);
        for (ev, d) in evs.drain(n..).zip(details) { rows.push((ev, d)); }
        save_prov(token, &rows);
    }

    fn prov_sync_owner(token: &str, owner: &str, ts: u64) {
        let rows = load_prov(token);
        if rows.last().map(|(e, _)| e.owner.as_str()) == Some(owner) || rows.is_empty() { return; }
        // Ownership changed: bump the settlement epoch so any in-flight settle stamped with the old epoch is void.
        let next = bump_epoch(epoch_of(token));
        set_epoch(token, next);
        prov_append(token, "transfer", owner, ts, &format!("transfer epoch {next}"));
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

    /// Seller lock: swap and withdraw are refused for `params.hours` (1..=168). It cannot be lifted
    /// early by the holder. A transfer ends it, because a lock binds only the owner who set it.
    fn op_lock(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "lock", true)?;
        let hours = s(&c.req.params, "hours").and_then(|h| h.parse::<u64>().ok())
            .or_else(|| c.req.params.get("hours").and_then(|h| h.as_u64()))
            .filter(|h| (1..=MAX_LOCK_HOURS).contains(h))
            .ok_or_else(|| err("bad_params", "params.hours must be 1..168"))?;
        let k = tkey(&c.token_id(), "lock");
        let cur = active_lock(&Host.get(&k), &c.account, c.now_ms).unwrap_or(0);
        let until = (c.now_ms + hours * 3_600_000).max(cur);
        Host.set(&k, lock_value(&c.account, until).as_bytes());
        prov_append(&c.token_id(), "lock", &c.account, c.now_ms, &format!("lock until {until}"));
        Ok(json!({"ok": true, "op": "lock", "account": c.account, "token_id": c.token_id(), "locked_until_ms": until}))
    }

    /// Holder limits: `params.per_tx_usd_micro` and `params.daily_usd_micro`, within the tier caps.
    /// A cut applies at once; a raise waits 24 h (`set_policy`). Enforced on every quote, swap and withdraw.
    fn op_limits(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "limits", true)?;
        let tier = limits_for_tier(c.tier.unwrap_or(0)).ok_or_else(|| err("no_key", "unknown tier"))?;
        let num = |k: &str| -> Result<u64, Error> {
            c.req.params.get(k).and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|x| x.parse().ok())))
                .ok_or_else(|| err("bad_params", format!("missing params.{k} (USD micro)")))
        };
        let (pt, d) = (num("per_tx_usd_micro")?, num("daily_usd_micro")?);
        let k = tkey(&c.token_id(), "policy");
        let cur = policy_for(&Host.get(&k), &c.account);
        let pol = set_policy(tier, cur.as_ref(), &c.account, pt, d, c.now_ms)?;
        if c.session.is_some() && session_limits_raise(cur.as_ref(), &pol) {
            return Err(err("session_scope", "raising limits needs a fresh wallet signature"));
        }
        Host.set(&k, serde_json::to_string(&pol).unwrap_or_default().as_bytes());
        prov_append(&c.token_id(), "limits", &c.account, c.now_ms, &format!("limits {pt}/{d} pending={}", pol.pending.is_some()));
        let eff = effective_limits(tier, Some(&pol), c.now_ms);
        Ok(json!({"ok": true, "op": "limits", "account": c.account, "token_id": c.token_id(), "holder_limits": pol, "limits": eff, "tier_limits": tier}))
    }

    /// Holder-signed proof that the key's account holds at least `params.min` of `params.token`.
    /// The statement names the threshold and a yes/no answer, not the balance, and is signed by the
    /// enclave minter key (same key as the key log). The holder chooses whom to show it to.
    fn op_prove(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "prove", true)?;
        let asset = s(&c.req.params, "token").unwrap_or_else(|| USDC.to_string());
        let min = digits(&c.req.params, "min")?;
        let min_n: u128 = min.parse().map_err(|_| err("bad_params", "params.min too large"))?;
        let (key, _) = c.wallet()?;
        let (st, j) = http("GET", &format!("{}/wallet/v1/confidential/balance", OL), Some(&key), None)?;
        if st >= 300 { return Err(err("upstream", format!("balance failed ({})", st))); }
        let holds = balance_of(j.get("balances").unwrap_or(&Value::Null), &asset) >= min_n;
        let tid = c.token_id();
        let locked = active_lock(&Host.get(&tkey(&tid, "lock")), &c.account, c.now_ms).unwrap_or(0);
        let rows = load_prov(&tid);
        let evs: Vec<ProvEvent> = rows.iter().map(|(e, _)| e.clone()).collect();
        let head = verify_chain(&evs).unwrap_or_else(|_| "0".repeat(64));
        let statement = proof_canonical(&tid, &c.account, &asset, &min, holds, locked, &head, c.now_ms);
        let (mid, msk) = minter()?;
        let sig = sign_head(&minter_secret(&msk)?, &statement);
        Ok(json!({"ok": true, "op": "prove", "statement": statement, "sig": sig, "minter": mid, "holds_at_least": holds}))
    }

    /// Opt-in PnL: the holder signs `pnl` to get a statement they may publish. The enclave reads its own
    /// trade log for this holder, prices each trade's output now (dry 1Click quotes) and signs totals
    /// with the minter key. Nothing is published by the enclave; the holder decides.
    fn op_pnl(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "pnl", true)?;
        let (_, id) = c.wallet()?;
        let tid = c.token_id();
        let all: Vec<Value> = serde_json::from_slice(&Host.get(&tkey(&tid, "log"))).unwrap_or_default();
        let mine = history_for(&all, &c.account);
        let (trades, cost, outs, since) = pnl_aggregate(&mine);
        if outs.len() > 6 { return Err(err("bad_params", "too many assets to price in one call")); }
        let mut value = 0u64;
        for (tok, amt) in &outs { value = value.saturating_add(usd_of(tok, &amt.to_string(), &id, c.now_ms)?); }
        let rows = load_prov(&tid);
        let evs: Vec<ProvEvent> = rows.iter().map(|(e, _)| e.clone()).collect();
        let head = verify_chain(&evs).unwrap_or_else(|_| "0".repeat(64));
        let statement = pnl_canonical(&tid, &c.account, trades, cost, value, since, &head, c.now_ms);
        let (mid, msk) = minter()?;
        let sig = sign_head(&minter_secret(&msk)?, &statement);
        Ok(json!({"ok": true, "op": "pnl", "statement": statement, "sig": sig, "minter": mid}))
    }

    /// Public signed record of a key listed for sale. No signature: anyone may ask. It is answered only while the keys
    /// contract lists the key now (`not_listed` otherwise), and only from a key log that verifies (`bad_log`, nothing
    /// is written then). It covers every row of the key's log, from any holder, and is signed by the minter key as
    /// `prove` and `pnl` are. The trade log keeps its last 100 rows (`log_push`), so the counts cover those rows.
    fn op_record(input: &Value) -> Result<Value, Error> {
        let tid = s(&input.get("params").cloned().unwrap_or_default(), "token_id").unwrap_or_default();
        if chainsig::path_for(&tid).is_none() { return Err(err("bad_params", "params.token_id must be k + 16 hex")); }
        let listing = record_listing(listing_read(&tid).as_ref().map_err(String::as_str))?;
        let owner = view(&keys_contract(), "nft_token", json!({"token_id": tid}))?
            .get("owner_id").and_then(|o| o.as_str()).map(str::to_string)
            .ok_or_else(|| err("rpc", "the keys contract names no owner for this key"))?;
        let tier = nft_tier_of(&tid)?;
        let now = chain_now_ms()?;
        let stored: Vec<ProvEvent> = load_prov(&tid).into_iter().map(|(e, _)| e).collect();
        verify_chain(&stored)?;
        // The same owner sync as provenance and level_up, so a transfer the log has not seen yet is in the head.
        prov_sync_owner(&tid, &owner, now);
        let evs: Vec<ProvEvent> = load_prov(&tid).into_iter().map(|(e, _)| e).collect();
        let head = verify_chain(&evs)?;
        let all: Vec<Value> = serde_json::from_slice(&Host.get(&tkey(&tid, "log"))).unwrap_or_default();
        let (settled, volume) = level_counts(&all);
        let (trades, cost, outs, since) = pnl_aggregate(&all);
        let statement = record_canonical(&tid, &owner, tier, &listing.seller, &listing.price_yocto, settled, volume, trades, cost, &outs, since, &head, now);
        let (mid, msk) = minter()?;
        let sig = sign_head(&minter_secret(&msk)?, &statement);
        Ok(json!({"ok": true, "op": "record", "statement": statement, "sig": sig, "minter": mid, "token_id": tid}))
    }

    /// Earned tiers. The key's settled swaps and volume, read from its verified provenance chain and trade log, raise its tier.
    /// The count is `level_counts` (lib.rs): swap and copy rows with status success, in the last 100 rows of the key's log, any holder.
    /// Moves no funds. The minter sends `nft_set_tier` only when the record earns a higher tier than the contract holds now.
    fn op_level_up(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "level_up", true)?;
        let tid = c.token_id();
        prov_sync_owner(&tid, &c.account, c.now_ms);
        let evs: Vec<ProvEvent> = load_prov(&tid).into_iter().map(|(e, _)| e).collect();
        let trades: Vec<Value> = serde_json::from_slice(&Host.get(&tkey(&tid, "log"))).unwrap_or_default();
        let current = nft_tier_of(&tid)?;
        // Refuses with bad_log when the provenance chain does not verify; nothing is counted then.
        let a = assess_level(&evs, &trades, current)?;
        if a.earned <= current {
            let progress = serde_json::to_value(&a.progress).unwrap_or(Value::Null);
            return Ok(json!({"ok": true, "op": "level_up", "account": c.account, "token_id": tid,
                "tier": current, "earned": current, "progress": progress}));
        }
        if !owns(&tid, &c.account)? {
            return Err(err("not_owner", "the key moved before this request settled; nothing was sent"));
        }
        let (mid, msk) = minter()?;
        let args = json!({"token_id": tid, "tier": a.earned}).to_string();
        let tx = send(&mid, &msk, &keys_contract(), &[Action::FunctionCall { method: "nft_set_tier", args: args.as_bytes(), gas: LEVEL_UP_GAS, deposit: 0 }])?;
        prov_append(&tid, "level_up", &c.account, c.now_ms, &format!("level_up {current}->{} tx {tx}", a.earned));
        let after = tier_progress(a.earned, a.progress.swaps, a.progress.volume_usd_micro);
        Ok(json!({"ok": true, "op": "level_up", "account": c.account, "token_id": tid,
            "tier_before": current, "tier_after": a.earned, "tx_hash": tx, "progress": after}))
    }

    fn op_history(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "history", true)?;
        let _ = c.wallet()?; // runs the one-time migration, so a legacy log is found
        let all: Vec<Value> = serde_json::from_slice(&Host.get(&tkey(&c.token_id(), "log"))).unwrap_or_default();
        let a = history_for(&all, &c.account);
        let tid = c.token_id();
        let chain = prov_body(&tid, Some(&c.account)).unwrap_or(json!({}));
        Ok(json!({"ok": true, "op": "history", "account": c.account, "entries": a, "log": chain}))
    }

    /// One read for the whole vault screen: status, account, balances, history. One signature (or none with a session).
    fn op_dashboard(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "dashboard", true)?;
        let tid = c.token_id();
        let lim = limits_now(&c)?;
        let tier_lim = c.tier.and_then(limits_for_tier);
        let pol = policy_for(&Host.get(&tkey(&tid, "policy")), &c.account);
        prov_sync_owner(&tid, &c.account, c.now_ms);
        let evs: Vec<ProvEvent> = load_prov(&tid).into_iter().map(|(e, _)| e).collect();
        let cool = cooldown_until(&evs, &c.account).filter(|u| *u > c.now_ms);
        let spent = Host.incr(&hkey(&c.cap(), &format!("spent/{}", c.now_ms / 86_400_000)), 0)?;
        let locked = active_lock(&Host.get(&tkey(&tid, "lock")), &c.account, c.now_ms);
        let (key, id) = c.wallet()?;
        let (_, b) = http("GET", &format!("{}/wallet/v1/confidential/balance", OL), Some(&key), None)?;
        let all: Vec<Value> = serde_json::from_slice(&Host.get(&tkey(&tid, "log"))).unwrap_or_default();
        let entries = history_for(&all, &c.account);
        // Earned-tier progress from the same verified record as level_up. Null when that record does not verify.
        let progress = assess_level(&evs, &all, c.tier.unwrap_or(1)).ok().and_then(|a| serde_json::to_value(a.progress).ok());
        let session = c.session.as_ref().map(|(id, g)| json!({"exp_ms": g.exp_ms, "max_usd_micro": g.max_usd_micro,
            "spent_usd_micro": Host.incr(&session_key(id, "spent"), 0).unwrap_or(0), "scope": g.scope}));
        Ok(json!({"ok": true, "op": "dashboard", "account": c.account, "token_id": tid, "tier": c.tier, "limits": lim, "tier_limits": tier_lim,
            "holder_limits": pol, "withdraw_cooldown_until_ms": cool, "locked_until_ms": locked, "spent_today_usd_micro": spent,
            "confidential_id": id, "balances": b.get("balances").cloned().unwrap_or(json!([])), "entries": entries, "session": session, "progress": progress}))
    }

    /// Ends a session now: called with the session itself (Revoke button / sign out).
    fn op_session_revoke(input: &Value) -> Result<Value, Error> {
        let c = authenticate(input, "session_revoke", true)?;
        let id = c.session.as_ref().map(|(id, _)| id.clone()).ok_or_else(|| err("bad_params", "revoke is sent with the session it ends"))?;
        Host.set_if_absent(&session_key(&id, "revoked"), c.now_ms.to_string().as_bytes())?;
        Ok(json!({"ok": true, "op": "session_revoke", "account": c.account, "revoked": true}))
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

    /// Chain Signatures: the foreign (EVM) address `v1.signer` derives for this key NFT. Public, read-only.
    fn op_chain_address(input: &Value) -> Result<Value, Error> {
        let tid = s(&input.get("params").cloned().unwrap_or_default(), "token_id").unwrap_or_default();
        let path = chainsig::path_for(&tid).ok_or_else(|| err("bad_params", "params.token_id must be k + 16 hex"))?;
        let (mid, _) = minter()?;
        let root = chainsig::parse_pk(chainsig::ROOT_PK).ok_or_else(|| err("config", "root key"))?;
        let child = chainsig::derive(&root, &mid, &path);
        // Cross-check against the signer contract itself; refuse if they disagree.
        let onchain = view(chainsig::SIGNER, "derived_public_key", json!({"path": path, "predecessor": mid, "domain_id": chainsig::DOMAIN_SECP256K1}))?;
        if onchain.as_str() != Some(chainsig::fmt_pk(&child).as_str()) { return Err(err("rpc", "derived key mismatch with v1.signer")); }
        Ok(json!({"ok": true, "op": "chain_address", "token_id": tid, "path": path, "predecessor": mid,
            "public_key": chainsig::fmt_pk(&child), "evm_address": chainsig::evm_address(&child)}))
    }

    /// Chain Signatures: the holder asks the MPC network to sign a 32-byte hash for this key's address.
    /// The minter calls `v1.signer.sign` (1 yocto); the answer is checked to recover to the derived key.
    fn op_chain_sign(input: &Value) -> Result<Value, Error> {
        let c=authenticate(input,"chain_sign",true)?;guard_preflight(&c)?;
        Err(err("unsupported_authority","generic detached signing is disabled in the guarded revision: future broadcast cannot be reconciled"))
    }

    /// Scoped beat key on the TEE minter: `add_beat_key` / `del_beat_key {public_key}`, signed by the keys contract owner.
    /// The added key can call only `beat` on the keys contract, with a 0.05 NEAR gas allowance and no deposit.
    fn op_beat_key(input: &Value, add: bool) -> Result<Value, Error> {
        let op = if add { "add_beat_key" } else { "del_beat_key" };
        let c = authenticate(input, op, false)?;
        // The keys contract's configured owner, read live, not the contract account id (P1-5).
        let owner = config_owner(&view(&keys_contract(), "config", json!({}))?).ok_or_else(|| err("config", "keys contract has no owner in config"))?;
        assert_owner(&c.account, &owner)?;
        let (mid, msk) = minter()?;
        let raw = bs58::decode(msk.trim_start_matches("ed25519:")).into_vec().map_err(|_| err("signer", "bad key"))?;
        let mpk: [u8; 32] = raw.get(32..64).and_then(|b| b.try_into().ok()).ok_or_else(|| err("signer", "bad key"))?;
        let pk = parse_beat_key(&s(&c.req.params, "public_key").unwrap_or_default(), &mpk)?;
        let kc = keys_contract();
        let a = if add { Action::AddFcKey { pk, allowance: BEAT_KEY_ALLOWANCE_YOCTO, receiver: &kc, methods: &BEAT_KEY_METHODS } } else { Action::DeleteKey { pk } };
        let tx = send(&mid, &msk, &mid, &[a])?;
        let pks = format!("ed25519:{}", bs58::encode(pk).into_string());
        Ok(json!({"ok": true, "op": op, "minter_account": mid, "public_key": pks, "receiver": kc, "methods": BEAT_KEY_METHODS,
            "allowance_yocto": BEAT_KEY_ALLOWANCE_YOCTO.to_string(), "tx": tx}))
    }

    fn op_info() -> Result<Value, Error> {
        let (mid, _) = minter()?;
        Ok(json!({"ok": true, "op": "info", "version": VERSION, "guarded_revision":guarded::REVISION, "guarded_registry_hash":cfg("GUARDED_WORKER_HASH",""), "keys_contract": keys_contract(), "nep413_recipient": recipient(),
            "minter_account": mid, "limits": {"1": limits_for_tier(1), "2": limits_for_tier(2), "3": limits_for_tier(3)},
            "ops": ["info","status","quote","mint","account","balance","swap","copy","withdraw","transfer","loan_certificate","reconcile_value_op","history","provenance","record","lock","prove","limits","pnl","sweep_minter","chain_address","chain_sign","add_beat_key","del_beat_key","dashboard","level_up","session","session_revoke"], "raise_delay_ms": RAISE_DELAY_MS, "transfer_cooldown_ms": TRANSFER_COOLDOWN_MS, "global_per_minute": GLOBAL_PER_MINUTE, "global_mints_per_day": GLOBAL_MINTS_PER_DAY,
            "sign": "NEP-413 signMessage: message = JSON {op, account_id, ts_ms, params}, recipient = nep413_recipient, nonce = 32 random bytes", "session": {"max_ms": SESSION_MAX_MS, "ops": SESSION_OPS, "start_op": "session", "doc": "https://docs.near.org/web3-apps/backend/backend#backend-auth-with-a-near-wallet"}}))
    }

    pub fn run() {
        let mut raw = String::new();
        std::io::stdin().read_to_string(&mut raw).ok();
        let input: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        let op = input.get("op").and_then(|v| v.as_str()).unwrap_or("");
        let r = match op {
            "info" => op_info(),
            "provenance" => op_provenance(&input),
            "record" => op_record(&input),
            "lock" => op_lock(&input),
            "limits" => op_limits(&input),
            "prove" => op_prove(&input),
            "status" => op_status(&input),
            "quote" => op_quote(&input),
            "mint" => op_mint(&input),
            "account" => op_account(&input),
            "balance" => op_balance(&input),
            "swap" => op_swap(&input, "swap"),
            "copy" => op_swap(&input, "copy"),
            "withdraw" => op_withdraw(&input),
            "transfer" => op_transfer(&input),
            "loan_certificate" => op_loan_certificate(&input),
            "reconcile_value_op" => op_reconcile_value(&input),
            "history" => op_history(&input),
            "pnl" => op_pnl(&input),
            "sweep_minter" => op_sweep_minter(),
            "chain_address" => op_chain_address(&input),
            "chain_sign" => op_chain_sign(&input),
            "add_beat_key" => op_beat_key(&input, true),
            "del_beat_key" => op_beat_key(&input, false),
            "dashboard" => op_dashboard(&input),
            "level_up" => op_level_up(&input),
            "session" => op_session(&input),
            "session_revoke" => op_session_revoke(&input),
            _ => Err(err("unknown_op", "op must be one of: info, status, quote, mint, account, balance, swap, copy, withdraw, transfer, loan_certificate, reconcile_value_op, history, provenance, record, lock, prove, limits, pnl, sweep_minter, chain_address, chain_sign, add_beat_key, del_beat_key, dashboard, level_up, session, session_revoke")),
        };
        let mut out = match r { Ok(v) => v, Err(e) => json!({"ok": false, "error": e}) };
        // Binding: the exact signed message and nonce this answer is for, and the key that passed auth.
        if let (Some(m), Some(n)) = (input.pointer("/auth/message").and_then(|v| v.as_str()), input.pointer("/auth/nonce").and_then(|v| v.as_str())) {
            let who = BIND.with(|b| b.borrow().clone());
            out["bind"] = json!({"req_sha256": sha256_hex(m), "nonce": n,
                "account": who.as_ref().map(|w| w.0.clone()), "token_id": who.and_then(|w| w.1)});
        }
        println!("{}", out);
    }
}

fn main() {
    #[cfg(target_arch = "wasm32")]
    host::run();
}
