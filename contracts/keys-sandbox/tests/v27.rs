#[path="support/payout_storage.rs"] mod payout_storage;
use payout_storage::register_payouts;
// v2.7 sandbox on the local NEAR runtime with the labelled custody mock (no live keystore enforcement).
// (a) v2.6 state with NFTs, a listing and a full loan cycle, then a code-only upgrade to the release v2.7 wasm: every read is identical.
// (b) stage the release wasm on the short-delay fixture, refuse apply before the delay, cancel, then apply after it.
// (c) a loan the borrower never claims; the named lender reclaims the principal after the fixture deadline. Balances are exact.
// The release wasm keeps a 24h delay. Only tests/fixtures/v27_short_delay.wasm (feature sandbox-short-delay) is short.
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
/// Release v2.7 wasm from contracts/keys/build.sh. 24h upgrade delay. Not the short-delay fixture.
const V27: &str = "../keys/release/v2.7/keyhole_keys.wasm";
/// `contracts/keys/build-sandbox-delay.sh`. Upgrade delay and disbursement window are 30s. Never deploy this.
const V27_SHORT: &str = "tests/fixtures/v27_short_delay.wasm";
const MOCK: &str = "tests/fixtures/custody_policy_mock.wasm";
const N: u128 = 1_000_000_000_000_000_000_000_000;
const SEC: u64 = 1_000_000_000;
const RELEASE_DELAY: u64 = 86_400 * SEC;

struct E { w: Worker<Sandbox>, c: Contract, alice: Account, lender: Account, bob: Account, minter: Account }

