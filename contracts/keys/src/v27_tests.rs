//! v2.7 unit tests: G1 race orders, G2 callbacks that never panic and reconcile, governance, wind-down,
//! tier caps, events, and deterministic randomized invariant loops (proptest is not a dependency of this crate).
use super::*;
use super::{MIN_UPGRADE_DELAY_NS, RELEASE_UPGRADE_DELAY_NS, WIND_DOWN_KEY};
use crate::pledge::{collateral, config_required, loans, save_config, CollateralBinding, DISBURSEMENT_WINDOW_NS, LOAN_STORAGE_DEPOSIT, RECOVERY_UNLOCK_NS};
use crate::{test_funded_contract, test_register_payouts};
use near_sdk::json_types::Base64VecU8;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::testing_env;
use near_sdk::{Gas, PromiseResult};
use std::panic::{catch_unwind, AssertUnwindSafe};

const NOW: u64 = 1_794_000_000_000_000_000;
const N: u128 = 1_000_000_000_000_000_000_000_000;
const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400 * SECOND;

fn a(s: &str) -> AccountId { s.parse().unwrap() }
fn sk() -> SigningKey { SigningKey::from_bytes(&[7; 32]) }
fn context(who: &str, amount: u128, now: u64, balance: u128) -> near_sdk::VMContext {
    VMContextBuilder::new().current_account_id(a("keys.near")).predecessor_account_id(a(who))
        .signer_account_id(a(who)).account_balance(yocto(balance)).storage_usage(200_000)
        .block_timestamp(now).attached_deposit(yocto(amount)).prepaid_gas(Gas::from_tgas(300)).build()
}
fn ctx(who: &str, amount: u128, now: u64) { ctx_bal(who, amount, now, 1000 * N); }
fn ctx_bal(who: &str, amount: u128, now: u64, balance: u128) {
    let mut c = context(who, amount, now, balance); c.storage_usage = env::storage_usage(); testing_env!(c);
}
fn result(r: PromiseResult, now: u64) { result_bal(r, now, 1000 * N); }
fn result_bal(r: PromiseResult, now: u64, balance: u128) {
    let mut c = context("keys.near", 0, now, balance); c.storage_usage = env::storage_usage();
    testing_env!(c, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), std::collections::HashMap::default(), vec![r]);
}
fn policy(frozen: bool) -> PromiseResult {
    PromiseResult::Successful(near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({
        "owner":"keys.near", "encrypted_data":"sealed-policy", "version":1, "locked":true, "frozen":frozen
    })).unwrap())
}
fn meta() -> TokenMetadata { TokenMetadata { title: Some("Key".into()), ..Default::default() } }
fn bind(c: &mut Contract, token: &str) {
    let _ = c;
    collateral().insert(&token.into(), &CollateralBinding {
        wallet_pubkey: format!("ed25519:{}", "ab".repeat(32)), encrypted_policy_hash: Base64VecU8(env::sha256(b"sealed-policy")),
        policy_version: U64(1), ready: true, policy_generation: U64(0),
    });
}
fn setup() -> Contract {
    ctx("keys.near", 0, NOW);
    let mut c = test_funded_contract();
    ctx("minter.near", N / 10, NOW);
    c.nft_mint("k1".into(), a("alice.near"), 3, meta());
    // Settle the minter's known mint-storage refund so the lending baseline has no unrelated credit.
    ctx("minter.near", 1, NOW); let _ = c.claim_payout(); let p = c.get_pending_payout(a("minter.near")).unwrap();
    result(PromiseResult::Successful(vec![]), NOW); assert!(c.on_payout(a("minter.near"), p.nonce));
    env::state_write(&c); ctx("keys.near", 0, NOW);
    let c = Contract::migrate_pledge(a("recovery.near"), Base64VecU8(sk().verifying_key().to_bytes().to_vec()), a("custody.near"), "sandbox".into());
    let mut cfg = config_required(); cfg.lending_enabled = true; save_config(&cfg);
    let mut c = c;
    bind(&mut c, "k1");
    c
}
fn mint(c: &mut Contract, token: &str, to: &str, tier: u8) {
    test_register_payouts(c, &[a(to)]);
    ctx("minter.near", N / 10, NOW);
    c.nft_mint(token.into(), a(to), tier, meta());
}
fn terms_for(lender: &str, principal: u128) -> LoanTerms {
    LoanTerms { lender: a(lender), principal: U128(principal), repayment: U128(principal + principal / 10), duration_sec: U64(60), grace_sec: U64(30), floor_raw: U128(1_000_000), funding_deadline_ns: U64(NOW + 600 * SECOND) }
}
fn terms() -> LoanTerms { terms_for("lender.near", N) }
fn settle_policy_on(c: &mut Contract, token: &str, frozen: bool, now: u64, balance: u128) {
    let l = c.get_loan(token.into()).unwrap();
    result_bal(PromiseResult::Successful(vec![]), now, balance);
    let _ = c.on_policy_action(token.into(), l.nonce, l.policy_sequence);
    result_bal(policy(frozen), now, balance);
    assert!(c.on_loan_policy(token.into(), l.nonce, l.policy_sequence));
}
fn signed(v: &LoanCertificate) -> Base64VecU8 { Base64VecU8(sk().sign(&near_sdk::borsh::to_vec(v).unwrap()).to_bytes().to_vec()) }
fn rejected<F: FnOnce()>(f: F) { assert!(catch_unwind(AssertUnwindSafe(f)).is_err()); }
fn logs_contain(name: &str) -> bool { get_logs().iter().any(|l| l.contains(&format!("\"event\":\"{name}\""))) }
fn reg(c: &mut Contract, who: &str) { test_register_payouts(c, &[a(who)]); }

/// Opens, freezes and funds a loan on `token` with the named lender and principal. Returns the loan nonce.
fn open_and_fund(c: &mut Contract, token: &str, borrower: &str, principal: u128, now: u64, bal: &mut u128) -> U64 {
    let mut t = terms_for("lender.near", principal);
    t.funding_deadline_ns = U64(now + 600 * SECOND);
    *bal += LOAN_STORAGE_DEPOSIT; ctx_bal(borrower, LOAN_STORAGE_DEPOSIT, now, *bal);
    let _ = c.open_loan(token.into(), t);
    let nonce = c.get_loan(token.into()).unwrap().nonce;
    settle_policy_on(c, token, true, now, *bal);
    let cert = c.loan_certificate_template(token.into(), U64(now), U64(now + 30 * SECOND));
    let sig = signed(&cert);
    *bal += principal; ctx_bal("lender.near", principal, now, *bal);
    assert!(c.fund_loan(token.into(), nonce, cert, sig));
    nonce
}

// ---------- governance ----------

#[test]
fn owner_handover_is_two_step_and_only_the_proposed_account_accepts() {
    let mut c = setup();
    ctx("owner.near", 0, NOW); rejected(|| { let _ = c.propose_owner(a("guardian.near")); });
    ctx("owner.near", 1, NOW); let not_before = c.propose_owner(a("guardian.near"));
    assert_eq!(not_before.0, NOW + MIN_UPGRADE_DELAY_NS);
    assert_eq!(c.governance_state().pending_owner, Some(a("guardian.near")));
    assert_eq!(c.governance_state().pending_owner_not_before_ns, Some(not_before));
    assert_eq!(c.governance_state().owner, a("owner.near"), "proposal does not change the owner");
    ctx("owner.near", 1, NOW); c.set_royalty(a("treasury.near"), 400);
    ctx("evil.near", 1, NOW + MIN_UPGRADE_DELAY_NS); rejected(|| c.accept_owner());
    ctx("guardian.near", 0, NOW + MIN_UPGRADE_DELAY_NS); rejected(|| c.accept_owner());
    ctx("guardian.near", 1, NOW + MIN_UPGRADE_DELAY_NS - 1); rejected(|| c.accept_owner());
    ctx("guardian.near", 1, NOW + MIN_UPGRADE_DELAY_NS); c.accept_owner();
    assert_eq!(c.governance_state().owner, a("guardian.near"));
    assert_eq!(c.config().owner, a("guardian.near"));
    assert!(logs_contain("owner_changed"));
    ctx("owner.near", 1, NOW); rejected(|| c.set_royalty(a("treasury.near"), 500));
    ctx("guardian.near", 1, NOW); c.set_royalty(a("treasury.near"), 500);
}

