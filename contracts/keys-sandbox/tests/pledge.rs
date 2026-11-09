//! Local NEAR runtime + clearly-labelled mock OutLayer policy contract.
//! Does NOT prove live keystore enforcement or retired legacy worker availability.
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signer, SigningKey};
use keyhole_keys::LoanCertificate;
use near_workspaces::{Account, Contract};
use near_workspaces::types::NearToken;
use serde_json::{json,Value};
const WASM:&str="../keys/release/v2.5/keyhole_keys.wasm";
const MOCK:&str="tests/fixtures/custody_policy_mock.wasm";
const N:u128=1_000_000_000_000_000_000_000_000;
struct E { w:near_workspaces::Worker<near_workspaces::network::Sandbox>, c:Contract, mock:Contract, alice:Account, lender:Account, bob:Account, minter:Account }
async fn view(c:&Contract,m:&str,args:Value)->Value {c.view(m).args_json(args).await.unwrap().json().unwrap()}
async fn account(root:&Account,name:&str)->Result<Account>{Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(50)).transact().await?.into_result()?)}
async fn setup()->Result<E>{
 let w=near_workspaces::sandbox().await?; let root=w.root_account()?;
 let c=w.dev_deploy(&std::fs::read(WASM)?).await?; let mock=w.dev_deploy(&std::fs::read(MOCK)?).await?;
 let alice=account(&root,"alice").await?;let lender=account(&root,"lender").await?;let bob=account(&root,"bob").await?;let minter=account(&root,"minter").await?;
 c.call("new").args_json(json!({"owner":c.id(),"minter":minter.id(),"treasury":c.id(),"royalty_bps":500})).max_gas().transact().await?.into_result()?;
 minter.call(c.id(),"nft_mint").args_json(json!({"token_id":"k1","receiver_id":alice.id(),"tier":2,"metadata":{"title":"Sealed collateral","copies":1}}))
  .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
 minter.call(c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 let pk=SigningKey::from_bytes(&[7;32]).verifying_key().to_bytes();
 c.call("migrate_pledge").args_json(json!({"recovery_account":root.id(),"attestor_public_key":B64.encode(pk),"custody_contract":mock.id(),"network":"sandbox"})).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&c,"get_pledge_config",json!({})).await["lending_enabled"],false);
 c.call("set_lending_enabled").args_json(json!({"enabled":true})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 // Mock accepts a fixed fake artifact; signature cryptography belongs to live provider rollout, not this fixture.
 minter.call(c.id(),"register_collateral").args_json(json!({"token_id":"k1","wallet_pubkey":format!("ed25519:{}","ab".repeat(32)),"encrypted_data":"sealed-policy","wallet_signature":"ab".repeat(64),"version":1,"valid_until":4_000_000_000u64}))
  .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&c,"get_collateral_binding",json!({"token_id":"k1"})).await["ready"],true);
 Ok(E{w,c,mock,alice,lender,bob,minter})
}
async fn now(e:&E)->u64 {e.w.view_block().await.unwrap().timestamp()}
async fn open(e:&E)->Result<()> {
 let ts=now(e).await;
 e.alice.call(e.c.id(),"open_loan").args_json(json!({"token_id":"k1","terms":{"lender":e.lender.id(),"principal":N.to_string(),"repayment":(11*N/10).to_string(),"duration_sec":"120","grace_sec":"30","floor_raw":"1000000","funding_deadline_ns":(ts+600_000_000_000).to_string()}}))
  .deposit(NearToken::from_millinear(50)).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await["state"],"Offered"); Ok(())
}
async fn funding(e:&E,borrower_deleted:bool)->Result<()> {
 let ts=now(e).await;
 let cert=view(&e.c,"loan_certificate_template",json!({"token_id":"k1","observed_at_ns":ts.to_string(),"expires_at_ns":(ts+60_000_000_000).to_string()})).await;
 let c:LoanCertificate=serde_json::from_value(cert.clone())?;
 let signature=SigningKey::from_bytes(&[7;32]).sign(&near_sdk::borsh::to_vec(&c)?);
 let mut tampered=cert.clone();tampered["terms"]["floor_raw"]=json!("1");
 let r=e.lender.call(e.c.id(),"fund_loan").args_json(json!({"token_id":"k1","nonce":"1","certificate":tampered,"signature":B64.encode(signature.to_bytes())}))
  .deposit(NearToken::from_near(1)).max_gas().transact().await?;
 assert!(format!("{:?}",r.into_result().unwrap_err()).contains("certificate not bound"));
 if borrower_deleted {e.alice.deploy(&std::fs::read(MOCK)?).await?.into_result()?;}
 e.lender.call(e.c.id(),"fund_loan").args_json(json!({"token_id":"k1","nonce":"1","certificate":cert,"signature":B64.encode(signature.to_bytes())}))
  .deposit(NearToken::from_near(1)).max_gas().transact().await?.into_result()?;
 if borrower_deleted {e.alice.call(e.alice.id(),"claim_then_delete").args_json(json!({"keys":e.c.id(),"beneficiary":e.bob.id()})).max_gas().transact().await?.into_result()?;}
 else{e.alice.call(e.c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;}
 Ok(())
}
#[tokio::test] async fn sealed_loan_repay_unlock_and_native_credit_conservation()->Result<()> {
 let e=setup().await?;open(&e).await?;let alice_before=e.alice.view_account().await?.balance.as_yoctonear();funding(&e,false).await?;
 assert!(e.alice.view_account().await?.balance.as_yoctonear()>alice_before+N*99/100);
 assert_eq!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await["state"],"Active");
 let r=e.alice.call(e.c.id(),"nft_transfer").args_json(json!({"token_id":"k1","receiver_id":e.bob.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
 assert!(format!("{:?}",r.into_result().unwrap_err()).contains("pledged"));
 e.alice.call(e.c.id(),"repay_loan").args_json(json!({"token_id":"k1","nonce":"1"})).deposit(NearToken::from_yoctonear(11*N/10)).max_gas().transact().await?.into_result()?;
 assert!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await.is_null());
 assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.lender.id()})).await,(11*N/10).to_string());
 assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["user_liabilities"],(11*N/10+N/20).to_string());
 let lender_before=e.lender.view_account().await?.balance.as_yoctonear();
 e.lender.call(e.c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 assert!(e.lender.view_account().await?.balance.as_yoctonear()>lender_before+N);
 assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["user_liabilities"],(N/20).to_string());
 e.alice.call(e.c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["user_liabilities"],"0");
 e.alice.call(e.c.id(),"nft_transfer").args_json(json!({"token_id":"k1","receiver_id":e.bob.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;Ok(())
}
#[tokio::test] async fn sealed_loan_default_redirect_and_failed_thaw_keeps_both_owners_blocked()->Result<()> {
 let e=setup().await?;open(&e).await?;funding(&e,false).await?;// Sandbox height fast-forward is not a fixed wall-clock second; derive a safe bound from due timestamp.
 let due=view(&e.c,"get_loan",json!({"token_id":"k1"})).await["due_ns"].as_str().unwrap().parse::<u64>()?;
 for _ in 0..10 { if now(&e).await>due+30_000_000_000 {break;} e.w.fast_forward(1000).await?; }
 assert!(now(&e).await>due+30_000_000_000,"sandbox clock must pass grace before default");
 e.mock.call("mock_refuse_thaw").args_json(json!({"refuse":true})).transact().await?.into_result()?;
 e.lender.call(e.c.id(),"claim_default").args_json(json!({"token_id":"k1","nonce":"1","receiver_id":e.bob.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&e.c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],e.bob.id().as_str());
 assert_eq!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await["state"],"UnlockPending");
 let r=e.bob.call(e.c.id(),"nft_transfer").args_json(json!({"token_id":"k1","receiver_id":e.lender.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
 assert!(format!("{:?}",r.into_result().unwrap_err()).contains("pledged"));
 e.mock.call("mock_refuse_thaw").args_json(json!({"refuse":false})).transact().await?.into_result()?;
 e.bob.call(e.c.id(),"retry_loan_policy").args_json(json!({"token_id":"k1","nonce":"1"})).max_gas().transact().await?.into_result()?;
 assert!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await.is_null());
 let r=e.alice.call(e.c.id(),"nft_transfer").args_json(json!({"token_id":"k1","receiver_id":e.lender.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
 assert!(r.into_result().is_err());
 e.bob.call(e.c.id(),"nft_transfer").args_json(json!({"token_id":"k1","receiver_id":e.lender.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;Ok(())
}
#[tokio::test] async fn failed_principal_cashout_restores_borrower_credit_and_preserves_atomic_debt()->Result<()> {let e=setup().await?;open(&e).await?;funding(&e,true).await?;
 assert_eq!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await["state"],"Active");
 assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.alice.id()})).await,N.to_string());
 assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.lender.id()})).await,"0");
 assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["user_liabilities"],(N+N/20).to_string());Ok(())
}
#[tokio::test] async fn admission_and_pledge_both_receipt_orderings_are_serialized()->Result<()> {
 let e=setup().await?;
 e.minter.call(e.c.id(),"begin_value_op").args_json(json!({"token_id":"k1","epoch":"0","op_id":"1:a","action_hash":"hash","owner_id":e.alice.id()})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;
 let ts=now(&e).await;
 let r=e.alice.call(e.c.id(),"open_loan").args_json(json!({"token_id":"k1","terms":{"lender":e.lender.id(),"principal":N.to_string(),"repayment":N.to_string(),"duration_sec":"120","grace_sec":"30","floor_raw":"1000000","funding_deadline_ns":(ts+600_000_000_000).to_string()}})).deposit(NearToken::from_millinear(50)).max_gas().transact().await?;
 assert!(format!("{:?}",r.into_result().unwrap_err()).contains("value-op pending"));
 e.minter.call(e.c.id(),"finish_value_op").args_json(json!({"token_id":"k1","op_id":"1:a","success":true})).max_gas().transact().await?.into_result()?;
 open(&e).await?;
 let r=e.minter.call(e.c.id(),"begin_value_op").args_json(json!({"token_id":"k1","epoch":"0","op_id":"2:b","action_hash":"hash","owner_id":e.alice.id()})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?;
 assert!(format!("{:?}",r.into_result().unwrap_err()).contains("pledged"));Ok(())
}
#[tokio::test] async fn token_transfer_call_lock_refuses_reentrant_loan_then_resolves_cleanly()->Result<()> {
 let e=setup().await?; let receiver=e.w.dev_deploy(&std::fs::read(MOCK)?).await?;let ts=now(&e).await;
 let msg=json!({"keys":e.c.id(),"attack_method":"open_loan","attack_deposit":(N/20).to_string(),"attack_args":{"token_id":"k1","terms":{"lender":e.lender.id(),"principal":N.to_string(),"repayment":N.to_string(),"duration_sec":"120","grace_sec":"30","floor_raw":"1000000","funding_deadline_ns":(ts+600_000_000_000).to_string()}}}).to_string();
 e.alice.call(e.c.id(),"nft_transfer_call").args_json(json!({"token_id":"k1","receiver_id":receiver.id(),"msg":msg})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&receiver,"attack_succeeded",json!({})).await,false);
 assert!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await.is_null());
 assert_eq!(view(&e.c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],e.alice.id().as_str());
 assert_eq!(view(&e.c,"get_control_state",json!({"token_id":"k1"})).await["transfer_pending"],false);Ok(())
}

