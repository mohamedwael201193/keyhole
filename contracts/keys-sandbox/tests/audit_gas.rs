
use anyhow::Result;
use near_workspaces::types::NearToken;
use serde_json::{json,Value};
#[tokio::test]
async fn audit_maximum_approvals_transfer_call_gas()->Result<()> {
 let w=near_workspaces::sandbox().await?;let root=w.root_account()?;
 let c=w.dev_deploy(&std::fs::read("../keys/release/v2.5/keyhole_keys.wasm")?).await?;
 let recv=w.dev_deploy(&std::fs::read("tests/fixtures/custody_policy_mock.wasm")?).await?;
 let alice=root.create_subaccount("alice").initial_balance(NearToken::from_near(50)).transact().await?.into_result()?;
 c.call("new").args_json(json!({"owner":c.id(),"minter":c.id(),"treasury":c.id(),"royalty_bps":500})).max_gas().transact().await?.into_result()?;
 let token="k".repeat(64);
 c.call("nft_mint").args_json(json!({"token_id":token,"receiver_id":alice.id(),"tier":2,"metadata":{"title":"Gas boundary"}})).deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
 for i in 0..10 {
 let account=format!("{}{}.near","a".repeat(58),i);
 alice.call(c.id(),"nft_approve").args_json(json!({"token_id":token,"account_id":account})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;
 }
 for len in [0usize,1024,4096,8192,16384,32768,65536,131072,262144] {
  let msg="x".repeat(len);
  let r=alice.call(c.id(),"nft_transfer_call").args_json(json!({"token_id":token,"receiver_id":recv.id(),"msg":msg})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
  let v:Value=c.view("get_control_state").args_json(json!({"token_id":token})).await?.json()?;
  println!("len={len} state={v} failures={:?} gas={}",r.receipt_failures(),r.total_gas_burnt.as_gas());
  assert_eq!(v["transfer_pending"],false,"resolver failed for {len}");
 }
 Ok(())
}

#[tokio::test]
async fn audit_return_data_bomb_does_not_strand_title()->Result<()> {
 let w=near_workspaces::sandbox().await?;let root=w.root_account()?;
 let c=w.dev_deploy(&std::fs::read("../keys/release/v2.5/keyhole_keys.wasm")?).await?;
 let recv=w.dev_deploy(&std::fs::read("tests/fixtures/return_bomb_receiver.wasm")?).await?;
 let alice=root.create_subaccount("alice").initial_balance(NearToken::from_near(50)).transact().await?.into_result()?;
 c.call("new").args_json(json!({"owner":c.id(),"minter":c.id(),"treasury":c.id(),"royalty_bps":500})).max_gas().transact().await?.into_result()?;
 c.call("nft_mint").args_json(json!({"token_id":"k1","receiver_id":alice.id(),"tier":2,"metadata":{"title":"Return bomb"}})).deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
 let r=alice.call(c.id(),"nft_transfer_call").args_json(json!({"token_id":"k1","receiver_id":recv.id(),"msg":""})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
 let v:Value=c.view("get_control_state").args_json(json!({"token_id":"k1"})).await?.json()?;
 // Print failure strings and gas, not the enormous returned payload.
 let pending:Value=c.view("pending_return_count").args_json(json!({"account_id":alice.id()})).await?.json()?;
 let title:Value=c.view("nft_token").args_json(json!({"token_id":"k1"})).await?.json()?;
 let blocked=recv.as_account().call(c.id(),"nft_transfer").args_json(json!({"receiver_id":root.id(),"token_id":"k1"})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
 println!("new-owner attempted return failures={:?}",blocked.receipt_failures());
 println!("bomb state={v} old_owner_pending_returns={pending} token_owner={} failures={:?} gas={}",title["owner_id"],r.receipt_failures(),r.total_gas_burnt.as_gas());
 assert_eq!(v["transfer_pending"],false,"return-data bomb strands token lock");assert_eq!(pending,0);assert_eq!(title["owner_id"],alice.id().as_str());Ok(())
}
#[tokio::test]
async fn audit_return_data_bomb_at_maximum_token_and_approval_bound()->Result<()> {
 let w=near_workspaces::sandbox().await?;let root=w.root_account()?;
 let c=w.dev_deploy(&std::fs::read("../keys/release/v2.5/keyhole_keys.wasm")?).await?;
 let recv=w.dev_deploy(&std::fs::read("tests/fixtures/return_bomb_receiver.wasm")?).await?;
 let alice=root.create_subaccount("alice").initial_balance(NearToken::from_near(50)).transact().await?.into_result()?;
 c.call("new").args_json(json!({"owner":c.id(),"minter":c.id(),"treasury":c.id(),"royalty_bps":500})).max_gas().transact().await?.into_result()?;
 let token="k".repeat(64);
 c.call("nft_mint").args_json(json!({"token_id":token,"receiver_id":alice.id(),"tier":2,"metadata":{"title":"Return bomb"}})).deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
 for i in 0..10 {alice.call(c.id(),"nft_approve").args_json(json!({"token_id":token,"account_id":format!("{}{}.near","a".repeat(58),i)})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;}
 let r=alice.call(c.id(),"nft_transfer_call").args_json(json!({"token_id":token,"receiver_id":recv.id(),"msg":""})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
 let v:Value=c.view("get_control_state").args_json(json!({"token_id":token})).await?.json()?;
 // Print failure strings and gas, not the enormous returned payload.
 let pending:Value=c.view("pending_return_count").args_json(json!({"account_id":alice.id()})).await?.json()?;
 let title:Value=c.view("nft_token").args_json(json!({"token_id":token})).await?.json()?;
 let blocked=recv.as_account().call(c.id(),"nft_transfer").args_json(json!({"receiver_id":root.id(),"token_id":token})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
 println!("new-owner attempted return failures={:?}",blocked.receipt_failures());
 println!("bomb state={v} old_owner_pending_returns={pending} token_owner={} failures={:?} gas={}",title["owner_id"],r.receipt_failures(),r.total_gas_burnt.as_gas());
 assert!(r.receipt_failures().is_empty());let resolver=r.receipt_outcomes().iter().find(|o|o.logs.iter().any(|l|l.contains(&format!("\"old_owner_id\":\"{}\"",recv.id())))).expect("return resolver receipt");println!("maximum-case resolver gas={}",resolver.gas_burnt.as_gas());assert!(resolver.gas_burnt.as_gas()<50_000_000_000_000);
 assert_eq!(v["transfer_pending"],false,"return-data bomb strands token lock");assert_eq!(pending,0);assert_eq!(title["owner_id"],alice.id().as_str());Ok(())
}