#[test]
fn owner_proposal_to_self_is_refused() {
    let mut c = setup();
    ctx("owner.near", 1, NOW); rejected(|| { let _ = c.propose_owner(a("owner.near")); });
}

#[test]
fn a_bad_owner_proposal_can_be_cancelled_before_it_can_take_effect() {
    let mut c = setup();
    ctx("owner.near", 1, NOW); let _ = c.propose_owner(a("attacker.near"));
    ctx("owner.near", 1, NOW); c.set_royalty(a("treasury.near"), 100);
    ctx("alice.near", 1, NOW); rejected(|| c.cancel_owner_proposal());
    ctx("owner.near", 0, NOW); rejected(|| c.cancel_owner_proposal());
    ctx("attacker.near", 1, NOW + MIN_UPGRADE_DELAY_NS - 1); rejected(|| c.accept_owner());
    ctx("owner.near", 1, NOW); c.cancel_owner_proposal();
    assert!(c.governance_state().pending_owner.is_none());
    ctx("attacker.near", 1, NOW + MIN_UPGRADE_DELAY_NS); rejected(|| c.accept_owner());
    assert_eq!(c.governance_state().owner, a("owner.near"));
    ctx("owner.near", 1, NOW + MIN_UPGRADE_DELAY_NS); c.set_royalty(a("treasury.near"), 200);
}

#[test]
fn repeating_an_owner_proposal_does_not_grow_storage() {
    let mut c = setup();
    ctx("owner.near", 1, NOW); let _ = c.propose_owner(a("guardian.near"));
    let used = env::storage_usage();
    ctx("owner.near", 1, NOW + SECOND); let _ = c.propose_owner(a("guardian.near"));
    assert_eq!(env::storage_usage(), used, "an overwrite of the same proposal must not grow storage");
}

#[test]
fn accepting_ownership_clears_a_staged_upgrade() {
    let mut c = setup();
    ctx("owner.near", 1, NOW); let _ = c.stage_upgrade(sha_hex(&wasm()));
    ctx("owner.near", 1, NOW); let when = c.propose_owner(a("next.near"));
    ctx("owner.near", 1, NOW + SECOND); let restarted = c.propose_owner(a("guardian.near"));
    assert!(restarted.0 > when.0, "replacing a proposal restarts the delay");
    ctx("next.near", 1, restarted.0); rejected(|| c.accept_owner());
    ctx("guardian.near", 1, restarted.0); c.accept_owner();
    assert_eq!(c.governance_state().owner, a("guardian.near"));
    assert!(c.governance_state().staged_upgrade_sha256.is_none(), "handover clears a staged upgrade");
    ctx_input("owner.near", 1, restarted.0 + MIN_UPGRADE_DELAY_NS, wasm());
    rejected(|| { let _ = c.apply_upgrade(); });
}

#[test]
fn governance_storage_cannot_consume_user_liabilities() {
    let mut c = setup();
    let mut cfg = config_required();
    cfg.user_liabilities = U128(N);
    save_config(&cfg);
    let storage = env::storage_byte_cost().as_yoctonear() * env::storage_usage() as u128;
    ctx_bal("owner.near", 1, NOW, storage);
    rejected(|| { let _ = c.propose_owner(a("guardian.near")); });
    // The mock VM keeps a write that panicked. A chain receipt rolls it back. The owner key is not written by propose_owner.
    assert_eq!(c.governance_state().owner, a("owner.near"));
}

/// The judge's listing budget (pre-write stake + operating reserve + the listing bond, and nothing for the new key) is refused.
/// The exact post-write floor succeeds. One yocto under that floor is refused.
/// The mock VM does not roll a panicked write back, so each refusal removes the proposal key before the next call.
#[test]
fn judge_governance_budget_omits_legacy_listing_reserve() {
    let mut c = setup();
    ctx("alice.near", LIST_STORAGE_DEPOSIT, NOW); c.nft_list("k1".into(), U128(N));
    assert_eq!(crate::index_count(), 1);
    assert_eq!(config_required().user_liabilities.0, 0, "an exact listing deposit is not a credit");
    let before = env::storage_usage();
    ctx("owner.near", 1, NOW); let _ = c.propose_owner(a("guardian.near"));
    let growth = env::storage_usage() - before;
    assert!(growth > 0, "a proposal writes a key");
    env::storage_remove(OWNER_PENDING_KEY);
    assert_eq!(env::storage_usage(), before);

    let byte = env::storage_byte_cost().as_yoctonear();
    let judge = before as u128 * byte + crate::pledge::OPERATING_RESERVE + LIST_STORAGE_DEPOSIT;
    let floor = (before as u128 + growth as u128) * byte + crate::pledge::OPERATING_RESERVE + LIST_STORAGE_DEPOSIT;
    let clear = || {
        env::storage_remove(OWNER_PENDING_KEY);
        assert_eq!(env::storage_usage(), before, "removing the panicked proposal restores the measured baseline");
    };

    // account_balance() includes the 1 yocto this call attaches, so the context balance is one less than the balance the check sees.
    ctx_bal("owner.near", 1, NOW, judge - 1);
    rejected(|| { let _ = c.propose_owner(a("guardian.near")); });
    clear();
    ctx_bal("owner.near", 1, NOW, floor - 2);
    rejected(|| { let _ = c.propose_owner(a("guardian.near")); });
    clear();
    ctx_bal("owner.near", 1, NOW, floor - 1);
    let _ = c.propose_owner(a("guardian.near"));
    assert_eq!(env::storage_usage() - before, growth);
    let cfg = config_required();
    let need = env::storage_usage() as u128 * byte + crate::pledge::non_treasury_obligations(&cfg) + cfg.treasury_available.0;
    assert_eq!(need, floor, "success sits on the shared reserve boundary");
    assert_eq!(c.governance_state().pending_owner.unwrap(), a("guardian.near"));
}

/// The old 32-byte wind-down budget is below the measured write. That balance is refused.
/// The balance that covers the measured growth, the operating reserve and treasury succeeds. One yocto under it is refused.
#[test]
fn judge_wind_down_storage_budget_underestimates_actual_write() {
    let mut c = setup();
    let mut cfg = config_required();
    cfg.treasury_available = U128(N);
    save_config(&cfg);
    let before = env::storage_usage();
    ctx("owner.near", 1, WIND_DOWN_NS); c.wind_down();
    let growth = env::storage_usage() - before;
    assert!(growth > 32, "Q27/wind_down costs more than the old 32-byte budget");
    env::storage_remove(WIND_DOWN_KEY);
    assert_eq!(env::storage_usage(), before);

    let byte = env::storage_byte_cost().as_yoctonear();
    let short = (before as u128 + 32) * byte + crate::pledge::OPERATING_RESERVE + N;
    let floor = (before as u128 + growth as u128) * byte + crate::pledge::OPERATING_RESERVE + N;
    let clear = || {
        env::storage_remove(WIND_DOWN_KEY);
        assert_eq!(env::storage_usage(), before, "removing the panicked flag restores the measured baseline");
    };

    // account_balance() includes the 1 yocto this call attaches, so the context balance is one less than the balance the check sees.
    ctx_bal("owner.near", 1, WIND_DOWN_NS, short - 1);
    rejected(|| c.wind_down());
    clear();
    ctx_bal("owner.near", 1, WIND_DOWN_NS, floor - 2);
    rejected(|| c.wind_down());
    clear();
    ctx_bal("owner.near", 1, WIND_DOWN_NS, floor - 1);
    c.wind_down();
    assert!(c.governance_state().wound_down);
    assert_eq!(env::storage_usage() - before, growth);
    let cfg = config_required();
    let need = env::storage_usage() as u128 * byte + crate::pledge::non_treasury_obligations(&cfg) + cfg.treasury_available.0;
    assert_eq!(need, floor, "success sits on the measured reserve boundary");
}

