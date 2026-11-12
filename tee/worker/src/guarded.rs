//! Guarded custody protocol. Host-independent validation; no timers unlock value permits.
//! Provider status is trusted custody evidence, not a private-shard proof or measured-code proof.
use crate::{err, sha256_hex, Charge, Error, Store};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const REVISION: &str = "keyhole-guarded-custody-v1";
pub const ASSET: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
pub const DOMAIN: &str = "KEYHOLE_SEALED_LOAN_V3_DELIVERY";
pub const PROJECT_ID: &str = "keyhole-devmo.near/keyhole";
pub const PROJECT_UUID: &str = "p000000000000004b";
pub const ADMISSION_DEPOSIT: u128 = 10_000_000_000_000_000_000_000;

pub fn text<'a>(v: &'a Value, k: &str) -> Result<&'a str, Error> {
    v.get(k).and_then(Value::as_str).ok_or_else(|| err("guard_state", format!("missing/string {k}")))
}
pub fn decimal(v: &Value, k: &str) -> Result<u128, Error> {
    let s=text(v,k)?;
    if s.is_empty() || !s.bytes().all(|b|b.is_ascii_digit()) { return Err(err("guard_state","noninteger amount")); }
    s.parse().map_err(|_|err("guard_state","integer overflow"))
}
pub fn u64_field(v: &Value,k:&str)->Result<u64,Error>{u64::try_from(decimal(v,k)?).map_err(|_|err("guard_state","u64 overflow"))}
fn flag(v:&Value,k:&str)->Result<bool,Error>{v.get(k).and_then(Value::as_bool).ok_or_else(||err("guard_state",format!("missing/bool {k}")))}
pub fn lower_hash(s:&str)->bool {s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}

#[derive(Debug,Clone,PartialEq,Eq)]
pub struct Control {pub epoch:u64,pub nonce:u64,pub pending:u64,pub pledged:bool,pub listed:bool,pub transfer_pending:bool}
impl Control {
    pub fn parse(v:&Value,token:&str)->Result<Self,Error>{
        if text(v,"token_id")?!=token{return Err(err("guard_state","wrong control token"));}
        Ok(Self{epoch:u64_field(v,"owner_epoch")?,nonce:u64_field(v,"value_op_nonce")?,pending:u64_field(v,"pending_value_ops")?,pledged:flag(v,"pledged")?,listed:flag(v,"listed")?,transfer_pending:flag(v,"transfer_pending")?})
    }
    pub fn admit(&self)->Result<(),Error>{
        if self.pledged{return Err(err("pledged","pledged: all custody value operations are locked"));}
        if self.transfer_pending{return Err(err("transfer_pending","token transfer-call has not resolved"));}
        if self.listed{return Err(err("listed","unlist before value operations"));}
        if self.pending!=0{return Err(err("value_op_pending","reconcile the existing value operation first"));}Ok(())
    }
}
/// A previously signed request must not revive after title returns to the same owner.
/// Title is provisional during transfer_call: not an authorization for sealed reads or sessions.
pub fn private_access(c:&Control,is_owner:bool)->Result<(),Error>{if !is_owner{return Err(err("not_owner","current title changed"));}
    if c.transfer_pending{return Err(err("transfer_pending","provisional receiver cannot access sealed data or establish control"));}Ok(())}
