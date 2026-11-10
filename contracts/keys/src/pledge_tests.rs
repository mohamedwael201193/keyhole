use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::testing_env;
use std::panic::{catch_unwind, AssertUnwindSafe};
const NOW: u64 = 1_794_000_000_000_000_000;
const N: u128 = 1_000_000_000_000_000_000_000_000;
fn a(s: &str) -> AccountId { s.parse().unwrap() }
fn sk() -> SigningKey { SigningKey::from_bytes(&[7; 32]) }
fn context(who: &str, amount: u128, now: u64) -> near_sdk::VMContext {
    VMContextBuilder::new().current_account_id(a("keys.near")).predecessor_account_id(a(who))
        .signer_account_id(a(who)).account_balance(yocto(1000 * N)).storage_usage(200_000)
        .block_timestamp(now).attached_deposit(yocto(amount)).prepaid_gas(Gas::from_tgas(300)).build()
}
fn ctx(who: &str, amount: u128, now: u64) { let mut c=context(who, amount, now); c.storage_usage=env::storage_usage(); testing_env!(c); }
fn result(r: PromiseResult, now: u64) {
    let mut c=context("keys.near",0,now);c.storage_usage=env::storage_usage();
    testing_env!(c, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), std::collections::HashMap::default(), vec![r]);
}
fn policy(frozen: bool) -> PromiseResult {
    PromiseResult::Successful(near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({
        "owner":"keys.near", "encrypted_data":"sealed-policy", "version":1, "locked":true, "frozen":frozen, "generation_supported":true, "generation":collateral().get(&"k1".into()).map(|b|b.policy_generation.0).unwrap_or(0)
    })).unwrap())
}
fn setup() -> Contract {
    ctx("keys.near", 0, NOW);
    let mut c = test_funded_contract();
    ctx("minter.near", N / 10, NOW);
    c.nft_mint("k1".into(), a("alice.near"), 2, TokenMetadata { title: Some("Key".into()), ..Default::default() });
    // Settle the minter's known successful mint-storage refund before the lending baseline.
    ctx("minter.near",1,NOW);let _=c.claim_payout();let p=c.get_pending_payout(a("minter.near")).unwrap();
    result(PromiseResult::Successful(vec![]),NOW);assert!(c.on_payout(a("minter.near"),p.nonce));
    env::state_write(&c); ctx("keys.near", 0, NOW);
    let c = Contract::migrate_pledge(a("recovery.near"), Base64VecU8(sk().verifying_key().to_bytes().to_vec()), a("custody.near"), "sandbox".into());
    let mut cfg = config_required(); cfg.lending_enabled = true; save_config(&cfg);
    collateral().insert(&"k1".into(), &CollateralBinding { wallet_pubkey: format!("ed25519:{}", "ab".repeat(32)), encrypted_policy_hash: Base64VecU8(env::sha256(b"sealed-policy")), policy_version: U64(1), ready: true, policy_generation:U64(0) });
    c
}
fn terms() -> LoanTerms { LoanTerms { lender: a("lender.near"), principal: U128(N), repayment: U128(11 * N / 10), duration_sec: U64(60), grace_sec: U64(30), floor_raw: U128(1_000_000), funding_deadline_ns: U64(NOW + 600 * SECOND) } }
fn open(c: &mut Contract) { ctx("alice.near", LOAN_STORAGE_DEPOSIT, NOW); let _ = c.open_loan("k1".into(), terms()); }
fn settle_policy(c: &mut Contract, frozen: bool, now: u64) {
    let l = c.get_loan("k1".into()).unwrap();
    result(PromiseResult::Successful(vec![]), now);
    let _ = c.on_policy_action("k1".into(), l.nonce, l.policy_sequence);
    result(policy(frozen), now);
    assert!(c.on_loan_policy("k1".into(), l.nonce, l.policy_sequence));
}
fn cert(c: &Contract) -> LoanCertificate { c.loan_certificate_template("k1".into(), U64(NOW), U64(NOW + 30 * SECOND)) }
fn signed(c: &Contract, v: &LoanCertificate) -> Base64VecU8 { let _ = c; Base64VecU8(sk().sign(&near_sdk::borsh::to_vec(v).unwrap()).to_bytes().to_vec()) }
fn fund(c: &mut Contract) {
    let v = cert(c); let signature = signed(c, &v); ctx("lender.near", N, NOW);
    let _ = c.fund_loan("k1".into(), U64(1), v, signature);
}
fn active(c: &mut Contract) { open(c);settle_policy(c,true,NOW);fund(c);ctx("alice.near",1,NOW);let _=c.claim_payout();result(PromiseResult::Successful(vec![]),NOW);assert!(c.on_payout(a("alice.near"),config_required().next_payout_nonce));
}
fn rejected<F: FnOnce()>(f: F) { assert!(catch_unwind(AssertUnwindSafe(f)).is_err()); }

