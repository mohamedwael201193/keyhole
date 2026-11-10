// Permanent regression probes adapted from the independent round-three review.
#[test]
fn review3_timeout_then_late_acceptance_must_not_report_success() {
    let mut c = r2_setup();
    ctx("alice.near", 1, NOW);
    let _ = c.nft_transfer_call(a("receiver.near"), "k1".into(), None, None, "".into());
    let epoch = c.nft_settlement_epoch("k1".into());
    ctx("anyone.near", 0, NOW + TRANSFER_RESTORE_DELAY_NS);
    assert!(!c.restore_expired_transfer("k1".into(), epoch));
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, a("alice.near"));
    result(PromiseResult::Successful(b"false".to_vec()), NOW + TRANSFER_RESTORE_DELAY_NS + 1);
    assert!(!c.resolve_transfer_call("k1".into(), epoch),
        "late resolver reports transfer success although timeout already returned title");
}
#[test]
fn review3_timeout_then_new_transfer_must_not_make_old_chain_report_success() {
    let mut c = r2_setup();
    ctx("alice.near", 1, NOW);
    let _ = c.nft_transfer_call(a("receiver.near"), "k1".into(), None, None, "".into());
    let old_epoch = c.nft_settlement_epoch("k1".into());
    ctx("anyone.near", 0, NOW + TRANSFER_RESTORE_DELAY_NS);
    assert!(!c.restore_expired_transfer("k1".into(), old_epoch));
    ctx("alice.near", 1, NOW + TRANSFER_RESTORE_DELAY_NS);
    let _ = c.nft_transfer_call(a("other-receiver.near"), "k1".into(), None, None, "".into());
    result(PromiseResult::Successful(b"false".to_vec()), NOW + TRANSFER_RESTORE_DELAY_NS + 1);
    assert!(!c.resolve_transfer_call("k1".into(), old_epoch),
        "old returned transfer is incorrectly reported accepted when a newer transfer is pending");
}
#[test]
fn review3_repay_wins_then_default_cannot_seize_or_credit_twice() {
    let mut c = r2_setup(); active(&mut c);
    ctx("alice.near", terms().repayment.0, NOW + 90*SECOND);
    let _ = c.repay_loan("k1".into(), U64(1));
    let liability = config_required().user_liabilities;
    ctx("lender.near", 1, NOW + 91*SECOND);
    rejected(|| { let _ = c.claim_default("k1".into(), U64(1), a("bob.near")); });
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, a("alice.near"));
    assert_eq!(c.get_payout_credit(a("lender.near")), terms().repayment);
    assert_eq!(config_required().user_liabilities, liability);
}
#[test]
fn review3_default_wins_then_repay_cannot_create_credit_or_change_title() {
    let mut c = r2_setup(); active(&mut c);
    ctx("lender.near", 1, NOW + 91*SECOND);
    let _ = c.claim_default("k1".into(), U64(1), a("bob.near"));
    let liability = config_required().user_liabilities;
    ctx("alice.near", terms().repayment.0, NOW + 91*SECOND);
    rejected(|| { let _ = c.repay_loan("k1".into(), U64(1)); });
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, a("bob.near"));
    assert_eq!(c.get_payout_credit(a("lender.near")).0, 0);
    assert_eq!(config_required().user_liabilities, liability);
}
#[test]
fn review3_pending_new_credit_and_stale_opposite_results_conserve_liabilities() {
    for paid in [true, false] {
        let mut c = r2_setup(); active(&mut c);
        ctx("alice.near", terms().repayment.0, NOW);
        let _ = c.repay_loan("k1".into(), U64(1));
        ctx("lender.near", 1, NOW);
        let _ = c.claim_payout();
        let p = c.get_pending_payout(a("lender.near")).unwrap();
        add_credit(&a("lender.near"), 321);
        let mut cfg=config_required(); change_liabilities(&mut cfg,321,0); save_config(&cfg);
        let before = config_required().user_liabilities.0;
        result(if paid { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed }, NOW);
        assert_eq!(c.on_payout(a("lender.near"),p.nonce),paid);
        assert_eq!(config_required().user_liabilities.0, before-if paid {p.amount.0}else{0});
        let available = c.get_payout_credit(a("lender.near"));
        assert_eq!(available.0,321+if paid{0}else{p.amount.0});
        result(if !paid { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed }, NOW);
        assert!(!c.on_payout(a("lender.near"),p.nonce));
        assert_eq!(c.get_payout_credit(a("lender.near")),available);
        ctx("lender.near",1,NOW); let _=c.claim_payout();
        let next=c.get_pending_payout(a("lender.near")).unwrap();assert_ne!(next.nonce,p.nonce);
        result(PromiseResult::Failed,NOW);assert!(!c.on_payout(a("lender.near"),p.nonce));
        assert_eq!(c.get_pending_payout(a("lender.near")).unwrap(),next);
    }
}
#[test]
fn review3_unknown_money_cannot_be_restored_by_title_timeout_and_remains_reserved() {
    let mut c=r2_setup(); open(&mut c); settle_policy(&mut c,true,NOW); fund(&mut c);
    ctx("alice.near",1,NOW);let _=c.claim_payout();
    let p=c.get_pending_payout(a("alice.near")).unwrap();
    ctx("anyone.near",0,NOW+1000*SECOND);
    rejected(||{ c.restore_expired_transfer("k1".into(),U64(1)); });
    assert_eq!(c.get_pending_payout(a("alice.near")).unwrap(),p);
    assert_eq!(c.get_payout_credit(a("alice.near")).0,0);
    assert_eq!(config_required().user_liabilities.0,N+LOAN_STORAGE_DEPOSIT);
    // Deliberately constrain liquid balance to storage+reserve+all unknown user claims.
    ctx("owner.near",2*N,RECOVERY_UNLOCK_NS);c.fund_treasury();
    let mut vm=context("recovery.near",0,RECOVERY_UNLOCK_NS);
    vm.storage_usage=env::storage_usage();
    vm.account_balance=yocto(env::storage_usage() as u128*env::storage_byte_cost().as_yoctonear()+OPERATING_RESERVE+config_required().user_liabilities.0);
    testing_env!(vm);
    assert_eq!(c.treasury_recoverable().0,0);
}

