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
fn fixture()->Value{serde_json::from_str(include_str!("../../../protocol/loan-certificate-v3-delivery.json")).unwrap()}
fn cert()->Certificate{serde_json::from_value(fixture()["certificate"].clone()).unwrap()}
fn control()->Value{json!({"token_id":"k1","owner_epoch":"0","value_op_nonce":"0","pending_value_ops":"0","pledged":false,"listed":false,"transfer_pending":false})}
fn journal()->Journal{Journal{contract:"keys.near".into(),token_id:"k1".into(),owner:"alice.near".into(),epoch:0,nonce:1,op_id:format!("1:{}","a".repeat(64)),action_hash:"a".repeat(64),kind:"swap".into(),body:json!({"amount_in":"100"}),wallet_id:"ab".repeat(32),charge:None,auth_scheme:"nep413".into(),event:Some(JournalEvent{ts_ms:1000,usd:100,source:Value::Null})}}
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
    fail_history:bool,last_success:bool,row:Value, reserved:BTreeMap<String,Value>, paths:Vec<String>,
}
impl Default for ProviderFixture {
    fn default()->Self{Self{store:Memory::default(),admitted:true,post_calls:0,executions:0,lose_post:false,lose_get:false,ack_finish:true,finish_calls:0,
        fail_history:false,last_success:false,row:json!({"request_id":ID,"type":"confidential","status":"success"}),reserved:BTreeMap::new(),paths:Vec::new()}}
}
impl Store for ProviderFixture {
    fn set_if_absent(&mut self,k:&str,v:&[u8])->Result<bool,Error>{if self.fail_history&&k.starts_with("p2/"){return Err(err("storage","injected history write failure"));}self.store.set_if_absent(k,v)}
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
    fn finish(&mut self,j:&Journal,t:&Terminal)->Result<bool,Error>{finalize_and_settle(self,j,t,|b|{*b=[4;32];Ok(())})}
}
impl AdmissionHost for ProviderFixture {
 fn value_op(&mut self,j:&Journal)->Result<Value,Error>{Ok(json!({"op_id":j.op_id,"action_hash":j.action_hash,"epoch":j.epoch.to_string(),"nonce":j.nonce.to_string(),"state":if self.admitted{0}else if self.last_success{2}else{3}}))}
 fn control(&mut self,_:&str)->Result<Control,Error>{Ok(Control{epoch:0,nonce:1,pending:if self.admitted{1}else{0},pledged:false,listed:false,transfer_pending:false})}
 fn begin(&mut self,_:&Journal)->Result<(),Error>{unreachable!()}
 fn complete(&mut self,_:&Journal,t:&Terminal)->Result<(),Error>{self.finish_calls+=1;if self.ack_finish{self.admitted=false;self.last_success=t.success;}Ok(())}
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
        let mut host=ProviderFixture::default();let mut j=journal();j.kind=kind.into();j.body=match kind{"withdraw"=>json!({"chain":"near","to":"alice.near","token":ASSET,"amount":"100"}),"transfer"=>json!({"to":"alice.near","token":ASSET,"amount":"100"}),_=>json!({"token_in":ASSET,"token_out":"nep141:wrap.near","amount_in":"100","min_amount_out":"1"})};
        if kind=="withdraw" {
            assert_eq!(drive_provider(&mut host,&j,"key",false).unwrap_err().code,"withdraw_execution_unavailable");
            assert_eq!(host.post_calls,0);assert_eq!(host.executions,0);
        } else {
            assert_eq!(drive_provider(&mut host,&j,"key",false).unwrap()["admission_finished"],true);
            assert_eq!(host.paths,vec![path]);assert_eq!(host.executions,1);
        }
    }
}