#[tokio::test] async fn deleted_payout_recipient_restores_exact_lender_credit_on_real_runtime()->Result<()> {
 let e=setup().await?;let lender=e.lender.deploy(&std::fs::read(MOCK)?).await?.into_result()?;
 open(&e).await?;funding(&e,false).await?;
 e.alice.call(e.c.id(),"repay_loan").args_json(json!({"token_id":"k1","nonce":"1"})).deposit(NearToken::from_yoctonear(11*N/10)).max_gas().transact().await?.into_result()?;
 lender.call("claim_then_delete").args_json(json!({"keys":e.c.id(),"beneficiary":e.bob.id()})).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.lender.id()})).await,(11*N/10).to_string());
 assert!(view(&e.c,"get_pending_payout",json!({"account_id":e.lender.id()})).await.is_null());
 assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["user_liabilities"],(11*N/10+N/20).to_string()); Ok(())
}
#[tokio::test] async fn captured_v24_state_migrates_without_reclassifying_legacy_balance()->Result<()> {
 use near_workspaces::types::AccountDetailsPatch;
 let st:Value=serde_json::from_str(include_str!("fixtures/v24-public-state.json"))?;
 let ac:Value=serde_json::from_str(include_str!("fixtures/v24-public-account.json"))?;
 assert_eq!(st["block_hash"],ac["block_hash"]);
 let w=near_workspaces::sandbox().await?;let root=w.root_account()?;
 let c=w.dev_deploy(&std::fs::read("../keys/release/v2.4/keyhole_keys.wasm")?).await?;
 let kv:Vec<(Vec<u8>,Vec<u8>)>=st["values"].as_array().unwrap().iter().map(|v|(B64.decode(v["key"].as_str().unwrap()).unwrap(),B64.decode(v["value"].as_str().unwrap()).unwrap())).collect();
 let pairs:Vec<(&[u8],&[u8])>=kv.iter().map(|(k,v)|(k.as_slice(),v.as_slice())).collect();
 w.patch(c.id()).states(pairs).transact().await?;
 let amount=ac["amount"].as_str().unwrap().parse::<u128>()?;let storage=ac["storage_usage"].as_u64().unwrap();
 w.patch(c.id()).account_from_current(move |cur|AccountDetailsPatch::from(cur).balance(NearToken::from_yoctonear(amount)).storage_usage(storage)).transact().await?;
 let tokens=view(&c,"nft_tokens",json!({"limit":50})).await;let cfg=view(&c,"config",json!({})).await;
 assert_eq!(tokens.as_array().unwrap().len(),6);
 let deploy=c.as_account().deploy(&std::fs::read(WASM)?).await?;
 if deploy.is_failure(){
  assert!(format!("{:?}",deploy.details.failures()).contains("LackBalanceForState"));
  println!("captured-state deploy blocker (sandbox only): {:?}",deploy.details.failures());
  // Sandbox-only sponsor capital: size it from this candidate instead of a stale fixed 2 NEAR.
  // The reserve is test operating headroom, NOT a mainnet quote or an approved expenditure.
  let current=c.view_account().await?;
  let old_len=std::fs::metadata("../keys/release/v2.4/keyhole_keys.wasm")?.len();
  let new_len=std::fs::metadata(WASM)?.len();
  let expected_storage=current.storage_usage.saturating_add(new_len.saturating_sub(old_len));
  let required=expected_storage as u128*10_000_000_000_000_000_000u128;
  let topup=required.saturating_sub(current.balance.as_yoctonear())+2*N;
  println!("sandbox-only measured candidate storage backing plus 2 NEAR operating margin: {topup} yoctoNEAR");
  root.transfer_near(c.id(),NearToken::from_yoctonear(topup)).await?.into_result()?;
  c.as_account().deploy(&std::fs::read(WASM)?).await?.into_result()?;
 }
 let pk=SigningKey::from_bytes(&[7;32]).verifying_key().to_bytes();
 c.call("migrate_pledge").args_json(json!({"recovery_account":root.id(),"attestor_public_key":B64.encode(pk),"custody_contract":"outlayer.near","network":"mainnet"})).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&c,"nft_tokens",json!({"limit":50})).await,tokens);assert_eq!(view(&c,"config",json!({})).await,cfg);
 let pg=view(&c,"get_pledge_config",json!({})).await;
 assert_eq!(pg["treasury_available"],"0");assert_eq!(pg["user_liabilities"],"0");assert_eq!(pg["lending_enabled"],false);
 let again=c.call("migrate_pledge").args_json(json!({"recovery_account":root.id(),"attestor_public_key":B64.encode(pk),"custody_contract":"outlayer.near","network":"mainnet"})).max_gas().transact().await?;
 assert!(again.is_failure());Ok(())
}