#[test] fn migration_preserves_layout_and_defaults_to_disabled_zero_treasury() {
    let c = setup(); let cfg = config_required();
    assert_eq!(cfg.treasury_available.0, 0); assert_eq!(cfg.recovery_unlock_ns.0, RECOVERY_UNLOCK_NS);
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, a("alice.near"));
    ctx("keys.near", 0, NOW);
    rejected(|| { Contract::migrate_pledge(a("evil.near"), Base64VecU8(vec![9;32]), a("custody.near"), "sandbox".into()); });
    assert_eq!(config_required().recovery_account, a("recovery.near"));
}
#[test] fn lending_switch_does_not_disable_repayment_or_credit() {
    let mut c=setup(); active(&mut c); let mut cfg=config_required(); cfg.lending_enabled=false; save_config(&cfg);
    ctx("alice.near", terms().repayment.0, NOW); let _=c.repay_loan("k1".into(), U64(1));
    assert_eq!(c.get_payout_credit(a("lender.near")), terms().repayment);
}
#[test] fn open_waits_for_real_controller_locked_policy_read() {
    let mut c=setup(); open(&mut c);
    assert_eq!(c.get_loan("k1".into()).unwrap().state, LoanState::Freezing);
    let l=c.get_loan("k1".into()).unwrap(); result(PromiseResult::Successful(vec![]),NOW); let _=c.on_policy_action("k1".into(),l.nonce,l.policy_sequence);
    result(PromiseResult::Successful(br#"{"owner":"evil.near","encrypted_data":"sealed-policy","version":1,"locked":true,"frozen":true}"#.to_vec()),NOW);
    assert!(!c.on_loan_policy("k1".into(),l.nonce,l.policy_sequence));
    assert!(c.get_loan("k1".into()).unwrap().policy_busy);
    result(policy(true),NOW); assert!(c.on_loan_policy("k1".into(),l.nonce,l.policy_sequence));
    assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::Offered);
}
#[test] fn unknown_policy_retry_replays_same_fenced_generation() {let mut c=setup();open(&mut c);let l=c.get_loan("k1".into()).unwrap();
 result(PromiseResult::Failed,NOW);assert!(!c.on_loan_policy("k1".into(),l.nonce,l.policy_sequence));
 ctx("anyone.near",0,NOW);let _=c.retry_loan_policy("k1".into(),l.nonce);assert_eq!(c.get_loan("k1".into()).unwrap().policy_sequence,l.policy_sequence);
 result(policy(true),NOW);assert!(c.on_loan_policy("k1".into(),l.nonce,l.policy_sequence));
}
#[test] fn all_four_pledge_phases_block_title_listing_approval_and_admission() {
    let mut c=setup(); open(&mut c); let mut l=c.get_loan("k1".into()).unwrap();
    for state in [LoanState::Freezing,LoanState::Offered,LoanState::Active,LoanState::UnlockPending] {
        l.state=state; loans().insert(&"k1".into(),&l);
        ctx("alice.near",1,NOW); rejected(||c.nft_transfer(a("bob.near"),"k1".into(),None,None));
        ctx("alice.near",1,NOW); rejected(||{let _=c.nft_transfer_call(a("bob.near"),"k1".into(),None,None,"".into());});
        ctx("alice.near",LIST_STORAGE_DEPOSIT,NOW); rejected(||c.nft_list("k1".into(),U128(N)));
        ctx("alice.near",N/100,NOW); rejected(||{let _=c.nft_approve("k1".into(),a("market.near"),None);});
        ctx("alice.near",1,NOW); rejected(||{let _=c.nft_transfer_payout(a("bob.near"),"k1".into(),None,None,U128(N),Some(2));});
        ctx("bob.near",N,NOW); rejected(||c.nft_buy("k1".into()));
        ctx("minter.near",N/100,NOW); rejected(||c.begin_value_op("k1".into(),U64(0),"1:op".into(),"hash".into(), a("alice.near")));
        ctx("alice.near",1,NOW); c.nft_revoke_all("k1".into());
    }
}
#[test] fn approved_market_cannot_bypass_pledge() {
    let mut c=setup(); ctx("alice.near",N/100,NOW); let _=c.nft_approve("k1".into(),a("market.near"),None); open(&mut c);
    ctx("market.near",1,NOW); rejected(||c.nft_transfer(a("bob.near"),"k1".into(),None,None));
}
#[test] fn admission_before_open_blocks_open_and_open_before_admission_blocks_admission() {
    let mut c=setup(); ctx("minter.near",N/100,NOW); c.begin_value_op("k1".into(),U64(0),"1:op".into(),"hash".into(), a("alice.near"));
    ctx("alice.near",LOAN_STORAGE_DEPOSIT,NOW); rejected(||{let _=c.open_loan("k1".into(),terms());});
    ctx("minter.near",0,NOW); c.finish_value_op("k1".into(),"1:op".into(),true); open(&mut c);
    ctx("minter.near",N/100,NOW); rejected(||c.begin_value_op("k1".into(),U64(0),"2:op2".into(),"hash".into(), a("alice.near")));
}
#[test] fn completed_admission_id_never_reopens() {
    let mut c=setup(); ctx("minter.near",N/100,NOW); c.begin_value_op("k1".into(),U64(0),"1:op".into(),"hash".into(), a("alice.near"));
    ctx("minter.near",0,NOW); c.finish_value_op("k1".into(),"1:op".into(),false);
    rejected(||c.finish_value_op("k1".into(),"1:op".into(),false));
    ctx("minter.near",N/100,NOW); rejected(||c.begin_value_op("k1".into(),U64(0),"1:op".into(),"hash".into(), a("alice.near")));
}
#[test] fn transient_transfer_call_receiver_cannot_pledge_list_approve_or_dispatch() {
    let mut c=setup(); ctx("alice.near",1,NOW); let _=c.nft_transfer_call(a("bob.near"),"k1".into(),None,None,"".into());
    assert!(c.get_control_state("k1".into()).transfer_pending);
    ctx("bob.near",LOAN_STORAGE_DEPOSIT,NOW); rejected(||{let _=c.open_loan("k1".into(),terms());});
    ctx("bob.near",LIST_STORAGE_DEPOSIT,NOW); rejected(||c.nft_list("k1".into(),U128(N)));
    ctx("bob.near",N/100,NOW); rejected(||{let _=c.nft_approve("k1".into(),a("market.near"),None);});
    ctx("minter.near",N/100,NOW); rejected(||c.begin_value_op("k1".into(),U64(1),"1:op".into(),"hash".into(), a("alice.near")));
    result(PromiseResult::Successful(b"true".to_vec()),NOW);
    assert!(!c.resolve_transfer_call("k1".into(), c.nft_settlement_epoch("k1".into())));
    assert!(!c.get_control_state("k1".into()).transfer_pending);
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,a("alice.near"));
}
#[test] fn funded_principal_is_atomic_backed_credit_and_debt_without_push_callback() {let mut c=setup();open(&mut c);settle_policy(&mut c,true,NOW);fund(&mut c);
 assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::Active);
 assert_eq!(c.get_payout_credit(a("alice.near")).0,N);assert_eq!(config_required().user_liabilities.0,N+LOAN_STORAGE_DEPOSIT);
 assert!(get_created_receipts().is_empty(),"funding is atomic credit, not a push");
 result(PromiseResult::Failed,NOW);
 assert_eq!(c.get_payout_credit(a("alice.near")).0,N);
}
#[test] fn retired_principal_callback_cannot_erase_debt_or_mint_lender_credit() {let mut c=setup();open(&mut c);settle_policy(&mut c,true,NOW);fund(&mut c);
 result(PromiseResult::Failed,NOW);
 assert_eq!(c.get_payout_credit(a("lender.near")).0,0);assert_eq!(c.get_payout_credit(a("alice.near")).0,N);
 assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::Active);
}
#[test] fn repaid_credit_remains_backed_across_failed_pull_payout_and_unlock() {
    let mut c=setup(); active(&mut c); ctx("alice.near",terms().repayment.0,NOW);
    let _=c.repay_loan("k1".into(),U64(1)); assert!(c.get_control_state("k1".into()).pledged);
    ctx("lender.near",1,NOW); let _=c.claim_payout(); let p=c.get_pending_payout(a("lender.near")).unwrap();
    result(PromiseResult::Failed,NOW); assert!(!c.on_payout(a("lender.near"),p.nonce));
    assert_eq!(c.get_payout_credit(a("lender.near")),terms().repayment);
    settle_policy(&mut c,false,NOW); assert!(c.get_loan("k1".into()).is_none());
    assert_eq!(config_required().user_liabilities.0,LOAN_STORAGE_DEPOSIT+terms().repayment.0);
    ctx("lender.near",1,NOW); let _=c.claim_payout(); let p=c.get_pending_payout(a("lender.near")).unwrap();
    result(PromiseResult::Successful(vec![]),NOW); assert!(c.on_payout(a("lender.near"),p.nonce));
    assert!(!c.on_payout(a("lender.near"),p.nonce)); assert_eq!(config_required().user_liabilities.0,LOAN_STORAGE_DEPOSIT);
}
#[test] fn funding_rejects_each_tampered_binding_even_with_a_valid_attestor_signature() {
    let mut c=setup(); open(&mut c); settle_policy(&mut c,true,NOW); let good=cert(&c);
    for i in 0..13 {
        let mut v=good.clone(); match i {
            0=>v.domain="WRONG".into(),1=>v.network="wrong".into(),2=>v.contract=a("wrong.near"),3=>v.token_id="k2".into(),
            4=>v.loan_nonce=U64(99),5=>v.owner_epoch=U64(9),6=>v.terms.floor_raw=U128(1),7=>v.terms.lender=a("evil.near"),
            8=>v.asset="wrong-asset".into(),9=>v.wallet_pubkey="wrong-wallet".into(),10=>v.floor_met=false,11=>v.frozen=false,_=>v.pending_value_ops=U64(1),
        }
        let sig=signed(&c,&v); ctx("lender.near",N,NOW); rejected(||{let _=c.fund_loan("k1".into(),U64(1),v,sig);});
    }
    assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::Offered);
}
#[test] fn funding_refuses_bad_signature_expiry_future_and_unbounded_freshness() {
    let mut c=setup(); open(&mut c); settle_policy(&mut c,true,NOW); let good=cert(&c);
    ctx("lender.near",N,NOW); rejected(||{let _=c.fund_loan("k1".into(),U64(1),good.clone(),Base64VecU8(vec![0;64]));});
    for (observed,expires) in [(NOW,NOW),(NOW+1,NOW+SECOND),(NOW,NOW+CERTIFICATE_MAX_AGE_NS+1)] {
        let v=c.loan_certificate_template("k1".into(),U64(observed),U64(expires)); let sig=signed(&c,&v);
        ctx("lender.near",N,NOW); rejected(||{let _=c.fund_loan("k1".into(),U64(1),v,sig);});
    }
}
#[test] fn cancel_reopen_has_unique_nonce_and_old_certificate_cannot_fund() {
    let mut c=setup(); open(&mut c); settle_policy(&mut c,true,NOW); let old=cert(&c); let sig=signed(&c,&old);
    ctx("alice.near",1,NOW); let _=c.cancel_loan("k1".into(),U64(1)); settle_policy(&mut c,false,NOW); open(&mut c); settle_policy(&mut c,true,NOW);
    assert_eq!(c.get_loan("k1".into()).unwrap().nonce,U64(2));
    ctx("lender.near",N,NOW); rejected(||{let _=c.fund_loan("k1".into(),U64(2),old,sig);});
}
#[test] fn default_redirect_checks_one_key_before_title_and_keeps_unlock_lock() {
    let mut c=setup(); active(&mut c); ctx("minter.near",N/10,NOW);
    c.nft_mint("k2".into(),a("lender.near"),1,TokenMetadata {title:Some("Other".into()),..Default::default()});
    let overdue=NOW+91*SECOND; ctx("lender.near",1,overdue);
    rejected(||{let _=c.claim_default("k1".into(),U64(1),a("lender.near"));});
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,a("alice.near"));
    ctx("lender.near",1,overdue); let _=c.claim_default("k1".into(),U64(1),a("bob.near"));
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,a("bob.near")); assert_eq!(c.nft_settlement_epoch("k1".into()).0,1);
    ctx("bob.near",1,overdue); rejected(||c.nft_transfer(a("carol.near"),"k1".into(),None,None));
    settle_policy(&mut c,false,overdue); ctx("bob.near",1,overdue); c.nft_transfer(a("carol.near"),"k1".into(),None,None);
}
#[test] fn exact_grace_boundary_allows_repay_but_not_default() {
    let mut c=setup(); active(&mut c); ctx("lender.near",1,NOW+90*SECOND);
    rejected(||{let _=c.claim_default("k1".into(),U64(1),a("bob.near"));});
    ctx("alice.near",terms().repayment.0,NOW+90*SECOND); let _=c.repay_loan("k1".into(),U64(1));
}
#[test] fn principal_and_policy_callbacks_are_nonce_bound_and_private() {
    let mut c=setup(); open(&mut c); ctx("evil.near",0,NOW);
    rejected(||{let _=c.on_policy_action("k1".into(),U64(1),U64(1));});
    result(PromiseResult::Successful(vec![]),NOW); assert!(matches!(c.on_policy_action("k1".into(),U64(99),U64(1)),PromiseOrValue::Value(false)));
    assert!(c.get_loan("k1".into()).unwrap().policy_busy);
}
#[test] fn legacy_balance_and_listing_deposits_never_become_treasury() {
    let mut c=setup(); ctx("alice.near",LIST_STORAGE_DEPOSIT,NOW); c.nft_list("k1".into(),U128(N));
    assert_eq!(c.treasury_recoverable().0,0); ctx("recovery.near",1,RECOVERY_UNLOCK_NS);
    rejected(||{let _=c.recover_treasury(U128(1));});
    assert!(c.nft_listing("k1".into()).is_some());
}
#[test] fn recovery_has_exact_timelock_immutable_destination_and_failed_transfer_restore() {
    let mut c=setup(); ctx("owner.near",N,NOW); c.fund_treasury();
    ctx("recovery.near",1,RECOVERY_UNLOCK_NS-1); rejected(||{let _=c.recover_treasury(U128(N));});
    ctx("evil.near",1,RECOVERY_UNLOCK_NS); rejected(||{let _=c.recover_treasury(U128(N));});
    ctx("recovery.near",1,RECOVERY_UNLOCK_NS); let _=c.recover_treasury(U128(N));
    assert!(get_created_receipts().iter().any(|r|r.receiver_id==a("recovery.near")));
    let p=config_required().treasury_pending.unwrap(); assert_eq!(config_required().treasury_available.0,0);
    result(PromiseResult::Failed,RECOVERY_UNLOCK_NS); assert!(!c.on_treasury_recovered(p.nonce));
    assert_eq!(config_required().treasury_available.0,N); assert!(!c.on_treasury_recovered(p.nonce));
    ctx("recovery.near",1,RECOVERY_UNLOCK_NS); let _=c.recover_treasury(U128(N/2)); let p=config_required().treasury_pending.unwrap();
    result(PromiseResult::Successful(vec![]),RECOVERY_UNLOCK_NS); assert!(c.on_treasury_recovered(p.nonce));
    assert_eq!(config_required().treasury_available.0,N/2);
}
#[test] fn treasury_recovery_never_reduces_loan_principal_credit_or_bond_liabilities() {
    let mut c=setup(); active(&mut c); ctx("alice.near",terms().repayment.0,NOW); let _=c.repay_loan("k1".into(),U64(1));
    ctx("owner.near",N,NOW); c.fund_treasury(); let before=config_required().user_liabilities;
    ctx("recovery.near",1,RECOVERY_UNLOCK_NS); let _=c.recover_treasury(U128(N));
    assert_eq!(config_required().user_liabilities,before); assert_eq!(c.get_payout_credit(a("lender.near")),terms().repayment);
    assert!(c.get_loan("k1".into()).is_some());
}
#[test] fn insolvent_native_balance_fails_closed_even_with_treasury_ledger() {
    let mut c=setup(); ctx("owner.near",N,NOW); c.fund_treasury();
    let mut context=context("recovery.near",1,RECOVERY_UNLOCK_NS); context.account_balance=yocto(1); testing_env!(context);
    assert_eq!(c.treasury_recoverable().0,0); rejected(||{let _=c.recover_treasury(U128(1));});
}
#[test] fn minter_cannot_be_replaced_after_attestor_pin() {
    let mut c=setup(); ctx("owner.near",1,NOW); rejected(||c.set_minter(a("evil.near")));
}