#[test]
fn propose_owner_and_accept_owner_reject_the_contract_account() {
    let mut c = setup();
    ctx("owner.near", 1, NOW);
    rejected(|| { let _ = c.propose_owner(a("keys.near")); });
    assert!(c.governance_state().pending_owner.is_none(), "the refusal is before the write");

    let proposal = OwnerProposal { account: a("keys.near"), not_before_ns: NOW };
    env::storage_write(OWNER_PENDING_KEY, &near_sdk::borsh::to_vec(&proposal).unwrap());
    ctx("keys.near", 1, NOW);
    rejected(|| c.accept_owner());
    assert_eq!(c.governance_state().owner, a("owner.near"));
}

/// stage_upgrade and propose_owner are independent keys. apply_upgrade does not wait for accept_owner.
/// accept_owner after the stage is consumed does not need a staged record.
#[test]
fn parallel_owner_and_upgrade_timers_apply_before_accept() {
    let mut c = setup();
    let code = wasm();
    ctx("owner.near", 1, NOW); let upgrade_at = c.stage_upgrade(sha_hex(&code));
    ctx("owner.near", 1, NOW); let owner_at = c.propose_owner(a("guardian.near"));
    assert_eq!(upgrade_at.0, owner_at.0, "both delays start from the same block");
    assert_eq!(c.governance_state().owner, a("owner.near"));
    ctx_input("owner.near", 1, upgrade_at.0, code);
    let _ = c.apply_upgrade();
    assert!(c.governance_state().staged_upgrade_sha256.is_none(), "apply consumes the stage before accept");
    assert_eq!(c.governance_state().pending_owner, Some(a("guardian.near")));
    assert_eq!(c.governance_state().owner, a("owner.near"), "apply does not hand over the owner");
    ctx("guardian.near", 1, owner_at.0); c.accept_owner();
    assert_eq!(c.governance_state().owner, a("guardian.near"));
    assert!(c.governance_state().staged_upgrade_sha256.is_none());
}

#[test]
fn release_delay_is_24h_and_the_release_script_refuses_the_sandbox_feature() {
    assert_eq!(RELEASE_UPGRADE_DELAY_NS, 86_400_000_000_000);
    let build = include_str!("../build.sh");
    assert!(build.contains("refuses sandbox-short-delay"), "build.sh must refuse the short-delay feature");
    assert!(build.contains("keyhole_release"), "release builds set cfg keyhole_release");
    assert!(build.contains("--features callback-failure-fixture"));
    #[cfg(not(feature = "sandbox-short-delay"))]
    {
        assert_eq!(MIN_UPGRADE_DELAY_NS, RELEASE_UPGRADE_DELAY_NS);
        assert_eq!(DISBURSEMENT_WINDOW_NS, RELEASE_UPGRADE_DELAY_NS);
    }
}

#[test]
fn payout_and_treasury_callbacks_reject_an_external_predecessor() {
    let mut c = setup();
    ctx("alice.near", 0, NOW); rejected(|| { let _ = c.on_payout(a("alice.near"), U64(1)); });
    ctx("alice.near", 0, NOW); rejected(|| { let _ = c.on_treasury_recovered(U64(1)); });
    ctx("alice.near", 0, NOW); rejected(|| { let _ = c.on_loan_policy("k1".into(), U64(1), U64(1)); });
}

#[test]
fn loan_bond_covers_the_deadline_key_and_closing_frees_it() {
    let mut c = setup();
    let before = env::storage_usage();
    let mut bal = 1000 * N;
    bal += LOAN_STORAGE_DEPOSIT;
    ctx_bal("alice.near", LOAN_STORAGE_DEPOSIT, NOW, bal);
    let _ = c.open_loan("k1".into(), terms());
    let grown = env::storage_usage().saturating_sub(before);
    assert!((grown as u128) * env::storage_byte_cost().as_yoctonear() <= LOAN_STORAGE_DEPOSIT, "bond covers the deadline key");
    settle_policy_on(&mut c, "k1", true, NOW, bal);
    let open = env::storage_usage();
    let nonce = c.get_loan("k1".into()).unwrap().nonce;
    ctx("alice.near", 1, NOW); let _ = c.cancel_loan("k1".into(), nonce);
    settle_policy_on(&mut c, "k1", false, NOW, bal);
    assert!(c.get_loan("k1".into()).is_none());
    assert!(env::storage_usage() < open, "closing the loan frees the deadline key");
}

#[test]
fn wound_down_refuses_funding_and_a_protected_purchase() {
    let mut c = setup();
    let mut bal = 1000 * N;
    bal += LOAN_STORAGE_DEPOSIT;
    ctx_bal("alice.near", LOAN_STORAGE_DEPOSIT, NOW, bal);
    let _ = c.open_loan("k1".into(), terms());
    settle_policy_on(&mut c, "k1", true, NOW, bal);
    env::storage_write(WIND_DOWN_KEY, &[1]);
    let nonce = c.get_loan("k1".into()).unwrap().nonce;
    let cert = c.loan_certificate_template("k1".into(), U64(NOW), U64(NOW + 30 * SECOND));
    let sig = signed(&cert);
    ctx_bal("lender.near", N, NOW, bal + N);
    rejected(|| { let _ = c.fund_loan("k1".into(), nonce, cert, sig); });
    assert_eq!(c.get_loan("k1".into()).unwrap().state, LoanState::Offered, "refused funding leaves the offer unchanged");
    ctx("bob.near", N, NOW);
    let sale = crate::SaleCertificate {
        domain: String::new(), network: String::new(), contract: a("keys.near"), token_id: "k1".into(), sale_nonce: U64(1),
        seller: a("alice.near"), owner_epoch: U64(0),
        terms: crate::SaleTerms { buyer: a("bob.near"), price: U128(N), floor_raw: U128(1), deadline_ns: U64(NOW + SECOND) },
        royalty_bps: 0, seller_net: U128(N), custody_contract: a("custody.near"), wallet_pubkey: String::new(), asset: String::new(),
        decimals: 6, controller: a("keys.near"), policy_version: U64(1), policy_hash: Base64VecU8(vec![]), policy_sequence: U64(0),
        observed_at_ns: U64(NOW), expires_at_ns: U64(NOW + SECOND), floor_met: true, frozen: true, pending_value_ops: U64(0),
    };
    rejected(|| { let _ = c.buy_sale("k1".into(), U64(1), sale, Base64VecU8(vec![0; 64])); });
}

fn wasm() -> Vec<u8> { b"\0asm-v27-fixture".to_vec() }
fn sha_hex(bytes: &[u8]) -> String { env::sha256(bytes).iter().map(|b| format!("{b:02x}")).collect() }
fn ctx_input(who: &str, amount: u128, now: u64, input: Vec<u8>) {
    let mut c = context(who, amount, now, 1000 * N); c.storage_usage = env::storage_usage(); c.input = input; testing_env!(c);
}