async fn view(c: &Contract, m: &str, args: Value) -> Value { c.view(m).args_json(args).await.unwrap().json().unwrap() }
async fn account(root: &Account, name: &str) -> Result<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(50)).transact().await?.into_result()?)
}
async fn now(e: &E) -> u64 { e.w.view_block().await.unwrap().timestamp() }
/// Advances the sandbox clock to at least `target_ns` without producing a day's worth of blocks.
/// One short sample measures nanoseconds per block, then a single fast_forward covers the rest, capped at 400 blocks.
async fn advance_to(w: &Worker<Sandbox>, target_ns: u64) -> Result<()> {
    let start = w.view_block().await?;
    if start.timestamp() >= target_ns { return Ok(()); }
    w.fast_forward(20).await?;
    let mid = w.view_block().await?;
    println!("CLOCK sample height {} timestamp {} target {}", mid.height(), mid.timestamp(), target_ns);
    if mid.timestamp() >= target_ns { return Ok(()); }
    let elapsed = mid.timestamp().saturating_sub(start.timestamp()).max(1);
    let blocks = mid.height().saturating_sub(start.height()).max(1);
    let per = elapsed / blocks;
    let need = target_ns.saturating_sub(mid.timestamp()).div_ceil(per).saturating_add(5).min(400);
    println!("CLOCK {blocks} blocks covered {elapsed} ns; forwarding {need} more");
    w.fast_forward(need).await?;
    let end = w.view_block().await?;
    println!("CLOCK height {} timestamp {} target {}", end.height(), end.timestamp(), target_ns);
    if end.timestamp() >= target_ns { Ok(()) } else {
        anyhow::bail!("sandbox clock {} did not reach {target_ns} within {need} blocks", end.timestamp())
    }
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

fn read_wasm(path: &str) -> Result<Vec<u8>> {
    std::fs::read(path).map_err(|err| anyhow::anyhow!("missing {path} ({err}); build the release wasm and the short-delay fixture first"))
}

/// Credit ledger and the payout_claim event are the exact amount. Once every earlier receipt's
/// gas refund has landed, `after + tokens_burnt + attached - before` equals that amount: the signer
/// paid exactly the gas the receipts burnt.
fn assert_native_cashout(logs: &[String], before: u128, after: u128, burnt: u128, credit: u128) {
    assert!(logs.iter().any(|l| l.contains(&format!("\"amount\":\"{credit}\""))), "payout_claim event pays exactly the credit");
    let gap = after as i128 + burnt as i128 + 1 - before as i128 - credit as i128;
    assert_eq!(gap, 0, "native balance moves by exactly the credit, after gas burn and the 1 yocto");
}

#[tokio::test]
async fn bc_short_delay_proves_timelock_cancel_apply_and_exact_principal_reclaim() -> Result<()> {
    let e = setup_v26().await?;
    // The running code is the short-delay fixture so the clocks are 30s. The bytes applied later are the release wasm.
    e.c.as_account().deploy(&read_wasm(V27_SHORT)?).await?.into_result()?;
    let release = read_wasm(V27)?;
    let principal = N / 10;
    open_loan(&e, "k1", principal).await?;
    fund_loan(&e, "k1", principal).await?;
    assert_eq!(view(&e.c, "get_loan", json!({"token_id": "k1"})).await["state"], "DisbursementPending");
    assert_eq!(view(&e.c, "get_payout_credit", json!({"account_id": e.alice.id()})).await, principal.to_string());

    let sha: String = Sha256::digest(&release).iter().map(|b| format!("{b:02x}")).collect();
    e.c.call("stage_upgrade").args_json(json!({"code_sha256": sha})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    let first_deadline: u64 = view(&e.c, "governance_state", json!({})).await["staged_upgrade_not_before_ns"].as_str().unwrap().parse()?;

    let early_apply = e.c.call("apply_upgrade").args(release.clone()).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(format!("{:?}", early_apply.into_result().unwrap_err()).contains("timelock not expired"));
    let early_reclaim = e.lender.call(e.c.id(), "reclaim_unclaimed_principal").args_json(json!({"token_id": "k1", "nonce": "1"}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(format!("{:?}", early_reclaim.into_result().unwrap_err()).contains("disbursement window still open"));

    // Cancel works, and restaging restarts the clock. Apply is refused again before the new deadline.
    e.c.call("cancel_upgrade").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert!(view(&e.c, "governance_state", json!({})).await["staged_upgrade_sha256"].is_null());
    e.c.call("stage_upgrade").args_json(json!({"code_sha256": sha})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    let not_before: u64 = view(&e.c, "governance_state", json!({})).await["staged_upgrade_not_before_ns"].as_str().unwrap().parse()?;
    assert!(not_before > first_deadline, "cancel then stage restarts the timelock");
    let early_again = e.c.call("apply_upgrade").args(release.clone()).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    assert!(format!("{:?}", early_again.into_result().unwrap_err()).contains("timelock not expired"));

    advance_to(&e.w, not_before + SEC).await?;

    // (c) The named lender reclaims exactly the principal. The borrower keeps the key and loses that credit.
    e.lender.call(e.c.id(), "reclaim_unclaimed_principal").args_json(json!({"token_id": "k1", "nonce": "1"}))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    assert!(view(&e.c, "get_loan", json!({"token_id": "k1"})).await.is_null());
    assert_eq!(view(&e.c, "nft_token", json!({"token_id": "k1"})).await["owner_id"], e.alice.id().as_str(), "key never left the borrower");
    assert_eq!(view(&e.c, "get_payout_credit", json!({"account_id": e.alice.id()})).await, keyhole_keys::LOAN_STORAGE_DEPOSIT.to_string(), "borrower keeps only the refundable bond, not the principal");
    assert_eq!(view(&e.c, "get_payout_credit", json!({"account_id": e.lender.id()})).await, principal.to_string(), "lender credit is exactly the principal");
    e.w.fast_forward(10).await?;
    let lender_before = e.lender.view_account().await?.balance.as_yoctonear();
    let claim_tx = e.lender.call(e.c.id(), "claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    let burnt: u128 = claim_tx.outcomes().iter().map(|o| o.tokens_burnt.as_yoctonear()).sum();
    let logs: Vec<String> = claim_tx.logs().into_iter().map(|l| l.to_string()).collect();
    claim_tx.into_result()?;
    e.w.fast_forward(10).await?;
    let lender_after = e.lender.view_account().await?.balance.as_yoctonear();
    assert_native_cashout(&logs, lender_before, lender_after, burnt, principal);
    assert_eq!(view(&e.c, "get_payout_credit", json!({"account_id": e.lender.id()})).await, "0");

    // (b) The timelocked in-contract apply of the release wasm. The delay view must then be 24h, which the fixture is not.
    let before = snapshot(&e).await;
    let r = e.c.call("apply_upgrade").args(release.clone()).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    println!("apply_upgrade with {} bytes: total gas burnt {} (one call, limit 300 Tgas)", release.len(), r.total_gas_burnt);
    r.into_result()?;
    let g = view(&e.c, "governance_state", json!({})).await;
    assert!(g["staged_upgrade_sha256"].is_null(), "applied upgrade is consumed");
    assert_eq!(g["min_upgrade_delay_ns"].as_str().unwrap(), RELEASE_DELAY.to_string(), "applied wasm is the 24h release build");
    assert_eq!(before, snapshot(&e).await, "state identical after the in-contract deploy");
    assert_eq!(view(&e.c, "contract_source_metadata", json!({})).await["version"], "2.7.0");

    // The borrower collects only the bond the unlock returned, and nothing is left owed.
    let bond = view(&e.c, "get_payout_credit", json!({"account_id": e.alice.id()})).await.as_str().unwrap().parse::<u128>()?;
    assert_eq!(bond, keyhole_keys::LOAN_STORAGE_DEPOSIT);
    e.w.fast_forward(10).await?;
    let alice_before = e.alice.view_account().await?.balance.as_yoctonear();
    let alice_tx = e.alice.call(e.c.id(), "claim_payout").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
    let alice_burnt: u128 = alice_tx.outcomes().iter().map(|o| o.tokens_burnt.as_yoctonear()).sum();
    let alice_logs: Vec<String> = alice_tx.logs().into_iter().map(|l| l.to_string()).collect();
    alice_tx.into_result()?;
    e.w.fast_forward(10).await?;
    let alice_after = e.alice.view_account().await?.balance.as_yoctonear();
    assert_native_cashout(&alice_logs, alice_before, alice_after, alice_burnt, bond);
    assert_eq!(view(&e.c, "get_pledge_config", json!({})).await["user_liabilities"], "0");
    Ok(())
}

/// Mainnet successor. The sandbox protocol refuses CreateAccount on a 64-hex account id, and this checkout
/// does not have that account's secret, so the test signs for a fresh implicit account created by transfer.
const MAINNET_GUARDIAN: &str = "0705fdc1581a35351453bd4625f22d0c41b2b9edc3e7bed860586623c6778228";

fn hex_sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}
fn economic(mut snap: Value) -> Value {
    snap["config"].as_object_mut().unwrap().remove("owner");
    snap
}
async fn wasm_sha(c: &Contract) -> Result<String> {
    Ok(hex_sha(&c.view_code().await?))
}
async fn sandbox_guardian(w: &Worker<Sandbox>, root: &Account) -> Result<Account> {
    let sk = near_workspaces::types::SecretKey::from_random(near_workspaces::types::KeyType::ED25519);
    let id: near_workspaces::AccountId = sk.public_key().key_data().iter().map(|b| format!("{b:02x}")).collect::<String>().parse()?;
    root.transfer_near(&id, NearToken::from_near(50)).await?.into_result()?;
    Ok(Account::from_secret_key(id, sk, w))
}
async fn delete_all_keys(c: &Contract) -> Result<()> {
    let keys = c.view_access_keys().await?;
    assert!(!keys.is_empty(), "the contract starts with a key the test can delete");
    let mut tx = c.batch();
    for key in keys {
        tx = tx.delete_key(key.public_key);
    }
    tx.transact().await?.into_result()?;
    assert!(c.view_access_keys().await?.is_empty(), "every access key on the contract account is gone");
    Ok(())
}

/// Mainnet order, on the short-delay fixture: stage and propose in the same hour, apply, then accept.
/// `accept_owner` still drops a staged upgrade, so apply is first and the clear is a no-op.
/// The release wasm's next delay is 24h. This sandbox cannot fast-forward that far (it stalls near height 225179,
/// and 24h is about 325000 blocks at the measured block time). The zero-key stage-and-apply therefore runs on a
/// second chain that is still executing the short-delay fixture when the guardian deploys the release wasm.
#[tokio::test]
async fn parallel_timelock_apply_then_accept_then_zero_key_self_deploy() -> Result<()> {
    let release = read_wasm(V27)?;
    let short = read_wasm(V27_SHORT)?;
    let release_sha = hex_sha(&release);
    let short_sha = hex_sha(&short);

    // Phase 1: the exact order, applying the release wasm, then a zero-key stage on that code.
    {
        let e = setup_v26().await?;
        e.c.as_account().deploy(&short).await?.into_result()?;
        assert_eq!(MAINNET_GUARDIAN.len(), 64);
        assert!(MAINNET_GUARDIAN.bytes().all(|b| b.is_ascii_hexdigit()));
        let root = e.w.root_account()?;
        let guardian = sandbox_guardian(&e.w, &root).await?;
        let before = snapshot(&e).await;

        e.c.call("stage_upgrade").args_json(json!({"code_sha256": release_sha})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
        e.c.call("propose_owner").args_json(json!({"new_owner": guardian.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
        let g = view(&e.c, "governance_state", json!({})).await;
        let upgrade_at: u64 = g["staged_upgrade_not_before_ns"].as_str().unwrap().parse()?;
        let owner_at: u64 = g["pending_owner_not_before_ns"].as_str().unwrap().parse()?;
        assert!(upgrade_at.abs_diff(owner_at) < 120 * SEC, "both waits start in the same hour");
        assert_eq!(g["owner"], e.c.id().as_str());
        assert_eq!(g["pending_owner"], guardian.id().as_str());
        assert_eq!(g["staged_upgrade_sha256"], release_sha);

        let early = e.c.call("apply_upgrade").args(release.clone()).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
        assert!(format!("{:?}", early.into_result().unwrap_err()).contains("timelock not expired"));

        advance_to(&e.w, upgrade_at.max(owner_at) + SEC).await?;
        let applied = e.c.call("apply_upgrade").args(release.clone()).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?;
        applied.into_result()?;
        let g = view(&e.c, "governance_state", json!({})).await;
        assert!(g["staged_upgrade_sha256"].is_null(), "apply consumes the stage before accept");
        assert_eq!(g["owner"], e.c.id().as_str(), "apply does not hand the contract to the successor");
        assert_eq!(g["pending_owner"], guardian.id().as_str());
        assert_eq!(wasm_sha(&e.c).await?, release_sha, "code hash is the staged release hash");
        assert_eq!(economic(before.clone()), economic(snapshot(&e).await), "state preserved across the in-contract deploy");

        guardian.call(e.c.id(), "accept_owner").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
        let g = view(&e.c, "governance_state", json!({})).await;
        assert_eq!(g["owner"], guardian.id().as_str());
        assert!(g["pending_owner"].is_null());
        assert!(g["staged_upgrade_sha256"].is_null(), "accept finds no stage left to clear");
        assert_eq!(wasm_sha(&e.c).await?, release_sha, "accept does not change the code that was just applied");
        let after = snapshot(&e).await;
        assert_eq!(after["config"]["owner"], guardian.id().as_str());
        assert_eq!(economic(before), economic(after));

        delete_all_keys(&e.c).await?;
        let locked = e.c.call("stage_upgrade").args_json(json!({"code_sha256": short_sha})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await;
        let locked_ok = match locked { Err(_) => false, Ok(out) => out.into_result().is_ok() };
        assert!(!locked_ok, "the contract account can no longer sign");
        guardian.call(e.c.id(), "stage_upgrade").args_json(json!({"code_sha256": short_sha})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
        let g = view(&e.c, "governance_state", json!({})).await;
        assert_eq!(g["staged_upgrade_sha256"], short_sha, "the external owner stages with zero keys on the contract");
        let not_before: u64 = g["staged_upgrade_not_before_ns"].as_str().unwrap().parse()?;
        let wait = not_before.saturating_sub(now(&e).await);
        assert!(wait + 120 * SEC > RELEASE_DELAY && wait < RELEASE_DELAY + 120 * SEC, "the applied release wasm's next delay is 24h, which this sandbox does not fast-forward");
        assert!(e.c.view_access_keys().await?.is_empty());
    }

    // Phase 2: same order while the executor stays on the short delay, so the guardian can also apply.
    {
        let e = setup_v26().await?;
        e.c.as_account().deploy(&short).await?.into_result()?;
        let root = e.w.root_account()?;
        let guardian = sandbox_guardian(&e.w, &root).await?;
        let before = snapshot(&e).await;

        e.c.call("stage_upgrade").args_json(json!({"code_sha256": short_sha})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
        e.c.call("propose_owner").args_json(json!({"new_owner": guardian.id()})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
        let g = view(&e.c, "governance_state", json!({})).await;
        let upgrade_at: u64 = g["staged_upgrade_not_before_ns"].as_str().unwrap().parse()?;
        let owner_at: u64 = g["pending_owner_not_before_ns"].as_str().unwrap().parse()?;
        advance_to(&e.w, upgrade_at.max(owner_at) + SEC).await?;

        e.c.call("apply_upgrade").args(short.clone()).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
        assert_eq!(wasm_sha(&e.c).await?, short_sha);
        assert_eq!(view(&e.c, "governance_state", json!({})).await["owner"], e.c.id().as_str());
        guardian.call(e.c.id(), "accept_owner").deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
        assert_eq!(view(&e.c, "governance_state", json!({})).await["owner"], guardian.id().as_str());
        delete_all_keys(&e.c).await?;

        guardian.call(e.c.id(), "stage_upgrade").args_json(json!({"code_sha256": release_sha})).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
        let not_before: u64 = view(&e.c, "governance_state", json!({})).await["staged_upgrade_not_before_ns"].as_str().unwrap().parse()?;
        advance_to(&e.w, not_before + SEC).await?;
        guardian.call(e.c.id(), "apply_upgrade").args(release.clone()).deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;

        assert_eq!(wasm_sha(&e.c).await?, release_sha, "zero-key self-deploy installed the staged release hash");
        assert_eq!(view(&e.c, "governance_state", json!({})).await["owner"], guardian.id().as_str());
        assert!(e.c.view_access_keys().await?.is_empty(), "the deploy did not add a key");
        let after = snapshot(&e).await;
        assert_eq!(after["config"]["owner"], guardian.id().as_str());
        assert_eq!(economic(before), economic(after), "nft, pledge, listing and credit state preserved");
    }
    Ok(())
}