#[test] fn certificate_fixture_matches_contract_borsh() {
    let mut c=setup(); open(&mut c); settle_policy(&mut c,true,NOW); let cert=cert(&c);
    let bytes=near_sdk::borsh::to_vec(&cert).unwrap();
    let hex=bytes.iter().map(|b|format!("{b:02x}")).collect::<String>();
    let fixture=near_sdk::serde_json::json!({"certificate":cert,"borsh_hex":hex,"signature":signed(&c,&cert),"public_key":Base64VecU8(sk().verifying_key().to_bytes().to_vec())});
    let path=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../protocol/loan-certificate-v2-credit.json");
    if std::env::var("KH_UPDATE_CERTIFICATE_FIXTURE").as_deref()==Ok("1") {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path,near_sdk::serde_json::to_string_pretty(&fixture).unwrap()+"\n").unwrap();
    }
    let committed:near_sdk::serde_json::Value=near_sdk::serde_json::from_slice(&std::fs::read(path).expect("missing certificate fixture")).unwrap();
    assert_eq!(fixture,committed);
}

#[test] fn only_future_self_treasury_sale_royalties_credit_recoverable_ledger() {
    let mut c=setup(); assert_eq!(config_required().treasury_available.0,0);
    ctx("owner.near",1,NOW); c.set_royalty(a("keys.near"),500);
    ctx("alice.near",LIST_STORAGE_DEPOSIT,NOW); c.nft_list("k1".into(),U128(N));
    ctx("bob.near",N,NOW); c.nft_buy("k1".into());
    assert_eq!(config_required().treasury_available.0,N/20);
    assert_eq!(config_required().user_liabilities.0,N-N/20+LIST_STORAGE_DEPOSIT);
}