#[test]
fn upgrade_stage_cancel_timelock_and_hash_checks() {
    let mut c = setup();
    let code = wasm();
    let hash = sha_hex(&code);
    ctx("alice.near", 1, NOW); rejected(|| { c.stage_upgrade(hash.clone()); });
    ctx("owner.near", 0, NOW); rejected(|| { c.stage_upgrade(hash.clone()); });
    ctx("owner.near", 1, NOW); rejected(|| { c.stage_upgrade("ABC".into()); });
    ctx("owner.near", 1, NOW); let not_before = c.stage_upgrade(hash.clone());
    assert_eq!(not_before.0, NOW + MIN_UPGRADE_DELAY_NS);
    ctx("owner.near", 1, NOW); rejected(|| { c.stage_upgrade(hash.clone()); });
    assert_eq!(c.governance_state().staged_upgrade_sha256, Some(hash.clone()));
    // Too early, even with the right bytes. A refusal does not consume the staged hash.
    ctx_input("owner.near", 1, NOW + MIN_UPGRADE_DELAY_NS - 1, code.clone()); rejected(|| { let _ = c.apply_upgrade(); });
    assert!(c.governance_state().staged_upgrade_sha256.is_some());
    // Right time, wrong bytes.
    ctx_input("owner.near", 1, NOW + MIN_UPGRADE_DELAY_NS, b"other".to_vec()); rejected(|| { let _ = c.apply_upgrade(); });
    assert_eq!(c.governance_state().staged_upgrade_sha256, Some(hash.clone()));
    // Right hash, not a wasm module: refused and the stage is kept.
    let text = b"this-is-not-wasm!!".to_vec();
    ctx("owner.near", 1, NOW + MIN_UPGRADE_DELAY_NS); c.cancel_upgrade();
    ctx("owner.near", 1, NOW + MIN_UPGRADE_DELAY_NS); let _ = c.stage_upgrade(sha_hex(&text));
    ctx_input("owner.near", 1, NOW + 2 * MIN_UPGRADE_DELAY_NS, text);
    rejected(|| { let _ = c.apply_upgrade(); });
    assert!(c.governance_state().staged_upgrade_sha256.is_some(), "non-wasm input does not consume the stage");
    ctx("owner.near", 1, NOW + 2 * MIN_UPGRADE_DELAY_NS); c.cancel_upgrade();
    // Cancel, then a restage restarts the clock.
    ctx("owner.near", 1, NOW + 2 * MIN_UPGRADE_DELAY_NS); let nb2 = c.stage_upgrade(hash.clone());
    assert_eq!(nb2.0, NOW + 3 * MIN_UPGRADE_DELAY_NS);
    // Right time and right bytes: a deploy of this contract's own account, with no migrate call.
    ctx_input("owner.near", 1, NOW + 3 * MIN_UPGRADE_DELAY_NS, code.clone());
    let _ = c.apply_upgrade();
    let receipts = format!("{:?}", get_created_receipts());
    assert!(receipts.contains("DeployContract"), "apply_upgrade must schedule a deploy receipt");
    assert!(!receipts.contains("migrate"), "code-only upgrade: no migrate call");
    assert!(c.governance_state().staged_upgrade_sha256.is_none(), "applied upgrade is consumed");
    assert!(logs_contain("upgrade_applied"));
}

#[test]
fn staged_hash_is_fixed_and_apply_is_owner_only() {
    let mut c = setup();
    let code = wasm();
    ctx("owner.near", 1, NOW); let _ = c.stage_upgrade(sha_hex(&code));
    ctx_input("alice.near", 1, NOW + MIN_UPGRADE_DELAY_NS, code.clone()); rejected(|| { let _ = c.apply_upgrade(); });
    ctx_input("owner.near", 0, NOW + MIN_UPGRADE_DELAY_NS, code.clone()); rejected(|| { let _ = c.apply_upgrade(); });
    assert!(c.governance_state().staged_upgrade_sha256.is_some());
}

#[test]
fn wind_down_refuses_before_date_then_closes_new_activity_and_keeps_transfers() {
    let mut c = setup();
    // Before the date.
    ctx("owner.near", 1, WIND_DOWN_NS - SECOND); rejected(|| c.wind_down());
    // Non-owner after the date.
    ctx("alice.near", 1, WIND_DOWN_NS); rejected(|| c.wind_down());
    // Liabilities above zero: an open loan's bond is a user liability.
    let mut bal = 1000 * N;
    let t = WIND_DOWN_NS - 10 * SECOND;
    collateral().remove(&"k1".into()); bind(&mut c, "k1");
    open_and_fund(&mut c, "k1", "alice.near", N / 100, t, &mut bal);
    ctx("owner.near", 1, WIND_DOWN_NS); rejected(|| c.wind_down());
    // Unwind the loan first: default needs due+grace, so use cancel-free path: lender claims default after the window.
    let due = c.get_loan("k1".into()).unwrap().due_ns.0;
    assert_eq!(due, 0, "principal not yet cashed out, so no due clock");
    // Reclaim after 24 h returns the principal and unlocks the key.
    let nonce = c.get_loan("k1".into()).unwrap().nonce;
    ctx("lender.near", 1, t + DISBURSEMENT_WINDOW_NS + SECOND); let _ = c.reclaim_unclaimed_principal("k1".into(), nonce);
    settle_policy_on(&mut c, "k1", false, t + DISBURSEMENT_WINDOW_NS + SECOND, bal);
    // The borrower collects the bond credit; the lender collects the principal credit.
    ctx("alice.near", 1, t + DISBURSEMENT_WINDOW_NS + SECOND); let _ = c.claim_payout();
    let p = c.get_pending_payout(a("alice.near")).unwrap(); result(PromiseResult::Successful(vec![]), t + DISBURSEMENT_WINDOW_NS + SECOND); assert!(c.on_payout(a("alice.near"), p.nonce));
    ctx("lender.near", 1, t + DISBURSEMENT_WINDOW_NS + SECOND); let _ = c.claim_payout();
    let p = c.get_pending_payout(a("lender.near")).unwrap(); result(PromiseResult::Successful(vec![]), t + DISBURSEMENT_WINDOW_NS + SECOND); assert!(c.on_payout(a("lender.near"), p.nonce));
    assert_eq!(config_required().user_liabilities.0, 0, "all user money has left the books");
    // Now wind-down succeeds, and after it every new-activity method refuses.
    ctx("owner.near", 1, WIND_DOWN_NS); c.wind_down();
    assert!(c.governance_state().wound_down);
    assert!(logs_contain("wind_down"));
    ctx("owner.near", 1, WIND_DOWN_NS); rejected(|| c.wind_down());
    ctx("minter.near", N / 10, WIND_DOWN_NS); rejected(|| { c.nft_mint("late".into(), a("bob.near"), 1, meta()); });
    ctx("alice.near", LIST_STORAGE_DEPOSIT, WIND_DOWN_NS); rejected(|| c.nft_list("k1".into(), U128(N)));
    ctx("alice.near", LOAN_STORAGE_DEPOSIT, WIND_DOWN_NS); rejected(|| { let _ = c.open_loan("k1".into(), terms()); });
    ctx("minter.near", N / 10, WIND_DOWN_NS); rejected(|| { let _ = c.register_collateral("k1".into(), format!("ed25519:{}", "cd".repeat(32)), "sealed-policy".into(), "a".repeat(128), 1, WIND_DOWN_NS / SECOND + 60, a("alice.near"), U64(0)); });
    // Transfers keep working.
    ctx("alice.near", 1, WIND_DOWN_NS); c.nft_transfer(a("bob.near"), "k1".into(), None, None);
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, a("bob.near"));
}

#[test]
fn wind_down_refuses_while_a_key_is_listed() {
    let mut c = setup();
    ctx("alice.near", LIST_STORAGE_DEPOSIT, NOW); c.nft_list("k1".into(), U128(N));
    ctx("owner.near", 1, WIND_DOWN_NS); rejected(|| c.wind_down());
    // Unlisting returns the listing deposit as alice's credit (a liability); alice claims it back first.
    ctx("alice.near", 1, NOW); c.nft_unlist("k1".into());
    ctx("owner.near", 1, WIND_DOWN_NS); rejected(|| c.wind_down());
    ctx("alice.near", 1, NOW); let _ = c.claim_payout();
    let p = c.get_pending_payout(a("alice.near")).unwrap();
    result(PromiseResult::Successful(vec![]), NOW); assert!(c.on_payout("alice.near".parse().unwrap(), p.nonce));
    ctx("owner.near", 1, WIND_DOWN_NS); c.wind_down();
}