#[tokio::test] async fn admission_storage_is_bounded_and_stale_finish_cannot_unlock_new_op()->Result<()> {
 let e=setup().await?;let mut previous=None;
 for n in 1..=4 {
  let id=format!("{n}:hash");
  e.minter.call(e.c.id(),"begin_value_op").args_json(json!({"token_id":"k1","owner_id":e.alice.id(),"epoch":"0","op_id":id,"action_hash":"hash"})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;
  if n>1 {
   let stale=e.minter.call(e.c.id(),"finish_value_op").args_json(json!({"token_id":"k1","op_id":"1:hash","success":true})).max_gas().transact().await?;
   assert!(stale.is_failure());assert_eq!(view(&e.c,"pending_value_op_count",json!({"token_id":"k1"})).await,"1");
  }
  e.minter.call(e.c.id(),"finish_value_op").args_json(json!({"token_id":"k1","op_id":id,"success":true})).max_gas().transact().await?.into_result()?;
  let usage=e.c.view_account().await?.storage_usage;
  if let Some(before)=previous {assert_eq!(usage,before,"operation history must not grow storage");}previous=Some(usage);
 }
 assert_eq!(view(&e.c,"get_control_state",json!({"token_id":"k1"})).await["value_op_nonce"],"4");Ok(())
}