pub fn signed_epoch(params:&Value,current:u64)->Result<(),Error>{
    if u64_field(params,"owner_epoch")?!=current{return Err(err("epoch_changed","sign again for the current owner epoch"));}Ok(())
}
pub fn session_epoch(raw:&[u8],current:u64)->Result<(),Error>{
    if raw!=current.to_be_bytes(){return Err(err("session_epoch","title changed or legacy session; unlock again"));}Ok(())
}
/// Registry checks reject legacy co-registrations. They do NOT prove currently executed bytes.
pub fn registry(project:&Value,versions:&Value,count:u64,expected_hash:&str)->Result<(),Error>{
    let old:Value=serde_json::from_str(include_str!("../../../protocol/legacy-worker-versions.json")).map_err(|_|err("legacy_versions","invalid compiled inventory"))?;
    if old["unsafe_version_hashes"].as_array().is_none_or(|hs|hs.iter().any(|h|h.as_str()==Some(expected_hash))){return Err(err("legacy_versions","legacy build cannot be the guarded build"));}
    let ok=lower_hash(expected_hash)&&text(project,"uuid")?==PROJECT_UUID&&text(project,"project_id")?==PROJECT_ID
        &&text(project,"active_version")?==expected_hash&&count==1;
    let vs=versions.as_array().ok_or_else(||err("legacy_versions","invalid version list"))?;
    if !ok||vs.len()!=1||text(&vs[0],"wasm_hash")?!=expected_hash||!flag(&vs[0],"is_active")?
        ||vs[0].pointer("/source/WasmUrl/hash").and_then(Value::as_str)!=Some(expected_hash){
        return Err(err("legacy_versions","guarded registry/UUID not pinned, or legacy versions remain"));
    }Ok(())
}

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct JournalEvent { pub ts_ms:u64, pub usd:u64, pub source:Value }

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Journal {
    pub contract:String,pub token_id:String,pub owner:String,pub epoch:u64,pub nonce:u64,
    pub op_id:String,pub action_hash:String,pub kind:String,pub body:Value,pub wallet_id:String,
    pub charge:Option<Charge>,
    #[serde(default)] pub auth_scheme:String,
    #[serde(default)] pub event:Option<JournalEvent>,
}
impl Journal {
    pub fn key(&self)->String {journal_key(&self.contract,&self.token_id,&self.op_id)}
    pub fn admission_args(&self)->Value {json!({"token_id":self.token_id,"owner_id":self.owner,"epoch":self.epoch.to_string(),"op_id":self.op_id,"action_hash":self.action_hash})}
    pub fn finish_args(&self,success:bool)->Value{json!({"token_id":self.token_id,"op_id":self.op_id,"success":success})}
    pub fn validate(&self)->Result<(),Error>{
        let expected=format!("{}:{}",self.nonce,self.action_hash);
        if self.op_id!=expected||!lower_hash(&self.action_hash)||self.nonce==0||!["swap","copy","withdraw","transfer","quote"].contains(&self.kind.as_str()){
            return Err(err("guard_journal","invalid immutable journal"));
        }Ok(())
    }
    pub fn validate_destination(&self)->Result<(),Error>{
        if self.kind=="withdraw"||self.kind=="transfer"{let chain=if self.kind=="transfer"{"near"}else{text(&self.body,"chain")?};let to=text(&self.body,"to")?;crate::self_withdraw_destination(&self.owner,chain,Some(to),&self.auth_scheme)?;}Ok(())
    }
    pub fn validate_permit(&self,v:&Value)->Result<(),Error>{
        if text(v,"op_id")?!=self.op_id||text(v,"action_hash")?!=self.action_hash||u64_field(v,"epoch")?!=self.epoch||u64_field(v,"nonce")?!=self.nonce
            ||!matches!(v.get("state").and_then(Value::as_u64),Some(0|1)){
            return Err(err("admission_unknown","no confirmed matching pending admission; do not dispatch"));
        }Ok(())
    }
    pub fn create(&self,st:&mut dyn Store)->Result<(),Error>{
        self.validate()?;
        let bytes=serde_json::to_vec(self).map_err(|_|err("guard_journal","cannot encode journal"))?;
        // Request hash is never reusable at a new admission nonce, even after completion.
        if !st.set_if_absent(&format!("g/request/{}",self.action_hash),self.key().as_bytes())?{return Err(err("replay","value request already journaled; reconcile, never redispatch with new id"));}
        if !st.set_if_absent(&format!("{}/record",self.key()),&bytes)?{return Err(err("replay","operation already exists"));}Ok(())
    }
}
pub fn journal_key(contract:&str,token:&str,op:&str)->String{format!("g/v1/{}",sha256_hex(&json!([contract,token,op]).to_string()))}
/// Append-only, atomic marker. Conflicting values are not silently overwritten.
pub fn put_once(st:&mut dyn Store,key:&str,value:&[u8])->Result<bool,Error>{
    if st.set_if_absent(key,value)?{return Ok(true);}
    if st.read(key)?!=value{return Err(err("guard_journal","conflicting journal evidence"));}Ok(false)
}
pub fn uuid(s:&str)->bool{s.len()==36&&s.bytes().enumerate().all(|(i,b)|if [8,13,18,23].contains(&i){b==b'-'}else{b.is_ascii_hexdigit()})}
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct Terminal {pub success:bool,pub refund_charge:bool,pub provider_id:String}
/// A POST answer names a request, never settles it. A duplicate is HTTP 200, not 409.
/// wallet_busy may name an unrelated in-flight operation: do not bind it to this journal.
pub fn posted_request_id(status:u16,v:&Value)->Option<&str>{
    if status!=200||v.get("error").is_some_and(|e|!e.is_null()&&e.as_str()!=Some("duplicate_idempotency_key")){
        return None;
    }
    v.get("request_id").and_then(Value::as_str).filter(|id|uuid(id))
}
/// Kind-less form (confidential rows only); kept for callers without a journal.
pub fn reconcile_status(v:&Value,id:&str)->Result<Option<Terminal>,Error>{reconcile_status_for(v,id,"")}
/// Exact-key recovery pointers (no listing anywhere). Up to POINTER_SLOTS attempts per nonce.
/// Reader and writer only ever `get`/`set_if_absent`/`remove` fixed keys.
pub const POINTER_SLOTS:u64=8;
/// Extra reads (2 s apart, so at most 4 s) of a pending_deposit/processing row before returning it
/// unfinished. Kept small: callers send no max_execution_seconds (OutLayer default 60 s) and the
/// web gateway aborts at 55 s; a swap call measured about 24 s without polling.
pub const SETTLE_POLLS:u32=2;
pub fn pointer_key(root:&str,nonce:u64,slot:u64)->String{format!("{root}/by_nonce/{nonce}/{slot}")}
/// Record `op_id` under the first free slot for `nonce`. FAILS CLOSED: a storage error or every
/// slot taken is an error, and the caller must not begin the operation without a pointer.
pub fn pointer_put(st:&mut dyn Store,root:&str,nonce:u64,op_id:&str)->Result<(),Error>{
    for slot in 0..POINTER_SLOTS{
        let k=pointer_key(root,nonce,slot);
        if st.set_if_absent(&k,op_id.as_bytes())?{return Ok(());}
        if st.read(&k)?==op_id.as_bytes(){return Ok(());}
    }
    Err(err("guard_state","recovery pointer slots exhausted; no value operation started"))
}
pub fn pointer_ids(st:&mut dyn Store,root:&str,nonce:u64)->Result<Vec<String>,Error>{
    let mut out=Vec::new();
    for slot in 0..POINTER_SLOTS{
        let raw=st.read(&pointer_key(root,nonce,slot))?;
        if raw.is_empty(){continue;}
        out.push(String::from_utf8(raw).map_err(|_|err("guard_journal","invalid recovery identity"))?);
    }
    Ok(out)
}
/// Remove every slot of `nonce` whose value is not `keep` (`None` keeps nothing).
pub fn pointer_remove_except(st:&mut dyn Store,root:&str,nonce:u64,keep:Option<&str>)->Result<(),Error>{
    for slot in 0..POINTER_SLOTS{
        let k=pointer_key(root,nonce,slot);
        let raw=st.read(&k)?;
        if raw.is_empty()||Some(raw.as_slice())==keep.map(str::as_bytes){continue;}
        st.remove(&k)?;
    }
    Ok(())
}
/// Candidate pending operation ids for status. `pending` is the on-chain pending count: zero
/// means there is nothing to find and storage is not touched. A positive count with no pointer
/// (legacy rows, full slots) is an error naming the recovery route; nothing is scanned.
pub fn pending_candidates(st:&mut dyn Store,root:&str,pending:u64,nonce:u64)->Result<Vec<String>,Error>{
    if pending==0{return Ok(vec![]);}
    let mut ids=pointer_ids(st,root,nonce)?;
    ids.extend(pointer_ids(st,root,nonce.saturating_add(1))?);
    if ids.is_empty(){
        return Err(err("guard_journal","pending value operation has no recovery pointer; reconcile with the original value_op_id"));
    }
    Ok(ids)
}
/// Request row types the provider documents for each journaled op kind. OutLayer OpenAPI
/// (RequestType): `confidential` covers every confidential-shard op (shield / unshield /
/// withdraw / transfer / swap); `swap` is its own listed type. A swap or copy journal accepts
/// either of those, or `confidential_swap` (observed live, absent from the OpenAPI enum: the
/// guarded swap row of call c01d32b9-61c8-4a1b-9762-e7ddc151fe57 reported type=confidential_swap);
/// every other kind accepts only `confidential` until another type is observed. Never any other.
pub fn allowed_request_types(kind:&str)->&'static [&'static str]{
    match kind{"swap"|"copy"=>&["confidential","swap","confidential_swap"],_=>&["confidential"]}
}
fn clean_type(v:&Value)->String{
    match v.get("type").and_then(Value::as_str){
        Some(t)=>t.chars().filter(|c|c.is_ascii_lowercase()||c.is_ascii_digit()||*c=='_').take(32).collect(),
        None=>"missing".into(),
    }
}
/// A top-level `error` that is absent or JSON null is not an error; anything else is.
fn error_present(v:&Value)->bool{v.get("error").is_some_and(|e|!e.is_null())}
/// ONLY a fresh GET /requests/{id} with matching id/type is settlement evidence.
/// Generic failure, partial result or HTTP status is NOT evidence of no spend.
/// `kind` is the journaled op kind; the error names the failed predicate, never row content.
pub fn reconcile_status_for(v:&Value,id:&str,kind:&str)->Result<Option<Terminal>,Error>{
    let id_ok=uuid(id)&&text(v,"request_id").is_ok_and(|r|r==id);
    let type_ok=v.get("type").and_then(Value::as_str).is_some_and(|t|allowed_request_types(kind).contains(&t));
    let has_error=error_present(v);
    if !id_ok||!type_ok||has_error{
        return Err(err("needs_review",format!("provider request binding changed: id_match={id_ok} type={} type_ok={type_ok} error_present={has_error} kind={}",clean_type(v),kind.chars().filter(|c|c.is_ascii_lowercase()||*c=='_').take(16).collect::<String>())));
    }
    // Inconsistent approval-bearing rows cannot establish terminal custody settlement.
    if v.get("approval_id").is_some_and(|a|!a.is_null()) {return Ok(None);}
    let terminal=match text(v,"status")?{
        "success"|"completed"=>Some((true,false)),
        // A refund may have fees; finish the terminal permit but conservatively keep the spend cap charged.
        "refunded"=>Some((false,false)),
        "failed" if v.pointer("/result/never_executed").and_then(Value::as_bool)==Some(true)||v.pointer("/result/never_submitted").and_then(Value::as_bool)==Some(true)=>Some((false,true)),
        _=>None,
    };
    Ok(terminal.map(|(success,refund_charge)|Terminal{success,refund_charge,provider_id:id.into()}))
}