#[test]fn signed_epoch_is_required_and_a_b_a_cannot_resurrect_old_authority(){
 assert!(signed_epoch(&json!({"owner_epoch":"0"}),0).is_ok());
 assert!(signed_epoch(&json!({"owner_epoch":"0"}),2).is_err());
 for bad in [json!({}),json!({"owner_epoch":2}),json!({"owner_epoch":"-1"})]{assert!(signed_epoch(&bad,2).is_err());}
}
#[test]fn session_epoch_rejects_legacy_missing_and_returned_title_grants(){
 assert!(session_epoch(&0u64.to_be_bytes(),0).is_ok());assert!(session_epoch(&0u64.to_be_bytes(),2).is_err());assert!(session_epoch(&[],0).is_err());
}

#[test]fn provisional_receiver_is_not_a_private_reader_or_session_holder(){let mut c=Control::parse(&control(),"k1").unwrap();assert!(private_access(&c,true).is_ok());assert!(private_access(&c,false).is_err());c.pledged=true;assert!(private_access(&c,true).is_ok());c.transfer_pending=true;assert!(private_access(&c,true).is_err());}
#[test]fn certificate_requires_current_binding_and_local_terminal_sequence(){let c=cert();let loan=json!({"token_id":c.token_id,"nonce":c.loan_nonce,"borrower":c.borrower,"owner_epoch":c.owner_epoch,"terms":c.terms,"state":"Offered","policy_busy":false,"policy_sequence":"1"});let binding=json!({"ready":true,"wallet_pubkey":c.wallet_pubkey,"policy_version":c.policy_version,"encrypted_policy_hash":c.policy_hash,"policy_generation":"1"});let mut control=Control::parse(&control(),"k1").unwrap();control.pledged=true;let config=json!({"network":c.network,"lending_enabled":true});assert!(loan_binding(&c,&loan,&binding,&control,&config).is_ok());for value in [json!(null),json!("0"),json!(1)]{let mut b=binding.clone();b["policy_generation"]=value;assert!(loan_binding(&c,&loan,&b,&control,&config).is_err());}}

#[test]fn standard_self_exit_binds_fresh_native_or_same_evm_identity(){use crate::self_withdraw_destination as dest;assert_eq!(dest("alice.near","near",None,"nep413").unwrap(),"alice.near");assert!(dest("alice.near","near",Some("attacker.near"),"nep413").is_err());assert!(dest("alice.near","near",Some("alice.near"),"session").is_err());assert!(dest("alice.near","base",Some("0x0000000000000000000000000000000000000001"),"nep413").is_err());let a="0x0000000000000000000000000000000000000001";for chain in ["eth","base","arb","op","bsc","pol","avax","gnosis"]{assert!(dest(a,chain,Some(a),"eip191").is_err());assert!(dest(a,chain,Some("0x0000000000000000000000000000000000000002"),"eip191").is_err());}for chain in ["near","sol","btc","unknown"]{assert!(dest(a,chain,None,"eip191").is_err());}}
#[test]fn standard_driver_never_posts_bad_or_legacy_unknown_identity_destinations(){for scheme in ["nep413","session",""]{let mut j=journal();j.kind="withdraw".into();j.auth_scheme=scheme.into();j.body=json!({"chain":"near","to":"attacker.near","token":ASSET,"amount":"100"});let mut h=ProviderFixture::default();assert!(drive_provider(&mut h,&j,"key",false).is_err());assert_eq!(h.executions,0);assert_eq!(h.post_calls,0);}let mut j=journal();j.kind="transfer".into();j.body=json!({"to":"attacker.near","token":ASSET,"amount":"100"});assert!(j.validate_destination().is_err());}

