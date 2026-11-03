//! Sandbox: deploy the exact mainnet v1 wasm, mint the 5 mainnet tokens, upgrade to v2,
//! migrate, and prove nothing moved. Then exercise every v2 path on a real runtime.
use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const V1: &str = "../keys/release/v1/keyhole_keys.wasm";
const V2: &str = "../keys/release/v2/keyhole_keys.wasm";
const MAINNET_OWNER: &str = "keyhole-devmo.near";

fn fixture() -> Vec<Value> {
    serde_json::from_str(include_str!("fixtures/mainnet_tokens.json")).unwrap()
}

async fn view(c: &Contract, m: &str, a: Value) -> Value {
    c.view(m).args_json(a).await.unwrap().json().unwrap()
}

struct Env { c: Contract, minter: Account, root: Account, ids: Vec<(String, String)> }

/// v1 on chain, initialised and minted exactly like mainnet (owner = treasury = the contract).
async fn v1_like_mainnet() -> anyhow::Result<Env> {
    let w = near_workspaces::sandbox().await?;
    let root = w.root_account()?;
    let c = w.dev_deploy(&std::fs::read(V1)?).await?;
    let minter = root.create_subaccount("minter").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let id = c.id().to_string();
    c.call("new").args_json(json!({"owner": id, "minter": minter.id(), "treasury": id, "royalty_bps": 500})).transact().await?.into_result()?;
    let mut ids = vec![];
    for t in fixture() {
        let owner = if t["owner_id"] == MAINNET_OWNER { id.clone() } else { t["owner_id"].as_str().unwrap().to_string() };
        minter.call(c.id(), "nft_mint")
            .args_json(json!({"token_id": t["token_id"], "receiver_id": owner, "tier": 1, "metadata": t["metadata"]}))
            .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
        ids.push((t["token_id"].as_str().unwrap().to_string(), owner));
    }
    for _ in 0..2 {
        minter.call(c.id(), "beat").args_json(json!({"token_ids": ids.iter().map(|x| x.0.clone()).collect::<Vec<_>>()})).transact().await?.into_result()?;
    }
    Ok(Env { c, minter, root, ids })
}

async fn upgrade(e: &Env) -> anyhow::Result<()> {
    e.c.as_account().deploy(&std::fs::read(V2)?).await?.into_result()?;
    e.c.call("migrate").max_gas().transact().await?.into_result()?;
    Ok(())
}

async fn snapshot(e: &Env) -> Value {
    let mut tiers = vec![];
    let mut holders = vec![];
    for (t, o) in &e.ids {
        tiers.push(view(&e.c, "nft_tier", json!({"token_id": t})).await);
        holders.push(view(&e.c, "holder_tier", json!({"account_id": o})).await);
        holders.push(view(&e.c, "nft_tokens_for_owner", json!({"account_id": o})).await);
    }
    let mut toks = view(&e.c, "nft_tokens", json!({})).await;
    for t in toks.as_array_mut().unwrap() { t.as_object_mut().unwrap().remove("approved_account_ids"); }
    for h in holders.iter_mut() { if let Some(a) = h.as_array_mut() { for t in a { t.as_object_mut().unwrap().remove("approved_account_ids"); } } }
    json!({
        "tokens": toks, "tiers": tiers, "holders": holders,
        "config": view(&e.c, "config", json!({})).await,
        "metadata": view(&e.c, "nft_metadata", json!({})).await,
        "supply": view(&e.c, "nft_total_supply", json!({})).await,
    })
}

