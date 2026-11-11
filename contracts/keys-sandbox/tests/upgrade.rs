#[path="support/payout_storage.rs"] mod payout_storage;
use payout_storage::register_payouts;
// Sandbox: deploy the exact mainnet v1 wasm, mint the 5 mainnet tokens, upgrade to v2,
// migrate, and prove nothing moved. Then exercise every v2 path on a real runtime.
use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const V1: &str = "../keys/release/v1/keyhole_keys.wasm";
const V2_0: &str = "../keys/release/v2/keyhole_keys.wasm";
const V2_1: &str = "../keys/release/v2.1/keyhole_keys.wasm";
const V2: &str = "../keys/release/v2.2/keyhole_keys.wasm";
const V2_3: &str = "../keys/release/v2.3/keyhole_keys.wasm";
const V2_4: &str = "../keys/release/v2.4/keyhole_keys.wasm";
const V2_5: &str = "../keys/release/v2.5/keyhole_keys.wasm";
const V2_6: &str = "../keys/release/v2.6/keyhole_keys.wasm";
const MAINNET_OWNER: &str = "keyhole-devmo.near";

fn fixture() -> Vec<Value> {
    serde_json::from_str(include_str!("fixtures/mainnet_tokens.json")).unwrap()
}

async fn view(c: &Contract, m: &str, a: Value) -> Value {
    c.view(m).args_json(a).await.unwrap().json().unwrap()
}

struct Env { c: Contract, minter: Account, root: Account, ids: Vec<(String, String)>, w: near_workspaces::Worker<near_workspaces::network::Sandbox> }

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
    Ok(Env { c, minter, root, ids, w })
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
    let ev: Vec<&str> = r.logs().into_iter().filter(|l| l.contains("\"nft_transfer\"")).collect();
    assert_eq!(ev.len(), 1, "one nft_transfer event per sale: {ev:?}");
    assert!(ev[0].contains(&format!("\"authorized_id\":\"{}\"", market.id())));
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

/// The mainnet path: v1 -> v2 (+migrate) -> v2.1 -> v2.2 (code only, no migrate). State survives every step.
#[tokio::test]
async fn mainnet_path_v1_v2_v2_1_keeps_state() -> anyhow::Result<()> {
    let e = v1_like_mainnet().await?;
    let before = snapshot(&e).await;
    e.c.as_account().deploy(&std::fs::read(V2_0)?).await?.into_result()?;
    e.c.call("migrate").max_gas().transact().await?.into_result()?;
    e.c.as_account().deploy(&std::fs::read(V2_1)?).await?.into_result()?;
    assert_eq!(before, snapshot(&e).await);
    e.c.as_account().deploy(&std::fs::read(V2)?).await?.into_result()?;
    assert_eq!(before, snapshot(&e).await);
    let r = e.c.call("migrate").max_gas().transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("already migrated"));
    assert_eq!(view(&e.c, "nft_is_approved", json!({"token_id": "0", "approved_account_id": "x.test.near"})).await, json!(false));
    Ok(())
}

