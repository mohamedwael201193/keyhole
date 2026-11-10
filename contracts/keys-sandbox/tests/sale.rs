//! Local NEAR runtime + clearly-labelled mock OutLayer policy contract.
//! Does NOT prove live keystore enforcement or retired legacy worker availability.
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signer, SigningKey};
use keyhole_keys::SaleCertificate;
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
 // Settle the unrelated mint-excess credit before isolating sale liabilities.
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
async fn open_sale(e:&E)->Result<()> {let ts=now(e).await;e.alice.call(e.c.id(),"open_sale").args_json(json!({"token_id":"k1","terms":{"buyer":e.lender.id(),"price":(N/100).to_string(),"floor_raw":"500000","deadline_ns":(ts+600_000_000_000).to_string()}})).deposit(NearToken::from_millinear(20)).max_gas().transact().await?.into_result()?;Ok(())}
async fn cert(e:&E)->Result<(Value,String)>{let ts=now(e).await;let v=view(&e.c,"sale_certificate_template",json!({"token_id":"k1","observed_at_ns":ts.to_string(),"expires_at_ns":(ts+60_000_000_000).to_string()})).await;let c:SaleCertificate=serde_json::from_value(v.clone())?;let sig=B64.encode(SigningKey::from_bytes(&[7;32]).sign(&near_sdk::borsh::to_vec(&c)?).to_bytes());Ok((v,sig))}
async fn enable(e:&E)->Result<()>{e.c.call("adopt_zero_royalty").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;e.c.call("set_protected_sales_enabled").args_json(json!({"enabled":true})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;Ok(())}
async fn buy(e:&E)->Result<()>{let(v,sig)=cert(e).await?;e.lender.call(e.c.id(),"buy_sale").args_json(json!({"token_id":"k1","nonce":"1","certificate":v,"signature":sig})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;Ok(())}
#[tokio::test] async fn protected_sale_atomic_title_backed_credit_and_real_seller_cashout()->Result<()>{
 let e=setup().await?;enable(&e).await?;
 assert_eq!(view(&e.c,"config",json!({})).await["royalty_bps"],0);
 for b in [0,1,u128::MAX]{let p=view(&e.c,"nft_payout",json!({"token_id":"k1","balance":b.to_string(),"max_len_payout":1})).await;assert_eq!(p["payout"].as_object().unwrap().len(),1);assert_eq!(p["payout"][e.alice.id().as_str()],b.to_string());}
 e.alice.call(e.c.id(),"nft_approve").args_json(json!({"token_id":"k1","account_id":e.bob.id()})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;
 open_sale(&e).await?;assert_eq!(view(&e.c,"get_sale",json!({"token_id":"k1"})).await["state"],"Offered");
 let(v,sig)=cert(&e).await?;let mut bad=v.clone();bad["domain"]=json!("KEYHOLE_SEALED_LOAN_V2_CREDIT");let c:SaleCertificate=serde_json::from_value(bad.clone())?;let bs=B64.encode(SigningKey::from_bytes(&[7;32]).sign(&near_sdk::borsh::to_vec(&c)?).to_bytes());
 let r=e.lender.call(e.c.id(),"buy_sale").args_json(json!({"token_id":"k1","nonce":"1","certificate":bad,"signature":bs})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?;assert!(r.is_failure());
 e.lender.call(e.c.id(),"buy_sale").args_json(json!({"token_id":"k1","nonce":"1","certificate":v,"signature":sig})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;
 assert_eq!(view(&e.c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],e.lender.id().as_str());assert_eq!(view(&e.c,"nft_settlement_epoch",json!({"token_id":"k1"})).await,"1");assert_eq!(view(&e.c,"nft_is_approved",json!({"token_id":"k1","approved_account_id":e.bob.id()})).await,false);
 // Sale price + released sale bond + the complete approval deposit (excess and released storage).
assert!(view(&e.c,"get_sale",json!({"token_id":"k1"})).await.is_null());assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.alice.id()})).await,(4*N/100).to_string());
 let before=e.alice.view_account().await?.balance.as_yoctonear();e.alice.call(e.c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;e.w.fast_forward(5).await?;let after=e.alice.view_account().await?.balance.as_yoctonear();assert!(after>before+39*N/1000,"native seller balance before={before} after={after}");assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["user_liabilities"],"0");
 let r=e.alice.call(e.c.id(),"nft_transfer").args_json(json!({"token_id":"k1","receiver_id":e.bob.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;assert!(r.is_failure());
 e.minter.call(e.c.id(),"begin_value_op").args_json(json!({"token_id":"k1","epoch":"1","op_id":"1:after-sale","action_hash":"test","owner_id":e.lender.id()})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;Ok(())
}
#[tokio::test] async fn sale_title_credit_survive_failed_thaw_and_alternate_routes_cannot_bypass()->Result<()>{
 let e=setup().await?;enable(&e).await?;open_sale(&e).await?;
 for m in ["nft_transfer","nft_transfer_call","nft_transfer_payout","nft_approve","nft_list","nft_buy"] {let r=e.alice.call(e.c.id(),m).args_json(json!({"token_id":"k1","receiver_id":e.bob.id(),"account_id":e.bob.id(),"price":N.to_string(),"balance":"1","max_len_payout":10,"msg":""})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;assert!(r.is_failure(),"bypass {m}");}
 e.mock.call("mock_refuse_thaw").args_json(json!({"refuse":true})).transact().await?.into_result()?;buy(&e).await?;
 assert_eq!(view(&e.c,"get_sale",json!({"token_id":"k1"})).await["state"],"UnlockPending");assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.alice.id()})).await,(N/100).to_string());
 let r=e.lender.call(e.c.id(),"nft_transfer").args_json(json!({"token_id":"k1","receiver_id":e.bob.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;assert!(r.is_failure());
 e.mock.call("mock_refuse_thaw").args_json(json!({"refuse":false})).transact().await?.into_result()?;e.lender.call(e.c.id(),"retry_sale_policy").args_json(json!({"token_id":"k1","nonce":"1"})).max_gas().transact().await?.into_result()?;assert!(view(&e.c,"get_sale",json!({"token_id":"k1"})).await.is_null());Ok(())
}
#[tokio::test] async fn cancelled_sale_reopen_cannot_use_old_certificate()->Result<()>{let e=setup().await?;enable(&e).await?;open_sale(&e).await?;let(v,sig)=cert(&e).await?;e.alice.call(e.c.id(),"cancel_sale").args_json(json!({"token_id":"k1","nonce":"1"})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;open_sale(&e).await?;let r=e.lender.call(e.c.id(),"buy_sale").args_json(json!({"token_id":"k1","nonce":"2","certificate":v,"signature":sig})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?;assert!(r.is_failure());assert_eq!(view(&e.c,"get_sale",json!({"token_id":"k1"})).await["nonce"],"2");Ok(())}
#[tokio::test] async fn lost_freeze_callback_stays_unknown_without_retry_or_view_only_clear()->Result<()>{let e=setup().await?;enable(&e).await?;e.c.as_account().deploy(&std::fs::read("tests/fixtures/callback_failure.wasm")?).await?.into_result()?;let _=open_sale(&e).await;let sale=view(&e.c,"get_sale",json!({"token_id":"k1"})).await;assert_eq!(sale["state"],"Freezing");assert_eq!(sale["policy_busy"],true);assert_eq!(sale["policy_call_complete"],false);for m in ["retry_sale_policy","reconcile_sale_policy","cancel_sale"]{let r=e.alice.call(e.c.id(),m).args_json(json!({"token_id":"k1","nonce":"1"})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;assert!(r.is_failure());}assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["user_liabilities"],(N/50).to_string());Ok(())}

#[tokio::test]
async fn failed_seller_cashout_restores_credit_once_without_reversing_title() -> Result<()> {
 let e=setup().await?;enable(&e).await?;open_sale(&e).await?;buy(&e).await?;
 let entitlement=3*N/100;
 e.alice.deploy(&std::fs::read(MOCK)?).await?.into_result()?;
 let r=e.alice.call(e.alice.id(),"claim_then_delete").args_json(json!({"keys":e.c.id(),"beneficiary":e.bob.id()})).max_gas().transact().await?;
 assert!(!r.receipt_failures().is_empty(),"deleted recipient must fail native transfer");
 assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.alice.id()})).await,entitlement.to_string());
 assert!(view(&e.c,"get_pending_payout",json!({"account_id":e.alice.id()})).await.is_null());
 assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["user_liabilities"],entitlement.to_string());
 assert_eq!(view(&e.c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],e.lender.id().as_str());
 // Recreate the same recipient in the sandbox; no refund/repair override is used.
 let root=e.w.root_account()?;
 let alice=account(&root,"alice").await?;
 let before=alice.view_account().await?.balance.as_yoctonear();
 alice.call(e.c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 e.w.fast_forward(5).await?;let after=alice.view_account().await?.balance.as_yoctonear();assert!(after>before+29*N/1000,"native seller balance before={before} after={after}");
 assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":alice.id()})).await,"0");
 assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["user_liabilities"],"0");
 Ok(())
}
#[tokio::test]
async fn lost_seller_cashout_callback_keeps_liability_pending_in_both_native_worlds() -> Result<()> {
 for native_fails in [false,true] {
  let e=setup().await?;enable(&e).await?;open_sale(&e).await?;buy(&e).await?;
  e.c.as_account().deploy(&std::fs::read("tests/fixtures/callback_failure.wasm")?).await?.into_result()?;
  let r=if native_fails {
   e.alice.deploy(&std::fs::read(MOCK)?).await?.into_result()?;
   e.alice.call(e.alice.id(),"claim_then_delete").args_json(json!({"keys":e.c.id(),"beneficiary":e.bob.id()})).max_gas().transact().await?
  }else{
   let before=e.alice.view_account().await?.balance.as_yoctonear();
   let r=e.alice.call(e.c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
   e.w.fast_forward(5).await?;let after=e.alice.view_account().await?.balance.as_yoctonear();assert!(after>before+29*N/1000,"native seller balance before={before} after={after}");r
  };
  assert!(format!("{:?}",r.receipt_failures()).contains("injected callback failure"));
  assert_eq!(view(&e.c,"get_payout_credit",json!({"account_id":e.alice.id()})).await,"0");
  assert_eq!(view(&e.c,"get_pending_payout",json!({"account_id":e.alice.id()})).await["amount"],(3*N/100).to_string());
  assert_eq!(view(&e.c,"get_pledge_config",json!({})).await["user_liabilities"],(3*N/100).to_string());
  assert_eq!(view(&e.c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],e.lender.id().as_str());
 }
 Ok(())
}

#[tokio::test] async fn terminal_sale_action_with_unverified_read_stays_pending_until_read_recovery()->Result<()>{
 let e=setup().await?;enable(&e).await?;
 e.mock.call("mock_fail_policy_reads").args_json(json!({"fail":true})).transact().await?.into_result()?;
 let _=open_sale(&e).await;
 let s=view(&e.c,"get_sale",json!({"token_id":"k1"})).await;
 assert_eq!(s["state"],"Freezing");assert_eq!(s["policy_busy"],true);assert_eq!(s["policy_call_complete"],true);assert_eq!(s["policy_sequence"],"1");
 for m in ["retry_sale_policy","cancel_sale"]{
  let r=e.alice.call(e.c.id(),m).args_json(json!({"token_id":"k1","nonce":"1"})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;assert!(r.is_failure(),"blocked read-stage command {m}");
 }
 e.mock.call("mock_fail_policy_reads").args_json(json!({"fail":false})).transact().await?.into_result()?;
 assert_eq!(e.mock.view("get_wallet_policy").args_json(json!({"wallet_pubkey":format!("ed25519:{}","ab".repeat(32))})).await?.json::<Value>()?["frozen"],true);
 e.alice.call(e.c.id(),"reconcile_sale_policy").args_json(json!({"token_id":"k1","nonce":"1"})).max_gas().transact().await?.into_result()?;
 let s=view(&e.c,"get_sale",json!({"token_id":"k1"})).await;assert_eq!(s["state"],"Offered");assert_eq!(s["policy_busy"],false);assert_eq!(s["policy_sequence"],"1");
 e.alice.call(e.c.id(),"cancel_sale").args_json(json!({"token_id":"k1","nonce":"1"})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
 assert!(view(&e.c,"get_sale",json!({"token_id":"k1"})).await.is_null());Ok(())
}