#[test] fn value_op_storage_is_bounded_and_obsolete_finish_cannot_unlock_new_operation() {
 let mut c=setup();
 for n in 1..=20 {ctx("minter.near",N/100,NOW);c.begin_value_op("k1".into(),U64(0),format!("{n}:action"),"hash".into(), a("alice.near"));ctx("minter.near",0,NOW);c.finish_value_op("k1".into(),format!("{n}:action"),true);}
 let storage=env::storage_usage();ctx("minter.near",N/100,NOW);c.begin_value_op("k1".into(),U64(0),"21:action".into(),"hash".into(), a("alice.near"));
 ctx("minter.near",0,NOW);rejected(||c.finish_value_op("k1".into(),"1:action".into(),true));
 assert_eq!(c.pending_value_op_count("k1".into()).0,1);c.finish_value_op("k1".into(),"21:action".into(),true);
 assert_eq!(env::storage_usage(),storage);assert_eq!(c.get_control_state("k1".into()).value_op_nonce.0,21);
}

#[test] fn admission_binds_authenticated_owner_even_at_current_epoch() {
 let mut c=setup();ctx("minter.near",N/100,NOW);
 rejected(||c.begin_value_op("k1".into(),U64(0),"1:action".into(),"hash".into(),a("bob.near")));
 assert_eq!(c.pending_value_op_count("k1".into()).0,0);
}


