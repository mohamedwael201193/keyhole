// Included inside the WASI host module: no production action happens during native tests/builds.
fn guard_control(token:&str)->Result<Control,Error>{Control::parse(&view(&keys_contract(),"get_control_state",json!({"token_id":token}))?,token)}
// Round 8: the control re-read that must observe the live chain. The cached
// get_control_state is from run start and cannot detect a change, so the
// certificate re-validation reads it fresh (view_fresh bypasses the cache).
fn guard_control_fresh(token:&str)->Result<Control,Error>{Control::parse(&view_fresh(&keys_contract(),"get_control_state",json!({"token_id":token}))?,token)}
fn guard_registry()->Result<(),Error>{
    let expected=cfg("GUARDED_WORKER_HASH","");
    let project=view("outlayer.near","get_project",json!({"project_id":guarded::PROJECT_ID}))?;
    let versions=view("outlayer.near","list_versions",json!({"project_id":guarded::PROJECT_ID,"from_index":0,"limit":100}))?;
    let count=view("outlayer.near","get_version_count",json!({"project_id":guarded::PROJECT_ID}))?.as_u64().ok_or_else(||err("legacy_versions","missing registry count"))?;
    guarded::registry(&project,&versions,count,&expected)
}
// Round 8 (adversarial F4): the second registry check inside
// op_loan_certificate must observe the LIVE registry, not the run-start
// cached views — a mid-run registry change is otherwise undetected. Same
// three reads as guard_registry, via view_fresh (never consults or
// populates the view cache).
fn guard_registry_fresh()->Result<(),Error>{
    let expected=cfg("GUARDED_WORKER_HASH","");
    let project=view_fresh("outlayer.near","get_project",json!({"project_id":guarded::PROJECT_ID}))?;
    let versions=view_fresh("outlayer.near","list_versions",json!({"project_id":guarded::PROJECT_ID,"from_index":0,"limit":100}))?;
    let count=view_fresh("outlayer.near","get_version_count",json!({"project_id":guarded::PROJECT_ID}))?.as_u64().ok_or_else(||err("legacy_versions","missing registry count"))?;
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
    provision_idle(&c.token_id())?;let control=guard_control(&c.token_id())?;control.admit()?;guarded::signed_epoch(&c.req.params,control.epoch)?;guard_registry()?;
    if view(&keys_contract(),"get_pledge_config",json!({}))?.is_null(){return Err(err("guard_state","pledge migration required; no legacy compatibility"));}
    if !owns(&c.token_id(),&c.account)?{return Err(err("not_owner","ownership changed"));}Ok(control)
}
thread_local!{static BEGIN_ATTEMPTED:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};}
/// The hold is given back and the journal marked abandoned when nothing was (or could have been) sent.
fn abandon_unbegun(j:&Journal,held:&Option<Charge>){
    let _=guarded::put_once(&mut Host,&format!("{}/abandoned",j.key()),b"1");
    // The abandoned attempt's own pointer is dead too: its journal can never be
    // begun later, so freeing this slot prevents the next leak. Only this op's
    // slot is removed here; other slots are reclaimed by pointer_put_reclaiming.
    let _=guarded::pointer_remove_op(&mut Host,&tkey(&j.token_id,"value_recovery"),j.nonce,&j.op_id);
    if let Some(ch)=held{ch.release(&mut Host);}
}
fn guard_begin(c:&Ctx,input:&Value,kind:&str,body:Value,charge:Option<Charge>)->Result<Journal,Error>{
    let held=charge.clone();
    // Before the journal exists a failure means nothing was begun: just give the hold back.
    let early=(||->Result<(Control,String),Error>{
        if !budget::begin_ok(){return Err(err("time_budget","not enough time left to begin safely; nothing was reserved or sent, retry"));}
        let control=guard_preflight(c)?;let (_,wallet_id)=guarded_wallet(&c.token_id())?;Ok((control,wallet_id))
    })();
    let (control,wallet_id)=match early{Ok(v)=>v,Err(e)=>{if let Some(ch)=&held{ch.release(&mut Host);}return Err(e);}};
    let action_hash=sha256_hex(&json!({"revision":guarded::REVISION,"contract":keys_contract(),"owner":c.account,"token_id":c.token_id(),"kind":kind,"body":body,
        "signed_message":input.pointer("/auth/message"),"signed_nonce":input.pointer("/auth/nonce")}).to_string());
    let nonce=match control.nonce.checked_add(1){Some(n)=>n,None=>{if let Some(ch)=&held{ch.release(&mut Host);}return Err(err("guard_state","nonce exhausted"));}};
    let j=Journal{contract:keys_contract(),token_id:c.token_id(),owner:c.account.clone(),epoch:control.epoch,nonce,op_id:format!("{nonce}:{action_hash}"),action_hash,kind:kind.into(),body,wallet_id,event:Some(guarded::JournalEvent{ts_ms:c.now_ms,usd:charge.as_ref().map(|ch|ch.usd_micro()).unwrap_or(0),source:c.req.params.get("source").cloned().unwrap_or(Value::Null)}),auth_scheme:input.pointer("/auth/scheme").and_then(Value::as_str).unwrap_or("nep413").to_owned(),charge};
    if let Err(e)=j.create(&mut Host){if let Some(ch)=&held{ch.release(&mut Host);}return Err(e);}
    let root=tkey(&j.token_id,"value_recovery");
    // Fail closed: no begin_value_op may be sent unless status can find the operation again.
    // Reclaiming put: frees a slot whose occupant journal was abandoned before any begin
    // (the already-leaked slots), but never touches a live occupant's slot.
    if let Err(e)=guarded::pointer_put_reclaiming(&mut Host,&root,j.nonce,&j.contract,&j.token_id,&j.op_id){
        if e.code!="guard_state"{abandon_unbegun(&j,&held);return Err(e);}
        // Second branch: reclaim a slot whose occupant PROVABLY never began.
        // Evidence is gathered host-side, BEFORE the reclaim scan, so the pure
        // scan never touches Host. Per occupant op_id all three facts must hold:
        // no on-chain permit (get_value_op is null), no pending value op on the
        // token, and the minter native journal idle (no unresolved ticket, so no
        // begin_value_op can still land). Any failed read proves nothing and
        // fails closed (false): the slot stays and the begin is refused.
        let occupants=guarded::pointer_ids(&mut Host,&root,j.nonce).unwrap_or_default();
        let proofs:Vec<(String,bool)>=occupants.iter().map(|op|{
            let proven=guarded::never_begun_proven(
                matches!(view(&keys_contract(),"get_value_op",json!({"token_id":j.token_id,"op_id":op})),Ok(v) if v.is_null()),
                matches!(guard_control(&j.token_id),Ok(c) if c.pending==0),
                matches!(native_send::current(&mut Host),Ok(None)));
            (op.clone(),proven)
        }).collect();
        if let Err(e2)=guarded::pointer_put_reclaiming_proven(&mut Host,&root,j.nonce,&j.contract,&j.token_id,&j.op_id,&|op|proofs.iter().any(|(id,p)|id==op&&*p)){
            abandon_unbegun(&j,&held);return Err(e2);
        }
    }
    BEGIN_ATTEMPTED.with(|f|f.set(false));
    if let Err(e)=guard_admit(&j){
        if !BEGIN_ATTEMPTED.with(|f|f.get())||guarded::begin_never_sent(e.code){abandon_unbegun(&j,&held);}
        return Err(e);
    }
    // This nonce is now owned by the confirmed permit: drop pointers of attempts that never began.
    let _=guarded::pointer_remove_except(&mut Host,&root,j.nonce,Some(&j.op_id));
    Ok(j)
}
impl guarded::AdmissionHost for Host {
    fn value_op(&mut self,j:&Journal)->Result<Value,Error>{view(&j.contract,"get_value_op",json!({"token_id":j.token_id,"op_id":j.op_id}))}
    fn control(&mut self,token:&str)->Result<Control,Error>{guard_control(token)}
    fn begin(&mut self,j:&Journal)->Result<(),Error>{
        BEGIN_ATTEMPTED.with(|f|f.set(true));
        provision_idle(&j.token_id)?;let (mid,msk)=guarded_minter()?;let args=j.admission_args().to_string();
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
fn guard_finish(j:&Journal,t:&Terminal)->Result<bool,Error>{
    guarded::finalize_and_settle(&mut Host,j,t,|bytes|getrandom::fill(bytes).map_err(|_|err("entropy","secure event randomness unavailable")))
}
impl guarded::ProviderHost for Host {
    fn validate_dispatch(&mut self,j:&Journal,key:&str)->Result<(),Error>{
        provision_idle(&j.token_id)?;guard_registry()?;j.validate_permit(&view(&j.contract,"get_value_op",json!({"token_id":j.token_id,"op_id":j.op_id}))?)?;
        let control=guard_control(&j.token_id)?;
        if control.epoch!=j.epoch || control.pledged || control.listed || control.transfer_pending || control.pending!=1 || !owns(&j.token_id,&j.owner)? { return Err(err("guard_journal","current title/control changed")); }
        assert_unlocked(&Host.get(&tkey(&j.token_id,"lock")),&j.owner,chain_now_ms()?)?;
        // A persisted journal cannot bypass the current ownership-epoch cooldown.
        if matches!(j.kind.as_str(),"withdraw"|"transfer") {
            let now=chain_now_ms()?;
            ownership_sync::require_elapsed(custody_cooldown(&j.token_id,&j.owner,now)?,now)?;
            let evs=load_prov(&j.token_id)?.into_iter().map(|(e,_)|e).collect::<Vec<_>>();
            assert_no_cooldown(&evs,&j.owner,now)?;
        }
        let (canonical,id)=guarded_wallet(&j.token_id)?;
        if canonical!=key||id!=j.wallet_id{return Err(err("guard_journal","custody changed"));}
        if j.kind=="withdraw" && j.body["exit_mode"]==exact_exit::MODE {exact_exit_policy(&j.token_id,key,&id)?;}
        Ok(())
    }
    fn post(&mut self,j:&Journal,key:&str,path:&str)->Result<(u16,Value),Error>{
        // Provider reserves (wallet,key) BEFORE funds. The journal freezes body and key forever.
        http_idempotent("POST",&format!("{OL}/wallet/v1/confidential/{path}"),Some(key),Some(&j.body),Some(&j.op_id))
    }
    fn fetch(&mut self,key:&str,id:&str)->Result<(u16,Value),Error>{http("GET",&format!("{OL}/wallet/v1/requests/{id}"),Some(key),None)}
    fn pause(&mut self){std::thread::sleep(std::time::Duration::from_secs(2));}
    fn finish(&mut self,j:&Journal,t:&Terminal)->Result<bool,Error>{guard_finish(j,t)}
}
fn guard_provider(j:&Journal,key:&str,reconcile:bool)->Result<Value,Error>{
    let out=if j.kind=="withdraw" && j.body["exit_mode"]==exact_exit::MODE {
        exact_exit::drive(&mut Host,j,key)?
    }else{guarded::drive_provider(&mut Host,j,key,reconcile)?};
    Ok(out)
}
fn op_reconcile_value(input:&Value)->Result<Value,Error>{
    let c=authenticate(input,"reconcile_value_op",true)?;let id=s(&c.req.params,"value_op_id").ok_or_else(||err("bad_params","value_op_id required"))?;
    let key=guarded::journal_key(&keys_contract(),&c.token_id(),&id);
    let j:Journal=serde_json::from_slice(&Store::read(&mut Host,&format!("{key}/record"))?).map_err(|_|err("guard_journal","unknown operation"))?;j.validate()?;
    if j.owner!=c.account||j.token_id!=c.token_id()||j.contract!=keys_contract()||j.op_id!=id{return Err(err("not_owner","wrong journal owner/token/contract"));}
    if Store::read(&mut Host,&format!("{}/terminal",j.key()))?.is_empty(){guard_registry()?;guard_admit(&j)?;}
    let (wallet_key,_) =guarded_wallet(&j.token_id)?;
    let out=if j.kind=="withdraw" && j.body["exit_mode"]==exact_exit::MODE {
        if input.pointer("/auth/scheme").and_then(Value::as_str)!=Some("nep413"){return Err(err("session_scope","exact exit recovery requires full-access NEP-413"));}
        guarded::signed_epoch(&c.req.params,j.epoch)?;
        EXIT_DELIVERY_LOCATOR.with(|p|*p.borrow_mut()=c.req.params.get("original_delivery_locator").cloned());
        exact_exit::drive_continued(&mut Host,&j,&wallet_key,c.req.params.get("exit_continue"))?
    }else{guard_provider(&j,&wallet_key,true)?};
    Ok(json!({"ok":out["admission_finished"],"op":"reconcile_value_op","value_op_id":j.op_id,"status":out["status"],"continuation":out["continuation"],"request_id":out["request_id"],"admission_finished":out["admission_finished"]}))
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
    Ok(json!({"ok":out["status"]=="success","op":"transfer","status":out["status"],"continuation":out["continuation"],"request_id":out["request_id"],"value_op_id":j.op_id,"admission_finished":out["admission_finished"]}))
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
    evidence::idle(&mut Host,token)?;
    evidence::eligible(&mut Host,token,&cert,&cfg_env_reviewer(),guarded::text(&config,"attestor_public_key")?,&contract,&cfg("GUARDED_WORKER_HASH",""))?;
    let (key,id)=guarded_wallet(token)?;
    let custody=guarded::text(&config,"custody_contract")?;
    let policy=view(custody,"get_wallet_policy",json!({"wallet_pubkey":cert.wallet_pubkey}))?;guarded::frozen_policy(&cert,&policy)?;
    evidence_inventory(&key)?;
    let proof=evidence::load_proof(&mut Host,token)?;
    let effective=custody_get(&key,"/wallet/v1/policy")?;
    if !evidence::effective_with_freeze(&proof.expected_policy,&effective,&proof.prepared,&contract,true){return Err(err("evidence","live decrypted policy differs from V2 reviewed policy"));}
    let balance=custody_get(&key,&format!("/wallet/v1/confidential/balance?token=nep141%3A{}",guarded::ASSET.trim_start_matches("nep141:")))?;
    guarded::fixed_floor(&cert,&balance,&id)?;
    // Round 8: re-read control, exact loan and policy FRESH (bypass the view
    // cache). The cached values are from run start and cannot detect a change,
    // so the old cached re-read was vacuous; no stale-loan signing.
    // Round 8 (adversarial F4): config and the custody balance were still
    // run-start values in the fresh checks below (loan_binding used the
    // stale config, fixed_floor the pre-re-read balance) and the second
    // guard_registry re-checked cached views. All three are re-read fresh
    // here so the re-validation observes the live chain on every input.
    let fresh_control=guard_control_fresh(token)?;
    let fresh_loan=view_fresh(&contract,"get_loan",json!({"token_id":token}))?;
    let fresh_binding=view_fresh(&contract,"get_collateral_binding",json!({"token_id":token}))?;
    let fresh_policy=view_fresh(custody,"get_wallet_policy",json!({"wallet_pubkey":cert.wallet_pubkey}))?;
    let fresh_config=view_fresh(&contract,"get_pledge_config",json!({}))?;
    if fresh_config["network"]!="mainnet"{return Err(err("collateral_ineligible","custody certificate requires configured mainnet domain"));}
    let fresh_balance=custody_get(&key,&format!("/wallet/v1/confidential/balance?token=nep141%3A{}",guarded::ASSET.trim_start_matches("nep141:")))?;
    if fresh_control!=control||fresh_loan!=loan||fresh_binding!=binding||fresh_policy!=policy||fresh_config!=config{return Err(err("collateral_ineligible","loan/custody changed during observation"));}
    let effective=custody_get(&key,"/wallet/v1/policy")?;
    if !evidence::effective_with_freeze(&proof.expected_policy,&effective,&proof.prepared,&contract,true){return Err(err("evidence","decrypted policy changed during certificate observation"));}
    guard_registry_fresh()?;
    // Round 8: the certificate window. The first template was issued against
    // the run-start block with a 30 s expiry, and the old final live() re-read
    // the SAME cached block, so it could not detect a slow run. Invalidate the
    // block cache, re-read the live FINAL block, and re-issue the template
    // against it with the contract-maximum 59 s window; sign the FRESH cert.
    // cert_window_fresh (lib, pure) validates the fresh block against the
    // run-start block (adversarial F5: must be >= now and <= 120 s ahead)
    // and computes the window.
    read_cache::invalidate_block();
    let fresh_now=chain_now_ms()?;
    let (fresh_observed,fresh_expires)=cert_window_fresh(fresh_now,now)?;
    let fresh_template=view_fresh(&contract,"loan_certificate_template",json!({"token_id":token,"observed_at_ns":fresh_observed.to_string(),"expires_at_ns":fresh_expires.to_string()}))?;
    let fresh_cert:guarded::Certificate=serde_json::from_value(fresh_template).map_err(|_|err("certificate","malformed contract template"))?;
    fresh_cert.live(&contract,token,nonce,fresh_control.epoch,fresh_observed)?;
    guarded::loan_binding(&fresh_cert,&fresh_loan,&fresh_binding,&fresh_control,&fresh_config)?;
    guarded::frozen_policy(&fresh_cert,&fresh_policy)?;
    guarded::fixed_floor(&fresh_cert,&fresh_balance,&id)?;
    let (_,msk)=guarded_minter()?;let seed=minter_secret(&msk)?;
    use base64::Engine;
    let public_key=base64::engine::general_purpose::STANDARD.encode(ed25519_dalek::SigningKey::from_bytes(&seed).verifying_key().to_bytes());
    if fresh_config["attestor_public_key"]!=public_key{return Err(err("certificate","worker key does not match pinned contract attestor"));}
    let signature=fresh_cert.sign(&seed)?;
    Ok(json!({"ok":true,"op":"loan_certificate","certificate":fresh_cert,"signature":signature,"public_key":public_key,
        "guarded_revision":guarded::REVISION,"registry_version":cfg("GUARDED_WORKER_HASH",""),
        "execution_verification":"Verify the OutLayer attestation over this exact output separately; registry version is NOT a measured self hash"}))
}

fn pending_value_identity(c:&Ctx)->Result<Value,Error>{
    let Some(token)=&c.token else{return Ok(Value::Null);};let control=guard_control(token)?;
    // Exact pointer keys plus the on-chain pending count; no key listing on this or any hot path.
    let root=tkey(token,"value_recovery");
    for id in guarded::pending_candidates(&mut Host,&root,control.pending,control.nonce)?{
        let key=guarded::journal_key(&keys_contract(),token,&id);
        let raw=Store::read(&mut Host,&format!("{key}/record"))?;
        if raw.is_empty(){continue;}
        let j:Journal=serde_json::from_slice(&raw).map_err(|_|err("guard_journal","invalid recovery journal"))?;
        let permit=view(&keys_contract(),"get_value_op",json!({"token_id":token,"op_id":id}))?;
        if j.owner==c.account&&j.epoch==control.epoch&&permit["op_id"]==id&&permit["action_hash"]==j.action_hash&&Store::read(&mut Host,&format!("{key}/finish_ack"))?.is_empty(){return Ok(json!({"token_id":token,"value_op_id":id,"status":"UNKNOWN"}));}
    }Ok(Value::Null)
}

fn op_pledge_inventory(input:&Value)->Result<Value,Error>{
 let c=authenticate(input,"pledge_inventory",true)?;
 let token=c.token_id();let control=guard_control(&token)?;let contract=keys_contract();
 let loan=view(&contract,"get_loan",json!({"token_id":token}))?;
 let binding=view(&contract,"get_collateral_binding",json!({"token_id":token}))?;
 let (key,id)=guarded_wallet(&token)?;
 let balances=custody_get(&key,"/wallet/v1/confidential/balance")?;
 let mut pages=Vec::new();for offset in (0..1000).step_by(100){let page=custody_get(&key,&format!("/wallet/v1/requests?limit=100&offset={offset}"))?;let total=page["total"].as_u64().ok_or_else(||err("inventory_unavailable","missing request total"))?;pages.push(page);if total<=offset+100{break;}}
 let mut order_items=Vec::new();let mut orders_complete=false;
 for offset in (0..=1000).step_by(100){let page=custody_get(&key,&format!("/wallet/v1/limit-orders?open=true&limit=100&offset={offset}"))?;let rows=page.as_array().filter(|a|a.len()<=100).ok_or_else(||err("inventory_unavailable","invalid open-orders page"))?;order_items.extend(rows.iter().cloned());if order_items.len()>1000{return Err(err("inventory_unavailable","open orders exceed inventory bound"));}
 if rows.len()<100{orders_complete=true;break;}}
 let orders=json!({"items":order_items,"complete":orders_complete});
 let approvals=custody_get(&key,"/wallet/v1/pending_approvals")?;
 let mut out=keyhole_worker::pledge_inventory::project(&balances,&pages,&orders,&approvals)?;
 if !owns(&token,&c.account)?||guard_control(&token)?!=control||view(&contract,"get_loan",json!({"token_id":token}))?!=loan||view(&contract,"get_collateral_binding",json!({"token_id":token}))?!=binding{return Err(err("inventory_changed","owner/loan changed; authorize a fresh inventory"));}
 let now=chain_now_ms()?;let limits=limits_now(&c)?;
 let events:Vec<ProvEvent>=load_prov(&token)?.into_iter().map(|(e,_)|e).collect();
 let cooldown=prov_sync_owner(&token,&c.account,now)?.max(custody_cooldown(&token,&c.account,now)?).max(cooldown_until(&events,&c.account)).filter(|u|*u>now);
 let spent=Host.incr(&hkey(&c.cap(),&format!("spent/{}",now/86_400_000)),0)?;out["spent_today_usd_micro"]=json!(spent);
 out["ok"]=json!(true);out["op"]=json!("pledge_inventory");out["account"]=json!(c.account);out["token_id"]=json!(token);out["owner_epoch"]=json!(control.epoch.to_string());out["confidential_id"]=json!(id);out["observed_at_ns"]=json!((now*1_000_000).to_string());out["loan"]=loan;out["binding_ready"]=json!(binding["ready"]==true);out["limits"]=json!(limits);out["withdraw_cooldown_until_ms"]=json!(cooldown);Ok(out)
}

include!("exact_exit_host.rs");