/// The same receipt-finality protocol is used by the WASI host and cross-layer sandbox.
pub trait AdmissionHost:Store {
    fn value_op(&mut self,j:&Journal)->Result<Value,Error>;
    fn control(&mut self,token:&str)->Result<Control,Error>;
    fn begin(&mut self,j:&Journal)->Result<(),Error>;
    fn complete(&mut self,j:&Journal,t:&Terminal)->Result<(),Error>;
}
pub fn confirm_admission<H:AdmissionHost>(host:&mut H,j:&Journal)->Result<(),Error>{
    j.validate()?;
    if let Ok(v)=host.value_op(j){if j.validate_permit(&v).is_ok(){return Ok(());}}
    // A lost send reply is neither rejection nor finality. Require the exact finalized record.
    let begun=host.begin(j);
    let permit=host.value_op(j);
    if let Ok(v)=&permit{if j.validate_permit(v).is_ok(){return Ok(());}}
    // Fail closed either way, but name the real blocker. A refused/unsent begin (a pending
    // native-journal ticket, an RPC outage, a minter mismatch) must not read as an unknown
    // on-chain outcome: only the native_* codes mean "reconcile the minter send, never resend".
    if let Err(e)=begun{if begin_blocker_visible(e.code){return Err(e);}}
    permit?;
    Err(err("admission_unknown",format!("admission not confirmed; reconcile operation {}",j.op_id)))
}
fn begin_blocker_visible(code:&str)->bool{matches!(code,"native_busy"|"native_unknown"|"collateral_unknown"|"guard_state"|"rpc")}
pub fn settle_admission<H:AdmissionHost>(host:&mut H,j:&Journal,t:&Terminal)->Result<bool,Error>{
    put_once(host,&format!("{}/terminal",j.key()),&serde_json::to_vec(t).map_err(|_|err("guard_journal","encode terminal"))?)?;
    let _=host.complete(j,t);
    let control=host.control(&j.token_id)?;let last=host.value_op(j)?;
    let done=control.nonce>j.nonce||(last["op_id"]==j.op_id&&last["state"].as_u64()==Some(if t.success{2}else{3}));
    if !done{return Ok(false);}
    put_once(host,&format!("{}/finish_ack",j.key()),b"1")?;
    // Best effort: the pointer only helps status find an unfinished operation.
    let _=pointer_remove_except(host,&crate::tkey(&j.token_id,"value_recovery"),j.nonce,None);
    // Crash after the marker may overcharge, never refund the same reservation twice.
    if t.refund_charge&&put_once(host,&format!("{}/refund_once",j.key()),b"1")?{if let Some(ch)=&j.charge{ch.release(host);}}
    Ok(true)
}