#[test]fn actual_cli_signed_envelope_reaches_strict_worker_preflight_and_rejects_a_b_a(){
 let input:Value=serde_json::from_str(include_str!("../../../protocol/client-owner-epoch.json")).unwrap();
 let auth:crate::Auth=serde_json::from_value(input["auth"].clone()).unwrap();
 let (req,_)=crate::verify_nep413(&auth,"keyhole").unwrap();
 assert_eq!(req.op,"swap");assert_eq!(req.params["token_id"],"k1234");
 signed_epoch(&req.params,7).unwrap();assert_eq!(signed_epoch(&req.params,9).unwrap_err().code,"epoch_changed");
 let mut bad=auth.clone();bad.message=bad.message.replace("\"7\"","\"9\"");assert!(crate::verify_nep413(&bad,"keyhole").is_err());
}
#[test]fn late_terminal_projection_repairs_history_exactly_once_without_redispatch(){
 let mut host=ProviderFixture::default();host.row["status"]=json!("processing");let j=journal();
 drive_provider(&mut host,&j,"key",false).unwrap();finalize_record(&mut host,&j,|b|{*b=[1;32];Ok(())}).unwrap();
 assert!(merged_history(&mut host,"keys.near","k1",vec![]).unwrap().is_empty());
 host.row["status"]=json!("success");host.row["result"]=json!({"amount_out":"250"});
 drive_provider(&mut host,&j,"key",true).unwrap();
 for n in 1..4 {finalize_record(&mut host,&j,|b|{*b=[n;32];Ok(())}).unwrap();drive_provider(&mut host,&j,"key",true).unwrap();}
 let rows=merged_history(&mut host,"keys.near","k1",vec![]).unwrap();assert_eq!(rows.len(),1);assert_eq!(rows[0]["status"],"success");assert_eq!(rows[0]["amount_out"],"250");assert_eq!(rows[0]["epoch"],0);assert_eq!(rows[0]["by"],"alice.near");
 assert_eq!(host.executions,1);assert_eq!(host.post_calls,1);
 let prov=crate::provenance::load(&mut host,"keys.near","k1").unwrap();assert_eq!(prov.len(),1);assert!(prov[0].project(Some("bob.near")).get("detail").is_none());
}
#[test]fn completed_payment_record_storage_failure_reconciles_without_a_second_payment(){
 let mut host=ProviderFixture{fail_history:true,..ProviderFixture::default()};let j=journal();
 assert!(drive_provider(&mut host,&j,"key",false).is_err());
 assert!(host.admitted,"history failure must keep title/admission locked");assert_eq!(host.finish_calls,0);
 host.fail_history=false;host.lose_get=true;
 assert_eq!(drive_provider(&mut host,&j,"key",true).unwrap()["admission_finished"],true);
 assert_eq!(merged_history(&mut host,"keys.near","k1",vec![]).unwrap().len(),1);assert_eq!(host.executions,1);assert_eq!(host.post_calls,1);assert!(!host.admitted);
}

#[test]fn completed_provider_status_is_normalized_only_after_terminal_record_and_admission_ack(){
 let mut host=ProviderFixture::default();host.row["status"]=json!("completed");let j=journal();
 let out=drive_provider(&mut host,&j,"key",false).unwrap();assert_eq!(out["status"],"success");assert_eq!(out["admission_finished"],true);
 assert_eq!(merged_history(&mut host,"keys.near","k1",vec![]).unwrap()[0]["status"],"success");
}

#[test]
fn no_withdrawal_preview_can_bypass_the_actual_provider_driver_or_reconciler() {
 for reconcile in [false,true] {
  for (field,value) in [("min_amount_out",json!(null)),("min_amount_out",json!("90")),("deadline_ms",json!(0)),("preview_amount_out",json!("1")),("quote_id",json!("changed"))] {
   let mut j=journal();j.kind="withdraw".into();j.body=json!({"chain":"near","to":"alice.near","amount":"100","token":ASSET,"min_amount_out":"90","deadline_ms":2000});j.body[field]=value;
   let mut host=ProviderFixture::default();
   assert!(drive_provider(&mut host,&j,"key",reconcile).is_err());
   assert_eq!(host.post_calls,0);assert_eq!(host.executions,0);
  }
 }
}