#[test]
fn review3_failed_sale_refund_cannot_be_counted_as_free_treasury() {
    let mut c=r2_setup();
    ctx("owner.near",1,NOW);c.set_royalty(a("keys.near"),0);
    ctx("owner.near",N,NOW);c.fund_treasury();
    ctx("alice.near",LIST_STORAGE_DEPOSIT,NOW);c.nft_list("k1".into(),U128(N));
    ctx("bob.near",N,NOW);c.nft_buy("k1".into());
    // Model the terminal failed seller push independently reproduced on the real runtime.
    // Old operational treasury has been spent on fees; remaining liquid value is the
    // refunded seller payment, apart from operating/storage reserves. There is no sale callback.
    let mut vm=context("recovery.near",0,RECOVERY_UNLOCK_NS);
    vm.storage_usage=env::storage_usage();
    vm.account_balance=yocto(env::storage_usage() as u128*env::storage_byte_cost().as_yoctonear()+OPERATING_RESERVE+N+LIST_STORAGE_DEPOSIT);
    testing_env!(vm);
    assert_eq!(c.treasury_recoverable().0,0,
        "gross treasury attribution plus zero seller liabilities lets failed user payment count as free capital");
}

#[test]
fn review3_all_migrated_refund_paths_create_backed_credit_without_native_pushes() {
    let mut c=r2_setup();
    ctx("alice.near",N/100,NOW); let _=c.nft_approve("k1".into(),a("market.near"),None);
    let excess=c.get_payout_credit(a("alice.near")).0;
    assert!(excess>0 && excess<N/100);assert!(get_created_receipts().is_empty());
    ctx("alice.near",1,NOW);c.nft_revoke("k1".into(),a("market.near"));
    assert_eq!(c.get_payout_credit(a("alice.near")).0,N/100);
    assert_eq!(config_required().user_liabilities.0,N/100);assert!(get_created_receipts().is_empty());
    ctx("alice.near",N/100,NOW);let _=c.nft_approve("k1".into(),a("market.near"),None);
    ctx("alice.near",1,NOW);c.nft_revoke_all("k1".into());
    assert_eq!(c.get_payout_credit(a("alice.near")).0,N/50);assert!(get_created_receipts().is_empty());
    ctx("alice.near",2*LIST_STORAGE_DEPOSIT,NOW);c.nft_list("k1".into(),U128(N));
    assert_eq!(c.get_payout_credit(a("alice.near")).0,N/50+LIST_STORAGE_DEPOSIT);
    ctx("alice.near",1,NOW);c.nft_unlist("k1".into());
    assert_eq!(config_required().user_liabilities.0,N/50+2*LIST_STORAGE_DEPOSIT);
    assert_eq!(c.get_payout_credit(a("alice.near")).0,config_required().user_liabilities.0);
    assert!(get_created_receipts().is_empty());
    ctx("minter.near",N/10,NOW);c.nft_mint("k2".into(),a("bob.near"),1,TokenMetadata::default());
    assert!(c.get_payout_credit(a("minter.near")).0>0);assert!(get_created_receipts().is_empty());
    assert_eq!(config_required().user_liabilities.0,c.get_payout_credit(a("alice.near")).0+c.get_payout_credit(a("minter.near")).0);
}
#[test]
fn review3_pre_migration_sale_credit_and_inflight_nonce_survive_migration() {
    near_sdk::mock::with_mocked_blockchain(|b|{b.take_storage();});
    ctx("keys.near",0,NOW);let mut c=Contract::new(a("owner.near"),a("minter.near"),a("treasury.near"),0);
    test_register_payouts(&mut c,&[a("minter.near"),a("alice.near")]);
    ctx("minter.near",N/10,NOW);c.nft_mint("k1".into(),a("alice.near"),1,TokenMetadata::default());
    ctx("alice.near",LIST_STORAGE_DEPOSIT,NOW);c.nft_list("k1".into(),U128(N));ctx("bob.near",N,NOW);c.nft_buy("k1".into());
    let mint_credit=c.get_payout_credit(a("minter.near")).0;
    assert_eq!(pre_total(),N+LIST_STORAGE_DEPOSIT+mint_credit);
    ctx("alice.near",1,NOW);let _=c.claim_payout();let p=c.get_pending_payout(a("alice.near")).unwrap();
    env::state_write(&c);ctx("keys.near",0,NOW);
    let mut c=Contract::migrate_pledge(a("recovery.near"),Base64VecU8(vec![7;32]),a("custody.near"),"sandbox".into());
    assert_eq!(config_required().user_liabilities.0,p.amount.0+mint_credit);assert_eq!(config_required().next_payout_nonce,p.nonce);
    result(PromiseResult::Failed,NOW);assert!(!c.on_payout(a("alice.near"),p.nonce));
    assert_eq!(c.get_payout_credit(a("alice.near")),p.amount);
    ctx("alice.near",1,NOW);let _=c.claim_payout();let next=c.get_pending_payout(a("alice.near")).unwrap();assert!(next.nonce.0>p.nonce.0);
    result(PromiseResult::Successful(vec![]),NOW);assert!(!c.on_payout(a("alice.near"),p.nonce));assert_eq!(c.get_pending_payout(a("alice.near")).unwrap(),next);
    assert!(c.on_payout(a("alice.near"),next.nonce));assert_eq!(config_required().user_liabilities.0,mint_credit);
}