/// Host boundary shared by WASI and native fault-injection tests. The driver is the
/// production journal/idempotency state machine, not a second mock implementation.
pub trait ProviderHost: Store {
    fn validate_dispatch(&mut self,j:&Journal,key:&str)->Result<(),Error>;
    fn post(&mut self,j:&Journal,key:&str,path:&str)->Result<(u16,Value),Error>;
    fn fetch(&mut self,key:&str,id:&str)->Result<(u16,Value),Error>;
    /// Short wait between re-reads of a non-terminal provider row. Default: none (native tests).
    fn pause(&mut self){}
    fn finish(&mut self,j:&Journal,t:&Terminal)->Result<bool,Error>;
}
pub fn drive_provider<H:ProviderHost>(host:&mut H,j:&Journal,key:&str,reconcile:bool)->Result<Value,Error>{
    j.validate()?;
    let raw=host.read(&format!("{}/terminal",j.key()))?;
    if !raw.is_empty(){
        let t:Terminal=serde_json::from_slice(&raw).map_err(|_|err("guard_journal","corrupt terminal"))?;
        let done=host.finish(j,&t)?;
        return Ok(json!({"status":if done{if t.success{"success"}else{"failed"}}else{"needs_review"},"value_op_id":j.op_id,"request_id":t.provider_id,"admission_finished":done}));
    }
    host.validate_dispatch(j,key)?;
    let first=put_once(host,&format!("{}/dispatch",j.key()),b"1")?;
    if !first&&!reconcile{return Err(err("replay","already dispatched; reconcile_value_op required"));}
    let pk=format!("{}/provider",j.key());let raw=host.read(&pk)?;
    let id=if raw.is_empty(){
        if j.kind=="quote"{return Err(err("needs_review","quote outcome unknown; automatic resend/unlock unsupported"));}
        j.validate_destination()?;
        let path=match j.kind.as_str(){"swap"|"copy"=>"swap","withdraw"=>"withdraw","transfer"=>"transfer",_=>return Err(err("guard_journal","unsupported kind"))};
        if j.kind=="withdraw" {crate::withdrawal_protection::deny_unbound_provider_execution()?;}
        let id=host.post(j,key,path).ok().and_then(|(status,v)|posted_request_id(status,&v).map(str::to_string));
        let Some(id)=id else{return Ok(json!({"status":"needs_review","value_op_id":j.op_id,"admission_finished":false}));};
        put_once(host,&pk,id.as_bytes())?;id
    }else{String::from_utf8(raw).map_err(|_|err("guard_journal","bad request id"))?};
    if !uuid(&id){return Err(err("guard_journal","invalid provider id"));}
    let mut value=match host.fetch(key,&id){Ok((200,v))=>v,_=>return Ok(json!({"status":"needs_review","value_op_id":j.op_id,"request_id":id,"admission_finished":false}))};
    // A row that is only pending_deposit/processing usually settles within seconds. Re-read a bounded
    // number of times so the original call can finish the operation instead of leaving it pending
    // (which locks the token until a reconcile). Read-only: never a second POST.
    let mut polls=0;
    while polls<SETTLE_POLLS&&matches!(value["status"].as_str(),Some("pending_deposit"|"processing"))
        &&reconcile_status_for(&value,&id,&j.kind).is_ok_and(|t|t.is_none()){
        host.pause();polls+=1;
        match host.fetch(key,&id){Ok((200,v))=>value=v,_=>break}
    }
    let done=if let Some(t)=reconcile_status_for(&value,&id,&j.kind)?{
        // Preserve the exact first terminal result before admission release. A late reconciler
        // must rebuild history from this fact, never from a new request or a changing provider row.
        let facts=serde_json::to_vec(&value).map_err(|_|err("guard_journal","encode settlement"))?;
        let _=host.set_if_absent(&format!("{}/settlement",j.key()),&facts)?;
        let done=host.finish(j,&t)?;
        if done {value["status"]=json!(if t.success{"success"}else{"failed"});}
        done
    }else{false};
    if !done&&!["pending_deposit","processing","pending_approval"].contains(&value["status"].as_str().unwrap_or("")){value["status"]=json!("needs_review");}
    value["value_op_id"]=json!(j.op_id);value["admission_finished"]=json!(done);Ok(value)
}

