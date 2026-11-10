#[path="support/payout_storage.rs"] mod payout_storage;
use payout_storage::register_payouts;
// Permanent round-three runtime regressions. Isolated local NEAR only.
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use near_workspaces::{Account, Contract, Worker, network::Sandbox, types::NearToken};
use serde_json::{json, Value};
const WASM: &str = "../keys/release/v2.5/keyhole_keys.wasm";
const N: u128 = 1_000_000_000_000_000_000_000_000;
async fn v(c: &Contract, m: &str, a: Value) -> Value { c.view(m).args_json(a).await.unwrap().json().unwrap() }
async fn init(c: &Contract, root: &Account) -> Result<()> {
    c.call("new").args_json(json!({"owner":c.id(),"minter":c.id(),"treasury":c.id(),"royalty_bps":0})).max_gas().transact().await?.into_result()?; register_payouts(c,root,&[c.id()]).await?; Ok(())
}
async fn migrate(c: &Contract, root: &Account) -> Result<()> {
    c.call("migrate_pledge").args_json(json!({"recovery_account":root.id(),"attestor_public_key":STANDARD.encode([7;32]),"custody_contract":"custody.near","network":"sandbox"})).max_gas().transact().await?.into_result()?; Ok(())
}
async fn mint(c: &Contract, a: &Account) -> Result<()> {
    c.call("nft_mint").args_json(json!({"token_id":"k1","receiver_id":a.id(),"tier":2,"metadata":{"title":"Round-three regression"}})).deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?; Ok(())
}
async fn new_account(root:&Account, name:&str)->Result<Account>{Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(50)).transact().await?.into_result()?)}
async fn wait_value(c:&Contract,method:&str,args:Value)->Result<Value>{
    for _ in 0..200 {let x=v(c,method,args.clone()).await;if !x.is_null(){return Ok(x);}tokio::time::sleep(std::time::Duration::from_millis(100)).await;}
    anyhow::bail!("timed out waiting for {method}")
}
async fn start(sender:&Contract,c:&Contract,recv:&Contract,label:&str)->Result<()> {
    // No status() call: the actual final promise is observed by the sender contract.
    let _tx=sender.call("start").args_json(json!({"keys":c.id(),"receiver":recv.id(),"label":label})).max_gas().transact_async().await?; Ok(())
}
async fn advance(w:&Worker<Sandbox>,deadline:u64)->Result<()> {
    for _ in 0..10 {if w.view_block().await?.timestamp()>=deadline{return Ok(());}w.fast_forward(1000).await?;}anyhow::bail!("clock did not reach timeout")
}
#[tokio::test]
async fn review3_timeout_late_real_resolver_returns_false_with_and_without_new_transfer()->Result<()> {
    for newer in [false,true] {
        let w=near_workspaces::sandbox().await?;let root=w.root_account()?;
        let c=w.dev_deploy(&std::fs::read(WASM)?).await?;
        let fixture=std::fs::read("tests/fixtures/yield_receiver.wasm")?;
        let sender=w.dev_deploy(&fixture).await?;let recv=w.dev_deploy(&fixture).await?;
        init(&c,&root).await?;mint(&c,sender.as_account()).await?;
        start(&sender,&c,&recv,"old").await?;
        let p=wait_value(&c,"get_pending_transfer",json!({"token_id":"k1"})).await?;
        let deadline=p["restore_after_ns"].as_str().unwrap().parse()?;advance(&w,deadline).await?;
        assert!(!root.call(c.id(),"restore_expired_transfer").args_json(json!({"token_id":"k1","epoch":p["epoch"]})).max_gas().transact().await?.json::<bool>()?);
        assert_eq!(v(&c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],sender.id().as_str());
        let next=if newer {let r=w.dev_deploy(&fixture).await?;start(&sender,&c,&r,"new").await?;let n=wait_value(&c,"get_pending_transfer",json!({"token_id":"k1"})).await?;assert_ne!(n["epoch"],p["epoch"]);Some((r,n))}else{None};
        recv.call("accept").max_gas().transact().await?.into_result()?;
        assert_eq!(wait_value(&sender,"get_result",json!({"label":"old"})).await?,false,"actual old promise must not manufacture acceptance");
        if let Some((r,n))=next {
            assert_eq!(v(&c,"get_pending_transfer",json!({"token_id":"k1"})).await,n);
            assert_eq!(v(&c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],r.id().as_str());
            assert_eq!(v(&c,"pending_return_count",json!({"account_id":sender.id()})).await,1);
            r.call("accept").max_gas().transact().await?.into_result()?;
            assert_eq!(wait_value(&sender,"get_result",json!({"label":"new"})).await?,true);
            assert_eq!(v(&c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],r.id().as_str());
        }else{assert_eq!(v(&c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],sender.id().as_str());}
        assert_eq!(v(&c,"pending_return_count",json!({"account_id":sender.id()})).await,0);
    } Ok(())
}
async fn sale(w:&Worker<Sandbox>,deleted:bool)->Result<(Contract,Account,Account)> {
    let root=w.root_account()?;let c=w.dev_deploy(&std::fs::read(WASM)?).await?;
    let a=new_account(&root,"seller").await?;let b=new_account(&root,"buyer").await?;
    init(&c,&root).await?;mint(&c,&a).await?;
    c.call("claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    migrate(&c,&root).await?;
    register_payouts(&c,&root,&[a.id(),b.id()]).await?;
    a.call(c.id(),"nft_list").args_json(json!({"token_id":"k1","price":N.to_string()})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;
    if deleted{a.clone().delete_account(root.id()).await?.into_result()?;}
    let r=b.call(c.id(),"nft_buy").args_json(json!({"token_id":"k1"})).deposit(NearToken::from_near(1)).max_gas().transact().await?;
    assert!(r.receipt_failures().is_empty(),"sale records liability, not a failing push");
    assert_eq!(v(&c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],b.id().as_str());
    assert!(v(&c,"nft_listing",json!({"token_id":"k1"})).await.is_null());
    assert_eq!(v(&c,"get_payout_credit",json!({"account_id":a.id()})).await,(N+N/100).to_string());
    assert_eq!(v(&c,"get_pledge_config",json!({})).await["user_liabilities"],(N+N/100).to_string());
    Ok((c,a,b))
}
#[tokio::test]
async fn review3_deleted_seller_retains_exact_sale_and_bond_then_recreated_seller_claims()->Result<()> {
    let w=near_workspaces::sandbox().await?;let (c,_a,b)=sale(&w,true).await?;
    let recreated=new_account(&w.root_account()?,"seller").await?;let before=recreated.view_account().await?.balance.as_yoctonear();
    recreated.call(c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    w.fast_forward(2).await?; // Let unused prepaid gas refund land before measuring wallet delivery.
    assert!(recreated.view_account().await?.balance.as_yoctonear()>before+N);
    assert_eq!(v(&c,"get_payout_credit",json!({"account_id":recreated.id()})).await,"0");
    assert_eq!(v(&c,"get_pledge_config",json!({})).await["user_liabilities"],"0");
    assert_eq!(v(&c,"nft_token",json!({"token_id":"k1"})).await["owner_id"],b.id().as_str()); Ok(())
}
#[tokio::test]
async fn review3_sale_cashout_deleted_recipient_restores_once_or_stays_pending_if_callback_lost()->Result<()> {
    for lost in [false,true] {
        let w=near_workspaces::sandbox().await?;let (c,a,b)=sale(&w,false).await?;
        a.deploy(&std::fs::read("tests/fixtures/custody_policy_mock.wasm")?).await?.into_result()?;
        if lost {c.as_account().deploy(&std::fs::read("tests/fixtures/callback_failure.wasm")?).await?.into_result()?;}
        let r=a.call(a.id(),"claim_then_delete").args_json(json!({"keys":c.id(),"beneficiary":b.id()})).max_gas().transact().await?;
        assert!(format!("{:?}",r.receipt_failures()).contains("AccountDoesNotExist"));
        let credit=v(&c,"get_payout_credit",json!({"account_id":a.id()})).await;
        let pending=v(&c,"get_pending_payout",json!({"account_id":a.id()})).await;
        assert_eq!(credit,if lost{"0".to_string()}else{(N+N/100).to_string()});
        assert_eq!(pending.is_null(),!lost);
        if lost {assert_eq!(pending["amount"],(N+N/100).to_string());}
        assert_eq!(v(&c,"get_pledge_config",json!({})).await["user_liabilities"],(N+N/100).to_string());
        if lost {
            c.as_account().deploy(&std::fs::read(WASM)?).await?.into_result()?;
            let recreated=new_account(&w.root_account()?,"seller").await?;
            let retry=recreated.call(c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
            assert!(retry.is_failure());assert_eq!(v(&c,"get_pending_payout",json!({"account_id":a.id()})).await,pending);
        }
    } Ok(())
}
#[tokio::test]
async fn review3_sale_delivered_but_callback_lost_keeps_reserved_pending_and_cannot_pay_again()->Result<()> {
    let w=near_workspaces::sandbox().await?;let (c,a,_)=sale(&w,false).await?;
    c.as_account().deploy(&std::fs::read("tests/fixtures/callback_failure.wasm")?).await?.into_result()?;
    let before=a.view_account().await?.balance.as_yoctonear();
    let r=a.call(c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(format!("{:?}",r.receipt_failures()).contains("injected callback failure"));
    w.fast_forward(2).await?;
    assert!(a.view_account().await?.balance.as_yoctonear()>before+N);
    let pending=v(&c,"get_pending_payout",json!({"account_id":a.id()})).await;assert_eq!(pending["amount"],(N+N/100).to_string());
    assert_eq!(v(&c,"get_pledge_config",json!({})).await["user_liabilities"],(N+N/100).to_string());
    c.as_account().deploy(&std::fs::read(WASM)?).await?.into_result()?;
    let r=a.call(c.id(),"claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;assert!(r.is_failure());
    assert_eq!(v(&c,"get_pending_payout",json!({"account_id":a.id()})).await,pending); Ok(())
}