#[tokio::test]
async fn upgrade_v1_to_v2_keeps_every_token_owner_tier_metadata_and_minter() -> anyhow::Result<()> {
    let e = v1_like_mainnet().await?;
    let before = snapshot(&e).await;
    assert_eq!(before["supply"], "5");
    assert_eq!(before["config"]["beats"], "2");
    let v1_tok = view(&e.c, "nft_token", json!({"token_id": "0"})).await;
    assert!(v1_tok["approved_account_ids"].is_null(), "v1 has no approvals");
    // v1 has no approval methods
    assert!(e.c.view("nft_is_approved").args_json(json!({"token_id": "0", "approved_account_id": "x.test.near"})).await.is_err());

    upgrade(&e).await?;
    let after = snapshot(&e).await;
    assert_eq!(before, after, "state identical across the upgrade");
    assert_eq!(after["config"]["minter"], e.minter.id().as_str());
    for (t, _) in &e.ids {
        let tok = view(&e.c, "nft_token", json!({"token_id": t})).await;
        assert_eq!(tok["approved_account_ids"], json!({}), "{t}: approvals on, empty");
        assert_eq!(view(&e.c, "nft_is_approved", json!({"token_id": t, "approved_account_id": "x.test.near"})).await, json!(false));
    }
    // NEP-330 lists the standards
    let src = view(&e.c, "contract_source_metadata", json!({})).await;
    let stds: Vec<String> = src["standards"].as_array().unwrap().iter().map(|s| s["standard"].as_str().unwrap().to_string()).collect();
    for s in ["nep171", "nep177", "nep178", "nep181", "nep199", "nep330"] { assert!(stds.contains(&s.to_string()), "{s} in {stds:?}"); }
    Ok(())
}

#[tokio::test]
async fn migrate_runs_once_and_only_as_self() -> anyhow::Result<()> {
    let e = v1_like_mainnet().await?;
    e.c.as_account().deploy(&std::fs::read(V2)?).await?.into_result()?;
    let r = e.root.call(e.c.id(), "migrate").max_gas().transact().await?;
    let err = format!("{:?}", r.into_result().unwrap_err());
    assert!(err.contains("migrate is private"), "{err}");
    e.c.call("migrate").max_gas().transact().await?.into_result()?;
    let r = e.c.call("migrate").max_gas().transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("already migrated"));
    assert_eq!(view(&e.c, "nft_total_supply", json!({})).await, "5");
    Ok(())
}