#[test]
fn blocked_withdrawal_still_allows_read_only_recovery_of_an_existing_original_provider_id() {
 let mut j=journal();j.kind="withdraw".into();j.body=json!({"chain":"near","to":"alice.near","token":ASSET,"amount":"100"});
 let mut host=ProviderFixture::default();
 put_once(&mut host,&format!("{}/provider",j.key()),ID.as_bytes()).unwrap();
 assert_eq!(drive_provider(&mut host,&j,"key",true).unwrap()["admission_finished"],true);
 assert_eq!(host.post_calls,0);assert_eq!(host.executions,0);
}

/// Exercise the actual production withdrawal adapter with injected side effects,
/// not a counter after an independent copy of the validation predicate.
#[test]
fn withdrawal_adapter_refuses_all_quote_context_faults_before_any_transport_or_admission() {
    let good=json!({"token_id":"k1","owner_epoch":"0","chain":"near","to":"alice.near","token":ASSET,"amount":"100","min_amount_out":"90","deadline_ms":2000,"quote_id":"original","quote_sha256":"a".repeat(64)});
    let mut cases=vec![("currently unsupported even if well formed",good.clone())];
    for (field,value) in [
        ("min_amount_out",json!(null)),("min_amount_out",json!("0")),("min_amount_out",json!("-1")),
        ("min_amount_out",json!("340282366920938463463374607431768211456")),
        ("quote_id",json!(null)),("quote_id",json!("changed")),("quote_sha256",json!("wrong")),
        ("owner_epoch",json!("1")),("to",json!("wrong.near")),("token",json!("wrong-asset")),
        ("chain",json!("base")),("deadline_ms",json!(999)),("deadline_ms",json!(301001)),
        ("preview_amount_out",json!("1")),("execution_supported",json!(true)),("owner",json!("old.near")),
    ] {let mut v=good.clone();v[field]=value;cases.push((field,v));}
    for (label,p) in cases {
        let mut h=ProviderFixture{admitted:false,..ProviderFixture::default()};
        let j=journal();let mut custody_lookups=0;let mut signatures=0;let mut admissions=0;let mut spend=0;
        let result=crate::withdrawal_protection::dispatch(&p,1000,|| {
            custody_lookups+=1;spend+=1;signatures+=1;admissions+=1;
            j.create(&mut h)?;confirm_admission(&mut h,&j)?;
            drive_provider(&mut h,&j,"fixture-key",false)
        });
        assert!(result.is_err(),"{label}");
        assert_eq!((custody_lookups,signatures,admissions,spend,h.post_calls,h.executions,h.finish_calls),(0,0,0,0,0,0,0),"{label}");
        assert!(!h.admitted);assert!(h.store.0.is_empty(),"no WAL, eligibility or success marker on {label}");
    }
}
#[test]
fn withdrawal_unknown_without_original_id_never_resigns_or_posts_on_retry_or_false_terminal() {
    for reconcile in [false,true] {
        for dispatched in [false,true] {
            let mut h=ProviderFixture::default();let mut j=journal();j.kind="withdraw".into();
            j.body=json!({"chain":"near","to":"alice.near","token":ASSET,"amount":"100"});
            j.create(&mut h).unwrap();
            if dispatched {put_once(&mut h,&format!("{}/dispatch",j.key()),b"1").unwrap();}
            // An unsolicited success, shortfall, wrong destination or failed FT
            // descendant is not an original request identity or recovery proof.
            for result in [json!({"amount_out":"1"}),json!({"to":"wrong.near"}),json!({"token":"wrong"}),json!({"receipt":{"status":"Failure"}})] {
                h.row["result"]=result;
                assert!(drive_provider(&mut h,&j,"fixture-key",reconcile).is_err());
                assert_eq!((h.post_calls,h.executions,h.finish_calls),(0,0,0));
                assert!(h.read(&format!("{}/terminal",j.key())).unwrap().is_empty());
                assert!(h.read(&format!("{}/finish_ack",j.key())).unwrap().is_empty());
            }
        }
    }
}
#[test]
fn original_withdrawal_unknown_poll_is_get_only_and_keeps_admission_locked() {
    for status in ["processing","needs_review","failed","partially_failed"] {
        let mut h=ProviderFixture::default();h.row["status"]=json!(status);
        let mut j=journal();j.kind="withdraw".into();j.body=json!({"chain":"near","to":"alice.near","token":ASSET,"amount":"100"});
        put_once(&mut h,&format!("{}/provider",j.key()),ID.as_bytes()).unwrap();
        assert_eq!(drive_provider(&mut h,&j,"fixture-key",true).unwrap()["admission_finished"],false);
        h.lose_get=true;assert_eq!(drive_provider(&mut h,&j,"fixture-key",true).unwrap()["status"],"needs_review");
        assert_eq!((h.post_calls,h.executions,h.finish_calls),(0,0,0));assert!(h.admitted);
    }
}