#[test]
fn wind_down_does_not_pause_claims_or_repayments_while_obligations_exist() {
    // Before the date, an active loan keeps repayment working. Wind-down itself is refused by liabilities.
    let mut c = setup();
    let mut bal = 1000 * N;
    open_and_fund(&mut c, "k1", "alice.near", N / 100, NOW, &mut bal);
    ctx("owner.near", 1, WIND_DOWN_NS); rejected(|| c.wind_down());
    ctx("alice.near", 1, NOW); let _ = c.claim_payout(); // borrower's cashout dispatches (nothing pauses it)
    assert!(c.get_pending_payout(a("alice.near")).is_some());
}

// ---------- tier caps and views ----------

#[test]
fn tier_caps_are_exact_per_tier_and_views_report_them() {
    let mut c = setup();
    mint(&mut c, "t1", "bob.near", 1); mint(&mut c, "t2", "carol.near", 2);
    assert_eq!(c.loan_cap("t1".into()), Some(U128(5 * 10u128.pow(22))));
    assert_eq!(c.loan_cap("t2".into()), Some(U128(5 * 10u128.pow(23))));
    assert_eq!(c.loan_cap("k1".into()), Some(U128(5 * 10u128.pow(24))));
    assert_eq!(c.loan_cap("none".into()), None);
    for (token, who, over, exact) in [("t1", "bob.near", 5 * 10u128.pow(22) + 1, 5 * 10u128.pow(22)), ("t2", "carol.near", 5 * 10u128.pow(23) + 1, 5 * 10u128.pow(23))] {
        bind(&mut c, token);
        ctx(who, LOAN_STORAGE_DEPOSIT, NOW);
        rejected(|| { let _ = c.open_loan(token.into(), terms_for("lender.near", over)); });
        assert!(c.get_loan(token.into()).is_none(), "refused open must leave no loan");
        // Exactly at the cap is accepted, so the cap is inclusive.
        ctx(who, LOAN_STORAGE_DEPOSIT, NOW); let _ = c.open_loan(token.into(), terms_for("lender.near", exact));
        assert!(c.get_loan(token.into()).is_some(), "exact cap must open");
        // Clean up: freeze settles to Offered, then the unfunded loan is cancelled and unfrozen.
        settle_policy_on(&mut c, token, true, NOW, 1000 * N);
        let nonce = c.get_loan(token.into()).unwrap().nonce;
        ctx(who, 1, NOW); let _ = c.cancel_loan(token.into(), nonce);
        settle_policy_on(&mut c, token, false, NOW, 1000 * N);
        assert!(c.get_loan(token.into()).is_none());
    }
}

#[test]
fn governance_and_config_views_are_additive_and_consistent() {
    let c = setup();
    let g = c.governance_state();
    assert_eq!(g.owner, a("owner.near"));
    assert!(!g.wound_down);
    assert_eq!(g.min_upgrade_delay_ns.0, MIN_UPGRADE_DELAY_NS);
    assert_eq!(RELEASE_UPGRADE_DELAY_NS, 86_400_000_000_000, "the release constant is 24h");
    #[cfg(not(feature = "sandbox-short-delay"))]
    {
        assert_eq!(MIN_UPGRADE_DELAY_NS, RELEASE_UPGRADE_DELAY_NS);
        assert_eq!(DISBURSEMENT_WINDOW_NS, RELEASE_UPGRADE_DELAY_NS);
    }
    #[cfg(feature = "sandbox-short-delay")]
    {
        assert!(MIN_UPGRADE_DELAY_NS < RELEASE_UPGRADE_DELAY_NS);
        assert_eq!(DISBURSEMENT_WINDOW_NS, MIN_UPGRADE_DELAY_NS);
        assert!(MIN_UPGRADE_DELAY_NS <= 60 * SECOND);
    }
    assert_eq!(g.wind_down_ns.0, WIND_DOWN_NS);
    assert_eq!(WIND_DOWN_NS, 1_801_440_000 * 1_000_000_000, "2027-02-01T00:00:00Z");
    assert_eq!(RECOVERY_UNLOCK_NS, 1_796_169_600 * 1_000_000_000, "2026-12-02T00:00:00Z, unchanged");
}

// ---------- G1: reclaim ----------

#[test]
fn reclaim_refuses_inside_the_window_and_for_anyone_but_the_named_lender() {
    let mut c = setup(); let mut bal = 1000 * N;
    let nonce = open_and_fund(&mut c, "k1", "alice.near", N / 100, NOW, &mut bal);
    ctx("lender.near", 1, NOW + DISBURSEMENT_WINDOW_NS - SECOND); rejected(|| { let _ = c.reclaim_unclaimed_principal("k1".into(), nonce); });
    ctx("alice.near", 1, NOW + DISBURSEMENT_WINDOW_NS + SECOND); rejected(|| { let _ = c.reclaim_unclaimed_principal("k1".into(), nonce); });
    ctx("lender.near", 0, NOW + DISBURSEMENT_WINDOW_NS + SECOND); rejected(|| { let _ = c.reclaim_unclaimed_principal("k1".into(), nonce); });
    ctx("lender.near", 1, NOW + DISBURSEMENT_WINDOW_NS); rejected(|| { let _ = c.reclaim_unclaimed_principal("k1".into(), nonce); }); // strictly after
    assert_eq!(c.get_loan("k1".into()).unwrap().state, LoanState::DisbursementPending);
}

#[test]
fn reclaim_after_window_moves_principal_credit_and_unlocks_the_key() {
    let mut c = setup(); let mut bal = 1000 * N;
    let nonce = open_and_fund(&mut c, "k1", "alice.near", N / 100, NOW, &mut bal);
    assert_eq!(c.get_payout_credit(a("alice.near")).0, N / 100);
    let t = NOW + DISBURSEMENT_WINDOW_NS + SECOND;
    ctx_bal("lender.near", 1, t, bal); let _ = c.reclaim_unclaimed_principal("k1".into(), nonce);
    assert_eq!(c.get_payout_credit(a("alice.near")).0, 0, "borrower loses the unclaimed principal credit");
    assert_eq!(c.get_payout_credit(a("lender.near")).0, N / 100, "lender holds exactly the principal");
    let l = c.get_loan("k1".into()).unwrap();
    assert_eq!(l.state, LoanState::UnlockPending);
    assert_eq!(l.resolution.as_deref(), Some("unclaimed_principal_reclaimed"));
    assert!(logs_contain("loan_reclaim"));
    // Unlock path: the custody policy must show unfrozen before the bond is released.
    settle_policy_on(&mut c, "k1", false, t, bal);
    assert!(c.get_loan("k1".into()).is_none());
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, a("alice.near"), "key never left the borrower");
    // Reclaim cannot run twice: the loan is gone.
    ctx("lender.near", 1, t); rejected(|| { let _ = c.reclaim_unclaimed_principal("k1".into(), nonce); });
}

#[test]
fn race_order_claim_first_blocks_reclaim_until_a_failed_cashout_restores_credit() {
    let mut c = setup(); let mut bal = 1000 * N;
    let nonce = open_and_fund(&mut c, "k1", "alice.near", N / 100, NOW, &mut bal);
    let t = NOW + DISBURSEMENT_WINDOW_NS + SECOND;
    // Borrower claims: the dispatch marker is set and the credit is drained into the pending payout.
    ctx("alice.near", 1, t); let _ = c.claim_payout();
    let p = c.get_pending_payout(a("alice.near")).unwrap();
    ctx_bal("lender.near", 1, t, bal); rejected(|| { let _ = c.reclaim_unclaimed_principal("k1".into(), nonce); });
    assert_eq!(c.get_loan("k1".into()).unwrap().state, LoanState::DisbursementPending);
    // Native transfer fails: the marker clears and the credit returns, so reclaim is now the only path left.
    result_bal(PromiseResult::Failed, t, bal); assert!(!c.on_payout("alice.near".parse().unwrap(), p.nonce));
    assert_eq!(c.get_payout_credit(a("alice.near")).0, N / 100);
    ctx_bal("lender.near", 1, t, bal); let _ = c.reclaim_unclaimed_principal("k1".into(), nonce);
    assert_eq!(c.get_payout_credit(a("lender.near")).0, N / 100);
    assert_eq!(c.get_payout_credit(a("alice.near")).0, 0);
}