// Fault fixture differs ONLY by intentional private-callback panics; public recovery and state layout are unchanged.
async fn fault_callbacks(e:&E)->Result<()> {
 e.c.as_account().deploy(&std::fs::read("tests/fixtures/callback_failure.wasm")?).await?.into_result()?;Ok(())
}
async fn raw_fund(e:&E)->Result<near_workspaces::result::ExecutionFinalResult>{
 let ts=now(e).await;let cert=view(&e.c,"loan_certificate_template",json!({"token_id":"k1","observed_at_ns":ts.to_string(),"expires_at_ns":(ts+60_000_000_000).to_string()})).await;
 let typed:LoanCertificate=serde_json::from_value(cert.clone())?;let sig=SigningKey::from_bytes(&[7;32]).sign(&near_sdk::borsh::to_vec(&typed)?);
 Ok(e.lender.call(e.c.id(),"fund_loan").args_json(json!({"token_id":"k1","nonce":"1","certificate":cert,"signature":B64.encode(sig.to_bytes())})).deposit(NearToken::from_near(1)).max_gas().transact().await?)
}
fn injected(r:&near_workspaces::result::ExecutionFinalResult){assert!(format!("{:?}",r.receipt_failures()).contains("injected callback failure"));}
#[tokio::test]async fn actual_lost_policy_callback_recovers_by_fence_and_lost_payout_cannot_be_paid_three_times()->Result<()> {let e=setup().await?;fault_callbacks(&e).await?;let ts=now(&e).await;
 let r=e.alice.call(e.c.id(),"open_loan").args_json(json!({"token_id":"k1","terms":{"lender":e.lender.id(),"principal":N.to_string(),"repayment":(11*N/10).to_string(),"duration_sec":"120","grace_sec":"30","floor_raw":"1000000","funding_deadline_ns":(ts+600_000_000_000).to_string()}})).deposit(NearToken::from_millinear(50)).max_gas().transact().await?;injected(&r);
 e.bob.call(e.c.id(),"reconcile_loan_policy").args_json(json!({"token_id":"k1","nonce":"1"})).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await["state"],"Offered");
 raw_fund(&e).await?.into_result()?;assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.alice.id()})).await,N.to_string());
 let r=e.alice.call(e.c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;injected(&r);
 let r=e.alice.call(e.c.id(),"repay_loan").args_json(json!({"token_id":"k1","nonce":"1"})).deposit(NearToken::from_yoctonear(11*N/10)).max_gas().transact().await?;injected(&r);
 e.bob.call(e.c.id(),"reconcile_loan_policy").args_json(json!({"token_id":"k1","nonce":"1"})).max_gas().transact().await?.into_result()?;
 assert!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await.is_null());
 let before=e.lender.view_account().await?.balance.as_yoctonear();let r=e.lender.call(e.c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;injected(&r);assert!(e.lender.view_account().await?.balance.as_yoctonear()>before+N);
 for _ in 0..3 {
  let fake=e.bob.call(e.c.id(),"reconcile_terminal_outcome").args_json(json!({"attestation":{"kind":"payout","success":false},"signature":B64.encode([8;64])})).max_gas().transact().await?;assert!(fake.is_failure());
  let again=e.lender.call(e.c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;assert!(again.is_failure());
 }
 assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.lender.id()})).await,"0");assert!(!view(&e.c,"get_pending_payout",json!({"account_id":e.lender.id()})).await.is_null());Ok(())
}
#[tokio::test]async fn actual_failed_native_cashout_and_lost_callback_stays_unknown_not_double_credited()->Result<()> {let e=setup().await?;open(&e).await?;fault_callbacks(&e).await?;e.alice.deploy(&std::fs::read(MOCK)?).await?.into_result()?;raw_fund(&e).await?.into_result()?;
 let r=e.alice.call(e.alice.id(),"claim_then_delete").args_json(json!({"keys":e.c.id(),"beneficiary":e.bob.id()})).max_gas().transact().await?;
 assert!(!r.receipt_failures().is_empty());assert_eq!(view(&e.c,"get_loan",json!({"token_id":"k1"})).await["state"],"Active");
 assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.alice.id()})).await,"0");assert!(!view(&e.c,"get_pending_payout",json!({"account_id":e.alice.id()})).await.is_null());
 // A failed native transfer plus a lost callback is deliberately UNKNOWN on chain, never timed-refunded.
 assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.lender.id()})).await,"0");Ok(())
}
#[tokio::test]async fn actual_failed_registration_refunds_forwarded_deposit_and_allows_corrected_retry()->Result<()> {
 let e=setup().await?;e.minter.call(e.c.id(),"nft_mint").args_json(json!({"token_id":"k2","receiver_id":e.bob.id(),"tier":2,"metadata":{"title":"Retry"}})).deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
 let mint_credit=view(&e.c,"get_payout_credit",json!({"account_id":e.minter.id()})).await.as_str().unwrap().parse::<u128>()?;
 let args=json!({"token_id":"k2","wallet_pubkey":format!("ed25519:{}","cd".repeat(32)),"encrypted_data":"sealed-policy","wallet_signature":"ab".repeat(64),"version":1,"valid_until":4_000_000_000u64});
 let dep=N/50+1;let r=e.minter.call(e.c.id(),"register_collateral").args_json(args.clone()).deposit(NearToken::from_yoctonear(dep)).max_gas().transact().await?;
 assert!(format!("{:?}",r.receipt_failures()).contains("mock provider insufficient deposit"));
 assert!(view(&e.c,"get_collateral_binding",json!({"token_id":"k2"})).await.is_null());assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.minter.id()})).await,(dep+mint_credit).to_string());
 e.minter.call(e.c.id(),"register_collateral").args_json(args).deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;assert_eq!(view(&e.c,"get_collateral_binding",json!({"token_id":"k2"})).await["ready"],true);
 assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["user_liabilities"],(dep+mint_credit).to_string());Ok(())
}
#[tokio::test]async fn actual_failed_resolver_has_permissionless_provisional_timeout_not_economic_rollback()->Result<()> {let e=setup().await?;fault_callbacks(&e).await?;let recv=e.w.dev_deploy(&std::fs::read(MOCK)?).await?;
 let msg=json!({"keys":e.c.id(),"attack_method":"fund_treasury","attack_args":{},"attack_deposit":(N/10).to_string()}).to_string();
 let r=e.alice.call(e.c.id(),"nft_transfer_call").args_json(json!({"token_id":"k1","receiver_id":recv.id(),"msg":msg})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;injected(&r);
 let p=view(&e.c,"get_pending_transfer",json!({"token_id":"k1"})).await;let epoch=p["epoch"].clone();let deadline=p["restore_after_ns"].as_str().unwrap().parse::<u64>()?;
 let early=e.bob.call(e.c.id(),"restore_expired_transfer").args_json(json!({"token_id":"k1","epoch":epoch})).max_gas().transact().await?;assert!(early.is_failure());
 for _ in 0..10{if now(&e).await>=deadline{break;}e.w.fast_forward(1000).await?;}
 e.bob.call(e.c.id(),"restore_expired_transfer").args_json(json!({"token_id":"k1","epoch":epoch})).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&e.c,"pending_return_count",json!({"account_id":e.alice.id()})).await,0);assert_eq!(view(&e.c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],e.alice.id().as_str());
 assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["treasury_available"],(N/10).to_string(),"external economic side effects are NOT unwound: receiver must wait for committed acceptance");Ok(())
}