// A refused begin must surface its real blocker (native journal ticket) instead of a generic
// admission_unknown, while still failing closed and never reporting success.
struct BeginHost{store:Memory,begin:Option<Error>,landed:bool,begins:usize}
impl Store for BeginHost{
 fn set_if_absent(&mut self,k:&str,v:&[u8])->Result<bool,Error>{self.store.set_if_absent(k,v)}
 fn incr(&mut self,k:&str,d:i64)->Result<i64,Error>{self.store.incr(k,d)}
 fn read(&mut self,k:&str)->Result<Vec<u8>,Error>{self.store.read(k)}
 fn remove(&mut self,k:&str)->Result<(),Error>{self.store.remove(k)}
 fn list_prefix(&mut self,p:&str)->Result<Vec<String>,Error>{self.store.list_prefix(p)}
}
impl AdmissionHost for BeginHost{
 fn value_op(&mut self,j:&Journal)->Result<Value,Error>{
  if self.landed{Ok(json!({"op_id":j.op_id,"action_hash":j.action_hash,"epoch":j.epoch.to_string(),"nonce":j.nonce.to_string(),"state":0}))}else{Ok(Value::Null)}}
 fn control(&mut self,_:&str)->Result<Control,Error>{unreachable!()}
 fn begin(&mut self,_:&Journal)->Result<(),Error>{self.begins+=1;match self.begin.take(){Some(e)=>Err(e),None=>{self.landed=true;Ok(())}}}
 fn complete(&mut self,_:&Journal,_:&Terminal)->Result<(),Error>{unreachable!()}
}
fn begin_host(e:Option<Error>)->BeginHost{BeginHost{store:Memory::default(),begin:e,landed:false,begins:0}}
#[test]fn refused_begin_names_native_blocker_and_still_fails_closed(){
 for code in ["native_unknown","native_busy"]{
  let mut h=begin_host(Some(err(code,"another minter send must be reconciled")));
  let e=confirm_admission(&mut h,&journal()).unwrap_err();
  assert_eq!(e.code,code);assert_eq!(h.begins,1);
 }
}
#[test]fn refused_begin_with_other_codes_and_no_permit_stays_admission_unknown(){
 let mut h=begin_host(Some(err("tx_failed","begin rejected")));
 assert_eq!(confirm_admission(&mut h,&journal()).unwrap_err().code,"admission_unknown");
}
#[test]fn lost_begin_reply_is_confirmed_by_the_chain_record_not_the_send_error(){
 // Send reported native_unknown but the permit finalized: admission is confirmed, never double-begun.
 struct Lost(BeginHost);
 impl Store for Lost{
  fn set_if_absent(&mut self,k:&str,v:&[u8])->Result<bool,Error>{self.0.set_if_absent(k,v)}
  fn incr(&mut self,k:&str,d:i64)->Result<i64,Error>{self.0.incr(k,d)}
  fn read(&mut self,k:&str)->Result<Vec<u8>,Error>{self.0.read(k)}
  fn remove(&mut self,k:&str)->Result<(),Error>{self.0.remove(k)}
  fn list_prefix(&mut self,p:&str)->Result<Vec<String>,Error>{self.0.list_prefix(p)}
 }
 impl AdmissionHost for Lost{
  fn value_op(&mut self,j:&Journal)->Result<Value,Error>{self.0.value_op(j)}
  fn control(&mut self,_:&str)->Result<Control,Error>{unreachable!()}
  fn begin(&mut self,_:&Journal)->Result<(),Error>{self.0.begins+=1;self.0.landed=true;Err(err("native_unknown","response lost"))}
  fn complete(&mut self,_:&Journal,_:&Terminal)->Result<(),Error>{unreachable!()}
 }
 let mut h=Lost(begin_host(None));
 confirm_admission(&mut h,&journal()).unwrap();assert_eq!(h.0.begins,1);
}