fn registration(c:&mut Contract)->U64 {
    ctx("minter.near",N/10,NOW);
    let _=c.register_collateral("k1".into(),format!("ed25519:{}","ab".repeat(32)),"sealed-policy".into(),"a".repeat(128),1,NOW/SECOND+60);
    registrations().get(&"k1".into()).unwrap().nonce
}
#[test]fn unknown_token_control_view_is_not_unlocked(){let c=setup();rejected(||{c.get_control_state("missing".into());});}
#[test]fn funding_checks_certificate_bound_initial_default_receiver_eligibility(){
    let mut c=setup();open(&mut c);settle_policy(&mut c,true,NOW);
    ctx("minter.near",N/10,NOW);c.nft_mint("other".into(),a("lender.near"),2,TokenMetadata::default());
    let cert=cert(&c);let sig=signed(&c,&cert);ctx("lender.near",N,NOW);
    rejected(||{let _=c.fund_loan("k1".into(),U64(1),cert,sig);});
    assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::Offered);
}
#[test]fn failed_registration_refunds_exact_deposit_and_corrected_retry_is_nonce_safe(){
    let mut c=setup();collateral().remove(&"k1".into());let old=registration(&mut c);
    assert_eq!(config_required().user_liabilities.0,N/10);
    result(PromiseResult::Failed,NOW);let _=c.on_collateral_stored("k1".into(),old);
    assert_eq!(c.get_payout_credit(a("minter.near")).0,N/10-COLLATERAL_STORAGE_DEPOSIT);
    result(PromiseResult::Successful(b"null".to_vec()),NOW);assert!(!c.on_collateral_checked("k1".into(),old));
    assert!(c.get_collateral_binding("k1".into()).is_none());assert!(bound_wallets().get(&format!("ed25519:{}","ab".repeat(32))).is_none());
    assert_eq!(c.get_payout_credit(a("minter.near")).0,N/10);assert_eq!(config_required().user_liabilities.0,N/10);
    let new=registration(&mut c);assert_ne!(old,new);
    result(PromiseResult::Successful(vec![]),NOW);let _=c.on_collateral_stored("k1".into(),old);
    result(policy(false),NOW);assert!(!c.on_collateral_checked("k1".into(),old));
    assert!(registrations().get(&"k1".into()).unwrap().store_succeeded.is_none());
    result(PromiseResult::Successful(vec![]),NOW);let _=c.on_collateral_stored("k1".into(),new);
    result(policy(false),NOW);assert!(c.on_collateral_checked("k1".into(),new));
    assert_eq!(config_required().user_liabilities.0,N/10);assert_eq!(c.get_payout_credit(a("minter.near")).0,N/10);
}
#[test]fn failed_store_with_already_matching_policy_refunds_forwarded_only_and_keeps_ready_binding(){
    let mut c=setup();collateral().remove(&"k1".into());let n=registration(&mut c);
    result(PromiseResult::Failed,NOW);let _=c.on_collateral_stored("k1".into(),n);
    result(policy(false),NOW);assert!(c.on_collateral_checked("k1".into(),n));
    assert!(c.get_collateral_binding("k1".into()).unwrap().ready);
    assert_eq!(c.get_payout_credit(a("minter.near")).0,N/10-COLLATERAL_STORAGE_DEPOSIT);
    assert_eq!(config_required().user_liabilities,c.get_payout_credit(a("minter.near")));
    ctx("minter.near",N/10,NOW);rejected(||{let _=c.register_collateral("k1".into(),format!("ed25519:{}","ab".repeat(32)),"sealed-policy".into(),"a".repeat(128),1,NOW/SECOND+60);});
}
#[test]fn unknown_registration_receipt_never_unbinds_or_refunds_even_with_absent_read(){let mut c=setup();collateral().remove(&"k1".into());let n=registration(&mut c);
 result(PromiseResult::Successful(b"null".to_vec()),NOW);assert!(!c.on_collateral_checked("k1".into(),n));
 assert_eq!(c.get_payout_credit(a("minter.near")).0,0);assert!(c.get_collateral_binding("k1".into()).is_some());
 ctx("attacker.near",0,NOW+1000*SECOND);rejected(||{let _=c.on_collateral_stored("k1".into(),n);});
 assert_eq!(c.get_payout_credit(a("minter.near")).0,0);
}
#[test]fn missing_policy_callback_reconciles_exact_custody_enforced_generation_without_signer(){let mut c=setup();open(&mut c);let l=c.get_loan("k1".into()).unwrap();
 ctx("anyone.near",0,NOW);let _=c.reconcile_loan_policy("k1".into(),l.nonce);
 result(policy(true),NOW);assert!(c.on_loan_policy("k1".into(),l.nonce,l.policy_sequence));
 assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::Offered);
}
#[test]fn principal_credit_never_requires_a_delivery_oracle(){let mut c=setup();open(&mut c);settle_policy(&mut c,true,NOW);fund(&mut c);
 assert_eq!(c.get_payout_credit(a("alice.near")).0,N);assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::Active);
 result(PromiseResult::Successful(vec![]),NOW);assert_eq!(c.get_payout_credit(a("alice.near")).0,N);
}
#[test]fn principal_credit_cannot_be_reassigned_by_a_false_failure_claim(){let mut c=setup();open(&mut c);settle_policy(&mut c,true,NOW);fund(&mut c);
 ctx("attacker.near",0,NOW);rejected(||{c.restore_expired_transfer("k1".into(),U64(1));});
 assert_eq!(c.get_payout_credit(a("alice.near")).0,N);assert_eq!(c.get_payout_credit(a("lender.near")).0,0);
}
#[test]fn payout_unknown_is_locked_and_only_real_private_result_can_restore_credit(){let mut c=setup();active(&mut c);ctx("alice.near",terms().repayment.0,NOW);let _=c.repay_loan("k1".into(),U64(1));
 ctx("lender.near",1,NOW);let _=c.claim_payout();let old=c.get_pending_payout(a("lender.near")).unwrap();
 ctx("attacker.near",0,NOW+1000*SECOND);rejected(||{c.on_payout(a("lender.near"),old.nonce);});
 assert_eq!(c.get_payout_credit(a("lender.near")).0,0);assert!(c.get_pending_payout(a("lender.near")).is_some());
 result(PromiseResult::Failed,NOW);assert!(!c.on_payout(a("lender.near"),old.nonce));
 ctx("lender.near",1,NOW);let _=c.claim_payout();let next=c.get_pending_payout(a("lender.near")).unwrap();
 result(PromiseResult::Successful(vec![]),NOW);assert!(!c.on_payout(a("lender.near"),old.nonce));assert!(c.on_payout(a("lender.near"),next.nonce));
 assert_eq!(config_required().user_liabilities.0,LOAN_STORAGE_DEPOSIT);
}
#[test]fn treasury_unknown_never_refunds_on_time_or_untrusted_outcome(){let mut c=setup();ctx("owner.near",2*N,RECOVERY_UNLOCK_NS);c.fund_treasury();ctx("recovery.near",1,RECOVERY_UNLOCK_NS);let _=c.recover_treasury(U128(N));
 let p=config_required().treasury_pending.unwrap();ctx("attacker.near",0,RECOVERY_UNLOCK_NS+1000*SECOND);
 rejected(||{c.on_treasury_recovered(p.nonce);});assert_eq!(config_required().treasury_available.0,N);assert!(config_required().treasury_pending.is_some());
 result(PromiseResult::Failed,RECOVERY_UNLOCK_NS);assert!(!c.on_treasury_recovered(p.nonce));assert_eq!(config_required().treasury_available.0,2*N);
}
#[test]fn no_administrative_or_signing_role_can_forge_a_native_callback(){let mut c=setup();active(&mut c);ctx("alice.near",terms().repayment.0,NOW);let _=c.repay_loan("k1".into(),U64(1));ctx("lender.near",1,NOW);let _=c.claim_payout();let p=c.get_pending_payout(a("lender.near")).unwrap();
 for who in ["anyone.near","recovery.near","owner.near","minter.near"] {ctx(who,0,NOW+1000*SECOND);rejected(||{c.on_payout(a("lender.near"),p.nonce);});}
 assert_eq!(c.get_payout_credit(a("lender.near")).0,0);assert!(c.get_pending_payout(a("lender.near")).is_some());
}
#[test]fn bounded_resolver_handles_malformed_oversized_and_padded_acceptance_fail_closed(){
    let mut c=setup();for bytes in [b"garbage".to_vec(),[vec![b' ';100_000],b"false".to_vec()].concat(),vec![b'[';64]] {
        ctx("alice.near",1,NOW);let _=c.nft_transfer_call(a("receiver.near"),"k1".into(),None,None,"".into());let epoch=c.nft_settlement_epoch("k1".into());
        result(PromiseResult::Successful(bytes),NOW);assert!(!c.resolve_transfer_call("k1".into(),epoch));assert_eq!(c.pending_return_count(a("alice.near")),0);assert!(!c.get_control_state("k1".into()).transfer_pending);
    }
}
#[test]fn permissionless_provisional_timeout_exact_boundary_preserves_approvals_and_newer_epoch(){let mut c=setup();ctx("alice.near",N/100,NOW);let _=c.nft_approve("k1".into(),a("market.near"),None);ctx("alice.near",1,NOW);let _=c.nft_transfer_call(a("receiver.near"),"k1".into(),None,None,"".into());let old=c.nft_settlement_epoch("k1".into());
 ctx("anyone.near",0,NOW+TRANSFER_RESTORE_DELAY_NS-1);rejected(||{c.restore_expired_transfer("k1".into(),old);});ctx("anyone.near",0,NOW+TRANSFER_RESTORE_DELAY_NS);assert!(!c.restore_expired_transfer("k1".into(),old));
 assert_eq!(c.nft_token("k1".into()).unwrap().approved_account_ids.unwrap().len(),1);assert_eq!(c.pending_return_count(a("alice.near")),0);
 ctx("alice.near",1,NOW+TRANSFER_RESTORE_DELAY_NS);let _=c.nft_transfer_call(a("receiver.near"),"k1".into(),None,None,"".into());
 result(PromiseResult::Successful(b"false".to_vec()),NOW+TRANSFER_RESTORE_DELAY_NS);assert!(!c.resolve_transfer_call("k1".into(),old));assert!(c.get_control_state("k1".into()).transfer_pending);
 ctx("anyone.near",0,NOW+2*TRANSFER_RESTORE_DELAY_NS);rejected(||{c.restore_expired_transfer("k1".into(),old);});
}

