use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::testing_env;
use std::panic::{catch_unwind, AssertUnwindSafe};
const NOW: u64 = 1_794_000_000_000_000_000;
const N: u128 = 1_000_000_000_000_000_000_000_000;
fn a(s: &str) -> AccountId { s.parse().unwrap() }
fn sk() -> SigningKey { SigningKey::from_bytes(&[7; 32]) }
fn terminal_sk() -> SigningKey { SigningKey::from_bytes(&[8; 32]) }
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
        "owner":"keys.near", "encrypted_data":"sealed-policy", "version":1, "locked":true, "frozen":frozen
    })).unwrap())
}
fn setup() -> Contract {
    ctx("keys.near", 0, NOW);
    let mut c = Contract::new(a("owner.near"), a("minter.near"), a("treasury.near"), 500);
    ctx("minter.near", N / 10, NOW);
    c.nft_mint("k1".into(), a("alice.near"), 2, TokenMetadata { title: Some("Key".into()), ..Default::default() });
    env::state_write(&c); ctx("keys.near", 0, NOW);
    let c = Contract::migrate_pledge(a("recovery.near"), Base64VecU8(sk().verifying_key().to_bytes().to_vec()), Base64VecU8(terminal_sk().verifying_key().to_bytes().to_vec()), a("custody.near"), "sandbox".into());
    let mut cfg = config_required(); cfg.lending_enabled = true; save_config(&cfg);
    collateral().insert(&"k1".into(), &CollateralBinding { wallet_pubkey: format!("ed25519:{}", "ab".repeat(32)), encrypted_policy_hash: Base64VecU8(env::sha256(b"sealed-policy")), policy_version: U64(1), ready: true });
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
fn active(c: &mut Contract) { open(c); settle_policy(c, true, NOW); fund(c); result(PromiseResult::Successful(vec![]), NOW); let _ = c.on_principal_paid("k1".into(), U64(1)); }
fn rejected<F: FnOnce()>(f: F) { assert!(catch_unwind(AssertUnwindSafe(f)).is_err()); }

#[test] fn migration_preserves_layout_and_defaults_to_disabled_zero_treasury() {
    let c = setup(); let cfg = config_required();
    assert_eq!(cfg.treasury_available.0, 0); assert_eq!(cfg.recovery_unlock_ns.0, RECOVERY_UNLOCK_NS);
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, a("alice.near"));
    ctx("keys.near", 0, NOW);
    rejected(|| { Contract::migrate_pledge(a("evil.near"), Base64VecU8(vec![9;32]), Base64VecU8(vec![10;32]), a("custody.near"), "sandbox".into()); });
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
#[test] fn missing_policy_read_stays_locked_without_parallel_action_retry() {
    let mut c=setup(); open(&mut c); let l=c.get_loan("k1".into()).unwrap();
    result(PromiseResult::Successful(vec![]),NOW); let _=c.on_policy_action("k1".into(),l.nonce,l.policy_sequence);
    result(PromiseResult::Failed,NOW); assert!(!c.on_loan_policy("k1".into(),l.nonce,l.policy_sequence));
    ctx("alice.near",0,NOW); rejected(||{let _=c.retry_loan_policy("k1".into(),U64(1));});
    result(policy(true),NOW); assert!(c.on_loan_policy("k1".into(),l.nonce,l.policy_sequence));
}
#[test] fn all_five_pledge_phases_block_title_listing_approval_and_admission() {
    let mut c=setup(); open(&mut c); let mut l=c.get_loan("k1".into()).unwrap();
    for state in [LoanState::Freezing,LoanState::Offered,LoanState::FundingPending,LoanState::Active,LoanState::UnlockPending] {
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
#[test] fn funded_principal_is_pending_debt_only_after_success() {
    let mut c=setup(); open(&mut c); settle_policy(&mut c,true,NOW); fund(&mut c);
    assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::FundingPending);
    assert_eq!(config_required().user_liabilities.0,N+LOAN_STORAGE_DEPOSIT);
    result(PromiseResult::Successful(vec![]),NOW); let _=c.on_principal_paid("k1".into(),U64(1));
    assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::Active);
    assert_eq!(config_required().user_liabilities.0,LOAN_STORAGE_DEPOSIT);
    let _=c.on_principal_paid("k1".into(),U64(1));
    assert_eq!(config_required().user_liabilities.0,LOAN_STORAGE_DEPOSIT);
}
#[test] fn failed_principal_creates_no_debt_and_restores_lender_credit() {
    let mut c=setup(); open(&mut c); settle_policy(&mut c,true,NOW); fund(&mut c);
    result(PromiseResult::Failed,NOW); let _=c.on_principal_paid("k1".into(),U64(1));
    assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::UnlockPending);
    assert_eq!(c.get_payout_credit(a("lender.near")).0,N);
    settle_policy(&mut c,false,NOW);
    assert!(c.get_loan("k1".into()).is_none()); assert_eq!(c.get_payout_credit(a("alice.near")).0,LOAN_STORAGE_DEPOSIT);
    assert_eq!(config_required().user_liabilities.0,N+LOAN_STORAGE_DEPOSIT);
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
    let path=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../protocol/loan-certificate-v1.json");
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
    assert_eq!(config_required().user_liabilities.0,0);
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


