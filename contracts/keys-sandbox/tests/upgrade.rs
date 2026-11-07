//! Sandbox: deploy the exact mainnet v1 wasm, mint the 5 mainnet tokens, upgrade to v2,
//! migrate, and prove nothing moved. Then exercise every v2 path on a real runtime.
use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const V1: &str = "../keys/release/v1/keyhole_keys.wasm";
const V2_0: &str = "../keys/release/v2/keyhole_keys.wasm";
const V2_1: &str = "../keys/release/v2.1/keyhole_keys.wasm";
const V2: &str = "../keys/release/v2.2/keyhole_keys.wasm";
const V2_3: &str = "../keys/release/v2.3/keyhole_keys.wasm";
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
    Ok(V22 { e: Env { c, minter, root: root.clone(), ids }, root, seller, buyer, market, holder })
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