#[test]fn corrected_same_wallet_retry_after_failed_store_and_mismatched_read_never_replays_old_callback(){
    let mut c=setup();collateral().remove(&"k1".into());let old=registration(&mut c);
    result(PromiseResult::Failed,NOW);let _=c.on_collateral_stored("k1".into(),old);
    result(PromiseResult::Successful(br#"{"owner":"keys.near","encrypted_data":"old-policy","version":1,"locked":false,"frozen":false}"#.to_vec()),NOW);
    assert!(!c.on_collateral_checked("k1".into(),old));let new=registration(&mut c);assert_ne!(old,new);
    assert_eq!(c.get_payout_credit(a("minter.near")).0,N/10);assert_eq!(config_required().user_liabilities.0,N/5);
    result(policy(false),NOW);assert!(!c.on_collateral_checked("k1".into(),old));
    result(PromiseResult::Successful(vec![]),NOW);let _=c.on_collateral_stored("k1".into(),new);
    result(policy(false),NOW);assert!(c.on_collateral_checked("k1".into(),new));assert_eq!(config_required().user_liabilities.0,N/10);
}
#[test]fn unresolved_registration_cannot_replace_wallet_or_reissue_external_action(){
    let mut c=setup();collateral().remove(&"k1".into());let n=registration(&mut c);
    rejected(||{registration(&mut c);});assert_eq!(registrations().get(&"k1".into()).unwrap().nonce,n);
    result(PromiseResult::Failed,NOW);let _=c.on_collateral_stored("k1".into(),n);
    ctx("minter.near",N/10,NOW);rejected(||{let _=c.register_collateral("k1".into(),format!("ed25519:{}","cd".repeat(32)),"sealed-policy".into(),"a".repeat(128),1,NOW/SECOND+60);});
    assert_eq!(registrations().get(&"k1".into()).unwrap().nonce,n);
}