/// The nft_transfer_call race. alice sends k1 to a receiver contract with nft_transfer_call.
/// Inside nft_on_transfer the receiver (approved by carol for k2) hands k2 to alice, then asks
/// for k1 back. Returns (alice's key count, k2 owner).
async fn race(wasm: &str) -> anyhow::Result<(String, String)> {
    let w = near_workspaces::sandbox().await?;
    let root = w.root_account()?;
    let c = w.dev_deploy(&std::fs::read(wasm)?).await?;
    let mk = |n: &'static str| { let r = root.clone(); async move { r.create_subaccount(n).initial_balance(NearToken::from_near(5)).transact().await.unwrap().into_result().unwrap() } };
    let (minter, alice, carol) = (mk("minter").await, mk("alice").await, mk("carol").await);
    let recv = root.create_subaccount("recv").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?
        .deploy(include_bytes!("fixtures/race_receiver.wasm")).await?.into_result()?;
    c.call("new").args_json(json!({"owner": c.id(), "minter": minter.id(), "treasury": c.id(), "royalty_bps": 500})).transact().await?.into_result()?;
    for (id, to) in [("k1", alice.id()), ("k2", carol.id())] {
        minter.call(c.id(), "nft_mint").args_json(json!({"token_id": id, "receiver_id": to, "tier": 1, "metadata": fixture()[1]["metadata"]}))
            .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
    }
    carol.call(c.id(), "nft_approve").args_json(json!({"token_id": "k2", "account_id": recv.id()})).deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    let _ = alice.call(c.id(), "nft_transfer_call")
        .args_json(json!({"receiver_id": recv.id(), "token_id": "k1", "msg": json!({"keys": c.id(), "other_token": "k2"}).to_string()}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    let n: String = c.view("nft_supply_for_owner").args_json(json!({"account_id": alice.id()})).await?.json()?;
    let k2: Value = c.view("nft_token").args_json(json!({"token_id": "k2"})).await?.json()?;
    assert_eq!(c.view("nft_token").args_json(json!({"token_id": "k1"})).await?.json::<Value>()?["owner_id"], alice.id().as_str(), "k1 returned");
    let pending: Value = c.view("pending_return_count").args_json(json!({"account_id": alice.id()})).await.map(|r| r.json().unwrap()).unwrap_or(Value::Null);
    if !pending.is_null() { assert_eq!(pending, json!(0), "marker cleared after resolve"); }
    Ok((n, if k2["owner_id"] == alice.id().as_str() { "alice".into() } else { "carol".into() }))
}

#[tokio::test]
async fn transfer_call_race_reaches_two_keys_on_v2_1() -> anyhow::Result<()> {
    assert_eq!(race(V2_1).await?, ("2".to_string(), "alice".to_string()), "the race v2.2 closes");
    Ok(())
}

#[tokio::test]
async fn transfer_call_race_is_closed_on_v2_2() -> anyhow::Result<()> {
    assert_eq!(race(V2).await?, ("1".to_string(), "carol".to_string()), "inner transfer refused, k1 back, one key");
    Ok(())
}

/// v2.3 (code only, on top of v2.2). The state is built on v2.2 the way the v2 tests build it:
/// the 5 mainnet tokens, a key with approvals, a royalty of 7%, beats, one key per account.
struct V22 { e: Env, root: Account, seller: Account, buyer: Account, market: Account, holder: Account }

async fn mk(root: &Account, name: &str) -> Account {
    root.create_subaccount(name).initial_balance(NearToken::from_near(5)).transact().await.unwrap().into_result().unwrap()
}

fn approval_count(t: &Value) -> usize {
    t["approved_account_ids"].as_object().map(|m| m.len()).unwrap_or(0)
}

async fn v22_with_state() -> anyhow::Result<V22> {
    let w = near_workspaces::sandbox().await?;
    let root = w.root_account()?;
    let c = w.dev_deploy(&std::fs::read(V2)?).await?;
    let minter = root.create_subaccount("minter").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let id = c.id().to_string();
    c.call("new").args_json(json!({"owner": id, "minter": minter.id(), "treasury": id, "royalty_bps": 500})).transact().await?.into_result()?;
    let mut ids = vec![];
    for (n, t) in fixture().into_iter().enumerate() {
        let owner = if t["owner_id"] == MAINNET_OWNER { id.clone() } else { t["owner_id"].as_str().unwrap().to_string() };
        minter.call(c.id(), "nft_mint")
            .args_json(json!({"token_id": t["token_id"], "receiver_id": owner, "tier": (n % 3) + 1, "metadata": t["metadata"]}))
            .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
        ids.push((t["token_id"].as_str().unwrap().to_string(), owner));
    }
    for _ in 0..2 {
        minter.call(c.id(), "beat").args_json(json!({"token_ids": ids.iter().map(|x| x.0.clone()).collect::<Vec<_>>()})).transact().await?.into_result()?;
    }
    let (seller, buyer, market, holder) = (mk(&root, "seller").await, mk(&root, "buyer").await, mk(&root, "market").await, mk(&root, "holder").await);
    let meta = fixture()[1]["metadata"].clone();
    for (to, token, tier) in [(seller.id().clone(), "kseller", 2), (holder.id().clone(), "kholder", 3)] {
        minter.call(c.id(), "nft_mint")
            .args_json(json!({"token_id": token, "receiver_id": to, "tier": tier, "metadata": meta}))
            .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
    }
    for who in [market.id().clone(), buyer.id().clone()] {
        seller.call(c.id(), "nft_approve").args_json(json!({"token_id": "kseller", "account_id": who}))
            .deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    }
    c.call("set_royalty").args_json(json!({"treasury": format!("royalty.{}", root.id()), "royalty_bps": 700}))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    Ok(V22 { e: Env { c, minter, root: root.clone(), ids, w }, root, seller, buyer, market, holder })
}

/// Everything a holder or buyer can read, with approvals, payouts and holder state included.
async fn full_snapshot(s: &V22) -> Value {
    let c = &s.e.c;
    let mut owners: Vec<String> = s.e.ids.iter().map(|(_, o)| o.clone()).collect();
    owners.extend([s.seller.id(), s.buyer.id(), s.market.id(), s.holder.id()].iter().map(|a| a.to_string()));
    let mut holders = vec![];
    for o in &owners {
        holders.push(json!({
            "account": o,
            "holder_tier": view(c, "holder_tier", json!({"account_id": o})).await,
            "tokens": view(c, "nft_tokens_for_owner", json!({"account_id": o})).await,
            "supply": view(c, "nft_supply_for_owner", json!({"account_id": o})).await,
            "pending": view(c, "pending_return_count", json!({"account_id": o})).await,
        }));
    }
    let toks = view(c, "nft_tokens", json!({})).await;
    let mut tiers = vec![];
    let mut payouts = vec![];
    for t in toks.as_array().unwrap() {
        let id = t["token_id"].as_str().unwrap();
        tiers.push(view(c, "nft_tier", json!({"token_id": id})).await);
        payouts.push(view(c, "nft_payout", json!({"token_id": id, "balance": "10000", "max_len_payout": 10})).await);
    }
    json!({
        "tokens": toks, "tiers": tiers, "payouts": payouts, "holders": holders,
        "config": view(c, "config", json!({})).await,
        "metadata": view(c, "nft_metadata", json!({})).await,
        "supply": view(c, "nft_total_supply", json!({})).await,
    })
}

#[tokio::test]
async fn v2_3_is_a_code_only_upgrade_of_v2_2() -> anyhow::Result<()> {
    let s = v22_with_state().await?;
    let before = full_snapshot(&s).await;
    assert_eq!(before["supply"], "7");
    assert_eq!(before["config"]["royalty_bps"], 700);
    assert_eq!(before["config"]["beats"], "2");
    let kseller = before["tokens"].as_array().unwrap().iter().find(|t| t["token_id"] == "kseller").unwrap().clone();
    assert_eq!(approval_count(&kseller), 2, "two approvals before the upgrade");

    // code only: the same account, live state, no migrate call
    s.e.c.as_account().deploy(&std::fs::read(V2_3)?).await?.into_result()?;
    assert_eq!(before, full_snapshot(&s).await, "every token, owner, tier, approval, payout, holder and config value is unchanged");

    // NEP-330 reports 2.3.0 and the link; the standards list is unchanged
    let src = view(&s.e.c, "contract_source_metadata", json!({})).await;
    assert_eq!(src["version"], "2.3.0");
    assert_eq!(src["link"], "https://github.com/mohamedwael201193/keyhole");
    let stds: Vec<String> = src["standards"].as_array().unwrap().iter().map(|x| x["standard"].as_str().unwrap().to_string()).collect();
    assert_eq!(stds, ["nep171", "nep177", "nep178", "nep181", "nep199", "nep330"], "standards list");

    // migrate stays one-shot: a second call is refused and changes nothing
    let r = s.e.c.call("migrate").max_gas().transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("already migrated"));
    assert_eq!(full_snapshot(&s).await, before);
    Ok(())
}

#[tokio::test]
async fn v2_3_approval_cap_one_key_and_transfers_work_after_upgrade() -> anyhow::Result<()> {
    let s = v22_with_state().await?;
    s.e.c.as_account().deploy(&std::fs::read(V2_3)?).await?.into_result()?;
    let c = s.e.c.id().clone();
    let root_id = s.root.id().to_string();

    // NEP-178 cap: kseller holds 2 approvals; 8 more make 10. The 11th is refused; re-approving one at the cap is fine.
    for i in 0..8 {
        s.seller.call(&c, "nft_approve").args_json(json!({"token_id": "kseller", "account_id": format!("cap{i}.{root_id}")}))
            .deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    }
    let t = view(&s.e.c, "nft_token", json!({"token_id": "kseller"})).await;
    assert_eq!(approval_count(&t), 10, "at the cap");
    let r = s.seller.call(&c, "nft_approve").args_json(json!({"token_id": "kseller", "account_id": format!("cap8.{root_id}")}))
        .deposit(NearToken::from_millinear(10)).transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("approval cap reached"), "11th refused");
    s.seller.call(&c, "nft_approve").args_json(json!({"token_id": "kseller", "account_id": s.market.id()}))
        .deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    let t = view(&s.e.c, "nft_token", json!({"token_id": "kseller"})).await;
    assert_eq!(approval_count(&t), 10, "re-approve keeps the count");
    assert_eq!(t["approved_account_ids"][s.market.id().as_str()], 11, "fresh approval id");
    s.seller.call(&c, "nft_revoke").args_json(json!({"token_id": "kseller", "account_id": format!("cap0.{root_id}")}))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    s.seller.call(&c, "nft_approve").args_json(json!({"token_id": "kseller", "account_id": format!("cap8.{root_id}")}))
        .deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    assert_eq!(view(&s.e.c, "nft_is_approved", json!({"token_id": "kseller", "approved_account_id": format!("cap8.{root_id}")})).await, json!(true));

    // one key per account still holds: mint to a holder, transfer into a holder
    let r = s.e.minter.call(&c, "nft_mint").args_json(json!({"token_id": "kdup", "receiver_id": s.holder.id(), "tier": 1, "metadata": fixture()[1]["metadata"]}))
        .deposit(NearToken::from_millinear(100)).max_gas().transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("one key per account"));
    let r = s.seller.call(&c, "nft_transfer").args_json(json!({"receiver_id": s.holder.id(), "token_id": "kseller"}))
        .deposit(NearToken::from_yoctonear(1)).transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("one key per account"));

    // plain transfer: the holder gives its key to the buyer, who holds none
    s.holder.call(&c, "nft_transfer").args_json(json!({"receiver_id": s.buyer.id(), "token_id": "kholder"}))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    assert_eq!(view(&s.e.c, "holder_tier", json!({"account_id": s.holder.id()})).await, Value::Null);
    assert_eq!(view(&s.e.c, "holder_tier", json!({"account_id": s.buyer.id()})).await, json!(3));

    // marketplace sale of kseller to the now-empty holder: approved market, payout 7% to the royalty account, rest to the seller
    let price: u128 = NearToken::from_millinear(100).as_yoctonear();
    let r = s.market.call(&c, "nft_transfer_payout")
        .args_json(json!({"receiver_id": s.holder.id(), "token_id": "kseller", "balance": price.to_string(), "max_len_payout": 10}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    let p: Value = r.json()?;
    assert_eq!(p["payout"][format!("royalty.{root_id}")], (price * 7 / 100).to_string());
    assert_eq!(p["payout"][s.seller.id().as_str()], (price - price * 7 / 100).to_string());
    assert_eq!(view(&s.e.c, "nft_token", json!({"token_id": "kseller"})).await["owner_id"], s.holder.id().as_str());

    // nft_transfer_call still works. The receiver (race-receiver fixture, holds no key) names an unknown token,
    // so its inner transfer fails; its callback still returns the key to the holder.
    let recv = s.root.create_subaccount("recv").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?
        .deploy(include_bytes!("fixtures/race_receiver.wasm")).await?.into_result()?;
    let msg = json!({"keys": c.as_str(), "other_token": "none"}).to_string();
    let _ = s.holder.call(&c, "nft_transfer_call").args_json(json!({"receiver_id": recv.id(), "token_id": "kseller", "msg": msg}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert_eq!(view(&s.e.c, "nft_token", json!({"token_id": "kseller"})).await["owner_id"], s.holder.id().as_str(), "key returned");
    assert_eq!(view(&s.e.c, "pending_return_count", json!({"account_id": s.holder.id()})).await, json!(0));

    // the 5 mainnet tokens and the supply are untouched by all of this
    assert_eq!(view(&s.e.c, "nft_total_supply", json!({})).await, "7");
    for (t, o) in &s.e.ids { assert_eq!(view(&s.e.c, "nft_token", json!({"token_id": t})).await["owner_id"], o.as_str()); }
    Ok(())
}

/// v2.4 (code only, on top of v2.3). The mainnet path: v1 -> v2.2 (+migrate) -> v2.3 -> v2.4, state built on each step.
/// The raise is minter-only and upward-only; the state snapshot is identical before and after the code-only deploy.
#[tokio::test]
async fn v2_4_set_tier_is_code_only_and_minter_only() -> anyhow::Result<()> {
    let e = v1_like_mainnet().await?;
    upgrade(&e).await?;
    e.c.as_account().deploy(&std::fs::read(V2_3)?).await?.into_result()?;
    let before = snapshot(&e).await;
    assert_eq!(before["supply"], "5");

    e.c.as_account().deploy(&std::fs::read(V2_4)?).await?.into_result()?;
    assert_eq!(before, snapshot(&e).await, "every token, owner, tier, holder, config and metadata value is unchanged");
    let src = view(&e.c, "contract_source_metadata", json!({})).await;
    assert_eq!(src["version"], "2.4.0");
    let stds: Vec<String> = src["standards"].as_array().unwrap().iter().map(|x| x["standard"].as_str().unwrap().to_string()).collect();
    assert_eq!(stds, ["nep171", "nep177", "nep178", "nep181", "nep199", "nep330"], "standards list unchanged");

    let (t, o) = e.ids[0].clone();
    assert_eq!(view(&e.c, "nft_tier", json!({"token_id": t})).await, json!(1));

    // a non-minter, the contract's own account (owner and treasury) included, cannot raise a tier
    let r = e.root.call(e.c.id(), "nft_set_tier").args_json(json!({"token_id": t, "tier": 2})).transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("only minter"));
    let r = e.c.as_account().call(e.c.id(), "nft_set_tier").args_json(json!({"token_id": t, "tier": 2})).transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("only minter"));

    // the minter raises 1 -> 2; the event names the token; holder_tier follows
    let r = e.minter.call(e.c.id(), "nft_set_tier").args_json(json!({"token_id": t, "tier": 2})).max_gas().transact().await?.into_result()?;
    let ev: Vec<&str> = r.logs().into_iter().filter(|l| l.contains("nft_metadata_update")).collect();
    assert_eq!(ev, vec![format!(r#"EVENT_JSON:{{"standard":"nep171","version":"1.2.0","event":"nft_metadata_update","data":[{{"token_ids":["{t}"]}}]}}"#)], "one metadata update for the token");
    assert_eq!(view(&e.c, "nft_tier", json!({"token_id": t})).await, json!(2));
    assert_eq!(view(&e.c, "holder_tier", json!({"account_id": o})).await, json!(2));

    // upward only, bounded, token must exist; refused calls change nothing
    for (tier, want) in [(2, "tier only goes up"), (1, "tier only goes up"), (0, "bad tier"), (4, "bad tier")] {
        let r = e.minter.call(e.c.id(), "nft_set_tier").args_json(json!({"token_id": t, "tier": tier})).transact().await?;
        assert!(format!("{:?}", r.into_result().unwrap_err()).contains(want), "tier {tier}");
    }
    let r = e.minter.call(e.c.id(), "nft_set_tier").args_json(json!({"token_id": "no-such-key", "tier": 2})).transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("no token"));
    assert_eq!(view(&e.c, "nft_tier", json!({"token_id": t})).await, json!(2));

    // a second key goes to 3; supply and beats do not move
    let (t2, _) = e.ids[1].clone();
    e.minter.call(e.c.id(), "nft_set_tier").args_json(json!({"token_id": t2, "tier": 3})).transact().await?.into_result()?;
    assert_eq!(view(&e.c, "nft_tier", json!({"token_id": t2})).await, json!(3));
    assert_eq!(view(&e.c, "nft_total_supply", json!({})).await, "5");
    assert_eq!(view(&e.c, "config", json!({})).await["beats"], "2", "a tier raise is not a beat");
    Ok(())
}

/// NEAR credits the contract with a share of the gas burnt by its calls (gas rewards), so the contract's own balance
/// is checked as "the deposit, less or plus at most this". The seller-side amounts in the sale are the exact checks.
const GAS_REWARD_SLACK: u128 = 10u128.pow(21);

/// Liquid balance of an account, read on chain.
async fn bal(a: &Account) -> u128 {
    a.view_account().await.unwrap().balance.as_yoctonear()
}

/// The NEP-297 payloads in a receipt's logs (EVENT_JSON: lines).
fn event_json(logs: &[&str]) -> Vec<Value> {
    logs.iter().filter_map(|l| l.strip_prefix("EVENT_JSON:")).map(|j| serde_json::from_str(j).unwrap()).collect()
}

/// v2.4 (code only, on top of v2.3): the built-in key sale on a real runtime. A key is listed, bought between two
/// sandbox accounts and listed and unlisted again. Seller and treasury amounts are exact (neither signs the buy).
/// The buyer pays the price plus gas. The contract's own balance moves by exactly the listing deposit.
#[tokio::test]
async fn v2_4_sale_settles_real_balances() -> anyhow::Result<()> {
    let e = v1_like_mainnet().await?;
    upgrade(&e).await?;
    let root = e.root.clone();
    let treasury = root.create_subaccount("treasury").initial_balance(NearToken::from_near(2)).transact().await?.into_result()?;
    e.c.call("set_royalty").args_json(json!({"treasury": treasury.id(), "royalty_bps": 500}))
        .deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    e.c.as_account().deploy(&std::fs::read(V2_3)?).await?.into_result()?;
    let before = snapshot(&e).await;
    e.c.as_account().deploy(&std::fs::read(V2_4)?).await?.into_result()?;
    assert_eq!(before, snapshot(&e).await, "code only: every token, owner, tier, holder, config and metadata value is unchanged");

    let (seller, buyer) = (mk(&root, "seller").await, mk(&root, "buyer").await);
    let c = e.c.id().clone();
    let price = NearToken::from_near(1).as_yoctonear();
    let dep = NearToken::from_millinear(10).as_yoctonear(); // 0.01 NEAR: LIST_STORAGE_DEPOSIT
    e.minter.call(&c, "nft_mint")
        .args_json(json!({"token_id": "ksale", "receiver_id": seller.id(), "tier": 2, "metadata": fixture()[1]["metadata"]}))
        .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;

    // list: the contract holds exactly the deposit; the event and the view agree
    let k0 = bal(e.c.as_account()).await;
    let r = seller.call(&c, "nft_list").args_json(json!({"token_id": "ksale", "price": price.to_string()}))
        .deposit(NearToken::from_yoctonear(dep)).max_gas().transact().await?.into_result()?;
    // The unused prepaid gas of this call is refunded to the seller in a receipt that lands in the next block.
    // Let it land before any balance is read, or the buy below would be credited with it.
    e.w.fast_forward(2).await?;
    let gained = bal(e.c.as_account()).await - k0;
    assert!(gained >= dep && gained < dep + GAS_REWARD_SLACK, "the contract holds the listing deposit (plus its gas reward): {gained}");
    let ev = event_json(&r.logs());
    assert_eq!(ev.len(), 1, "{ev:?}");
    assert_eq!(ev[0], json!({"standard": "keyhole", "version": "1.0.0", "event": "key_list",
        "data": [{"token_id": "ksale", "seller": seller.id(), "price": price.to_string()}]}));
    assert_eq!(view(&e.c, "nft_listing", json!({"token_id": "ksale"})).await,
        json!({"token_id": "ksale", "seller": seller.id(), "price": price.to_string()}));
    assert_eq!(view(&e.c, "nft_listings", json!({})).await.as_array().unwrap().len(), 1);

    // buy with 1.2 NEAR: 1 NEAR price, 0.2 NEAR back to the buyer
    let (s0, t0, b0, k1) = (bal(&seller).await, bal(&treasury).await, bal(&buyer).await, bal(e.c.as_account()).await);
    let attached = price + price / 5;
    let r = buyer.call(&c, "nft_buy").args_json(json!({"token_id": "ksale"}))
        .deposit(NearToken::from_yoctonear(attached)).max_gas().transact().await?.into_result()?;
    let (s1, t1, b1, k2) = (bal(&seller).await, bal(&treasury).await, bal(&buyer).await, bal(e.c.as_account()).await);
    assert_eq!(s1 - s0, price - price / 20 + dep, "seller: price - 5% royalty + the listing deposit");
    assert_eq!(t1 - t0, price / 20, "treasury: 5% royalty");
    let moved = k1 - k2; // in 1.2, out 0.96 + 0.05 + 0.2: net -deposit, less the contract's gas reward
    assert!(moved <= dep && moved + GAS_REWARD_SLACK > dep, "the contract pays out the listing deposit: {moved}");
    let spent_beyond_price = (b0 as i128) - (b1 as i128) - (price as i128);
    assert!(spent_beyond_price > 0 && spent_beyond_price < dep as i128, "buyer pays the price plus gas only: {spent_beyond_price}");
    let ev = event_json(&r.logs());
    let sale: Vec<&Value> = ev.iter().filter(|v| v["event"] == "key_sale").collect();
    assert_eq!(sale.len(), 1, "{ev:?}");
    assert_eq!(sale[0]["data"][0], json!({"token_id": "ksale", "seller": seller.id(), "buyer": buyer.id(),
        "price": price.to_string(), "royalty": (price / 20).to_string()}));
    let tr: Vec<&Value> = ev.iter().filter(|v| v["event"] == "nft_transfer").collect();
    assert_eq!(tr.len(), 1, "one nft_transfer per sale");
    assert_eq!(tr[0]["data"][0]["memo"], "sale");
    assert!(tr[0]["data"][0].get("authorized_id").is_none(), "owner-listed sale names no approved account");

    // the old owner's key is gone; the listing is gone
    assert_eq!(view(&e.c, "nft_token", json!({"token_id": "ksale"})).await["owner_id"], buyer.id().as_str());
    assert_eq!(view(&e.c, "nft_supply_for_owner", json!({"account_id": seller.id()})).await, "0");
    assert_eq!(view(&e.c, "holder_tier", json!({"account_id": seller.id()})).await, Value::Null);
    assert_eq!(view(&e.c, "holder_tier", json!({"account_id": buyer.id()})).await, json!(2));
    assert_eq!(view(&e.c, "nft_listing", json!({"token_id": "ksale"})).await, Value::Null);
    assert_eq!(view(&e.c, "nft_listings", json!({})).await, json!([]));

    // the buyer, now the owner, lists again and unlists: the contract pays back exactly the deposit
    buyer.call(&c, "nft_list").args_json(json!({"token_id": "ksale", "price": (2 * price).to_string()}))
        .deposit(NearToken::from_yoctonear(dep)).max_gas().transact().await?.into_result()?;
    let k3 = bal(e.c.as_account()).await;
    let r = buyer.call(&c, "nft_unlist").args_json(json!({"token_id": "ksale"}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    let out = k3 - bal(e.c.as_account()).await;
    assert!(out <= dep && out + GAS_REWARD_SLACK > dep, "unlist refunds the deposit: {out}");
    let ev = event_json(&r.logs());
    assert!(ev.iter().any(|v| v["event"] == "key_unlist"), "{ev:?}");
    assert_eq!(view(&e.c, "nft_listing", json!({"token_id": "ksale"})).await, Value::Null);

    // a listing ends when the owner transfers the key: the deposit goes back to the seller who listed it
    buyer.call(&c, "nft_list").args_json(json!({"token_id": "ksale", "price": price.to_string()}))
        .deposit(NearToken::from_yoctonear(dep)).max_gas().transact().await?.into_result()?;
    let k4 = bal(e.c.as_account()).await;
    buyer.call(&c, "nft_transfer").args_json(json!({"receiver_id": seller.id(), "token_id": "ksale"}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    let out = k4 - bal(e.c.as_account()).await;
    assert!(out <= dep && out + GAS_REWARD_SLACK > dep, "the listing deposit goes back on transfer: {out}");
    assert_eq!(view(&e.c, "nft_listing", json!({"token_id": "ksale"})).await, Value::Null);
    assert_eq!(view(&e.c, "nft_token", json!({"token_id": "ksale"})).await["owner_id"], seller.id().as_str());

    // the 5 mainnet tokens are untouched by the sale
    assert_eq!(view(&e.c, "nft_total_supply", json!({})).await, "6");
    for (t, o) in &e.ids { assert_eq!(view(&e.c, "nft_token", json!({"token_id": t})).await["owner_id"], o.as_str()); }
    Ok(())
}


/// v2.5 code-only: admission barrier + owner epoch + pledge metadata. Existing tokens unchanged; pending op blocks transfer.
#[tokio::test]
async fn v2_5_admission_barrier_and_epoch_code_only() -> anyhow::Result<()> {
    let e = v1_like_mainnet().await?;
    upgrade(&e).await?;
    e.c.as_account().deploy(&std::fs::read(V2_3)?).await?.into_result()?;
    e.c.as_account().deploy(&std::fs::read(V2_4)?).await?.into_result()?;
    let before = snapshot(&e).await;
    e.c.as_account().deploy(&std::fs::read(V2_5)?).await?.into_result()?;
    assert_eq!(before, snapshot(&e).await, "code only");
    let src = view(&e.c, "contract_source_metadata", json!({})).await;
    assert_eq!(src["version"], "2.5.0");
    for (t, _) in &e.ids {
        assert_eq!(view(&e.c, "nft_settlement_epoch", json!({"token_id": t})).await, "0");
        assert_eq!(view(&e.c, "pending_value_op_count", json!({"token_id": t})).await, "0");
    }
    let root = e.root.clone();
    let alice = mk(&root, "alice").await;
    let bob = mk(&root, "bob").await;
    let c = e.c.id().clone();
    register_payouts(&e.c,&root,&[e.minter.id()]).await?;
    e.minter.call(&c, "nft_mint")
        .args_json(json!({"token_id": "kadm", "receiver_id": alice.id(), "tier": 2, "metadata": fixture()[1]["metadata"]}))
        .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
    e.minter.call(&c, "begin_value_op")
        .args_json(json!({"token_id": "kadm", "epoch": "0", "op_id": "1:op1", "action_hash": "ah", "owner_id": alice.id()}))
        .deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&e.c, "pending_value_op_count", json!({"token_id": "kadm"})).await, "1");
    let r = alice.call(&c, "nft_transfer").args_json(json!({"receiver_id": bob.id(), "token_id": "kadm"}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("value-op pending"));
    e.minter.call(&c, "finish_value_op")
        .args_json(json!({"token_id": "kadm", "op_id": "1:op1", "success": true}))
        .max_gas().transact().await?.into_result()?;
    alice.call(&c, "nft_transfer").args_json(json!({"receiver_id": bob.id(), "token_id": "kadm"}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&e.c, "nft_settlement_epoch", json!({"token_id": "kadm"})).await, "1");
    assert_eq!(view(&e.c, "nft_token", json!({"token_id": "kadm"})).await["owner_id"], bob.id().as_str());
    // Lending is disabled until a separately approved one-time pledge migration.
    assert!(view(&e.c, "get_loan", json!({"token_id":"kadm"})).await.is_null());
    assert!(view(&e.c, "get_pledge_config", json!({})).await.is_null());
    Ok(())
}

/// Ordinary existing UI/CLI journeys on candidate bytecode, starting with NO prepaid accounts.
#[tokio::test]
async fn candidate_unregistered_minter_sale_unlist_buy_and_approval_refunds_cash_out() -> anyhow::Result<()> {
    let w=near_workspaces::sandbox().await?;let root=w.root_account()?;
    let c=w.dev_deploy(&std::fs::read(V2_5)?).await?;
    c.call("new").args_json(json!({"owner":c.id(),"minter":root.id(),"treasury":c.id(),"royalty_bps":0})).transact().await?.into_result()?;
    let seller=root.create_subaccount("slot-seller").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let buyer=root.create_subaccount("slot-buyer").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let market=root.create_subaccount("slot-market").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    // Match the hosted worker: 17-byte id, full artwork metadata, 0.012 NEAR / 20 Tgas mint and 70 Tgas cashout.
    let mint=json!({"token_id":"k0123456789abcdef","receiver_id":seller.id(),"tier":1,"metadata":{"title":"KEYHOLE Key · Bronze","description":"Viewing key to a confidential account. Holder-only, attested in a TEE.","copies":1,"media":"https://keyhole-seven.vercel.app/heirloom/keys/k01.webp","media_hash":"9HSWMftzPmAPsHnX52j2CxUHKywOQxlTq0q+eaI5bYQ="}});
    let refused=root.call(c.id(),"nft_mint").args_json(mint.clone()).deposit(NearToken::from_millinear(12)).gas(near_workspaces::types::Gas::from_tgas(20)).transact().await?;
    assert!(format!("{:?}",refused.into_result().unwrap_err()).contains("register payout account"));
    let cost=view(&c,"payout_storage_cost",json!({})).await.as_str().unwrap().parse::<u128>()?;
    for a in [&root,&seller] { a.call(c.id(),"register_payout_account").args_json(json!({})).deposit(NearToken::from_yoctonear(cost)).max_gas().transact().await?.into_result()?; }
    root.call(c.id(),"nft_mint").args_json(mint).deposit(NearToken::from_millinear(12)).gas(near_workspaces::types::Gas::from_tgas(20)).transact().await?.into_result()?;
    let minter_credit=view(&c,"get_payout_credit",json!({"account_id":root.id()})).await.as_str().unwrap().parse::<u128>()?;assert!(minter_credit>0);
    root.call(c.id(),"claim_payout").args_json(json!({})).deposit(NearToken::from_yoctonear(1)).gas(near_workspaces::types::Gas::from_tgas(70)).transact().await?.into_result()?;
    assert_eq!(view(&c,"get_payout_credit",json!({"account_id":root.id()})).await,"0");
    assert!(view(&c,"get_pending_payout",json!({"account_id":root.id()})).await.is_null());
    let list=json!({"token_id":"k0123456789abcdef","price":"100000000000000000000000"});
    seller.call(c.id(),"nft_list").args_json(list.clone()).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;
    seller.call(c.id(),"nft_unlist").args_json(json!({"token_id":"k0123456789abcdef"})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&c,"get_payout_credit",json!({"account_id":seller.id()})).await,"10000000000000000000000");
    seller.call(c.id(),"claim_payout").args_json(json!({})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert!(view(&c,"get_pending_payout",json!({"account_id":seller.id()})).await.is_null());
    seller.call(c.id(),"nft_list").args_json(list).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;
    let overpay=100000000000000000000002u128;
    let refused=buyer.call(c.id(),"nft_buy").args_json(json!({"token_id":"k0123456789abcdef"})).deposit(NearToken::from_yoctonear(overpay)).max_gas().transact().await?;
    assert!(format!("{:?}",refused.into_result().unwrap_err()).contains("register payout account"));
    assert_eq!(view(&c,"nft_token",json!({"token_id":"k0123456789abcdef"})).await["owner_id"],seller.id().as_str());
    buyer.call(c.id(),"register_payout_account").args_json(json!({})).deposit(NearToken::from_yoctonear(cost)).max_gas().transact().await?.into_result()?;
    buyer.call(c.id(),"nft_buy").args_json(json!({"token_id":"k0123456789abcdef"})).deposit(NearToken::from_yoctonear(overpay)).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&c,"get_payout_credit",json!({"account_id":buyer.id()})).await,"2");
    assert_eq!(view(&c,"get_payout_credit",json!({"account_id":seller.id()})).await,"110000000000000000000000");
    seller.call(c.id(),"claim_payout").args_json(json!({})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&c,"get_payout_credit",json!({"account_id":seller.id()})).await,"0");
    buyer.call(c.id(),"nft_approve").args_json(json!({"token_id":"k0123456789abcdef","account_id":market.id()})).deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;
    buyer.call(c.id(),"nft_revoke").args_json(json!({"token_id":"k0123456789abcdef","account_id":market.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert!(view(&c,"get_payout_credit",json!({"account_id":buyer.id()})).await.as_str().unwrap().parse::<u128>()?>2);
    buyer.call(c.id(),"claim_payout").args_json(json!({})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&c,"get_payout_credit",json!({"account_id":buyer.id()})).await,"0");
    assert!(view(&c,"get_pending_payout",json!({"account_id":buyer.id()})).await.is_null());Ok(())
}


/// Exact six live NFT IDs/owners/metadata, deployed on v2.5 and preserved by a
/// plain v2.6 DeployContract. Covers both absent and already-initialized Pledge
/// metadata; initialization below is only fixture setup BEFORE the upgrade.
#[tokio::test]
async fn v2_6_plain_code_upgrade_preserves_six_live_nfts_owners_and_pledge_state() -> anyhow::Result<()> {
    let recorded: Value = serde_json::from_str(include_str!("fixtures/mainnet_v25_tokens.json"))?;
    let tokens = recorded["tokens"].as_array().unwrap();
    assert_eq!(tokens.len(), 6);
    for initialize_pledge in [false, true] {
        let w = near_workspaces::sandbox().await?;
        let root = w.root_account()?;
        let c = w.dev_deploy(&std::fs::read(V2_5)?).await?;
        c.call("new").args_json(json!({"owner":c.id(),"minter":root.id(),"treasury":c.id(),"royalty_bps":500}))
            .transact().await?.into_result()?;
        register_payouts(&c, &root, &[root.id()]).await?;
        let mut ids = vec![];
        for t in tokens {
            root.call(c.id(), "nft_mint").args_json(json!({"token_id":t["token_id"],"receiver_id":t["owner_id"],"tier":t["tier"],"metadata":t["metadata"]}))
                .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
            ids.push((t["token_id"].as_str().unwrap().to_owned(),t["owner_id"].as_str().unwrap().to_owned()));
        }
        if initialize_pledge {
            c.call("migrate_pledge").args_json(recorded["pledge_init"].clone()).max_gas().transact().await?.into_result()?;
        }
        let e = Env { c, minter: root.clone(), root, ids, w };
        assert_eq!(view(&e.c,"contract_source_metadata",json!({})).await["version"],"2.5.0");
        let before = snapshot(&e).await;
        let raw_tokens = view(&e.c,"nft_tokens",json!({})).await;
        let pledge_before = view(&e.c,"get_pledge_config",json!({})).await;
        let credit_before = view(&e.c,"get_payout_credit",json!({"account_id":e.minter.id()})).await;
        let mut control_before = vec![];
        for (id, _) in &e.ids { control_before.push(view(&e.c,"get_control_state",json!({"token_id":id})).await); }
        assert_eq!(before["supply"],"6");
        assert_eq!(!pledge_before.is_null(),initialize_pledge);
        // This is the ENTIRE upgrade: no init, migrate or migrate_pledge call.
        // Pin the committed v2.6 bytes. target/near is the v2.7 candidate or a sandbox fixture.
        e.c.as_account().deploy(&std::fs::read(V2_6)?).await?.into_result()?;
        assert_eq!(view(&e.c,"contract_source_metadata",json!({})).await["version"],"2.6.0");
        assert_eq!(view(&e.c,"collateral_registration_protocol",json!({})).await,2);
        assert_eq!(before,snapshot(&e).await,"all stored NFT/owner/tier/holder/config/metadata state survives");
        assert_eq!(raw_tokens,view(&e.c,"nft_tokens",json!({})).await,"including every approval map");
        assert_eq!(pledge_before,view(&e.c,"get_pledge_config",json!({})).await,"existing recovery/attestor/custody/network/nonces/liabilities unchanged");
        assert_eq!(credit_before,view(&e.c,"get_payout_credit",json!({"account_id":e.minter.id()})).await);
        for (i,(id,owner)) in e.ids.iter().enumerate() {
            assert_eq!(view(&e.c,"nft_token",json!({"token_id":id})).await["owner_id"],owner.as_str());
            assert_eq!(control_before[i],view(&e.c,"get_control_state",json!({"token_id":id})).await);
        }
    }
    Ok(())
}