// ---- request-row binding per journaled kind ----
#[test]
fn swap_row_of_documented_type_finishes_and_other_types_do_not() {
    for ty in ["confidential","swap","confidential_swap"] {
        for status in ["success","completed"] {
            let row=json!({"request_id":ID,"type":ty,"status":status});
            let t=reconcile_status_for(&row,ID,"swap").unwrap().unwrap();
            assert!(t.success&&!t.refund_charge);
        }
        let row=json!({"request_id":ID,"type":ty,"status":"refunded"});
        assert!(!reconcile_status_for(&row,ID,"swap").unwrap().unwrap().success);
    }
    for ty in ["withdraw","call","transfer","limit_order","cross_chain_withdraw","deposit","","SWAP"] {
        let row=json!({"request_id":ID,"type":ty,"status":"success"});
        let e=reconcile_status_for(&row,ID,"swap").unwrap_err();
        assert_eq!(e.code,"needs_review");
        assert!(e.message.contains("type_ok=false"),"{}",e.message);
    }
    let row=json!({"request_id":ID,"status":"success"});
    assert!(reconcile_status_for(&row,ID,"swap").unwrap_err().message.contains("type=missing"));
}
#[test]
fn non_swap_kinds_accept_only_confidential() {
    for kind in ["withdraw","transfer","quote",""] {
        let ok=json!({"request_id":ID,"type":"confidential","status":"success"});
        assert!(reconcile_status_for(&ok,ID,kind).unwrap().is_some());
        let bad=json!({"request_id":ID,"type":"swap","status":"success"});
        assert!(reconcile_status_for(&bad,ID,kind).is_err());
        let cs=json!({"request_id":ID,"type":"confidential_swap","status":"success"});
        let e=reconcile_status_for(&cs,ID,kind).unwrap_err();
        assert!(e.message.contains("type=confidential_swap")&&e.message.contains("type_ok=false"),"{}",e.message);
    }
    assert_eq!(allowed_request_types("swap"),&["confidential","swap","confidential_swap"]);
    assert_eq!(allowed_request_types("copy"),allowed_request_types("swap"));
    assert_eq!(allowed_request_types("withdraw"),&["confidential"]);
}
#[test]
fn id_mismatch_and_error_field_stay_needs_review_and_name_the_predicate() {
    let other="87654321-4321-4321-4321-123456789abc";
    let row=json!({"request_id":other,"type":"swap","status":"success"});
    let e=reconcile_status_for(&row,ID,"swap").unwrap_err();
    assert_eq!(e.code,"needs_review");
    assert!(e.message.contains("id_match=false"),"{}",e.message);
    let row=json!({"type":"swap","status":"success"});
    assert!(reconcile_status_for(&row,ID,"swap").unwrap_err().message.contains("id_match=false"));
    for err_v in [json!("boom"),json!({"code":"x"}),json!(true)] {
        let row=json!({"request_id":ID,"type":"swap","status":"success","error":err_v});
        let e=reconcile_status_for(&row,ID,"swap").unwrap_err();
        assert!(e.message.contains("error_present=true"),"{}",e.message);
        assert!(!e.message.contains("boom"));
    }
    // a JSON null error member is not an error
    let row=json!({"request_id":ID,"type":"swap","status":"success","error":null});
    assert!(reconcile_status_for(&row,ID,"swap").unwrap().is_some());
    // the message never carries row content beyond a sanitised type name
    let row=json!({"request_id":ID,"type":"x y\"z/SECRET","status":"success","result":{"k":"secret-value"}});
    let m=reconcile_status_for(&row,ID,"swap").unwrap_err().message;
    assert!(!m.contains("secret-value")&&!m.contains("SECRET")&&m.contains("type=xyz"),"{m}");
}
// ---- exact-key recovery pointers, no listing ----
struct NoList(Memory,usize);
impl Store for NoList{
 fn set_if_absent(&mut self,k:&str,v:&[u8])->Result<bool,Error>{self.0.set_if_absent(k,v)}
 fn incr(&mut self,k:&str,d:i64)->Result<i64,Error>{self.0.incr(k,d)}
 fn read(&mut self,k:&str)->Result<Vec<u8>,Error>{self.1+=1;self.0.read(k)}
 fn remove(&mut self,k:&str)->Result<(),Error>{self.0.remove(k)}
 fn list_prefix(&mut self,_:&str)->Result<Vec<String>,Error>{panic!("pending/status path must never list keys")}
}
#[test]
fn pointers_are_exact_keys_and_zero_pending_touches_no_storage() {
    let mut st=NoList(Memory::default(),0);
    assert!(pending_candidates(&mut st,"r",0,5).unwrap().is_empty());
    assert_eq!(st.1,0,"chain count 0 must not read storage at all");
    pointer_put(&mut st,"r",5,"5:a").unwrap();
    pointer_put(&mut st,"r",5,"5:a").unwrap();
    pointer_put(&mut st,"r",5,"5:b").unwrap();
    assert_eq!(pointer_ids(&mut st,"r",5).unwrap(),vec!["5:a".to_string(),"5:b".to_string()]);
    pointer_put(&mut st,"r",6,"6:c").unwrap();
    let ids=pending_candidates(&mut st,"r",1,5).unwrap();
    assert_eq!(ids,vec!["5:a".to_string(),"5:b".to_string(),"6:c".to_string()]);
}
#[test]
fn pending_without_a_pointer_is_the_recovery_error_not_a_scan() {
    let mut st=NoList(Memory::default(),0);
    // a legacy-style row exists, but only under the old listing layout: never found, never listed
    st.0.0.insert("r/current/5/hash".into(),b"5:a".to_vec());
    let e=pending_candidates(&mut st,"r",1,5).unwrap_err();
    assert_eq!(e.code,"guard_journal");
    assert!(e.message.contains("reconcile with the original value_op_id"));
    assert!(pending_candidates(&mut st,"r",0,5).unwrap().is_empty());
}
#[test]
fn pointers_are_pruned_on_begin_and_cleared_on_finish_and_slots_are_bounded() {
    let mut st=NoList(Memory::default(),0);
    for n in 0..POINTER_SLOTS+3 {let _=pointer_put(&mut st,"r",7,&format!("7:{n}"));}
    assert_eq!(pointer_ids(&mut st,"r",7).unwrap().len() as u64,POINTER_SLOTS);
    pointer_remove_except(&mut st,"r",7,Some("7:3")).unwrap();
    assert_eq!(pointer_ids(&mut st,"r",7).unwrap(),vec!["7:3".to_string()]);
    pointer_remove_except(&mut st,"r",7,None).unwrap();
    assert!(pointer_ids(&mut st,"r",7).unwrap().is_empty());
    assert!(st.0.0.is_empty(),"no stale keys left behind");
}
#[test]
fn settling_an_operation_clears_its_pointer() {
    let mut st=Memory::default();let j=journal();
    let root=crate::tkey(&j.token_id,"value_recovery");
    pointer_put(&mut st,&root,j.nonce,&j.op_id).unwrap();
    let key=pointer_key(&root,j.nonce,0);
    assert_eq!(st.read(&key).unwrap(),j.op_id.as_bytes());
    pointer_remove_except(&mut st,&root,j.nonce,None).unwrap();
    assert!(st.read(&key).unwrap().is_empty());
}
#[test]
fn no_hot_path_lists_keys() {
    let host=include_str!("guarded_host.rs");
    assert!(!host.contains("list_prefix")&&!host.contains("list_keys"),"guarded host must not list keys");
    assert!(host.contains("pending_candidates"));
    let guarded=include_str!("guarded.rs");
    assert!(!guarded.contains("list_prefix"));
}