fn recovery(kind:&str,token:&str,nonce:U64,sequence:U64,who:&str,amount:u128,success:bool)->TerminalAttestation {
    TerminalAttestation{domain:"KEYHOLE_TERMINAL_RECOVERY_V1".into(),network:"sandbox".into(),contract:a("keys.near"),kind:kind.into(),
        token_id:token.into(),nonce,sequence,account_id:a(who),amount:U128(amount),success,receipt_id:Base64VecU8(vec![9;32]),observed_at_ns:U64(NOW),expires_at_ns:U64(NOW+30*SECOND)}
}
fn relay(c:&mut Contract,proof:TerminalAttestation) { relay_at(c,proof,NOW); }
fn relay_at(c:&mut Contract,proof:TerminalAttestation,now:u64) {
    let sig=Base64VecU8(terminal_sk().sign(&near_sdk::borsh::to_vec(&proof).unwrap()).to_bytes().to_vec());
    ctx("anyone.near",0,now);let _=c.reconcile_terminal_outcome(proof,sig);
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
#[test]fn unknown_registration_receipt_never_unbinds_or_refunds_even_with_absent_read(){
    let mut c=setup();collateral().remove(&"k1".into());let n=registration(&mut c);
    result(PromiseResult::Successful(b"null".to_vec()),NOW);assert!(!c.on_collateral_checked("k1".into(),n));
    assert_eq!(c.get_payout_credit(a("minter.near")).0,0);assert!(c.get_collateral_binding("k1".into()).is_some());
    relay(&mut c,recovery("registration","k1",n,U64(0),"custody.near",N/10-COLLATERAL_STORAGE_DEPOSIT,false));
    result(PromiseResult::Successful(b"null".to_vec()),NOW);assert!(!c.on_collateral_checked("k1".into(),n));
    assert_eq!(c.get_payout_credit(a("minter.near")).0,N/10);
    result(PromiseResult::Failed,NOW);let _=c.on_collateral_stored("k1".into(),n);assert_eq!(c.get_payout_credit(a("minter.near")).0,N/10);
}
#[test]fn missing_first_stage_policy_callback_recovery_requires_terminal_proof_then_real_policy_read(){
    let mut c=setup();open(&mut c);let l=c.get_loan("k1".into()).unwrap();
    ctx("anyone.near",0,NOW);rejected(||{let _=c.reconcile_loan_policy("k1".into(),l.nonce);});
    relay(&mut c,recovery("policy_action","k1",l.nonce,l.policy_sequence,"custody.near",0,true));
    assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::Freezing);
    result(policy(true),NOW);assert!(c.on_loan_policy("k1".into(),l.nonce,l.policy_sequence));
    assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::Offered);
}
#[test]fn missing_successful_principal_callback_recovers_without_resending_and_late_callback_is_noop(){
    let mut c=setup();open(&mut c);settle_policy(&mut c,true,NOW);fund(&mut c);
    assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::FundingPending);
    relay(&mut c,recovery("principal","k1",U64(1),U64(0),"alice.near",N,true));
    assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::Active);assert_eq!(config_required().user_liabilities.0,LOAN_STORAGE_DEPOSIT);
    result(PromiseResult::Failed,NOW);let _=c.on_principal_paid("k1".into(),U64(1));assert_eq!(c.get_payout_credit(a("lender.near")).0,0);
    ctx("alice.near",terms().repayment.0,NOW);let _=c.repay_loan("k1".into(),U64(1));settle_policy(&mut c,false,NOW);assert!(c.get_loan("k1".into()).is_none());
}
#[test]fn missing_failed_principal_callback_restores_exact_credit_never_creates_debt(){
    let mut c=setup();open(&mut c);settle_policy(&mut c,true,NOW);fund(&mut c);
    relay(&mut c,recovery("principal","k1",U64(1),U64(0),"alice.near",N,false));
    assert_eq!(c.get_payout_credit(a("lender.near")).0,N);assert_eq!(config_required().user_liabilities.0,N+LOAN_STORAGE_DEPOSIT);
    result(PromiseResult::Successful(vec![]),NOW);let _=c.on_principal_paid("k1".into(),U64(1));assert_eq!(c.get_payout_credit(a("lender.near")).0,N);
    settle_policy(&mut c,false,NOW);assert!(c.get_loan("k1".into()).is_none());
}
#[test]fn payout_terminal_recovery_success_and_failure_conserve_liability_and_reject_old_nonce(){
    let mut c=setup();active(&mut c);ctx("alice.near",terms().repayment.0,NOW);let _=c.repay_loan("k1".into(),U64(1));
    ctx("lender.near",1,NOW);let _=c.claim_payout();let old=c.get_pending_payout(a("lender.near")).unwrap();
    relay(&mut c,recovery("payout","",old.nonce,U64(0),"lender.near",old.amount.0,false));
    assert_eq!(c.get_payout_credit(a("lender.near")),old.amount);assert_eq!(config_required().user_liabilities.0,old.amount.0+LOAN_STORAGE_DEPOSIT);
    ctx("lender.near",1,NOW);let _=c.claim_payout();let next=c.get_pending_payout(a("lender.near")).unwrap();
    rejected(||relay(&mut c,recovery("payout","",old.nonce,U64(0),"lender.near",old.amount.0,false)));
    relay(&mut c,recovery("payout","",next.nonce,U64(0),"lender.near",next.amount.0,true));
    result(PromiseResult::Failed,NOW);assert!(!c.on_payout(a("lender.near"),next.nonce));assert_eq!(c.get_payout_credit(a("lender.near")).0,0);assert_eq!(config_required().user_liabilities.0,LOAN_STORAGE_DEPOSIT);
}
#[test]fn treasury_terminal_recovery_never_changes_destination_or_spends_user_liabilities(){
    let mut c=setup();ctx("owner.near",2*N,RECOVERY_UNLOCK_NS);c.fund_treasury();ctx("recovery.near",1,RECOVERY_UNLOCK_NS);let _=c.recover_treasury(U128(N));
    let p=config_required().treasury_pending.unwrap();let mut proof=recovery("treasury","",p.nonce,U64(0),"recovery.near",N,false);proof.observed_at_ns=U64(RECOVERY_UNLOCK_NS);proof.expires_at_ns=U64(RECOVERY_UNLOCK_NS+30*SECOND);
    let mut bad=proof.clone();bad.account_id=a("other.near");rejected(||relay_at(&mut c,bad,RECOVERY_UNLOCK_NS));
    relay_at(&mut c,proof,RECOVERY_UNLOCK_NS);assert_eq!(config_required().treasury_available.0,2*N);assert_eq!(config_required().user_liabilities.0,0);
    result(PromiseResult::Failed,RECOVERY_UNLOCK_NS);assert!(!c.on_treasury_recovered(p.nonce));assert_eq!(config_required().treasury_available.0,2*N);
}
#[test]fn signed_recovery_rejects_tampered_nonce_amount_contract_network_account_and_expiry(){
    let mut c=setup();open(&mut c);settle_policy(&mut c,true,NOW);fund(&mut c);
    let good=recovery("principal","k1",U64(1),U64(0),"alice.near",N,true);
    let original_signature=Base64VecU8(terminal_sk().sign(&near_sdk::borsh::to_vec(&good).unwrap()).to_bytes().to_vec());
    for i in 0..8 {let mut bad=good.clone();match i{0=>bad.nonce=U64(2),1=>bad.amount=U128(N+1),2=>bad.contract=a("other.near"),3=>bad.network="mainnet".into(),4=>bad.account_id=a("other.near"),5=>bad.expires_at_ns=U64(NOW),6=>bad.sequence=U64(1),_=>bad.token_id="other".into()};
        let changed=bad.clone();let signature=original_signature.clone();ctx("anyone.near",0,NOW);rejected(||{let _=c.reconcile_terminal_outcome(bad,signature);});rejected(||relay(&mut c,changed));
        assert_eq!(c.get_loan("k1".into()).unwrap().state,LoanState::FundingPending);
    }
    let mut wrong=good.clone();wrong.amount=U128(N+1);rejected(||relay(&mut c,wrong));
    let sig=Base64VecU8(sk().sign(&near_sdk::borsh::to_vec(&good).unwrap()).to_bytes().to_vec());ctx("anyone.near",0,NOW);rejected(||{let _=c.reconcile_terminal_outcome(good,sig);});
}
#[test]fn bounded_resolver_handles_malformed_oversized_and_padded_acceptance_fail_closed(){
    let mut c=setup();for bytes in [b"garbage".to_vec(),[vec![b' ';100_000],b"false".to_vec()].concat(),vec![b'[';64]] {
        ctx("alice.near",1,NOW);let _=c.nft_transfer_call(a("receiver.near"),"k1".into(),None,None,"".into());let epoch=c.nft_settlement_epoch("k1".into());
        result(PromiseResult::Successful(bytes),NOW);assert!(!c.resolve_transfer_call("k1".into(),epoch));assert_eq!(c.pending_return_count(a("alice.near")),0);assert!(!c.get_control_state("k1".into()).transfer_pending);
    }
}
#[test]fn permissionless_transfer_recovery_is_proof_bound_and_cannot_clear_newer_transfer(){
    let mut c=setup();ctx("alice.near",N/100,NOW);let _=c.nft_approve("k1".into(),a("market.near"),None);
    ctx("alice.near",1,NOW);let _=c.nft_transfer_call(a("receiver.near"),"k1".into(),None,None,"".into());let old=c.nft_settlement_epoch("k1".into());
    relay(&mut c,recovery("transfer_call","k1",old,U64(0),"receiver.near",0,false));
    assert_eq!(c.nft_token("k1".into()).unwrap().approved_account_ids.unwrap().len(),1);assert_eq!(c.pending_return_count(a("alice.near")),0);
    ctx("alice.near",1,NOW);let _=c.nft_transfer_call(a("receiver.near"),"k1".into(),None,None,"".into());let new=c.nft_settlement_epoch("k1".into());
    result(PromiseResult::Successful(b"false".to_vec()),NOW);assert!(c.resolve_transfer_call("k1".into(),old));assert!(c.get_control_state("k1".into()).transfer_pending);
    rejected(||relay(&mut c,recovery("transfer_call","k1",old,U64(0),"receiver.near",0,true)));
    relay(&mut c,recovery("transfer_call","k1",new,U64(0),"receiver.near",0,true));assert!(!c.get_control_state("k1".into()).transfer_pending);assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,a("receiver.near"));
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