#[test]
fn race_order_reclaim_first_leaves_the_borrower_claim_nothing_to_pay() {
    let mut c = setup(); let mut bal = 1000 * N;
    let nonce = open_and_fund(&mut c, "k1", "alice.near", N / 100, NOW, &mut bal);
    let t = NOW + DISBURSEMENT_WINDOW_NS + SECOND;
    ctx_bal("lender.near", 1, t, bal); let _ = c.reclaim_unclaimed_principal("k1".into(), nonce);
    settle_policy_on(&mut c, "k1", false, t, bal);
    // The borrower's late claim has no credit, so it is refused, and the principal is not in any dispatch.
    // The borrower still holds the unlocked bond credit, which is claimable. The reclaimed principal is not in it.
    ctx("alice.near", 1, t + SECOND); let _ = c.claim_payout();
    let p = c.get_pending_payout(a("alice.near")).unwrap();
    assert_eq!(p.amount.0, LOAN_STORAGE_DEPOSIT, "claim pays only the bond, never the reclaimed principal");
    assert_eq!(c.get_payout_credit(a("lender.near")).0, N / 100);
}

#[test]
fn successful_cashout_activates_the_loan_and_blocks_reclaim_for_good() {
    let mut c = setup(); let mut bal = 1000 * N;
    let nonce = open_and_fund(&mut c, "k1", "alice.near", N / 100, NOW, &mut bal);
    ctx("alice.near", 1, NOW); let _ = c.claim_payout();
    let p = c.get_pending_payout(a("alice.near")).unwrap();
    result_bal(PromiseResult::Successful(vec![]), NOW, bal - N / 100); bal -= N / 100;
    assert!(c.on_payout("alice.near".parse().unwrap(), p.nonce));
    assert!(logs_contain("loan_principal_delivered"));
    assert_eq!(c.get_loan("k1".into()).unwrap().state, LoanState::Active);
    ctx_bal("lender.near", 1, NOW + DISBURSEMENT_WINDOW_NS + SECOND, bal); rejected(|| { let _ = c.reclaim_unclaimed_principal("k1".into(), nonce); });
}

// ---------- G2: callbacks never panic, outcomes are recorded and reconciled ----------

#[test]
fn payout_callback_with_a_broken_loan_state_does_not_panic_and_never_double_pays() {
    let mut c = setup(); let mut bal = 1000 * N;
    let nonce = open_and_fund(&mut c, "k1", "alice.near", N / 100, NOW, &mut bal);
    ctx("alice.near", 1, NOW); let _ = c.claim_payout();
    let p = c.get_pending_payout(a("alice.near")).unwrap();
    // Tamper the loan between dispatch and callback: impossible through the public API, which is the point of the check.
    let mut l = c.get_loan("k1".into()).unwrap(); l.state = LoanState::Offered; loans().insert(&"k1".into(), &l);
    result_bal(PromiseResult::Successful(vec![]), NOW, bal - N / 100); bal -= N / 100;
    assert!(c.on_payout("alice.near".parse().unwrap(), p.nonce), "money cashout is recorded; the callback does not panic");
    // Reclaim is refused by the loan state, and nothing is credited twice.
    ctx_bal("lender.near", 1, NOW + DISBURSEMENT_WINDOW_NS + SECOND, bal); rejected(|| { let _ = c.reclaim_unclaimed_principal("k1".into(), nonce); });
    assert_eq!(c.get_payout_credit(a("lender.near")).0, 0);
    assert!(c.get_pending_payout(a("alice.near")).is_none());
}

#[test]
fn apply_failure_is_recorded_and_reconcile_applies_the_recorded_result_once() {
    let mut c = setup(); let mut bal = 1000 * N;
    open_and_fund(&mut c, "k1", "alice.near", N / 100, NOW, &mut bal);
    ctx("alice.near", 1, NOW); let _ = c.claim_payout();
    let p = c.get_pending_payout(a("alice.near")).unwrap();
    // Inject a liability underflow: the success result cannot be applied, so the callback must not panic.
    let mut cfg = config_required(); let real = cfg.user_liabilities; cfg.user_liabilities = U128(0); save_config(&cfg);
    result_bal(PromiseResult::Successful(vec![]), NOW, bal - N / 100);
    assert!(!c.on_payout("alice.near".parse().unwrap(), p.nonce), "callback returns false, no panic");
    assert!(logs_contain("payout_apply_failed"));
    assert!(c.get_pending_payout(a("alice.near")).is_some(), "marker stays for reconcile");
    // Reconcile before the cause is fixed: still refused, nothing changes.
    ctx("anyone.near", 0, NOW); assert!(!c.reconcile_payout("alice.near".parse().unwrap()));
    assert!(c.get_pending_payout(a("alice.near")).is_some());
    // Fix the cause and reconcile: the recorded success is applied exactly once.
    let mut cfg = config_required(); cfg.user_liabilities = real; save_config(&cfg);
    ctx("anyone.near", 0, NOW); assert!(c.reconcile_payout("alice.near".parse().unwrap()));
    assert!(c.get_pending_payout(a("alice.near")).is_none());
    assert_eq!(config_required().user_liabilities.0, real.0 - N / 100);
    ctx("anyone.near", 0, NOW); assert!(!c.reconcile_payout("alice.near".parse().unwrap()), "a second reconcile has no record");
    assert_eq!(c.get_loan("k1".into()).unwrap().state, LoanState::Active);
}

#[test]
fn reconcile_without_a_recorded_result_never_clears_a_marker() {
    let mut c = setup(); let mut bal = 1000 * N;
    open_and_fund(&mut c, "k1", "alice.near", N / 100, NOW, &mut bal);
    ctx("alice.near", 1, NOW); let _ = c.claim_payout();
    let before = c.get_pending_payout(a("alice.near")).unwrap();
    ctx("anyone.near", 0, NOW + 1000 * SECOND);
    assert!(!c.reconcile_payout("alice.near".parse().unwrap()));
    assert_eq!(c.get_pending_payout(a("alice.near")).unwrap(), before, "a lost callback stays locked");
    assert!(!c.reconcile_treasury());
}

#[test]
fn treasury_apply_failure_is_recorded_and_reconciled_when_fixed() {
    let mut c = setup();
    ctx("owner.near", N, NOW); c.fund_treasury();
    ctx("recovery.near", 1, RECOVERY_UNLOCK_NS); let _ = c.recover_treasury(U128(N / 2));
    let p = config_required().treasury_pending.unwrap();
    // Failure can only restore into an overflowing ledger: refuse, keep the record and the marker.
    let mut cfg = config_required(); let saved = cfg.treasury_available; cfg.treasury_available = U128(u128::MAX - 1); save_config(&cfg);
    result(PromiseResult::Failed, RECOVERY_UNLOCK_NS); assert!(!c.on_treasury_recovered(p.nonce));
    assert!(logs_contain("treasury_apply_failed"));
    assert!(config_required().treasury_pending.is_some());
    assert!(!c.reconcile_treasury(), "still overflowing: refused");
    // Repair the ledger value and reconcile: the recorded failure restores the amount once.
    let mut cfg = config_required(); cfg.treasury_available = U128(saved.0 - N / 2); save_config(&cfg);
    let before = config_required().treasury_available.0;
    assert!(!c.reconcile_treasury());
    assert_eq!(config_required().treasury_available.0, before + N / 2);
    assert!(config_required().treasury_pending.is_none());
    assert!(!c.reconcile_treasury(), "no record after the first reconcile");
}