#[tokio::test]
async fn v2_one_key_nep178_and_a_real_royalty_sale() -> anyhow::Result<()> {
    let e = v1_like_mainnet().await?;
    upgrade(&e).await?;
    let mk = |n: &'static str| { let r = e.root.clone(); async move { r.create_subaccount(n).initial_balance(NearToken::from_near(5)).transact().await.unwrap().into_result().unwrap() } };
    let (seller, buyer, market, holder) = (mk("seller").await, mk("buyer").await, mk("market").await, mk("holder").await);
    let meta = fixture()[1]["metadata"].clone();
    let mint = |to: String, id: &'static str| { let (m, c, meta) = (e.minter.clone(), e.c.id().clone(), meta.clone()); async move {
        m.call(&c, "nft_mint").args_json(json!({"token_id": id, "receiver_id": to, "tier": 2, "metadata": meta})).deposit(NearToken::from_millinear(100)).max_gas().transact().await.unwrap()
    } };
    mint(seller.id().to_string(), "kseller").await.into_result()?;
    mint(holder.id().to_string(), "kholder").await.into_result()?;

    // one key per account: mint to a holder
    let r = mint(holder.id().to_string(), "ksecond").await;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("one key per account"));
    // ... and every transfer path into a holder
    for m in ["nft_transfer", "nft_transfer_call"] {
        let mut a = json!({"receiver_id": holder.id(), "token_id": "kseller"});
        if m == "nft_transfer_call" { a["msg"] = json!(""); }
        let r = seller.call(e.c.id(), m).args_json(a).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
        assert!(format!("{:?}", r.into_result().unwrap_err()).contains("one key per account"), "{m}");
    }
    let r = seller.call(e.c.id(), "nft_transfer_payout").args_json(json!({"receiver_id": holder.id(), "token_id": "kseller", "balance": "1000"})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("one key per account"));

    // NEP-178: approve (msg to an account with no code: the nft_on_approve XCC fails, approval stays)
    let r = seller.call(e.c.id(), "nft_approve").args_json(json!({"token_id": "kseller", "account_id": market.id(), "msg": "{\"price\":\"1\"}"})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?;
    // msg => the contract calls market.nft_on_approve. `market` has no code, so only that XCC receipt fails;
    // the approval itself is committed (NEP-178: the XCC is a notification).
    let err = format!("{:?}", r.into_result().unwrap_err());
    assert!(err.contains("CodeDoesNotExist") && err.contains(market.id().as_str()), "{err}");
    assert_eq!(view(&e.c, "nft_is_approved", json!({"token_id": "kseller", "approved_account_id": market.id(), "approval_id": 1})).await, json!(true));
    // non-owner cannot approve; stranger cannot transfer; wrong approval_id refused
    let r = market.call(e.c.id(), "nft_approve").args_json(json!({"token_id": "kseller", "account_id": market.id()})).deposit(NearToken::from_millinear(10)).transact().await?;
    assert!(r.is_failure());
    let r = holder.call(e.c.id(), "nft_transfer").args_json(json!({"receiver_id": buyer.id(), "token_id": "kseller"})).deposit(NearToken::from_yoctonear(1)).transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("Sender not approved"));
    let r = market.call(e.c.id(), "nft_transfer").args_json(json!({"receiver_id": buyer.id(), "token_id": "kseller", "approval_id": 9})).deposit(NearToken::from_yoctonear(1)).transact().await?;
    assert!(r.is_failure());

    // revoke then re-approve
    seller.call(e.c.id(), "nft_revoke").args_json(json!({"token_id": "kseller", "account_id": market.id()})).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    assert_eq!(view(&e.c, "nft_is_approved", json!({"token_id": "kseller", "approved_account_id": market.id()})).await, json!(false));
    seller.call(e.c.id(), "nft_approve").args_json(json!({"token_id": "kseller", "account_id": market.id()})).deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    seller.call(e.c.id(), "nft_approve").args_json(json!({"token_id": "kseller", "account_id": holder.id()})).deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;

    // the sale: market moves the key with nft_transfer_payout, then pays out exactly what it returned
    let price: u128 = NearToken::from_millinear(100).as_yoctonear();
    let r = market.call(e.c.id(), "nft_transfer_payout")
        .args_json(json!({"receiver_id": buyer.id(), "token_id": "kseller", "approval_id": 2, "balance": price.to_string(), "max_len_payout": 10}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    let payout: Value = r.json()?;
    let p = &payout["payout"];
    assert_eq!(p[e.c.id().as_str()], (price / 20).to_string(), "5% to the treasury");
    assert_eq!(p[seller.id().as_str()], (price - price / 20).to_string(), "95% to the seller");
    assert!(r.logs().iter().any(|l| l.contains("\"authorized_id\"") && l.contains(market.id().as_str())));
    let tok = view(&e.c, "nft_token", json!({"token_id": "kseller"})).await;
    assert_eq!(tok["owner_id"], buyer.id().as_str());
    assert_eq!(tok["approved_account_ids"], json!({}), "approvals cleared");
    let s0 = seller.view_account().await?.balance;
    market.transfer_near(seller.id(), NearToken::from_yoctonear(price - price / 20)).await?.into_result()?;
    assert!(seller.view_account().await?.balance.as_yoctonear() > s0.as_yoctonear() + price - price / 20 - 1, "seller paid");
    // old approvals are dead after the sale
    let r = holder.call(e.c.id(), "nft_transfer").args_json(json!({"receiver_id": seller.id(), "token_id": "kseller"})).deposit(NearToken::from_yoctonear(1)).transact().await?;
    assert!(r.is_failure());
    // holder_tier follows; the seller can hold a key again
    assert_eq!(view(&e.c, "holder_tier", json!({"account_id": buyer.id()})).await, json!(2));
    assert_eq!(view(&e.c, "holder_tier", json!({"account_id": seller.id()})).await, Value::Null);
    buyer.call(e.c.id(), "nft_transfer").args_json(json!({"receiver_id": seller.id(), "token_id": "kseller"})).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    assert_eq!(view(&e.c, "nft_supply_for_owner", json!({"account_id": seller.id()})).await, "1");
    // revoke_all
    seller.call(e.c.id(), "nft_approve").args_json(json!({"token_id": "kseller", "account_id": market.id()})).deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    seller.call(e.c.id(), "nft_revoke_all").args_json(json!({"token_id": "kseller"})).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    assert_eq!(view(&e.c, "nft_token", json!({"token_id": "kseller"})).await["approved_account_ids"], json!({}));
    // the 5 mainnet tokens are untouched by all of this
    assert_eq!(view(&e.c, "nft_total_supply", json!({})).await, "7");
    for (t, o) in &e.ids { assert_eq!(view(&e.c, "nft_token", json!({"token_id": t})).await["owner_id"], o.as_str()); }
    Ok(())
}