#[test]fn terminal_oracle_key_and_public_truth_selection_abi_are_removed(){let _=setup();let cfg=near_sdk::serde_json::to_string(&config_required()).unwrap();assert!(!cfg.contains("terminal_attestor"));assert!(!include_str!("pledge.rs").contains("pub fn reconcile_terminal_outcome"));assert!(!include_str!("pledge.rs").contains("pub fn on_principal_paid"));
}

#[test]fn bounded_policy_read_covers_worst_json_expansion_of_maximum_admitted_payload(){
    let mut c=setup();collateral().remove(&"k1".into());let nonce=registration(&mut c);
    let mut b=collateral().get(&"k1".into()).unwrap();let payload="\0".repeat(4096);b.encrypted_policy_hash=Base64VecU8(env::sha256(payload.as_bytes()));collateral().insert(&"k1".into(),&b);
    result(PromiseResult::Successful(vec![]),NOW);let _=c.on_collateral_stored("k1".into(),nonce);
    let bytes=near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"owner":"keys.near","encrypted_data":payload,"version":1,"locked":true,"frozen":false,"generation_supported":true,"generation":0})).unwrap();assert!(bytes.len()>16_384&&bytes.len()<32_768);
    result(PromiseResult::Successful(bytes),NOW);assert!(c.on_collateral_checked("k1".into(),nonce));assert!(c.get_collateral_binding("k1".into()).unwrap().ready);
}