/// Immutable terminal projection. Called by BOTH initiation and reconciliation. Provenance CAS
/// serializes duplicate/late writers; a storage error is retryable without another money dispatch.
pub fn finalize_record<S:Store,F:FnMut(&mut [u8;32])->Result<(),Error>>(st:&mut S,j:&Journal,entropy:F)->Result<(),Error>{
    let raw=st.read(&format!("{}/terminal",j.key()))?;if raw.is_empty(){return Ok(());}
    let t:Terminal=serde_json::from_slice(&raw).map_err(|_|err("guard_journal","invalid terminal"))?;
    let meta=j.event.as_ref().ok_or_else(||err("guard_journal","original event metadata unavailable"))?;
    let facts:Value=serde_json::from_slice(&st.read(&format!("{}/settlement",j.key()))?).map_err(|_|err("guard_journal","settlement facts unavailable"))?;
    let mut row=j.body.clone();
    row["value_op_id"]=json!(j.op_id);row["by"]=json!(j.owner);row["kind"]=json!(j.kind);row["ts_ms"]=json!(meta.ts_ms);
    row["epoch"]=json!(j.epoch);row["status"]=json!(if t.success{"success"}else{"failed"});row["request_id"]=json!(t.provider_id);
    row["usd_in_micro"]=json!(meta.usd);row["usd_micro"]=json!(meta.usd);row["source"]=meta.source.clone();
    row["amount_out"]=facts.pointer("/result/amount_out").cloned().unwrap_or(Value::Null);
    let detail=row.to_string();let kind=if t.success{j.kind.as_str()}else{"value_failure"};
    crate::provenance::append(st,crate::provenance::EventInput{operation_id:&j.op_id,contract:&j.contract,token:&j.token_id,kind,owner:&j.owner,owner_epoch:j.epoch,ts_ms:meta.ts_ms,detail:&detail},entropy)?;Ok(())
}
/// Publish the original terminal record before releasing transferable title/admission.
pub fn finalize_and_settle<H:AdmissionHost,F:FnMut(&mut [u8;32])->Result<(),Error>>(host:&mut H,j:&Journal,t:&Terminal,entropy:F)->Result<bool,Error>{
    put_once(host,&format!("{}/terminal",j.key()),&serde_json::to_vec(t).map_err(|_|err("guard_journal","encode terminal"))?)?;
    finalize_record(host,j,entropy)?;
    settle_admission(host,j,t)
}
/// Shared history/record/tier/PnL view. Legacy rows stay; late terminal rows replace only their own journal.
pub fn merged_history<S:Store>(st:&mut S,contract:&str,token:&str,mut legacy:Vec<Value>)->Result<Vec<Value>,Error>{
    for r in crate::provenance::load(st,contract,token)? {
        if let Ok(row)=serde_json::from_str::<Value>(&r.detail){
            if row["by"]==r.event.owner && row["value_op_id"].as_str().is_some_and(|id|id.contains(':')) && row["epoch"].as_u64()==Some(r.event.owner_epoch){
                legacy.retain(|e|e["value_op_id"]!=row["value_op_id"]);legacy.push(row);
            }
        }
    }
    legacy.sort_by_key(|r|r["ts_ms"].as_u64().unwrap_or(0));if legacy.len()>100{legacy.drain(..legacy.len()-100);}Ok(legacy)
}

