#[path="support/payout_storage.rs"] mod payout_storage;
use payout_storage::register_payouts;
// v2.7 sandbox on the local NEAR runtime with the labelled custody mock (no live keystore enforcement).
// (a) v2.6 state with NFTs, a listing and a full loan cycle, then a code-only upgrade to v2.7: every read is identical.
// (b+c) one 24 h sandbox clock (about 40 minutes of block production on this runtime) covers two checks:
//       the in-contract apply_upgrade with the real v2.7 wasm after its timelock, and the G1 reclaim of an
//       unclaimed principal by the named lender after the 24 h window, with the loan unlocking.
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signer, SigningKey};
use keyhole_keys::LoanCertificate;
use near_workspaces::{Account, Contract, Worker};
use near_workspaces::network::Sandbox;
use near_workspaces::types::NearToken;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const V26: &str = "../keys/release/v2.6/keyhole_keys.wasm";
/// Output of the reproducible build of this source (contracts/keys/build.sh), final sha256 a0e6881f...
const V27: &str = "../keys/target/near/keyhole_keys.wasm";
const MOCK: &str = "tests/fixtures/custody_policy_mock.wasm";
const N: u128 = 1_000_000_000_000_000_000_000_000;
const SEC: u64 = 1_000_000_000;
const DAY: u64 = 86_400 * SEC;

struct E { w: Worker<Sandbox>, c: Contract, alice: Account, lender: Account, bob: Account, minter: Account }

async fn view(c: &Contract, m: &str, args: Value) -> Value { c.view(m).args_json(args).await.unwrap().json().unwrap() }
async fn account(root: &Account, name: &str) -> Result<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(50)).transact().await?.into_result()?)
}
async fn now(e: &E) -> u64 { e.w.view_block().await.unwrap().timestamp() }
/// Advances the sandbox clock to at least `target_ns`.
async fn advance_to(w: &Worker<Sandbox>, target_ns: u64) -> Result<()> {
    for _ in 0..400 {
        let b = w.view_block().await?;
        println!("CLOCK height {} timestamp {} target {}", b.height(), b.timestamp(), target_ns);
        if b.timestamp() >= target_ns { return Ok(()); }
        w.fast_forward(2_000).await?;
    }
    anyhow::bail!("sandbox clock did not reach the target")
}

/// v2.6 on chain, wired like the pledge fixture: k1 (Gold) with a bound collateral binding, k2 for a listing, lending on.
async fn setup_v26() -> Result<E> {
    let w = near_workspaces::sandbox().await?;
    let root = w.root_account()?;
    let c = w.dev_deploy(&std::fs::read(V26)?).await?;
    let mock = w.dev_deploy(&std::fs::read(MOCK)?).await?;
    let alice = account(&root, "alice").await?;
    let lender = account(&root, "lender").await?;
    let bob = account(&root, "bob").await?;
    let minter = account(&root, "minter").await?;
    c.call("new").args_json(json!({"owner": c.id(), "minter": minter.id(), "treasury": c.id(), "royalty_bps": 500})).max_gas().transact().await?.into_result()?;
    register_payouts(&c, &root, &[minter.id(), alice.id(), lender.id(), bob.id()]).await?;
    minter.call(c.id(), "nft_mint").args_json(json!({"token_id": "k1", "receiver_id": alice.id(), "tier": 3, "metadata": {"title": "Sealed collateral", "copies": 1}}))
        .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
    minter.call(c.id(), "nft_mint").args_json(json!({"token_id": "k2", "receiver_id": bob.id(), "tier": 1, "metadata": {"title": "Listed", "copies": 1}}))
        .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
    minter.call(c.id(), "claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    let pk = SigningKey::from_bytes(&[7; 32]).verifying_key().to_bytes();
    c.call("migrate_pledge").args_json(json!({"recovery_account": root.id(), "attestor_public_key": B64.encode(pk), "custody_contract": mock.id(), "network": "sandbox"}))
        .max_gas().transact().await?.into_result()?;
    c.call("set_lending_enabled").args_json(json!({"enabled": true})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    minter.call(c.id(), "register_collateral").args_json(json!({"token_id": "k1", "wallet_pubkey": format!("ed25519:{}", "ab".repeat(32)), "encrypted_data": "sealed-policy",
        "wallet_signature": "ab".repeat(64), "version": 1, "valid_until": 4_000_000_000u64, "expected_owner_id": alice.id(), "expected_owner_epoch": "0"}))
        .deposit(NearToken::from_millinear(100)).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&c, "get_collateral_binding", json!({"token_id": "k1"})).await["ready"], true);
    Ok(E { w, c, alice, lender, bob, minter })
}

async fn upgrade_code_only(e: &E) -> Result<()> {
    e.c.as_account().deploy(&std::fs::read(V27)?).await?.into_result()?;
    Ok(())
}