#[test]fn terminal_attestation_matches_canonical_independent_key_test_vector(){
    let p=recovery("principal","k1",U64(1),U64(0),"alice.near",N,true);let bytes=near_sdk::borsh::to_vec(&p).unwrap();
    let vector=near_sdk::serde_json::json!({"warning":"TEST-ONLY fixture; independent terminal key, never a production attestation","attestation":p,"borsh_hex":bytes.iter().map(|b|format!("{b:02x}")).collect::<String>(),"public_key":Base64VecU8(terminal_sk().verifying_key().to_bytes().to_vec()),"signature":Base64VecU8(terminal_sk().sign(&bytes).to_bytes().to_vec())});
    let file=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../protocol/terminal-recovery-v1.json");
    if std::env::var_os("KH_UPDATE_RECOVERY_FIXTURE").is_some(){std::fs::write(&file,format!("{}\n",near_sdk::serde_json::to_string_pretty(&vector).unwrap())).unwrap();}
    let expected:near_sdk::serde_json::Value=near_sdk::serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();assert_eq!(vector,expected);
}

#[test]fn bounded_policy_read_covers_worst_json_expansion_of_maximum_admitted_payload(){
    let mut c=setup();collateral().remove(&"k1".into());let nonce=registration(&mut c);
    let mut b=collateral().get(&"k1".into()).unwrap();let payload="\0".repeat(4096);b.encrypted_policy_hash=Base64VecU8(env::sha256(payload.as_bytes()));collateral().insert(&"k1".into(),&b);
    result(PromiseResult::Successful(vec![]),NOW);let _=c.on_collateral_stored("k1".into(),nonce);
    let bytes=near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"owner":"keys.near","encrypted_data":payload,"version":1,"locked":true,"frozen":false})).unwrap();assert!(bytes.len()>16_384&&bytes.len()<32_768);
    result(PromiseResult::Successful(bytes),NOW);assert!(c.on_collateral_checked("k1".into(),nonce));assert!(c.get_collateral_binding("k1".into()).unwrap().ready);
}