include!("pledge_review_round2_tests.rs");

#[test]fn consolidated_credit_ledger_preserves_new_credit_during_pending_payout(){let mut c=setup();active(&mut c);ctx("alice.near",terms().repayment.0,NOW);let _=c.repay_loan("k1".into(),U64(1));for success in [true,false]{ctx("lender.near",1,NOW);let _=c.claim_payout();let p=c.get_pending_payout(a("lender.near")).unwrap();add_credit(&a("lender.near"),123);let mut cfg=config_required();change_liabilities(&mut cfg,123,0);save_config(&cfg);result(if success{PromiseResult::Successful(vec![])}else{PromiseResult::Failed},NOW);assert_eq!(c.on_payout(a("lender.near"),p.nonce),success);assert_eq!(c.get_payout_credit(a("lender.near")).0,123+if success{0}else{p.amount.0});assert!(!c.on_payout(a("lender.near"),p.nonce));}}
#[test]fn lazy_loan_storage_is_paid_by_borrower_bond_not_preexisting_reserves(){let mut c=setup();let before=env::storage_usage();open(&mut c);let bytes=env::storage_usage().saturating_sub(before);assert!(bytes>0);assert!((bytes as u128)*env::storage_byte_cost().as_yoctonear()<=LOAN_STORAGE_DEPOSIT);assert_eq!(c.get_loan("k1".into()).unwrap().storage_bond.0,LOAN_STORAGE_DEPOSIT);}
#[test]fn legacy_or_stale_policy_snapshot_cannot_unlock_a_fenced_generation(){let mut c=setup();open(&mut c);let l=c.get_loan("k1".into()).unwrap();for supported in [true,false]{let raw=near_sdk::serde_json::json!({"owner":"keys.near","encrypted_data":"sealed-policy","version":1,"locked":true,"frozen":true,"generation_supported":supported,"generation":if supported{0}else{l.policy_sequence.0}});result(PromiseResult::Successful(raw.to_string().into_bytes()),NOW);assert!(!c.on_loan_policy("k1".into(),l.nonce,l.policy_sequence));assert!(c.get_loan("k1".into()).unwrap().policy_busy);}}
#[test]fn maximum_ids_and_ten_approvals_survive_provisional_timeout(){let mut c=setup();let owner=format!("{}.near","a".repeat(59));test_register_payouts(&mut c,&[a(&owner)]);let token="t".repeat(64);ctx("minter.near",N/10,NOW);c.nft_mint(token.clone(),a(&owner),2,TokenMetadata::default());for n in 0..10{ctx(&owner,N/100,NOW);let id=format!("x{}{}.near",n,"a".repeat(57));let _=c.nft_approve(token.clone(),a(&id),None);}ctx(&owner,1,NOW);let _=c.nft_transfer_call(a("receiver.near"),token.clone(),None,None,"".into());let epoch=c.nft_settlement_epoch(token.clone());ctx("anyone.near",0,NOW+TRANSFER_RESTORE_DELAY_NS);assert!(!c.restore_expired_transfer(token.clone(),epoch));assert_eq!(c.nft_token(token).unwrap().approved_account_ids.unwrap().len(),10);assert_eq!(c.pending_return_count(a(&owner)),0);}

include!("pledge_review_round3_tests.rs");

include!("pledge_review_round4_tests.rs");