fn terms(lender: &Account, principal: u128, ts: u64) -> Value {
    json!({"lender": lender.id(), "principal": principal.to_string(), "repayment": (principal * 11 / 10).to_string(), "duration_sec": "120",
        "grace_sec": "30", "floor_raw": "1000000", "funding_deadline_ns": (ts + 600 * SEC).to_string()})
}
async fn open_loan(e: &E, token: &str, principal: u128) -> Result<()> {
    let ts = now(e).await;
    e.alice.call(e.c.id(), "open_loan").args_json(json!({"token_id": token, "terms": terms(&e.lender, principal, ts)}))
        .deposit(NearToken::from_yoctonear(keyhole_keys::LOAN_STORAGE_DEPOSIT)).max_gas().transact().await?.into_result()?;
    assert_eq!(view(&e.c, "get_loan", json!({"token_id": token})).await["state"], "Offered");
    Ok(())
}
async fn fund_loan(e: &E, token: &str, principal: u128) -> Result<()> {
    let nonce = view(&e.c, "get_loan", json!({"token_id": token})).await["nonce"].as_str().unwrap().to_string();
    let ts = now(e).await;
    let cert = view(&e.c, "loan_certificate_template", json!({"token_id": token, "observed_at_ns": ts.to_string(), "expires_at_ns": (ts + 60 * SEC).to_string()})).await;
    let c: LoanCertificate = serde_json::from_value(cert.clone())?;
    let signature = SigningKey::from_bytes(&[7; 32]).sign(&near_sdk::borsh::to_vec(&c)?);
    e.lender.call(e.c.id(), "fund_loan").args_json(json!({"token_id": token, "nonce": nonce, "certificate": cert, "signature": B64.encode(signature.to_bytes())}))
        .deposit(NearToken::from_yoctonear(principal)).max_gas().transact().await?.into_result()?;
    Ok(())
}
async fn claim(e: &E, who: &Account) -> Result<()> {
    who.call(e.c.id(), "claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    Ok(())
}

/// Every read the worker, the site and the judge use, for the NFT, pledge, listing and credit surfaces.
async fn snapshot(e: &E) -> Value {
    let mut toks = view(&e.c, "nft_tokens", json!({})).await;
    for t in toks.as_array_mut().unwrap() { t.as_object_mut().unwrap().remove("approved_account_ids"); }
    let mut credits = vec![];
    for who in [&e.alice, &e.lender, &e.bob, &e.minter] {
        credits.push(view(&e.c, "get_payout_credit", json!({"account_id": who.id()})).await);
    }
    json!({
        "tokens": toks,
        "tiers": [view(&e.c, "nft_tier", json!({"token_id": "k1"})).await, view(&e.c, "nft_tier", json!({"token_id": "k2"})).await],
        "holders": [view(&e.c, "holder_tier", json!({"account_id": e.alice.id()})).await, view(&e.c, "holder_tier", json!({"account_id": e.bob.id()})).await],
        "config": view(&e.c, "config", json!({})).await,
        "pledge_config": view(&e.c, "get_pledge_config", json!({})).await,
        "collateral": view(&e.c, "get_collateral_binding", json!({"token_id": "k1"})).await,
        "listing": view(&e.c, "nft_listing", json!({"token_id": "k2"})).await,
        "listings": view(&e.c, "nft_listings", json!({})).await,
        "credits": credits,
        "supply": view(&e.c, "nft_total_supply", json!({})).await,
        "metadata": view(&e.c, "nft_metadata", json!({})).await,
    })
}

/// A complete loan cycle on k1: open, fund, borrower cashout, repay, lender cashout, borrower bond cashout.
async fn full_cycle(e: &E, principal: u128) -> Result<()> {
    open_loan(e, "k1", principal).await?;
    fund_loan(e, "k1", principal).await?;
    claim(e, &e.alice).await?;
    assert_eq!(view(&e.c, "get_loan", json!({"token_id": "k1"})).await["state"], "Active");
    e.alice.call(e.c.id(), "repay_loan").args_json(json!({"token_id": "k1", "nonce": "1"}))
        .deposit(NearToken::from_yoctonear(principal * 11 / 10)).max_gas().transact().await?.into_result()?;
    assert!(view(&e.c, "get_loan", json!({"token_id": "k1"})).await.is_null());
    claim(e, &e.lender).await?;
    claim(e, &e.alice).await?;
    assert_eq!(view(&e.c, "get_pledge_config", json!({})).await["user_liabilities"], "0");
    Ok(())
}

#[tokio::test]
async fn a_v26_state_with_a_listing_and_a_full_loan_cycle_is_identical_after_a_code_only_upgrade_to_v27() -> Result<()> {
    let e = setup_v26().await?;
    e.bob.call(e.c.id(), "nft_list").args_json(json!({"token_id": "k2", "price": N.to_string()}))
        .deposit(NearToken::from_millinear(10)).max_gas().transact().await?.into_result()?;
    full_cycle(&e, N / 10).await?;
    let before = snapshot(&e).await;
    assert_eq!(view(&e.c, "nft_listing", json!({"token_id": "k2"})).await["seller"], e.bob.id().as_str());

    upgrade_code_only(&e).await?;

    let after = snapshot(&e).await;
    assert_eq!(before, after, "every read is identical across the code-only upgrade");
    // The new surface is additive and reads the same chain state.
    let g = view(&e.c, "governance_state", json!({})).await;
    assert_eq!(g["owner"], e.c.id().as_str());
    assert_eq!(g["wound_down"], false);
    assert_eq!(view(&e.c, "loan_cap", json!({"token_id": "k1"})).await, (5 * 10u128.pow(24)).to_string());
    let src = view(&e.c, "contract_source_metadata", json!({})).await;
    assert_eq!(src["version"], "2.7.0");
    Ok(())
}

#[tokio::test]
async fn bc_one_24h_clock_covers_the_timelocked_in_contract_apply_and_the_g1_reclaim() -> Result<()> {
    let e = setup_v26().await?;
    // v2.7 code is live before the loan is funded, so the disbursement deadline is recorded (no v2.6 loan is reclaimable).
    upgrade_code_only(&e).await?;
    let principal = N / 10;
    open_loan(&e, "k1", principal).await?;
    fund_loan(&e, "k1", principal).await?;
    assert_eq!(view(&e.c, "get_loan", json!({"token_id": "k1"})).await["state"], "DisbursementPending");
    assert_eq!(view(&e.c, "get_payout_credit", json!({"account_id": e.alice.id()})).await, principal.to_string());

    // Stage the same v2.7 bytes; the 24 h timelock starts now, after the funding deadline was recorded.
    let wasm = std::fs::read(V27)?;
    let sha: String = Sha256::digest(&wasm).iter().map(|b| format!("{b:02x}")).collect();
    e.c.call("stage_upgrade").args_json(json!({"code_sha256": sha})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    let not_before: u64 = view(&e.c, "governance_state", json!({})).await["staged_upgrade_not_before_ns"].as_str().unwrap().parse()?;

    // Before the clocks run out: the apply is refused by its timelock and the reclaim by its window.
    let early_apply = e.c.call("apply_upgrade").args(wasm.clone()).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(format!("{:?}", early_apply.into_result().unwrap_err()).contains("timelock not expired"));
    let early_reclaim = e.lender.call(e.c.id(), "reclaim_unclaimed_principal").args_json(json!({"token_id": "k1", "nonce": "1"}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(format!("{:?}", early_reclaim.into_result().unwrap_err()).contains("disbursement window still open"));

    advance_to(&e.w, not_before + SEC).await?;

    // G1: the named lender reclaims the unclaimed principal; the mock unfreezes in the same chain, so the loan closes.
    let lender_before = e.lender.view_account().await?.balance.as_yoctonear();
    e.lender.call(e.c.id(), "reclaim_unclaimed_principal").args_json(json!({"token_id": "k1", "nonce": "1"}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert!(view(&e.c, "get_loan", json!({"token_id": "k1"})).await.is_null());
    assert_eq!(view(&e.c, "nft_token", json!({"token_id": "k1"})).await["owner_id"], e.alice.id().as_str(), "key never left the borrower");
    assert_eq!(view(&e.c, "get_payout_credit", json!({"account_id": e.alice.id()})).await, "0", "borrower lost the unclaimed principal");
    assert_eq!(view(&e.c, "get_payout_credit", json!({"account_id": e.lender.id()})).await, principal.to_string());
    claim(&e, &e.lender).await?;
    assert!(e.lender.view_account().await?.balance.as_yoctonear() > lender_before + principal - N / 100, "lender receives the principal");

    // The timelocked in-contract apply with the real wasm, after the reclaim, on the same clock.
    let before = snapshot(&e).await;
    let r = e.c.call("apply_upgrade").args(wasm.clone()).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    let gas = r.total_gas_burnt;
    println!("apply_upgrade with {} bytes: total gas burnt {} (one call, limit 300 Tgas)", wasm.len(), gas);
    r.into_result()?;
    assert!(view(&e.c, "governance_state", json!({})).await["staged_upgrade_sha256"].is_null(), "applied upgrade is consumed");
    assert_eq!(before, snapshot(&e).await, "state identical after the in-contract deploy");
    assert_eq!(view(&e.c, "contract_source_metadata", json!({})).await["version"], "2.7.0");

    // The borrower collects the bond the unlock returned, and nothing is left owed.
    claim(&e, &e.alice).await?;
    assert_eq!(view(&e.c, "get_pledge_config", json!({})).await["user_liabilities"], "0");
    Ok(())
}
