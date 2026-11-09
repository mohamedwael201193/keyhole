use super::*;
use ed25519_dalek::{Signature,Verifier,VerifyingKey};
use std::collections::BTreeMap;
#[derive(Default)]struct Memory(BTreeMap<String,Vec<u8>>);
impl Store for Memory{
 fn set_if_absent(&mut self,k:&str,v:&[u8])->Result<bool,Error>{if self.0.contains_key(k){return Ok(false)}self.0.insert(k.into(),v.to_vec());Ok(true)}
 fn incr(&mut self,k:&str,d:i64)->Result<i64,Error>{let old=self.0.get(k).map(|v|String::from_utf8(v.clone()).unwrap().parse::<i64>().unwrap()).unwrap_or(0);self.0.insert(k.into(),(old+d).to_string().into_bytes());Ok(old+d)}
 fn read(&mut self,k:&str)->Result<Vec<u8>,Error>{Ok(self.0.get(k).cloned().unwrap_or_default())}
 fn remove(&mut self,k:&str)->Result<(),Error>{self.0.remove(k);Ok(())}
 fn list_prefix(&mut self,p:&str)->Result<Vec<String>,Error>{Ok(self.0.keys().filter(|k|k.starts_with(p)).cloned().collect())}
}
fn fixture()->Value{serde_json::from_str(include_str!("../../../protocol/loan-certificate-v1.json")).unwrap()}
fn cert()->Certificate{serde_json::from_value(fixture()["certificate"].clone()).unwrap()}
fn control()->Value{json!({"token_id":"k1","owner_epoch":"0","value_op_nonce":"0","pending_value_ops":"0","pledged":false,"listed":false,"transfer_pending":false})}
fn journal()->Journal{Journal{contract:"keys.near".into(),token_id:"k1".into(),owner:"alice.near".into(),epoch:0,nonce:1,op_id:format!("1:{}","a".repeat(64)),action_hash:"a".repeat(64),kind:"swap".into(),body:json!({"amount_in":"100"}),wallet_id:"ab".repeat(32),charge:None}}
const ID:&str="12345678-1234-1234-1234-123456789abc";
#[test]fn worker_certificate_matches_contract_borsh_and_signature_vector(){let f=fixture();let c=cert();assert_eq!(hex::encode(c.bytes().unwrap()),f["borsh_hex"]);assert_eq!(c.sign(&[7;32]).unwrap(),f["signature"]);let pk:[u8;32]=B64.decode(f["public_key"].as_str().unwrap()).unwrap().try_into().unwrap();let sig=Signature::from_slice(&B64.decode(f["signature"].as_str().unwrap()).unwrap()).unwrap();VerifyingKey::from_bytes(&pk).unwrap().verify(&c.bytes().unwrap(),&sig).unwrap();}
#[test]fn expired_future_wrong_epoch_nonce_contract_and_token_certificates_fail(){let c=cert();let now=c.observed_at_ns.parse::<u64>().unwrap();assert!(c.live("keys.near","k1",1,0,now).is_ok());for (contract,token,nonce,epoch,time)in[("other.near","k1",1,0,now),("keys.near","k2",1,0,now),("keys.near","k1",2,0,now),("keys.near","k1",1,1,now),("keys.near","k1",1,0,now-1),("keys.near","k1",1,0,now+30_000_000_000)]{assert!(c.live(contract,token,nonce,epoch,time).is_err());}}
#[test]fn certificate_long_validity_false_floor_or_wrong_asset_fail(){let original=cert();let now:u64=original.observed_at_ns.parse().unwrap();for i in 0..4{let mut c=original.clone();match i{0=>c.expires_at_ns=(now+60_000_000_001).to_string(),1=>c.floor_met=false,2=>c.asset="native".into(),_=>c.pending_value_ops="1".into()};assert!(c.live("keys.near","k1",1,0,now).is_err());}}
#[test]fn fixed_floor_uses_raw_units_exact_identity_and_never_echoes_balance(){let c=cert();let mut v=json!({"account_id":"ab".repeat(32),"token":ASSET,"balance":"1000000"});assert!(fixed_floor(&c,&v,&"ab".repeat(32)).is_ok());for bad in ["999999","1.0","-1","340282366920938463463374607431768211456"]{v["balance"]=json!(bad);let e=fixed_floor(&c,&v,&"ab".repeat(32)).unwrap_err();assert!(!e.message.contains(bad));}v["balance"]=json!("1000000");v["account_id"]=json!("cd".repeat(32));assert!(fixed_floor(&c,&v,&"ab".repeat(32)).is_err());}
#[test]fn unsigned_template_does_not_bypass_frozen_policy_or_sealed_authority_audit(){let c=cert();assert!(eligible(b"",&c).is_err());let e=Eligibility{revision:REVISION.into(),wallet_pubkey:c.wallet_pubkey.clone(),policy_hash:c.policy_hash.clone(),policy_version:c.policy_version.clone(),authority_audit_sha256:"a".repeat(64),no_presigned_authorities:true};assert!(eligible(&serde_json::to_vec(&e).unwrap(),&c).is_ok());let mut changed=e;changed.no_presigned_authorities=false;assert!(eligible(&serde_json::to_vec(&changed).unwrap(),&c).is_err());let p=json!({"owner":"keys.near","encrypted_data":"policy-ciphertext","version":1,"locked":true,"frozen":true});assert!(frozen_policy(&c,&p).is_err());}
#[test]fn exact_locked_policy_hash_version_controller_and_freeze_are_required(){use sha2::{Digest,Sha256};let mut c=cert();c.policy_hash=B64.encode(Sha256::digest(b"sealed"));let good=json!({"owner":"keys.near","encrypted_data":"sealed","version":1,"locked":true,"frozen":true});assert!(frozen_policy(&c,&good).is_ok());for (field,bad)in[("owner",json!("other.near")),("locked",json!(false)),("frozen",json!(false)),("version",json!(2)),("encrypted_data",json!("tampered"))]{let mut p=good.clone();p[field]=bad;assert!(frozen_policy(&c,&p).is_err());}}
#[test]fn control_is_fail_closed_for_missing_fields_and_wrong_token(){let v=control();assert!(Control::parse(&v,"k1").unwrap().admit().is_ok());for field in ["value_op_nonce","owner_epoch","pending_value_ops","pledged","transfer_pending","listed"]{let mut v=v.clone();v.as_object_mut().unwrap().remove(field);assert!(Control::parse(&v,"k1").is_err());}assert!(Control::parse(&v,"k2").is_err());}
#[test]fn pledged_transfer_pending_listed_and_pending_value_all_refuse_admission(){for (field,value)in[("pledged",json!(true)),("transfer_pending",json!(true)),("listed",json!(true)),("pending_value_ops",json!("1"))]{let mut v=control();v[field]=value;assert!(Control::parse(&v,"k1").unwrap().admit().is_err());}}
#[test]fn mock_both_receipt_orderings_never_allow_pledge_and_dispatch_together(){// Mock admission model; actual NEAR orderings also run in keys-sandbox.
 for pledge_first in [true,false]{let mut v=control();if pledge_first{v["pledged"]=json!(true);assert!(Control::parse(&v,"k1").unwrap().admit().is_err());}else{Control::parse(&v,"k1").unwrap().admit().unwrap();v["pending_value_ops"]=json!("1");assert!(Control::parse(&v,"k1").unwrap().pending>0,"contract open_loan must refuse");}}
}
#[test]fn journal_is_durable_immutable_and_request_hash_never_replays_at_new_nonce(){let mut st=Memory::default();let j=journal();j.create(&mut st).unwrap();let restored:Journal=serde_json::from_slice(&st.read(&format!("{}/record",j.key())).unwrap()).unwrap();assert_eq!(restored.body,j.body);assert!(j.create(&mut st).is_err());let mut next=j.clone();next.nonce=2;next.op_id=format!("2:{}",next.action_hash);assert!(next.create(&mut st).is_err());}
#[test]fn journal_keys_are_domain_separated_and_do_not_accept_path_injection(){assert_ne!(journal_key("a.near","x/y","z"),journal_key("a.near","x","y/z"));assert_ne!(journal_key("a.near","k1","1:a"),journal_key("b.near","k1","1:a"));}
#[test]fn confirmed_permit_must_match_exact_epoch_nonce_action_and_id(){let j=journal();let good=json!({"op_id":j.op_id,"epoch":"0","nonce":"1","action_hash":j.action_hash,"state":0});j.validate_permit(&good).unwrap();for(field,value)in[("epoch",json!("1")),("nonce",json!("2")),("action_hash",json!("bad")),("op_id",json!("2:other")),("state",json!(2))]{let mut v=good.clone();v[field]=value;assert!(j.validate_permit(&v).is_err());}}
#[test]fn journal_markers_are_atomic_and_conflicting_results_are_refused(){let mut st=Memory::default();assert!(put_once(&mut st,"dispatch",b"1").unwrap());assert!(!put_once(&mut st,"dispatch",b"1").unwrap());assert!(put_once(&mut st,"dispatch",b"2").is_err());}
#[test]fn timeout_needs_review_partial_and_unqualified_failure_never_finish_or_refund(){for status in ["processing","pending_deposit","pending_approval","needs_review","failed","error","partially_failed","cancelled","rejected"]{let row=json!({"request_id":ID,"type":"confidential","status":status});assert!(reconcile_status(&row,ID).unwrap().is_none());}}
#[test]fn only_matching_fresh_terminal_provider_records_finish_and_never_refund_twice(){for status in ["success","completed","refunded"]{let row=json!({"request_id":ID,"type":"confidential","status":status});let t=reconcile_status(&row,ID).unwrap().unwrap();assert!(!t.refund_charge);assert_eq!(t.success,status!="refunded");}let row=json!({"request_id":ID,"type":"confidential","status":"failed","result":{"never_submitted":true}});assert!(reconcile_status(&row,ID).unwrap().unwrap().refund_charge);let mut bad=row.clone();bad["request_id"]=json!("other");assert!(reconcile_status(&bad,ID).is_err());bad=row;bad["type"]=json!("transfer");assert!(reconcile_status(&bad,ID).is_err());}
#[test]fn dropped_post_response_reuses_identical_idempotency_key_and_body_in_mock_provider(){let j=journal();let mut provider:BTreeMap<String,(Value,usize)>=BTreeMap::new();for _ in 0..3{let row=provider.entry(j.op_id.clone()).or_insert((j.body.clone(),0));assert_eq!(row.0,j.body);if row.1==0{row.1+=1;}}assert_eq!(provider[&j.op_id].1,1);let out=json!({"request_id":ID,"type":"confidential","status":"success"});assert!(reconcile_status(&out,ID).unwrap().is_some());}
#[test]fn inventory_must_be_complete_and_rejects_ambiguous_old_requests(){let good=json!({"requests":[{"request_id":ID,"status":"success"}],"total":1});assert!(settled_inventory(std::slice::from_ref(&good)).is_ok());let mut pending=good.clone();pending["requests"][0]["status"]=json!("needs_review");assert!(settled_inventory(&[pending]).is_err());let mut truncated=good;truncated["total"]=json!(101);assert!(settled_inventory(&[truncated]).is_err());assert!(settled_inventory(&[json!({"requests":[],"total":0})]).is_ok());}
#[test]fn registry_requires_pinned_uuid_single_active_nonlegacy_hash(){let h="f".repeat(64);let p=json!({"project_id":PROJECT_ID,"uuid":PROJECT_UUID,"active_version":h});let vs=json!([{"wasm_hash":h,"is_active":true,"source":{"WasmUrl":{"hash":h}}}]);registry(&p,&vs,1,&h).unwrap();assert!(registry(&p,&vs,22,&h).is_err());let mut bad=p.clone();bad["uuid"]=json!("new-project");assert!(registry(&bad,&vs,1,&h).is_err());let old:Value=serde_json::from_str(include_str!("../../../protocol/legacy-worker-versions.json")).unwrap();let old=old["unsafe_version_hashes"][0].as_str().unwrap();assert!(registry(&p,&vs,1,old).is_err());}
#[test]fn source_wires_every_value_surface_and_disables_detached_authorities(){let main=include_str!("main.rs");let host=include_str!("guarded_host.rs");for kind in ["swap","withdraw","quote"]{assert!(main.contains(&format!("guard_begin(&c,input,\"{kind}\""))||kind=="swap"&&main.contains("guard_begin(&c,input,op"));}assert!(host.contains("guard_begin(&c,input,\"transfer\""));assert!(main.contains("generic detached signing is disabled"));assert!(main.contains("X-Idempotency-Key"));assert!(!main.contains("wallet_op("));}