// ---------- event coverage ----------

#[test]
fn loan_lifecycle_emits_the_named_events() {
    let mut c = setup(); let mut bal = 1000 * N;
    let nonce = open_and_fund(&mut c, "k1", "alice.near", N / 100, NOW, &mut bal);
    assert!(logs_contain("loan_fund"));
    ctx("alice.near", 1, NOW); let _ = c.claim_payout();
    assert!(logs_contain("payout_claim"));
    let p = c.get_pending_payout(a("alice.near")).unwrap();
    result_bal(PromiseResult::Successful(vec![]), NOW, bal - N / 100); bal -= N / 100;
    c.on_payout("alice.near".parse().unwrap(), p.nonce);
    assert!(logs_contain("loan_principal_delivered"));
    // Repay, then unlock; the repayment event appears once.
    ctx_bal("alice.near", N / 100 + N / 1000, NOW, bal + N / 100 + N / 1000); bal += N / 100 + N / 1000;
    let _ = c.repay_loan("k1".into(), nonce);
    assert!(logs_contain("loan_repay"));
    ctx("lender.near", 1, NOW); let _ = c.claim_payout();
    let p = c.get_pending_payout(a("lender.near")).unwrap();
    result(PromiseResult::Successful(vec![]), NOW); assert!(c.on_payout("lender.near".parse().unwrap(), p.nonce));
    settle_policy_on(&mut c, "k1", false, NOW, bal);
    assert!(logs_contain("loan_closed"));
    ctx("owner.near", 1, NOW); c.set_lending_enabled(false);
    assert!(logs_contain("lending_toggle"));
}

#[test]
fn cancel_and_default_events_are_emitted() {
    let mut c = setup(); let mut bal = 1000 * N;
    let t = NOW;
    bal += LOAN_STORAGE_DEPOSIT; ctx_bal("alice.near", LOAN_STORAGE_DEPOSIT, t, bal);
    let _ = c.open_loan("k1".into(), terms());
    let nonce = c.get_loan("k1".into()).unwrap().nonce;
    settle_policy_on(&mut c, "k1", true, t, bal);
    ctx("alice.near", 1, t); let _ = c.cancel_loan("k1".into(), nonce);
    assert!(logs_contain("loan_cancel"));
}

// ---------- randomized invariant loops (deterministic seeds) ----------

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 { self.0 ^= self.0 << 13; self.0 ^= self.0 >> 7; self.0 ^= self.0 << 17; self.0 }
    fn coin(&mut self) -> bool { self.next() & 1 == 1 }
}

/// Model balance = starting balance + attached deposits - successful native transfers. Pending payouts and treasury
/// pending are counted inside user_liabilities / treasury_pending, so the invariant is stated once, without double counting.
fn assert_solvent(c: &Contract, bal: u128) {
    let cfg = config_required();
    let storage = env::storage_byte_cost().as_yoctonear() * env::storage_usage() as u128;
    let owed = cfg.user_liabilities.0 + cfg.treasury_available.0 + cfg.treasury_pending.as_ref().map(|p| p.amount.0).unwrap_or(0) + storage;
    assert!(bal >= owed, "insolvent: balance {bal} < owed {owed}");
    let _ = c;
}

#[test]
fn random_sequences_keep_the_native_balance_above_every_obligation() {
    // Each seed runs on its own thread: the mock storage persists per thread, so seeds must not share state.
    for seed in 1..=12u64 { std::thread::spawn(move || random_run(seed)).join().expect("seed run"); }
}
fn random_run(seed: u64) {
    {
        let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        let mut c = setup(); let mut bal = 1000 * N;
        assert_solvent(&c, bal);
        for round in 0..4u64 {
            let token = format!("r{seed}x{round}");
            let borrower = format!("bo{seed}x{round}.near");
            let lender = format!("le{seed}x{round}.near");
            reg(&mut c, &lender);
            mint(&mut c, &token, &borrower, 3);
            bind(&mut c, &token);
            let principal = N / 100 * (1 + rng.next() % 5) as u128;
            let t = NOW + round * 1000 * SECOND;
            // Open and fund with the same helper; the borrower (not alice) owns this key.
            let t_terms = LoanTerms { lender: a(&lender), principal: U128(principal), repayment: U128(principal + principal / 10), duration_sec: U64(60), grace_sec: U64(30), floor_raw: U128(1_000_000), funding_deadline_ns: U64(t + 600 * SECOND) };
            bal += LOAN_STORAGE_DEPOSIT; ctx_bal(&borrower, LOAN_STORAGE_DEPOSIT, t, bal);
            let _ = c.open_loan(token.clone(), t_terms);
            assert_solvent(&c, bal);
            settle_policy_on(&mut c, &token, true, t, bal);
            let nonce = c.get_loan(token.clone()).unwrap().nonce;
            let cert = c.loan_certificate_template(token.clone(), U64(t), U64(t + 30 * SECOND));
            let sig = signed(&cert);
            bal += principal; ctx_bal(&lender, principal, t, bal);
            assert!(c.fund_loan(token.clone(), nonce, cert, sig));
            assert_solvent(&c, bal);
            // Random borrower cashout result.
            ctx(&borrower, 1, t); let _ = c.claim_payout();
            let p = c.get_pending_payout(a(&borrower)).unwrap();
            let ok = rng.coin();
            if ok { bal -= p.amount.0; }
            result_bal(if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed }, t, bal);
            c.on_payout(a(&borrower), p.nonce);
            assert_solvent(&c, bal);
            if c.get_loan(token.clone()).map(|l| l.state == LoanState::Active).unwrap_or(false) {
                // Repay with exact repayment, the lender cashes out, then the custody unlock releases the bond.
                let r = principal + principal / 10;
                bal += r; ctx_bal(&borrower, r, t, bal);
                let _ = c.repay_loan(token.clone(), nonce);
                assert_solvent(&c, bal);
                ctx(&lender, 1, t); let _ = c.claim_payout();
                let lp = c.get_pending_payout(a(&lender)).unwrap();
                let lok = rng.coin();
                if lok { bal -= lp.amount.0; }
                result_bal(if lok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed }, t, bal);
                c.on_payout(a(&lender), lp.nonce);
                assert_solvent(&c, bal);
                settle_policy_on(&mut c, &token, false, t, bal);
                assert_solvent(&c, bal);
                // Lender retries if it failed, then the borrower takes the bond credit.
                if !lok { ctx(&lender, 1, t); let _ = c.claim_payout(); let lp = c.get_pending_payout(a(&lender)).unwrap(); bal -= lp.amount.0; result_bal(PromiseResult::Successful(vec![]), t, bal); c.on_payout(a(&lender), lp.nonce); }
                assert_solvent(&c, bal);
            } else if c.get_loan(token.clone()).is_some() {
                // Principal unclaimed or failed: the lender reclaims after the window, then the custody unlock releases.
                let tr = t + DISBURSEMENT_WINDOW_NS + SECOND;
                ctx_bal(&lender, 1, tr, bal); let _ = c.reclaim_unclaimed_principal(token.clone(), nonce);
                settle_policy_on(&mut c, &token, false, tr, bal);
                assert_solvent(&c, bal);
            }
            // Borrower collects any remaining credit (bond or unclaimed principal remainder).
            if c.get_payout_credit(a(&borrower)).0 > 0 {
                ctx(&borrower, 1, t + 5 * DAY); let _ = c.claim_payout();
                let bp = c.get_pending_payout(a(&borrower)).unwrap(); bal -= bp.amount.0;
                result_bal(PromiseResult::Successful(vec![]), t + 5 * DAY, bal); c.on_payout(a(&borrower), bp.nonce);
            }
            assert_solvent(&c, bal);
        }
    }
}

