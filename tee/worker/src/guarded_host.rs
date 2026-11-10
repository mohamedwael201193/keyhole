// Included inside the WASI host module: no production action happens during native tests/builds.
fn guard_control(token:&str)->Result<Control,Error>{Control::parse(&view(&keys_contract(),"get_control_state",json!({"token_id":token}))?,token)}
fn guard_registry()->Result<(),Error>{
    let expected=cfg("GUARDED_WORKER_HASH","");
    let project=view("outlayer.near","get_project",json!({"project_id":guarded::PROJECT_ID}))?;
    let versions=view("outlayer.near","list_versions",json!({"project_id":guarded::PROJECT_ID,"from_index":0,"limit":100}))?;
    let count=view("outlayer.near","get_version_count",json!({"project_id":guarded::PROJECT_ID}))?.as_u64().ok_or_else(||err("legacy_versions","missing registry count"))?;
    guarded::registry(&project,&versions,count,&expected)
}
fn guarded_wallet(token:&str)->Result<(String,String),Error>{
    // NEVER register/rebind or fall back to an owner alias on guarded value/certificate paths.
    let raw=Store::read(&mut Host,&tkey(token,"wallet"))?;
    let rec:Value=serde_json::from_slice(&raw).map_err(|_|err("collateral_ineligible","canonical token wallet missing"))?;
    let key=guarded::text(&rec,"api_key")?.to_string();let id=guarded::text(&rec,"near_account_id")?.to_string();
    if key.is_empty()||!guarded::lower_hash(&id){return Err(err("collateral_ineligible","invalid canonical wallet"));}
    let b=view(&keys_contract(),"get_collateral_binding",json!({"token_id":token}))?;
    if !b.is_null()&&(b["ready"]!=true||b["wallet_pubkey"]!=format!("ed25519:{id}")){return Err(err("collateral_ineligible","immutable wallet binding mismatch"));}Ok((key,id))
}
fn guarded_minter()->Result<(String,String),Error>{
    if Store::read(&mut Host,"w/minter_sk_v1")?.len()!=32{return Err(err("guard_state","existing minter missing; no automatic replacement"));}
    let m=minter()?;if view(&keys_contract(),"config",json!({}))?["minter"]!=m.0{return Err(err("guard_state","minter mismatch"));}Ok(m)
}
fn guard_preflight(c:&Ctx)->Result<Control,Error>{
    let control=guard_control(&c.token_id())?;control.admit()?;guarded::signed_epoch(&c.req.params,control.epoch)?;guard_registry()?;
    if view(&keys_contract(),"get_pledge_config",json!({}))?.is_null(){return Err(err("guard_state","pledge migration required; no legacy compatibility"));}
    if !owns(&c.token_id(),&c.account)?{return Err(err("not_owner","ownership changed"));}Ok(control)
}
fn guard_begin(c:&Ctx,input:&Value,kind:&str,body:Value,charge:Option<Charge>)->Result<Journal,Error>{
    let control=guard_preflight(c)?;let (_,wallet_id)=guarded_wallet(&c.token_id())?;
    let action_hash=sha256_hex(&json!({"revision":guarded::REVISION,"contract":keys_contract(),"owner":c.account,"token_id":c.token_id(),"kind":kind,"body":body,
        "signed_message":input.pointer("/auth/message"),"signed_nonce":input.pointer("/auth/nonce")}).to_string());
    let nonce=control.nonce.checked_add(1).ok_or_else(||err("guard_state","nonce exhausted"))?;
    let j=Journal{contract:keys_contract(),token_id:c.token_id(),owner:c.account.clone(),epoch:control.epoch,nonce,op_id:format!("{nonce}:{action_hash}"),action_hash,kind:kind.into(),body,wallet_id,charge,auth_scheme:input.pointer("/auth/scheme").and_then(Value::as_str).unwrap_or("nep413").to_owned()};
    j.create(&mut Host)?;guard_admit(&j)?;Ok(j)
}
impl guarded::AdmissionHost for Host {
    fn value_op(&mut self,j:&Journal)->Result<Value,Error>{view(&j.contract,"get_value_op",json!({"token_id":j.token_id,"op_id":j.op_id}))}
    fn control(&mut self,token:&str)->Result<Control,Error>{guard_control(token)}
    fn begin(&mut self,j:&Journal)->Result<(),Error>{
        let (mid,msk)=guarded_minter()?;let args=j.admission_args().to_string();
        send(&mid,&msk,&j.contract,&[Action::FunctionCall{method:"begin_value_op",args:args.as_bytes(),gas:35_000_000_000_000,deposit:guarded::ADMISSION_DEPOSIT}]).map(|_|())
    }
    fn complete(&mut self,j:&Journal,t:&Terminal)->Result<(),Error>{
        let (mid,msk)=guarded_minter()?;let args=j.finish_args(t.success).to_string();
        send(&mid,&msk,&j.contract,&[Action::FunctionCall{method:"finish_value_op",args:args.as_bytes(),gas:35_000_000_000_000,deposit:0}]).map(|_|())
    }
}
fn guard_admit(j:&Journal)->Result<(),Error>{
    if j.contract!=keys_contract(){return Err(err("guard_journal","wrong contract"));}
    guarded::confirm_admission(&mut Host,j)
}
fn guard_finish(j:&Journal,t:&Terminal)->Result<bool,Error>{guarded::settle_admission(&mut Host,j,t)}
impl guarded::ProviderHost for Host {
    fn validate_dispatch(&mut self,j:&Journal,key:&str)->Result<(),Error>{
        guard_registry()?;j.validate_permit(&view(&j.contract,"get_value_op",json!({"token_id":j.token_id,"op_id":j.op_id}))?)?;
        // A persisted journal cannot bypass the current ownership-epoch cooldown.
        if matches!(j.kind.as_str(),"withdraw"|"transfer") {
            let now=chain_now_ms()?;
            ownership_sync::require_elapsed(custody_cooldown(&j.token_id,&j.owner,now)?,now)?;
            let evs=load_prov(&j.token_id)?.into_iter().map(|(e,_)|e).collect::<Vec<_>>();
            assert_no_cooldown(&evs,&j.owner,now)?;
        }
        let (canonical,id)=guarded_wallet(&j.token_id)?;
        if canonical!=key||id!=j.wallet_id{return Err(err("guard_journal","custody changed"));}Ok(())
    }
    fn post(&mut self,j:&Journal,key:&str,path:&str)->Result<(u16,Value),Error>{
        // Provider reserves (wallet,key) BEFORE funds. The journal freezes body and key forever.
        http_idempotent("POST",&format!("{OL}/wallet/v1/confidential/{path}"),Some(key),Some(&j.body),Some(&j.op_id))
    }
    fn fetch(&mut self,key:&str,id:&str)->Result<(u16,Value),Error>{http("GET",&format!("{OL}/wallet/v1/requests/{id}"),Some(key),None)}
    fn finish(&mut self,j:&Journal,t:&Terminal)->Result<bool,Error>{guard_finish(j,t)}
}
fn guard_provider(j:&Journal,key:&str,reconcile:bool)->Result<Value,Error>{guarded::drive_provider(&mut Host,j,key,reconcile)}
fn op_reconcile_value(input:&Value)->Result<Value,Error>{
    let c=authenticate(input,"reconcile_value_op",true)?;let id=s(&c.req.params,"value_op_id").ok_or_else(||err("bad_params","value_op_id required"))?;
    let key=guarded::journal_key(&keys_contract(),&c.token_id(),&id);
    let j:Journal=serde_json::from_slice(&Store::read(&mut Host,&format!("{key}/record"))?).map_err(|_|err("guard_journal","unknown operation"))?;j.validate()?;
    if j.owner!=c.account||j.token_id!=c.token_id()||j.contract!=keys_contract()||j.op_id!=id{return Err(err("not_owner","wrong journal owner/token/contract"));}
    if Store::read(&mut Host,&format!("{}/terminal",j.key()))?.is_empty(){guard_registry()?;guard_admit(&j)?;}
    let (wallet_key,_) =guarded_wallet(&j.token_id)?;let out=guard_provider(&j,&wallet_key,true)?;
    Ok(json!({"ok":out["admission_finished"],"op":"reconcile_value_op","value_op_id":j.op_id,"status":out["status"],"request_id":out["request_id"],"admission_finished":out["admission_finished"]}))
}

