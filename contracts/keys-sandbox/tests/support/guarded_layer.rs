//! Real NEAR receipts + the production worker admission/provider drivers.
//! HTTP custody, sealed storage and registry observations are labelled provider mocks;
//! this proves protocol wiring, not a live keystore or WASI host attestation.
use super::*;
use keyhole_worker::{guarded::{self, AdmissionHost, ProviderHost, Journal, Terminal, Control}, Store, Error, err};
use std::{collections::BTreeMap, future::Future};
fn sync<T>(f:impl Future<Output=T>)->T{tokio::task::block_in_place(||tokio::runtime::Handle::current().block_on(f))}
#[derive(Default)]struct Memory(BTreeMap<String,Vec<u8>>);
impl Store for Memory {
 fn set_if_absent(&mut self,k:&str,v:&[u8])->std::result::Result<bool,Error>{if self.0.contains_key(k){return Ok(false);}self.0.insert(k.into(),v.to_vec());Ok(true)}
 fn incr(&mut self,k:&str,d:i64)->std::result::Result<i64,Error>{let n=self.0.get(k).map(|b|std::str::from_utf8(b).unwrap().parse::<i64>().unwrap()).unwrap_or(0)+d;self.0.insert(k.into(),n.to_string().into_bytes());Ok(n)}
 fn read(&mut self,k:&str)->std::result::Result<Vec<u8>,Error>{Ok(self.0.get(k).cloned().unwrap_or_default())}
 fn remove(&mut self,k:&str)->std::result::Result<(),Error>{self.0.remove(k);Ok(())}
 fn list_prefix(&mut self,p:&str)->std::result::Result<Vec<String>,Error>{Ok(self.0.keys().filter(|k|k.starts_with(p)).cloned().collect())}
}
struct Layer<'a>{e:&'a E,store:Memory,post_calls:usize,executions:usize,lose_post:bool,fail_finish:bool,legacy_count:u64,balance:u128,rows:BTreeMap<String,Value>,bodies:BTreeMap<String,Value>}
impl<'a> Layer<'a>{
 fn new(e:&'a E)->Self{Self{e,store:Memory::default(),post_calls:0,executions:0,lose_post:false,fail_finish:false,legacy_count:1,balance:2_000_000,rows:BTreeMap::new(),bodies:BTreeMap::new()}}
 fn journal(&mut self,owner:&Account,kind:&str,label:&str)->Journal{
  self.journal_for("k1",owner,kind,label)
 }
 fn journal_for(&mut self,token:&str,owner:&Account,kind:&str,label:&str)->Journal{
  let v=sync(view(&self.e.c,"get_control_state",json!({"token_id":token})));let c=Control::parse(&v,token).unwrap();
  let hash=keyhole_worker::sha256_hex(label);let nonce=c.nonce+1;
  Journal{contract:self.e.c.id().to_string(),token_id:token.into(),owner:owner.id().to_string(),epoch:c.epoch,nonce,op_id:format!("{nonce}:{hash}"),action_hash:hash,kind:kind.into(),body:match kind{"swap"|"copy"=>json!({"token_in":guarded::ASSET,"token_out":"nep141:wrap.near","amount_in":"100000","min_amount_out":"1"}),"withdraw"=>json!({"chain":"near","token":guarded::ASSET,"amount":"100000","to":owner.id()}),_=>json!({"token":guarded::ASSET,"amount":"100000","to":owner.id()})},wallet_id:"ab".repeat(32),charge:None,auth_scheme:"nep413".into(),event:Some(guarded::JournalEvent{ts_ms:1000,usd:100,source:Value::Null})}
 }
 fn status(&mut self,j:&Journal,status:&str,never:bool){let row=self.rows.get_mut(&j.op_id).unwrap();row["status"]=json!(status);if never{row["result"]=json!({"never_submitted":true});}}
 fn assert_blocked(&mut self,owner:&Account,label:&str){let j=self.journal(owner,"withdraw",label);let before=self.post_calls;assert!(guarded::confirm_admission(self,&j).is_err());assert!(guarded::drive_provider(self,&j,"sealed-mock-key",false).is_err());assert_eq!(self.post_calls,before);}
 fn registry(&self)->std::result::Result<(),Error>{let h="f".repeat(64);guarded::registry(&json!({"project_id":guarded::PROJECT_ID,"uuid":guarded::PROJECT_UUID,"active_version":h}),&json!([{"wasm_hash":h,"is_active":true,"source":{"WasmUrl":{"hash":h}}}]),self.legacy_count,&h)}
}
impl Store for Layer<'_>{
 fn set_if_absent(&mut self,k:&str,v:&[u8])->std::result::Result<bool,Error>{self.store.set_if_absent(k,v)}
 fn incr(&mut self,k:&str,d:i64)->std::result::Result<i64,Error>{self.store.incr(k,d)}
 fn read(&mut self,k:&str)->std::result::Result<Vec<u8>,Error>{self.store.read(k)}
 fn remove(&mut self,k:&str)->std::result::Result<(),Error>{self.store.remove(k)}
 fn list_prefix(&mut self,p:&str)->std::result::Result<Vec<String>,Error>{self.store.list_prefix(p)}
}
impl AdmissionHost for Layer<'_>{
 fn value_op(&mut self,j:&Journal)->std::result::Result<Value,Error>{Ok(sync(view(&self.e.c,"get_value_op",json!({"token_id":j.token_id,"op_id":j.op_id}))))}
 fn control(&mut self,token:&str)->std::result::Result<Control,Error>{Control::parse(&sync(view(&self.e.c,"get_control_state",json!({"token_id":token}))),token)}
 fn begin(&mut self,j:&Journal)->std::result::Result<(),Error>{sync(async{self.e.minter.call(self.e.c.id(),"begin_value_op").args_json(j.admission_args()).deposit(NearToken::from_yoctonear(guarded::ADMISSION_DEPOSIT)).max_gas().transact().await.unwrap().into_result().map(|_|()).map_err(|_|err("admission_unknown","real NEAR begin rejected"))})}
 fn complete(&mut self,j:&Journal,t:&Terminal)->std::result::Result<(),Error>{if self.fail_finish{self.fail_finish=false;return Err(err("rpc","injected missing finish submission"));}sync(async{self.e.minter.call(self.e.c.id(),"finish_value_op").args_json(j.finish_args(t.success)).max_gas().transact().await.unwrap().into_result().map(|_|()).map_err(|_|err("rpc","real NEAR finish rejected"))})}
}
impl ProviderHost for Layer<'_>{
 fn validate_dispatch(&mut self,j:&Journal,key:&str)->std::result::Result<(),Error>{
  self.registry()?;assert_eq!(key,"sealed-mock-key");j.validate_permit(&self.value_op(j)?)?;
  let c=AdmissionHost::control(self,&j.token_id)?;
  if c.pledged||c.listed||c.transfer_pending||c.epoch!=j.epoch||c.pending!=1{return Err(err("pledged","real chain control is locked"));}
  if sync(view(&self.e.c,"nft_token",json!({"token_id":j.token_id})))["owner_id"]!=j.owner{return Err(err("not_owner","real chain title changed"));}
  Ok(())
 }
 fn post(&mut self,j:&Journal,_key:&str,_path:&str)->std::result::Result<(u16,Value),Error>{
  let policy=sync(view(&self.e.mock,"get_wallet_policy",json!({"wallet_pubkey":format!("ed25519:{}",j.wallet_id)})));
  assert_eq!(policy["frozen"],false,"mock provider also refuses frozen custody");self.post_calls+=1;
  if let Some(body)=self.bodies.get(&j.op_id){assert_eq!(body,&j.body);let id=self.rows[&j.op_id]["request_id"].clone();return Ok((200,json!({"error":"duplicate_idempotency_key","request_id":id,"type":"confidential","status":self.rows[&j.op_id]["status"]})));}
  let id=format!("00000000-0000-4000-8000-{:012x}",self.rows.len()+1);
  self.bodies.insert(j.op_id.clone(),j.body.clone());self.rows.insert(j.op_id.clone(),json!({"request_id":id,"type":"confidential","status":"processing","created_at":"2026-11-09T22:00:00Z","result":null}));
  // Reservation is atomic before side effects. Deferred settlement is applied by the test's fresh GET status.
  self.executions+=1;if self.lose_post{self.lose_post=false;return Err(err("http","lost after provider reservation"));}
  Ok((200,json!({"request_id":id,"status":"processing","poll_url":format!("/wallet/v1/requests/{id}")})))
 }
 fn fetch(&mut self,_key:&str,id:&str)->std::result::Result<(u16,Value),Error>{Ok((200,self.rows.values().find(|r|r["request_id"]==id).unwrap().clone()))}
 fn finish(&mut self,j:&Journal,t:&Terminal)->std::result::Result<bool,Error>{guarded::settle_admission(self,j,t)}
}
async fn floor_certificate(e:&E,l:&Layer<'_>)->Result<(Value,String)>{
 let ts=now(e).await;let value=view(&e.c,"loan_certificate_template",json!({"token_id":"k1","observed_at_ns":ts.to_string(),"expires_at_ns":(ts+60_000_000_000).to_string()})).await;
 let cert:guarded::Certificate=serde_json::from_value(value.clone())?;let control=Control::parse(&view(&e.c,"get_control_state",json!({"token_id":"k1"})).await,"k1").unwrap();
 cert.live(e.c.id().as_str(),"k1",cert.loan_nonce.parse()?,control.epoch,ts).unwrap();
 let loan=view(&e.c,"get_loan",json!({"token_id":"k1"})).await;let binding=view(&e.c,"get_collateral_binding",json!({"token_id":"k1"})).await;let cfg=view(&e.c,"get_pledge_config",json!({})).await;
 guarded::loan_binding(&cert,&loan,&binding,&control,&cfg).unwrap();
 guarded::frozen_policy(&cert,&view(&e.mock,"get_wallet_policy",json!({"wallet_pubkey":cert.wallet_pubkey})).await).unwrap();
 let eligibility=json!({"revision":guarded::REVISION,"wallet_pubkey":cert.wallet_pubkey,"policy_hash":cert.policy_hash,"policy_version":cert.policy_version,"authority_audit_sha256":"a".repeat(64),"no_presigned_authorities":true});
 guarded::eligible(&serde_json::to_vec(&eligibility)?,&cert).unwrap();
 let rows=l.rows.values().cloned().collect::<Vec<_>>();guarded::settled_inventory(&[json!({"requests":rows,"total":rows.len()})]).unwrap();
 let balance=json!({"account_id":"ab".repeat(32),"token":guarded::ASSET,"balance":l.balance.to_string()});guarded::fixed_floor(&cert,&balance,&"ab".repeat(32)).unwrap();
 let mut too_low=balance;too_low["balance"]=json!("999999");assert!(guarded::fixed_floor(&cert,&too_low,&"ab".repeat(32)).is_err());
 let contract_typed:LoanCertificate=serde_json::from_value(value.clone())?;assert_eq!(cert.bytes().unwrap(),near_sdk::borsh::to_vec(&contract_typed)?);
 Ok((value,cert.sign(&[7;32]).unwrap()))
}
async fn fund_worker(e:&E,l:&Layer<'_>)->Result<Value>{let (cert,sig)=floor_certificate(e,l).await?;e.lender.call(e.c.id(),"fund_loan").args_json(json!({"token_id":"k1","nonce":cert["loan_nonce"],"certificate":cert,"signature":sig})).deposit(NearToken::from_near(1)).max_gas().transact().await?.into_result()?;assert_eq!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await["state"],"DisbursementPending");e.alice.call(e.c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;assert_eq!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await["state"],"Active");Ok(cert)}
#[tokio::test(flavor="multi_thread",worker_threads=2)]
async fn guarded_worker_cross_layer_repay_failures_and_transfer_call_a_b_a()->Result<()>{
 let e=setup().await?;let mut l=Layer::new(&e);let first=l.journal(&e.alice,"swap","initial swap");first.create(&mut l).unwrap();
 l.legacy_count=22;assert!(guarded::drive_provider(&mut l,&first,"sealed-mock-key",false).is_err());assert_eq!(l.post_calls,0);l.legacy_count=1;
 guarded::confirm_admission(&mut l,&first).unwrap();l.lose_post=true;assert_eq!(guarded::drive_provider(&mut l,&first,"sealed-mock-key",false).unwrap()["status"],"needs_review");
 assert!(open(&e).await.is_err(),"pending worker send must bar freeze");l.status(&first,"success",false);l.balance-=100000;l.fail_finish=true;
 assert_eq!(guarded::drive_provider(&mut l,&first,"sealed-mock-key",true).unwrap()["admission_finished"],false);
 assert_eq!(AdmissionHost::control(&mut l,"k1").unwrap().pending,1);
 assert_eq!(guarded::drive_provider(&mut l,&first,"sealed-mock-key",true).unwrap()["admission_finished"],true);assert_eq!(l.executions,1);assert_eq!(l.post_calls,2);
 let stale=l.journal(&e.alice,"withdraw","before title roundtrip");let recv=e.w.dev_deploy(&std::fs::read(MOCK)?).await?;
 let msg=json!({"keys":e.c.id(),"attack_method":"get_control_state","attack_args":{"token_id":"k1"},"attack_deposit":"0"}).to_string();
 e.alice.call(e.c.id(),"nft_transfer_call").args_json(json!({"token_id":"k1","receiver_id":recv.id(),"msg":msg})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 let during=view(&recv,"attack_result",json!({})).await;assert_eq!(during["transfer_pending"],true);assert!(Control::parse(&during,"k1").unwrap().admit().is_err());
 assert_eq!(view(&e.c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],e.alice.id().as_str());assert_eq!(AdmissionHost::control(&mut l,"k1").unwrap().epoch,2);
 assert!(guarded::confirm_admission(&mut l,&stale).is_err(),"A->B->A must not resurrect old authorization");
 assert!(guarded::signed_epoch(&json!({"owner_epoch":stale.epoch.to_string()}),2).is_err());
 assert!(guarded::session_epoch(&stale.epoch.to_be_bytes(),2).is_err());
 open(&e).await?;l.assert_blocked(&e.alice,"offered");let certificate=fund_worker(&e,&l).await?;l.assert_blocked(&e.alice,"active");
 e.mock.call("mock_refuse_thaw").args_json(json!({"refuse":true})).transact().await?.into_result()?;
 e.alice.call(e.c.id(),"repay_loan").args_json(json!({"token_id":"k1","nonce":"1"})).deposit(NearToken::from_yoctonear(11*N/10)).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await["state"],"UnlockPending");l.assert_blocked(&e.alice,"failed thaw");
 e.mock.call("mock_refuse_thaw").args_json(json!({"refuse":false})).transact().await?.into_result()?;e.alice.call(e.c.id(),"retry_loan_policy").args_json(json!({"token_id":"k1","nonce":"1"})).max_gas().transact().await?.into_result()?;
 assert!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await.is_null());
 let stale_fund=e.lender.call(e.c.id(),"fund_loan").args_json(json!({"token_id":"k1","nonce":"1","certificate":certificate,"signature":""})).deposit(NearToken::from_near(1)).max_gas().transact().await?;assert!(stale_fund.is_failure());
 let lender=e.lender.deploy(&std::fs::read(MOCK)?).await?.into_result()?;lender.call("claim_then_delete").args_json(json!({"keys":e.c.id(),"beneficiary":e.bob.id()})).max_gas().transact().await?.into_result()?;assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.lender.id()})).await,(11*N/10).to_string());
 let exit=l.journal(&e.alice,"withdraw","after repay exit");exit.create(&mut l).unwrap();guarded::confirm_admission(&mut l,&exit).unwrap();guarded::drive_provider(&mut l,&exit,"sealed-mock-key",false).unwrap();l.status(&exit,"success",false);assert_eq!(guarded::drive_provider(&mut l,&exit,"sealed-mock-key",true).unwrap()["admission_finished"],true);Ok(())
}
#[tokio::test(flavor="multi_thread",worker_threads=2)]
async fn guarded_worker_cross_layer_default_failures_and_new_holder_exit()->Result<()>{
 let e=setup().await?;let mut l=Layer::new(&e);let j=l.journal(&e.alice,"transfer","private transfer failure");j.create(&mut l).unwrap();guarded::confirm_admission(&mut l,&j).unwrap();guarded::drive_provider(&mut l,&j,"sealed-mock-key",false).unwrap();
 l.status(&j,"failed",false);assert_eq!(guarded::drive_provider(&mut l,&j,"sealed-mock-key",true).unwrap()["admission_finished"],false);assert!(open(&e).await.is_err());
 l.status(&j,"failed",true);assert_eq!(guarded::drive_provider(&mut l,&j,"sealed-mock-key",true).unwrap()["admission_finished"],true);assert_eq!(l.executions,1);
 open(&e).await?;fund_worker(&e,&l).await?;l.assert_blocked(&e.alice,"active before default");let due=view(&e.c,"get_loan",json!({"token_id":"k1"})).await["due_ns"].as_str().unwrap().parse::<u64>()?;
 for _ in 0..10{if now(&e).await>due+30_000_000_000{break;}e.w.fast_forward(1000).await?;}
 e.mock.call("mock_refuse_thaw").args_json(json!({"refuse":true})).transact().await?.into_result()?;e.lender.call(e.c.id(),"claim_default").args_json(json!({"token_id":"k1","nonce":"1","receiver_id":e.bob.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&e.c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],e.bob.id().as_str());l.assert_blocked(&e.bob,"new holder before thaw");l.assert_blocked(&e.alice,"old holder after seizure");
 e.mock.call("mock_refuse_thaw").args_json(json!({"refuse":false})).transact().await?.into_result()?;e.bob.call(e.c.id(),"retry_loan_policy").args_json(json!({"token_id":"k1","nonce":"1"})).max_gas().transact().await?.into_result()?;
 let exit=l.journal(&e.bob,"withdraw","new holder exit");exit.create(&mut l).unwrap();guarded::confirm_admission(&mut l,&exit).unwrap();
 assert!(guarded::drive_provider(&mut l,&j,"sealed-mock-key",true).unwrap()["admission_finished"].as_bool().unwrap());assert_eq!(AdmissionHost::control(&mut l,"k1").unwrap().pending,1,"old settlement cannot clear the new holder's permit");
 guarded::drive_provider(&mut l,&exit,"sealed-mock-key",false).unwrap();l.status(&exit,"success",false);assert_eq!(guarded::drive_provider(&mut l,&exit,"sealed-mock-key",true).unwrap()["admission_finished"],true);
 l.assert_blocked(&e.alice,"old holder after exit");assert_eq!(l.executions,2);Ok(())
}

#[path="ui_harness.rs"] mod ui_harness;

/// Real local binding receipts + production writer, with explicitly mocked
/// custody encryption/signing and a fixture reviewer (not live TEE proof).
#[tokio::test(flavor="multi_thread",worker_threads=2)]
async fn collateral_provisioning_seals_only_final_binding_and_serializes_value_admission()->Result<()> {
 use keyhole_worker::collateral::{self,Prepared,AuthorityAudit};
 let e=setup().await?;
 e.minter.call(e.c.id(),"nft_mint").args_json(json!({"token_id":"provisioned","receiver_id":e.bob.id(),"tier":2,"metadata":{"title":"Provisioning fixture","copies":1}}))
  .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
 let p=Prepared{token_id:"provisioned".into(),owner:e.bob.id().to_string(),owner_epoch:0,worker_hash:"fe".repeat(32),wallet_pubkey:format!("ed25519:{}","cd".repeat(32)),plaintext_hash:"12".repeat(32),encrypted_data:"sealed-policy-provisioning-mock".into(),wallet_signature:"ab".repeat(64),version:1,valid_until:4_000_000_000};
 e.minter.call(e.c.id(),"begin_value_op").args_json(json!({"token_id":p.token_id,"epoch":"0","op_id":"1:provisioning-race","action_hash":"fixture","owner_id":e.bob.id()}))
  .deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;
 let blocked=e.minter.call(e.c.id(),"register_collateral").args_json(p.args()).deposit(NearToken::from_millinear(66)).gas(near_workspaces::types::Gas::from_tgas(200)).transact().await?;
 assert!(blocked.is_failure());assert!(view(&e.c,"get_collateral_binding",json!({"token_id":p.token_id})).await.is_null());
 e.minter.call(e.c.id(),"finish_value_op").args_json(json!({"token_id":p.token_id,"op_id":"1:provisioning-race","success":true})).max_gas().transact().await?.into_result()?;
 let out=e.minter.call(e.c.id(),"register_collateral").args_json(p.args()).deposit(NearToken::from_millinear(66)).gas(near_workspaces::types::Gas::from_tgas(200)).transact().await?.into_result()?;
 let terminal=out.json::<bool>()?;assert!(terminal);
 let hash=out.outcome().transaction_hash.to_string();
 let response=tokio::process::Command::new("curl").args(["-fsS","--max-time","30",&e.w.rpc_addr(),"-H","Content-Type: application/json","--data-binary",&json!({"jsonrpc":"2.0","id":"original","method":"tx","params":{"tx_hash":hash,"sender_account_id":e.minter.id(),"wait_until":"FINAL"}}).to_string()]).output().await?;
 anyhow::ensure!(response.status.success(),"sandbox RPC status failed");let original:Value=serde_json::from_slice(&response.stdout)?;
 assert_eq!(collateral::registration_terminal_for(&original,&hash,e.minter.id().as_str(),e.c.id().as_str(),&p,66*N/1000,e.mock.id().as_str()),Some(true),"actual runtime receipt graph must close");
 // A new holder can adopt the already-installed exact original proof, never send
 // the old preparation again. The old local epoch namespace cannot strand title.
 e.bob.call(e.c.id(),"nft_transfer").args_json(json!({"token_id":p.token_id,"receiver_id":e.lender.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 assert!(!collateral::holder_plan_access(&p,e.lender.id().as_str(),1,false));assert!(collateral::holder_plan_access(&p,e.lender.id().as_str(),1,true));
 e.lender.call(e.c.id(),"nft_transfer").args_json(json!({"token_id":p.token_id,"receiver_id":e.bob.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;

 let a=AuthorityAudit{domain:collateral::DOMAIN.into(),project_uuid:guarded::PROJECT_UUID.into(),contract:e.c.id().to_string(),provision_id:p.id(),authority_audit_sha256:"ef".repeat(32),issued_at_sec:1000,expires_at_sec:1100,no_presigned_authorities:true,all_aliases_reviewed:true,old_jobs_drained:true,external_chain_authorities_reviewed:true,effective_policy_reviewed:true,reachable_quorum_verified:true};
 let reviewer=SigningKey::from_bytes(&[44;32]);let message=serde_json::to_string(&a)?;let signature=B64.encode(reviewer.sign(format!("{}\n{message}",collateral::DOMAIN).as_bytes()).to_bytes());
 let approved=collateral::audit(&message,&signature,&B64.encode(reviewer.verifying_key().as_bytes()),&p,e.c.id().as_str(),1001).unwrap();
 let b=view(&e.c,"get_collateral_binding",json!({"token_id":p.token_id})).await;
 let policy=view(&e.mock,"get_wallet_policy",json!({"wallet_pubkey":p.wallet_pubkey})).await;
 assert!(view(&e.c,"get_pending_registration",json!({"token_id":p.token_id})).await.is_null());
 let mut st=Memory::default();assert!(collateral::seal_eligibility(&mut st,&p,&approved,&b,&policy,e.c.id().as_str(),false).is_err());assert!(st.0.is_empty());
 collateral::seal_eligibility(&mut st,&p,&approved,&b,&policy,e.c.id().as_str(),terminal).unwrap();
 let ts=now(&e).await;
 e.bob.call(e.c.id(),"open_loan").args_json(json!({"token_id":p.token_id,"terms":{"lender":e.lender.id(),"principal":N.to_string(),"repayment":(11*N/10).to_string(),"duration_sec":"120","grace_sec":"30","floor_raw":"1000000","funding_deadline_ns":(ts+600_000_000_000).to_string()}}))
  .deposit(NearToken::from_yoctonear(keyhole_keys::LOAN_STORAGE_DEPOSIT)).max_gas().transact().await?.into_result()?;
 let ts=now(&e).await;let cert:guarded::Certificate=serde_json::from_value(view(&e.c,"loan_certificate_template",json!({"token_id":p.token_id,"observed_at_ns":ts.to_string(),"expires_at_ns":(ts+30_000_000_000).to_string()})).await)?;
 guarded::eligible(&st.read(&keyhole_worker::tkey(&p.token_id,"confinement_v1")).unwrap(),&cert).unwrap();Ok(())
}

#[tokio::test(flavor="multi_thread",worker_threads=2)]
async fn provisioning_dispatch_rejects_stale_title_and_lost_callback_locks_all_mutation()->Result<()> {
 use keyhole_worker::collateral::Prepared;let e=setup().await?;
 e.minter.call(e.c.id(),"nft_mint").args_json(json!({"token_id":"cas-race","receiver_id":e.bob.id(),"tier":2,"metadata":{"copies":1}})).deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
 let mut p=Prepared{token_id:"cas-race".into(),owner:e.bob.id().to_string(),owner_epoch:0,worker_hash:"fe".repeat(32),wallet_pubkey:format!("ed25519:{}","cd".repeat(32)),plaintext_hash:"12".repeat(32),encrypted_data:"sealed-policy-cas-mock".into(),wallet_signature:"ab".repeat(64),version:1,valid_until:4_000_000_000};
 for (from,to) in [(&e.bob,&e.lender),(&e.lender,&e.bob)] {
  from.call(e.c.id(),"nft_transfer").args_json(json!({"token_id":p.token_id,"receiver_id":to.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
  let old=e.minter.call(e.c.id(),"register_collateral").args_json(p.args()).deposit(NearToken::from_millinear(66)).max_gas().transact().await?;assert!(old.is_failure());assert!(view(&e.c,"get_pending_registration",json!({"token_id":p.token_id})).await.is_null());
 }
 p.owner_epoch=2;fault_callbacks(&e).await?;
 let lost=e.minter.call(e.c.id(),"register_collateral").args_json(p.args()).deposit(NearToken::from_millinear(66)).max_gas().transact().await?;injected(&lost);
 for (actor,method,args,deposit) in [(&e.bob,"nft_transfer",json!({"token_id":p.token_id,"receiver_id":e.lender.id()}),1),(&e.minter,"begin_value_op",json!({"token_id":p.token_id,"owner_id":e.bob.id(),"epoch":"2","op_id":"1:race","action_hash":"hash"}),N/100),(&e.bob,"nft_list",json!({"token_id":p.token_id,"price":N.to_string()}),N/100)] {
  assert!(actor.call(e.c.id(),method).args_json(args).deposit(NearToken::from_yoctonear(deposit)).max_gas().transact().await?.is_failure());
 }
 let control=view(&e.c,"get_control_state",json!({"token_id":p.token_id})).await;assert_eq!(control["transfer_pending"],true);assert_eq!(control["owner_epoch"],"2");Ok(())
}