#[derive(Debug,Clone,Deserialize,Serialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct LoanTerms {pub lender:String,pub principal:String,pub repayment:String,pub duration_sec:String,pub grace_sec:String,pub floor_raw:String,pub funding_deadline_ns:String}
#[derive(Debug,Clone,Deserialize,Serialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct Certificate {
    pub domain:String,pub network:String,pub contract:String,pub token_id:String,pub loan_nonce:String,pub borrower:String,pub owner_epoch:String,pub terms:LoanTerms,
    pub asset:String,pub wallet_pubkey:String,pub policy_version:String,pub policy_hash:String,pub observed_at_ns:String,pub expires_at_ns:String,pub floor_met:bool,pub frozen:bool,pub pending_value_ops:String,
}
impl Certificate {
    pub fn bytes(&self)->Result<Vec<u8>,Error>{
        let mut out=Vec::new();
        fn string(v:&mut Vec<u8>,s:&str)->Result<(),Error>{let len=u32::try_from(s.len()).map_err(|_|err("certificate","field too long"))?;v.extend_from_slice(&len.to_le_bytes());v.extend_from_slice(s.as_bytes());Ok(())}
        fn n64(v:&mut Vec<u8>,s:&str)->Result<(),Error>{v.extend_from_slice(&s.parse::<u64>().map_err(|_|err("certificate","bad u64"))?.to_le_bytes());Ok(())}
        fn n128(v:&mut Vec<u8>,s:&str)->Result<(),Error>{v.extend_from_slice(&s.parse::<u128>().map_err(|_|err("certificate","bad u128"))?.to_le_bytes());Ok(())}
        for s in [&self.domain,&self.network,&self.contract,&self.token_id]{string(&mut out,s)?;}
        n64(&mut out,&self.loan_nonce)?;string(&mut out,&self.borrower)?;n64(&mut out,&self.owner_epoch)?;
        string(&mut out,&self.terms.lender)?;n128(&mut out,&self.terms.principal)?;n128(&mut out,&self.terms.repayment)?;
        n64(&mut out,&self.terms.duration_sec)?;n64(&mut out,&self.terms.grace_sec)?;n128(&mut out,&self.terms.floor_raw)?;n64(&mut out,&self.terms.funding_deadline_ns)?;
        string(&mut out,&self.asset)?;string(&mut out,&self.wallet_pubkey)?;n64(&mut out,&self.policy_version)?;
        let hash=B64.decode(&self.policy_hash).map_err(|_|err("certificate","invalid policy hash"))?;
        if hash.len()!=32{return Err(err("certificate","invalid policy hash length"));}
        out.extend_from_slice(&32u32.to_le_bytes());out.extend_from_slice(&hash);
        n64(&mut out,&self.observed_at_ns)?;n64(&mut out,&self.expires_at_ns)?;out.push(u8::from(self.floor_met));out.push(u8::from(self.frozen));n64(&mut out,&self.pending_value_ops)?;Ok(out)
    }
    pub fn sign(&self,key:&[u8;32])->Result<String,Error>{Ok(B64.encode(SigningKey::from_bytes(key).sign(&self.bytes()?).to_bytes()))}
    pub fn live(&self,contract:&str,token:&str,nonce:u64,epoch:u64,now:u64)->Result<(),Error>{
        let observed=self.observed_at_ns.parse::<u64>().map_err(|_|err("certificate","bad observation"))?;
        let expires=self.expires_at_ns.parse::<u64>().map_err(|_|err("certificate","bad expiry"))?;
        if self.domain!=DOMAIN||self.contract!=contract||self.token_id!=token||self.loan_nonce!=nonce.to_string()||self.owner_epoch!=epoch.to_string()
            ||self.asset!=ASSET||!self.floor_met||!self.frozen||self.pending_value_ops!="0"||observed>now||expires<=now||expires>observed.checked_add(60_000_000_000).ok_or_else(||err("certificate","time overflow"))?{
            return Err(err("certificate","wrong loan/epoch/contract/domain or stale certificate"));
        }Ok(())
    }
}
/// Written only by the signature-verified collateral provisioner after exact FINAL registration; no automatic legacy backfill.
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Eligibility {pub revision:String,pub wallet_pubkey:String,pub policy_hash:String,pub policy_version:String,pub authority_audit_sha256:String,pub no_presigned_authorities:bool}
pub fn eligible(raw:&[u8],cert:&Certificate)->Result<(),Error>{
    let e:Eligibility=serde_json::from_slice(raw).map_err(|_|err("collateral_ineligible","no sealed confinement audit for this exact wallet"))?;
    if e.revision!=REVISION||e.wallet_pubkey!=cert.wallet_pubkey||e.policy_hash!=cert.policy_hash||e.policy_version!=cert.policy_version||!lower_hash(&e.authority_audit_sha256)||!e.no_presigned_authorities{
        return Err(err("collateral_ineligible","wallet authority audit does not match exact binding"));
    }Ok(())
}
/// Exact fixed-asset floor only. Does not return/serialize actual balance.
pub fn fixed_floor(cert:&Certificate,balance:&Value,wallet_id:&str)->Result<(),Error>{
    if text(balance,"account_id")?!=wallet_id||text(balance,"token")?!=ASSET||cert.wallet_pubkey!=format!("ed25519:{wallet_id}")||!lower_hash(wallet_id){return Err(err("collateral_ineligible","custody identity or asset mismatch"));}
    let actual=decimal(balance,"balance")?;let floor=cert.terms.floor_raw.parse::<u128>().map_err(|_|err("certificate","bad floor"))?;
    if floor==0||actual<floor{return Err(err("collateral_ineligible","fixed collateral minimum cannot be certified"));}Ok(())
}