fn op_transfer(input:&Value)->Result<Value,Error>{
    let c=authenticate(input,"transfer",true)?;guard_preflight(&c)?;
    let p=&c.req.params;let to=self_withdraw_destination(&c.account,"near",s(p,"to").as_deref(),input.pointer("/auth/scheme").and_then(Value::as_str).unwrap_or("nep413"))?;
    if !is_valid_account_id(&to){return Err(err("bad_params","private transfer requires a NEAR account id"));}
    let token=s(p,"token").ok_or_else(||err("bad_params","token required"))?;let amount=digits(p,"amount")?;
    let (key,id)=guarded_wallet(&c.token_id())?;
    let epoch_cool=prov_sync_owner(&c.token_id(),&c.account,c.now_ms)?;
    ownership_sync::require_elapsed(epoch_cool,c.now_ms)?;
    let events=load_prov(&c.token_id())?.into_iter().map(|(e,_)|e).collect::<Vec<_>>();assert_no_cooldown(&events,&c.account,c.now_ms)?;
    assert_unlocked(&Host.get(&tkey(&c.token_id(),"lock")),&c.account,c.now_ms)?;
    let usd=usd_of(&token,&amount,&id,c.now_ms)?;let lim=limits_now(&c)?;
    let charge=charge_spend(&mut Host,&c.cap(),&lim,None,usd,c.now_ms)?;
    let j=guard_begin(&c,input,"transfer",json!({"to":to,"token":token,"amount":amount}),Some(charge))?;
    let out=guard_provider(&j,&key,false).map_err(|_|err("needs_review",format!("custody outcome unknown; reconcile {}",j.op_id)))?;
    Ok(json!({"ok":out["status"]=="success","op":"transfer","status":out["status"],"request_id":out["request_id"],"value_op_id":j.op_id,"admission_finished":out["admission_finished"]}))
}
fn custody_get(key:&str,path:&str)->Result<Value,Error>{
    match http("GET",&format!("{OL}{path}"),Some(key),None){Ok((200,v))=>Ok(v),_=>Err(err("collateral_ineligible","custody observation unavailable"))}
}
fn certificate_inventory(key:&str)->Result<(),Error>{
    let mut pages=Vec::new();
    for offset in (0..1000).step_by(100){
        let page=custody_get(key,&format!("/wallet/v1/requests?limit=100&offset={offset}"))?;
        let total=page["total"].as_u64().ok_or_else(||err("collateral_ineligible","missing inventory total"))?;
        pages.push(page);
        if total<=offset+100{break;}
    }
    guarded::settled_inventory(&pages)?;
    let orders=custody_get(key,"/wallet/v1/limit-orders?open=true&limit=1&offset=0")?;
    if !orders.as_array().is_some_and(Vec::is_empty){return Err(err("collateral_ineligible","resting orders or unknown order inventory"));}
    let approvals=custody_get(key,"/wallet/v1/pending_approvals")?;
    if !approvals["approvals"].as_array().is_some_and(Vec::is_empty){return Err(err("collateral_ineligible","pending approvals or unknown approval inventory"));}Ok(())
}
fn op_loan_certificate(input:&Value)->Result<Value,Error>{
    // Public lender surface: exact loan floor only; NEVER accepts an asset/minimum/template from the caller.
    let p=input.get("params").and_then(Value::as_object).ok_or_else(||err("bad_params","params {token_id,loan_nonce} required"))?;
    if p.len()!=2||!p.contains_key("token_id")||!p.contains_key("loan_nonce"){return Err(err("bad_params","only token_id and loan_nonce accepted"));}
    let token=p["token_id"].as_str().filter(|t|!t.is_empty()&&t.len()<=64).ok_or_else(||err("bad_params","token_id required"))?;
    let nonce=p["loan_nonce"].as_str().and_then(|n|n.parse::<u64>().ok()).ok_or_else(||err("bad_params","loan_nonce decimal string required"))?;
    guard_registry()?;
    let now=chain_now_ms()?;
    bump_within(&mut Host,&format!("g/certificate/{}/{}",sha256_hex(token),now/60_000),1,6,"rate_limited","certificate limit reached".into())?;
    let contract=keys_contract();let config=view(&contract,"get_pledge_config",json!({}))?;
    if config["network"]!="mainnet"{return Err(err("collateral_ineligible","custody certificate requires configured mainnet domain"));}
    let loan=view(&contract,"get_loan",json!({"token_id":token}))?;
    let binding=view(&contract,"get_collateral_binding",json!({"token_id":token}))?;
    let control=guard_control(token)?;
    let observed=now.checked_mul(1_000_000).ok_or_else(||err("certificate","timestamp overflow"))?;
    let expires=observed.checked_add(30_000_000_000).ok_or_else(||err("certificate","expiry overflow"))?;
    let template=view(&contract,"loan_certificate_template",json!({"token_id":token,"observed_at_ns":observed.to_string(),"expires_at_ns":expires.to_string()}))?;
    let cert:guarded::Certificate=serde_json::from_value(template).map_err(|_|err("certificate","malformed contract template"))?;
    cert.live(&contract,token,nonce,control.epoch,observed)?;guarded::loan_binding(&cert,&loan,&binding,&control,&config)?;
    guarded::eligible(&Store::read(&mut Host,&tkey(token,"confinement_v1"))?,&cert)?;
    let (key,id)=guarded_wallet(token)?;
    let custody=guarded::text(&config,"custody_contract")?;
    let policy=view(custody,"get_wallet_policy",json!({"wallet_pubkey":cert.wallet_pubkey}))?;guarded::frozen_policy(&cert,&policy)?;
    certificate_inventory(&key)?;
    let balance=custody_get(&key,&format!("/wallet/v1/confidential/balance?token=nep141%3A{}",guarded::ASSET.trim_start_matches("nep141:")))?;
    guarded::fixed_floor(&cert,&balance,&id)?;
    // Re-read control, exact loan and policy after balance/inventory collection; no stale-loan signing.
    if guard_control(token)?!=control||view(&contract,"get_loan",json!({"token_id":token}))?!=loan||view(&contract,"get_collateral_binding",json!({"token_id":token}))?!=binding
        ||view(custody,"get_wallet_policy",json!({"wallet_pubkey":cert.wallet_pubkey}))?!=policy{return Err(err("collateral_ineligible","loan/custody changed during observation"));}
    guard_registry()?;
    cert.live(&contract,token,nonce,control.epoch,chain_now_ms()?.checked_mul(1_000_000).ok_or_else(||err("certificate","timestamp overflow"))?)?;
    let (_,msk)=guarded_minter()?;let seed=minter_secret(&msk)?;
    use base64::Engine;
    let public_key=base64::engine::general_purpose::STANDARD.encode(ed25519_dalek::SigningKey::from_bytes(&seed).verifying_key().to_bytes());
    if config["attestor_public_key"]!=public_key{return Err(err("certificate","worker key does not match pinned contract attestor"));}
    let signature=cert.sign(&seed)?;
    Ok(json!({"ok":true,"op":"loan_certificate","certificate":cert,"signature":signature,"public_key":public_key,
        "guarded_revision":guarded::REVISION,"registry_version":cfg("GUARDED_WORKER_HASH",""),
        "execution_verification":"Verify the OutLayer attestation over this exact output separately; registry version is NOT a measured self hash"}))
}