#[test]
fn confidential_swap_row_observed_live_finishes_a_swap_only() {
    let row=json!({"request_id":ID,"type":"confidential_swap","status":"success"});
    let t=reconcile_status_for(&row,ID,"swap").unwrap().unwrap();
    assert!(t.success&&!t.refund_charge&&t.provider_id==ID);
    assert!(reconcile_status_for(&row,ID,"copy").unwrap().unwrap().success);
    // everything else stays strict even with the new type
    let wrong_id=json!({"request_id":"87654321-4321-4321-4321-123456789abc","type":"confidential_swap","status":"success"});
    assert!(reconcile_status_for(&wrong_id,ID,"swap").is_err());
    let err_row=json!({"request_id":ID,"type":"confidential_swap","status":"success","error":"x"});
    assert!(reconcile_status_for(&err_row,ID,"swap").is_err());
    for st in ["processing","pending_deposit","failed","needs_review"] {
        let pending=json!({"request_id":ID,"type":"confidential_swap","status":st});
        assert!(reconcile_status_for(&pending,ID,"swap").unwrap().is_none());
    }
    let unknown=json!({"request_id":ID,"type":"confidential_withdraw","status":"success"});
    assert!(reconcile_status_for(&unknown,ID,"swap").unwrap_err().message.contains("type=confidential_withdraw"));
}
struct FailingWrites;
impl Store for FailingWrites{
 fn set_if_absent(&mut self,_:&str,_:&[u8])->Result<bool,Error>{Err(err("storage","write failed"))}
 fn incr(&mut self,_:&str,_:i64)->Result<i64,Error>{Ok(0)}
 fn read(&mut self,_:&str)->Result<Vec<u8>,Error>{Ok(vec![])}
 fn remove(&mut self,_:&str)->Result<(),Error>{Ok(())}
 fn list_prefix(&mut self,_:&str)->Result<Vec<String>,Error>{Ok(vec![])}
}
#[test]
fn pointer_put_fails_closed_on_write_error_and_slot_exhaustion() {
    assert_eq!(pointer_put(&mut FailingWrites,"r",1,"1:a").unwrap_err().code,"storage");
    let mut st=Memory::default();
    for n in 0..POINTER_SLOTS {pointer_put(&mut st,"r",3,&format!("3:{n}")).unwrap();}
    let e=pointer_put(&mut st,"r",3,"3:new").unwrap_err();
    assert_eq!(e.code,"guard_state");
    assert!(e.message.contains("no value operation started"));
    // an existing attempt is idempotent even when full; another nonce is unaffected
    pointer_put(&mut st,"r",3,"3:0").unwrap();
    pointer_put(&mut st,"r",4,"4:x").unwrap();
}
#[test]
fn guard_begin_requires_the_pointer_before_admission() {
    let host=include_str!("guarded_host.rs");
    let a=host.find("guarded::pointer_put(&mut Host,&root,j.nonce,&j.op_id)?;").expect("pointer_put must propagate its error");
    let b=host.find("guard_admit(&j)?;").expect("admission");
    assert!(a<b,"the pointer must be written before begin_value_op can be sent");
}