pub fn loan_binding(cert:&Certificate,loan:&Value,binding:&Value,control:&Control,config:&Value)->Result<(),Error>{
    let terms:LoanTerms=serde_json::from_value(loan["terms"].clone()).map_err(|_|err("certificate","invalid authoritative terms"))?;
    if loan["state"]!="Offered"||loan["policy_busy"]!=false||loan["token_id"]!=cert.token_id||loan["borrower"]!=cert.borrower||loan["nonce"]!=cert.loan_nonce||loan["owner_epoch"]!=cert.owner_epoch
        ||u64_field(loan,"policy_sequence")?!=u64_field(binding,"policy_generation")?||terms!=cert.terms||binding["ready"]!=true||binding["wallet_pubkey"]!=cert.wallet_pubkey||binding["policy_version"]!=cert.policy_version||binding["encrypted_policy_hash"]!=cert.policy_hash
        ||config["network"]!=cert.network||config["lending_enabled"]!=true||!control.pledged||control.pending!=0||control.listed||control.transfer_pending||control.epoch.to_string()!=cert.owner_epoch{
        return Err(err("collateral_ineligible","loan/control/binding is not certifiable"));
    }Ok(())
}
pub fn frozen_policy(cert:&Certificate,policy:&Value)->Result<(),Error>{
    use sha2::{Digest,Sha256};
    let payload=text(policy,"encrypted_data")?;
    if policy["owner"]!=cert.contract||policy["frozen"]!=true||policy["locked"]!=true||policy["version"].as_u64().map(|n|n.to_string()).as_deref()!=Some(&cert.policy_version)
        ||B64.encode(Sha256::digest(payload.as_bytes()))!=cert.policy_hash{return Err(err("collateral_ineligible","locked frozen controller policy does not match"));}Ok(())
}
/// Complete paged inventory, not "first page had nothing pending". Unknown states fail closed.
pub fn settled_inventory(pages:&[Value])->Result<(),Error>{
    let total=pages.first().and_then(|p|p["total"].as_u64()).ok_or_else(||err("collateral_ineligible","missing request inventory total"))?;
    let mut seen=std::collections::BTreeSet::new();
    for page in pages {
        if page["total"].as_u64()!=Some(total){return Err(err("collateral_ineligible","request inventory changed during observation"));}
        let rows=page["requests"].as_array().ok_or_else(||err("collateral_ineligible","malformed request inventory"))?;
        for row in rows {
            let id=text(row,"request_id")?;
            if !uuid(id)||!seen.insert(id.to_string()){return Err(err("collateral_ineligible","duplicate/malformed inventory id"));}
            let settled=match text(row,"status")?{"success"|"completed"|"refunded"=>true,"failed"=>row.pointer("/result/never_executed").and_then(Value::as_bool)==Some(true)||row.pointer("/result/never_submitted").and_then(Value::as_bool)==Some(true),_=>false};
            if !settled{return Err(err("collateral_ineligible","pending or ambiguous prior custody authority"));}
        }
    }
    if seen.len() as u64!=total{return Err(err("collateral_ineligible","incomplete request inventory"));}Ok(())
}

#[cfg(test)]
#[path="guarded_tests.rs"]
mod tests;
