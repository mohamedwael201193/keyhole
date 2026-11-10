#[path="support/payout_storage.rs"] mod payout_storage;
use payout_storage::register_payouts;
// Independently authored local runtime probes, normal pinned production WASM.
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use near_workspaces::{Account,Contract,Worker,network::Sandbox,types::NearToken};
use serde_json::{json,Value};
const N:u128=1_000_000_000_000_000_000_000_000;
async fn view(c:&Contract,m:&str,a:Value)->Result<Value>{Ok(c.view(m).args_json(a).await?.json()?)}
async fn account(w:&Worker<Sandbox>,name:&str)->Result<Account>{Ok(w.root_account()?.create_subaccount(name).initial_balance(NearToken::from_near(10)).transact().await?.into_result()?)}
async fn setup(w:&Worker<Sandbox>)->Result<(Contract,Account)>{
    let c=w.dev_deploy(&std::fs::read("../keys/release/v2.5/keyhole_keys.wasm")?).await?;
    c.call("new").args_json(json!({"owner":c.id(),"minter":c.id(),"treasury":c.id(),"royalty_bps":0})).max_gas().transact().await?.into_result()?;
    let seller=account(w,"origin").await?;
    register_payouts(&c,&w.root_account()?,&[c.id(),seller.id()]).await?;
    c.call("nft_mint").args_json(json!({"token_id":"audit4","receiver_id":seller.id(),"tier":2,"metadata":{"title":"audit4"}})).deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
    c.call("claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    c.call("migrate_pledge").args_json(json!({"recovery_account":w.root_account()?.id(),"attestor_public_key":STANDARD.encode([7;32]),"custody_contract":"custody.near","network":"sandbox"})).max_gas().transact().await?.into_result()?;
    Ok((c,seller))
}
async fn list(c:&Contract,a:&Account)->Result<()>{a.call(c.id(),"nft_list").args_json(json!({"token_id":"audit4","price":N.to_string()})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;Ok(())}
async fn buy(c:&Contract,a:&Account,excess:u128)->Result<()>{a.call(c.id(),"nft_buy").args_json(json!({"token_id":"audit4"})).deposit(NearToken::from_yoctonear(N+excess)).max_gas().transact().await?.into_result()?;Ok(())}
async fn gift(c:&Contract,a:&Account,b:&Account)->Result<()>{a.call(c.id(),"nft_transfer").args_json(json!({"token_id":"audit4","receiver_id":b.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;Ok(())}
async fn claim(c:&Contract,a:&Account)->Result<()>{a.call(c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;Ok(())}
#[tokio::test]
async fn review4_real_failed_seller_cashout_restores_exact_credit_and_later_delivers()->Result<()>{
    let w=near_workspaces::sandbox().await?;let(c,s)=setup(&w).await?;let b=account(&w,"recipient").await?;
    register_payouts(&c,&w.root_account()?,&[b.id()]).await?;
    list(&c,&s).await?;buy(&c,&b,127).await?;
    assert_eq!(view(&c,"get_payout_credit",json!({"account_id":s.id()})).await?,(N+N/100).to_string());
    assert_eq!(view(&c,"get_payout_credit",json!({"account_id":b.id()})).await?,"127");
    s.deploy(&std::fs::read("tests/fixtures/custody_policy_mock.wasm")?).await?.into_result()?;
    let r=s.call(s.id(),"claim_then_delete").args_json(json!({"keys":c.id(),"beneficiary":b.id()})).max_gas().transact().await?;
    assert!(format!("{:?}",r.receipt_failures()).contains("AccountDoesNotExist"));
    assert_eq!(view(&c,"get_payout_credit",json!({"account_id":s.id()})).await?,(N+N/100).to_string());
    assert!(view(&c,"get_pending_payout",json!({"account_id":s.id()})).await?.is_null());
    assert_eq!(view(&c,"get_pledge_config",json!({})).await?["user_liabilities"],(N+N/100+127).to_string());
    let restored=account(&w,"origin").await?;
    let before=restored.view_account().await?.balance.as_yoctonear();claim(&c,&restored).await?;w.fast_forward(3).await?;
    assert!(restored.view_account().await?.balance.as_yoctonear()>before+N);
    assert_eq!(view(&c,"get_payout_credit",json!({"account_id":restored.id()})).await?,"0");
    assert_eq!(view(&c,"get_pledge_config",json!({})).await?["user_liabilities"],"127");
    let retry=restored.call(c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;assert!(retry.is_failure());
    assert_eq!(view(&c,"nft_token",json!({"token_id":"audit4"})).await?["owner_id"],b.id().as_str());
    Ok(())
}
#[tokio::test]
async fn review4_real_dust_refund_storage_must_not_consume_old_backing()->Result<()>{
    let w=near_workspaces::sandbox().await?;let(c,s)=setup(&w).await?;
    // Warm listing index, epoch and seller payout ledger lifecycle.
    let warm=account(&w,"warm").await?;
    list(&c,&s).await?;buy(&c,&warm,0).await?;gift(&c,&warm,&s).await?;claim(&c,&s).await?;w.fast_forward(3).await?;
    let before=c.view_account().await?;
    for i in 0..4 {
        let b=account(&w,&format!("dust{i}")).await?;
        register_payouts(&c,&w.root_account()?,&[b.id()]).await?;
        list(&c,&s).await?;buy(&c,&b,2).await?;gift(&c,&b,&s).await?;claim(&c,&s).await?;
        assert_eq!(view(&c,"get_payout_credit",json!({"account_id":b.id()})).await?,"2");
        assert_eq!(view(&c,"get_payout_credit",json!({"account_id":s.id()})).await?,"0");
        let state=c.view_account().await?;
        let stake=(state.storage_usage-before.storage_usage) as u128*10_000_000_000_000_000_000u128;
        let retained=state.balance.as_yoctonear() as i128-before.balance.as_yoctonear() as i128;
        assert!(retained>=stake as i128+2*(i+1),"every cycle funds its own state and full refunds, including real gas rewards");
        println!("DUST_CYCLE {}: storage_delta={} bytes, balance_delta={} yocto",i+1,state.storage_usage-before.storage_usage,state.balance.as_yoctonear() as i128-before.balance.as_yoctonear() as i128);
    }
    w.fast_forward(3).await?;let after=c.view_account().await?;
    let bytes=after.storage_usage-before.storage_usage;
    let cost=bytes as u128*10_000_000_000_000_000_000u128;
    let balance_delta=after.balance.as_yoctonear() as i128-before.balance.as_yoctonear() as i128;
    assert_eq!(view(&c,"get_pledge_config",json!({})).await?["user_liabilities"],"8");
    println!("DUST_FINAL bytes={bytes}, new_storage_stake={cost}, contract_balance_change_including_gas_rewards={balance_delta}, dust_liability=8");
    assert!(balance_delta>=cost as i128+8,"even real contract gas rewards do not pay for attacker-created persistent dust records");
    Ok(())
}


#[tokio::test]
async fn review4_real_registration_rejects_unfunded_refund_atomically_and_preserves_full_dust()->Result<()> {
    let w=near_workspaces::sandbox().await?;let(c,s)=setup(&w).await?;let b=account(&w,"fresh").await?;let root=w.root_account()?;
    list(&c,&s).await?;let before=c.view_account().await?.storage_usage;
    let liabilities=view(&c,"get_pledge_config",json!({})).await?["user_liabilities"].clone();
    let failed=b.call(c.id(),"nft_buy").args_json(json!({"token_id":"audit4"})).deposit(NearToken::from_yoctonear(N+2)).max_gas().transact().await?;
    assert!(format!("{:?}",failed.into_result().unwrap_err()).contains("register payout account storage first"));
    assert_eq!(c.view_account().await?.storage_usage,before);
    assert_eq!(view(&c,"nft_token",json!({"token_id":"audit4"})).await?["owner_id"],s.id().as_str());
    assert!(!view(&c,"nft_listing",json!({"token_id":"audit4"})).await?.is_null());
    assert_eq!(view(&c,"get_pledge_config",json!({})).await?["user_liabilities"],liabilities);
    let fee=view(&c,"payout_storage_cost",json!({})).await?.as_str().unwrap().parse::<u128>()?;
    for wrong in [0,fee-1,fee+1] {
        assert!(root.call(c.id(),"register_payout_account").args_json(json!({"account_id":b.id()}))
            .deposit(NearToken::from_yoctonear(wrong)).max_gas().transact().await?.into_result().is_err());
        assert_eq!(view(&c,"payout_account_registered",json!({"account_id":b.id()})).await?,false);
        assert_eq!(c.view_account().await?.storage_usage,before);
    }
    register_payouts(&c,&root,&[b.id()]).await?;
    let allocated=c.view_account().await?.storage_usage-before;
    assert!(fee >= (allocated as u128+24+130)*10_000_000_000_000_000_000);
    buy(&c,&b,2).await?;assert_eq!(view(&c,"get_payout_credit",json!({"account_id":b.id()})).await?,"2");
    assert!(root.call(c.id(),"register_payout_account").args_json(json!({"account_id":b.id()}))
        .deposit(NearToken::from_yoctonear(fee)).max_gas().transact().await?.into_result().is_err());
    assert_eq!(view(&c,"get_payout_credit",json!({"account_id":b.id()})).await?,"2");
    b.call(c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&c,"get_payout_credit",json!({"account_id":b.id()})).await?,"0");
    assert!(view(&c,"get_pending_payout",json!({"account_id":b.id()})).await?.is_null());
    assert_eq!(view(&c,"payout_account_registered",json!({"account_id":b.id()})).await?,true);
    assert_eq!(view(&c,"get_pledge_config",json!({})).await?["user_liabilities"],(N+N/100).to_string());
    eprintln!("review4 actual registered ledger bytes={allocated}; fee={fee}; complete 2-yocto credit paid without reducing storage bond");
    Ok(())
}