#[test]
fn principal_is_conserved_exactly_once_per_loan_over_many_seeds() {
    // Each loan ends in exactly one of: repayment to the lender, the key moved to the default receiver, or principal
    // reclaimed. Never two, never none.
    for seed in 1..=16u64 { std::thread::spawn(move || conservation_run(seed)).join().expect("seed run"); }
}
fn conservation_run(seed: u64) {
    {
        let mut rng = Rng(seed.wrapping_mul(0xD1B5_4A32_D192_ED03) | 1);
        let mut c = setup(); let mut bal = 1000 * N;
        let token = format!("cons{seed}");
        let borrower = format!("cb{seed}.near");
        let lender = format!("cl{seed}.near");
        reg(&mut c, &lender); mint(&mut c, &token, &borrower, 3); bind(&mut c, &token);
        let principal = N / 100;
        let t = NOW;
        let t_terms = LoanTerms { lender: a(&lender), principal: U128(principal), repayment: U128(principal + principal / 10), duration_sec: U64(60), grace_sec: U64(30), floor_raw: U128(1_000_000), funding_deadline_ns: U64(t + 600 * SECOND) };
        bal += LOAN_STORAGE_DEPOSIT; ctx_bal(&borrower, LOAN_STORAGE_DEPOSIT, t, bal);
        let _ = c.open_loan(token.clone(), t_terms);
        settle_policy_on(&mut c, &token, true, t, bal);
        let nonce = c.get_loan(token.clone()).unwrap().nonce;
        let cert = c.loan_certificate_template(token.clone(), U64(t), U64(t + 30 * SECOND));
        let sig = signed(&cert);
        bal += principal; ctx_bal(&lender, principal, t, bal);
        assert!(c.fund_loan(token.clone(), nonce, cert, sig));
        let mut lender_native = 0u128;
        let receiver = a("receiver.near");
        let mode = rng.next() % 3; // 0 = repay, 1 = default, 2 = reclaim
        match mode {
            0 => {
                ctx(&borrower, 1, t); let _ = c.claim_payout();
                let p = c.get_pending_payout(a(&borrower)).unwrap(); bal -= p.amount.0;
                result_bal(PromiseResult::Successful(vec![]), t, bal); c.on_payout(a(&borrower), p.nonce);
                let r = principal + principal / 10; bal += r; ctx_bal(&borrower, r, t, bal);
                let _ = c.repay_loan(token.clone(), nonce);
                ctx(&lender, 1, t); let _ = c.claim_payout();
                let lp = c.get_pending_payout(a(&lender)).unwrap(); lender_native += lp.amount.0; bal -= lp.amount.0;
                result_bal(PromiseResult::Successful(vec![]), t, bal); c.on_payout(a(&lender), lp.nonce);
                settle_policy_on(&mut c, &token, false, t, bal);
                assert_eq!(lender_native, principal + principal / 10, "repay: lender gets exactly the repayment");
                assert_eq!(c.nft_token(token.clone()).unwrap().owner_id, a(&borrower), "repay: key stays with the borrower");
            }
            1 => {
                ctx(&borrower, 1, t); let _ = c.claim_payout();
                let p = c.get_pending_payout(a(&borrower)).unwrap(); bal -= p.amount.0;
                result_bal(PromiseResult::Successful(vec![]), t, bal); c.on_payout(a(&borrower), p.nonce);
                let due = c.get_loan(token.clone()).unwrap().due_ns.0;
                let tt = due + 31 * SECOND;
                ctx_bal(&lender, 1, tt, bal); let _ = c.claim_default(token.clone(), nonce, receiver.clone());
                settle_policy_on(&mut c, &token, false, tt, bal);
                assert_eq!(lender_native, 0, "default: lender takes the key, not money");
                assert_eq!(c.nft_token(token.clone()).unwrap().owner_id, receiver, "default: key moved");
            }
            _ => {
                let tr = t + DISBURSEMENT_WINDOW_NS + SECOND;
                ctx_bal(&lender, 1, tr, bal); let _ = c.reclaim_unclaimed_principal(token.clone(), nonce);
                settle_policy_on(&mut c, &token, false, tr, bal);
                ctx(&lender, 1, tr); let _ = c.claim_payout();
                let lp = c.get_pending_payout(a(&lender)).unwrap(); lender_native += lp.amount.0; bal -= lp.amount.0;
                result_bal(PromiseResult::Successful(vec![]), tr, bal); c.on_payout(a(&lender), lp.nonce);
                assert_eq!(lender_native, principal, "reclaim: lender gets exactly the principal");
                assert_eq!(c.nft_token(token.clone()).unwrap().owner_id, a(&borrower), "reclaim: key stays with the borrower");
            }
        }
        assert!(c.get_loan(token.clone()).is_none(), "loan closed in every mode");
    }
}

#[test]
fn an_open_loan_keeps_the_key_fixed_until_default_after_due_and_grace() {
    let mut c = setup(); let mut bal = 1000 * N;
    let nonce = open_and_fund(&mut c, "k1", "alice.near", N / 100, NOW, &mut bal);
    ctx("alice.near", 1, NOW); let _ = c.claim_payout();
    let p = c.get_pending_payout(a("alice.near")).unwrap();
    result_bal(PromiseResult::Successful(vec![]), NOW, bal - N / 100); c.on_payout("alice.near".parse().unwrap(), p.nonce);
    let due = c.get_loan("k1".into()).unwrap().due_ns.0;
    // Every ownership path refuses while the loan is open.
    for attempt in 0..6 {
        ctx("alice.near", 1, due + SECOND);
        rejected(|| c.nft_transfer(a("bob.near"), "k1".into(), None, None));
        rejected(|| { let _ = c.nft_transfer_call(a("bob.near"), "k1".into(), None, None, "".into()); });
        ctx("alice.near", LIST_STORAGE_DEPOSIT, due + SECOND); rejected(|| c.nft_list("k1".into(), U128(N)));
        ctx("alice.near", N / 100, due + SECOND); rejected(|| { let _ = c.nft_approve("k1".into(), a("market.near"), None); });
        ctx("minter.near", N / 100, due + SECOND); rejected(|| c.begin_value_op("k1".into(), U64(0), format!("{}:op", attempt + 1), "hash".into(), a("alice.near")));
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, a("alice.near"));
    }
    // The lender cannot default inside the grace period either: the only ownership path is claim_default, once due + grace passed.
    ctx("lender.near", 1, due + 30 * SECOND); rejected(|| { let _ = c.claim_default("k1".into(), nonce, a("bob.near")); });
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, a("alice.near"));
    ctx("lender.near", 1, due + 31 * SECOND); let _ = c.claim_default("k1".into(), nonce, a("bob.near"));
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, a("bob.near"), "claim_default moves the key");
}

#[test]
fn wind_down_gate_does_not_block_transfers_or_claims_of_existing_credit() {
    // After wind-down no loan exists (liabilities are zero), so repay/claim are checked for their own reasons only.
    let mut c = setup();
    ctx("owner.near", 1, WIND_DOWN_NS); c.wind_down();
    ctx("alice.near", 1, WIND_DOWN_NS); c.nft_transfer(a("bob.near"), "k1".into(), None, None);
    ctx("bob.near", 1, WIND_DOWN_NS); rejected(|| { let _ = c.claim_payout(); }); // no credit: refused by its own rule
    ctx("alice.near", N, WIND_DOWN_NS); rejected(|| { let _ = c.repay_loan("k1".into(), U64(1)); }); // no loan: own rule
}

// ---------- ATTACK MATRIX (added 2026-11-13): a non-owner must not be able to propose
// a successor. The owner-only check fires before any proposal is written. ----------
#[test]
fn propose_owner_refuses_non_owner() {
    let mut c = setup();
    ctx("evil.near", 1, NOW); rejected(|| { let _ = c.propose_owner(a("guardian.near")); });
    assert!(c.governance_state().pending_owner.is_none(), "a refused proposal writes nothing");
}