#[tokio::test]async fn actual_failed_registration_callback_recovers_after_successful_provider_without_reforwarding()->Result<()> {
 let e=setup().await?;fault_callbacks(&e).await?;
 e.minter.call(e.c.id(),"nft_mint").args_json(json!({"token_id":"k2","receiver_id":e.bob.id(),"tier":2,"metadata":{"title":"Registration callback"}})).deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
 let mint_credit=view(&e.c,"get_payout_credit",json!({"account_id":e.minter.id()})).await;
 let r=e.minter.call(e.c.id(),"register_collateral").args_json(json!({"token_id":"k2","wallet_pubkey":format!("ed25519:{}","cd".repeat(32)),"encrypted_data":"sealed-policy","wallet_signature":"ab".repeat(64),"version":1,"valid_until":4_000_000_000u64})).deposit(NearToken::from_millinear(100)).max_gas().transact().await?;injected(&r);
 assert_eq!(view(&e.c,"get_collateral_binding",json!({"token_id":"k2"})).await["ready"],false);
 e.bob.call(e.c.id(),"check_collateral").args_json(json!({"token_id":"k2"})).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&e.c,"get_collateral_binding",json!({"token_id":"k2"})).await["ready"],true);assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["user_liabilities"],mint_credit);assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.minter.id()})).await,mint_credit);Ok(())
}

#[tokio::test]async fn custody_generation_fence_rejects_old_freeze_after_committed_thaw()->Result<()> {
 let e=setup().await?;open(&e).await?;e.alice.call(e.c.id(),"cancel_loan").args_json(json!({"token_id":"k1","nonce":"1"})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 let wallet=format!("ed25519:{}","ab".repeat(32));
 let stale=e.c.as_account().call(e.mock.id(),"set_wallet_frozen").args_json(json!({"wallet_pubkey":wallet,"generation":"1","frozen":true})).max_gas().transact().await?;assert!(stale.is_failure());
 let policy=view(&e.mock,"get_wallet_policy",json!({"wallet_pubkey":wallet})).await;assert_eq!(policy["frozen"],false);assert!(policy["generation"].as_u64().unwrap()>=2);Ok(())
}