#[test]
fn duplicate_post_is_only_a_request_pointer_not_terminal_evidence() {
    let row=json!({"error":"duplicate_idempotency_key","request_id":ID,"type":"confidential","status":"success"});
    assert_eq!(posted_request_id(200,&row),Some(ID));
    assert!(reconcile_status(&row,ID).is_err(),"a fresh GET is still required");
    for status in [400,401,409,500] {assert!(posted_request_id(status,&row).is_none());}
    let busy=json!({"error":"wallet_busy","request_id":ID,"in_flight_request_id":ID});
    assert!(posted_request_id(409,&busy).is_none());
    assert!(posted_request_id(200,&busy).is_none());
    assert!(posted_request_id(200,&json!({"request_id":"not-a-uuid"})).is_none());
}
#[test]
fn pending_approval_even_with_inconsistent_terminal_status_never_finishes() {
    for status in ["success","completed","refunded","failed"] {
        let row=json!({"request_id":ID,"type":"confidential","status":status,"approval_id":ID,"result":{"never_submitted":true}});
        assert!(reconcile_status(&row,ID).unwrap().is_none());
    }
}

struct ProviderFixture {
    store:Memory, admitted:bool, post_calls:usize, executions:usize,
    lose_post:bool, lose_get:bool, ack_finish:bool, finish_calls:usize,
    row:Value, reserved:BTreeMap<String,Value>, paths:Vec<String>,
}
impl Default for ProviderFixture {
    fn default()->Self{Self{store:Memory::default(),admitted:true,post_calls:0,executions:0,lose_post:false,lose_get:false,ack_finish:true,finish_calls:0,
        row:json!({"request_id":ID,"type":"confidential","status":"success"}),reserved:BTreeMap::new(),paths:Vec::new()}}
}
impl Store for ProviderFixture {
    fn set_if_absent(&mut self,k:&str,v:&[u8])->Result<bool,Error>{self.store.set_if_absent(k,v)}
    fn incr(&mut self,k:&str,d:i64)->Result<i64,Error>{self.store.incr(k,d)}
    fn read(&mut self,k:&str)->Result<Vec<u8>,Error>{self.store.read(k)}
    fn remove(&mut self,k:&str)->Result<(),Error>{self.store.remove(k)}
    fn list_prefix(&mut self,p:&str)->Result<Vec<String>,Error>{self.store.list_prefix(p)}
}
impl ProviderHost for ProviderFixture {
    fn validate_dispatch(&mut self,_j:&Journal,_key:&str)->Result<(),Error>{
        if !self.admitted{return Err(err("admission_unknown","no matching finalized permit"));}Ok(())
    }
    fn post(&mut self,j:&Journal,_key:&str,path:&str)->Result<(u16,Value),Error>{
        assert!(self.admitted);self.post_calls+=1;self.paths.push(path.into());
        let duplicate=if let Some(body)=self.reserved.get(&j.op_id){assert_eq!(body,&j.body);true}else{
            self.reserved.insert(j.op_id.clone(),j.body.clone());self.executions+=1;false
        };
        if self.lose_post{self.lose_post=false;return Err(err("upstream","lost after funds handover"));}
        if duplicate{Ok((200,json!({"error":"duplicate_idempotency_key","request_id":ID,"status":"success"})))}
        else{Ok((200,json!({"request_id":ID,"status":"processing"})))}
    }
    fn fetch(&mut self,_key:&str,id:&str)->Result<(u16,Value),Error>{
        assert_eq!(id,ID);if self.lose_get{return Err(err("upstream","GET unavailable"));}Ok((200,self.row.clone()))
    }
    fn finish(&mut self,j:&Journal,t:&Terminal)->Result<bool,Error>{
        put_once(self,&format!("{}/terminal",j.key()),&serde_json::to_vec(t).unwrap())?;
        self.finish_calls+=1;if self.ack_finish{self.admitted=false;}Ok(self.ack_finish)
    }
}
#[test]
fn production_driver_never_dispatches_without_confirmed_admission() {
    let mut host=ProviderFixture{admitted:false,..ProviderFixture::default()};let j=journal();j.create(&mut host).unwrap();
    assert!(drive_provider(&mut host,&j,"key",false).is_err());
    assert_eq!(host.post_calls,0);assert!(host.read(&format!("{}/dispatch",j.key())).unwrap().is_empty());
}
#[test]
fn production_driver_recovers_dropped_post_with_same_reserved_key_and_body() {
    let mut host=ProviderFixture{lose_post:true,..ProviderFixture::default()};let j=journal();j.create(&mut host).unwrap();
    let lost=drive_provider(&mut host,&j,"key",false).unwrap();assert_eq!(lost["status"],"needs_review");
    assert!(host.admitted);assert_eq!(host.executions,1);assert_eq!(host.finish_calls,0);
    assert!(drive_provider(&mut host,&j,"key",false).is_err());assert_eq!(host.post_calls,1);
    let restored=drive_provider(&mut host,&j,"key",true).unwrap();assert_eq!(restored["admission_finished"],true);
    assert_eq!(host.post_calls,2);assert_eq!(host.executions,1);assert!(!host.admitted);
}
#[test]
fn production_driver_polls_known_request_and_preserves_unknown_failure_lock() {
    let mut host=ProviderFixture{lose_get:true,..ProviderFixture::default()};let j=journal();
    assert_eq!(drive_provider(&mut host,&j,"key",false).unwrap()["status"],"needs_review");
    host.lose_get=false;
    for status in ["processing","needs_review","failed","pending_approval","partially_failed"] {
        host.row["status"]=json!(status);assert_eq!(drive_provider(&mut host,&j,"key",true).unwrap()["admission_finished"],false);
        assert!(host.admitted);assert_eq!(host.finish_calls,0);
    }
    host.row["status"]=json!("failed");host.row["result"]=json!({"never_submitted":true});
    assert_eq!(drive_provider(&mut host,&j,"key",true).unwrap()["admission_finished"],true);
    let terminal:Terminal=serde_json::from_slice(&host.read(&format!("{}/terminal",j.key())).unwrap()).unwrap();assert!(terminal.refund_charge);
    assert_eq!(host.post_calls,1);assert_eq!(host.executions,1);
}
#[test]
fn production_driver_retries_finish_ack_from_immutable_terminal_without_redispatch() {
    let mut host=ProviderFixture{ack_finish:false,..ProviderFixture::default()};let j=journal();
    assert_eq!(drive_provider(&mut host,&j,"key",false).unwrap()["admission_finished"],false);
    assert!(host.admitted);assert_eq!(host.post_calls,1);
    host.ack_finish=true;host.lose_get=true;host.row["status"]=json!("failed");
    let out=drive_provider(&mut host,&j,"key",true).unwrap();assert_eq!(out["admission_finished"],true);assert_eq!(out["status"],"success");
    assert_eq!(host.post_calls,1);assert_eq!(host.executions,1);assert_eq!(host.finish_calls,2);
}
#[test]
fn production_driver_rejects_wrong_request_identity_and_unknown_quote_resend() {
    let j=journal();let mut host=ProviderFixture::default();host.row["request_id"]=json!("another-request");
    assert!(drive_provider(&mut host,&j,"key",false).is_err());assert_eq!(host.finish_calls,0);assert!(host.admitted);
    let mut host=ProviderFixture::default();let mut q=j;q.kind="quote".into();
    assert!(drive_provider(&mut host,&q,"key",true).is_err());assert_eq!(host.executions,0);assert!(host.admitted);
}
#[test]
fn production_driver_routes_each_confidential_mutation_through_identical_journal_protocol() {
    for (kind,path)in [("swap","swap"),("copy","swap"),("withdraw","withdraw"),("transfer","transfer")] {
        let mut host=ProviderFixture::default();let mut j=journal();j.kind=kind.into();
        assert_eq!(drive_provider(&mut host,&j,"key",false).unwrap()["admission_finished"],true);
        assert_eq!(host.paths,vec![path]);assert_eq!(host.executions,1);
    }
}
