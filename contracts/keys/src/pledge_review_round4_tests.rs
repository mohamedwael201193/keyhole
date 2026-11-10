// Permanent round-four reviewer regression probes.
#[test]
fn review4_timeout_matrix_never_accepts_stale_chain_or_mutates_newer_title() {
    for newer in [false,true] {
        for output in [Some(b"false".to_vec()),Some(b"true".to_vec()),Some(b"bad".to_vec()),Some(vec![b' ';2_000_000]),None] {
            near_sdk::mock::with_mocked_blockchain(|b| { b.take_storage(); });
        let mut c=setup();
            ctx("alice.near",1,NOW);
            let _=c.nft_transfer_call(a("receiver.near"),"k1".into(),None,None,"".into());
            let old=c.nft_settlement_epoch("k1".into());
            ctx("stranger.near",0,NOW+TRANSFER_RESTORE_DELAY_NS-1);
            rejected(||{c.restore_expired_transfer("k1".into(),old);});
            ctx("stranger.near",0,NOW+TRANSFER_RESTORE_DELAY_NS);
            assert!(!c.restore_expired_transfer("k1".into(),old));
            if newer {ctx("alice.near",1,NOW+TRANSFER_RESTORE_DELAY_NS);let _=c.nft_transfer_call(a("new-receiver.near"),"k1".into(),None,None,"".into());}
            let title=c.nft_token("k1".into()).unwrap().owner_id;
            let epoch=c.nft_settlement_epoch("k1".into());
            let pending=c.get_pending_transfer("k1".into()).map(|p|p.epoch);
            result(output.map(PromiseResult::Successful).unwrap_or(PromiseResult::Failed),NOW+TRANSFER_RESTORE_DELAY_NS+1);
            assert!(!c.resolve_transfer_call("k1".into(),old));
            assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,title);
            assert_eq!(c.nft_settlement_epoch("k1".into()),epoch);
            assert_eq!(c.get_pending_transfer("k1".into()).map(|p|p.epoch),pending);
            assert_eq!(c.pending_return_count(a("alice.near")),if newer {1}else{0});
            if newer {result(PromiseResult::Successful(b"false".to_vec()),NOW+TRANSFER_RESTORE_DELAY_NS+2);assert!(c.resolve_transfer_call("k1".into(),epoch));}
        }
    }
}
#[test]
fn review4_sale_split_failed_cashout_new_credit_and_migration_preserve_exact_totals() {
    for premigration in [false,true] {
        near_sdk::mock::with_mocked_blockchain(|b| { b.take_storage(); });
        let mut c=setup();
        if premigration {env::storage_remove(CONFIG_KEY);}
        let total=|c:&Contract|c.get_pledge_config().map(|x|x.user_liabilities.0).unwrap_or_else(pre_total);
        ctx("alice.near",2*LIST_STORAGE_DEPOSIT,NOW);c.nft_list("k1".into(),U128(N));
        ctx("bob.near",N+N/10,NOW);c.nft_buy("k1".into());
        assert!(get_created_receipts().is_empty());
        let seller=N-N/20+2*LIST_STORAGE_DEPOSIT;
        assert_eq!(c.get_payout_credit(a("alice.near")).0,seller);
        assert_eq!(c.get_payout_credit(a("bob.near")).0,N/10);
        assert_eq!(c.get_payout_credit(a("treasury.near")).0,N/20);
        let initial=N+N/10+2*LIST_STORAGE_DEPOSIT;
        assert_eq!(total(&c),initial);
        ctx("alice.near",1,NOW);let _=c.claim_payout();let p=c.get_pending_payout(a("alice.near")).unwrap();
        if premigration {
            env::state_write(&c);ctx("keys.near",0,NOW);
            c=Contract::migrate_pledge(a("recovery.near"),Base64VecU8(sk().verifying_key().to_bytes().to_vec()),a("custody.near"),"sandbox".into());
        }
        result(PromiseResult::Failed,NOW);assert!(!c.on_payout(a("alice.near"),p.nonce));
        assert_eq!(c.get_payout_credit(a("alice.near")).0,seller);assert_eq!(total(&c),initial);
        result(PromiseResult::Successful(vec![]),NOW);assert!(!c.on_payout(a("alice.near"),p.nonce));
        assert_eq!(c.get_payout_credit(a("alice.near")).0,seller);
        ctx("alice.near",1,NOW);let _=c.claim_payout();let next=c.get_pending_payout(a("alice.near")).unwrap();assert!(next.nonce.0>p.nonce.0);
        ctx("bob.near",LIST_STORAGE_DEPOSIT,NOW);c.nft_list("k1".into(),U128(N));
        ctx("alice.near",N+123,NOW);c.nft_buy("k1".into());
        let before=total(&c);
        result(PromiseResult::Failed,NOW);assert!(!c.on_payout(a("alice.near"),p.nonce));
        assert_eq!(c.get_pending_payout(a("alice.near")).unwrap(),next);
        result(PromiseResult::Successful(vec![]),NOW);assert!(c.on_payout(a("alice.near"),next.nonce));
        assert_eq!(c.get_payout_credit(a("alice.near")).0,123);
        assert_eq!(total(&c),before-seller);
        for who in ["alice.near","bob.near","treasury.near"] {
            ctx("attacker.near",0,NOW);rejected(||{c.on_payout(a(who),next.nonce);});
        }
    }
}
#[test]
fn review4_dust_sale_refunds_must_pay_for_persistent_ledger_storage() {
    near_sdk::mock::with_mocked_blockchain(|b| { b.take_storage(); });
        let mut c=setup();ctx("owner.near",1,NOW);c.set_royalty(a("treasury.near"),0);
    // Warm every one-time per-token/index/nonce key. Do not blame old fixed metadata for new growth.
    ctx("alice.near",LIST_STORAGE_DEPOSIT,NOW);c.nft_list("k1".into(),U128(N));
    ctx("alice.near",1,NOW);c.nft_unlist("k1".into());
    ctx("alice.near",1,NOW);let _=c.claim_payout();let p=c.get_pending_payout(a("alice.near")).unwrap();result(PromiseResult::Successful(vec![]),NOW);assert!(c.on_payout(a("alice.near"),p.nonce));
    ctx("alice.near",1,NOW);c.nft_transfer(a("warm0.near"),"k1".into(),None,None);
    ctx("warm0.near",1,NOW);c.nft_transfer(a("alice.near"),"k1".into(),None,None);
    let before=env::storage_usage();
    let mut retained=0u128;
    for i in 0..20 {
        let buyer=format!("dust{i:03}.near");
        ctx("alice.near",LIST_STORAGE_DEPOSIT,NOW);c.nft_list("k1".into(),U128(N));
        let fee=c.payout_storage_cost().0;
        ctx("sponsor.near",fee,NOW);assert!(c.register_payout_account(Some(a(&buyer))));
        retained+=fee; // Separate non-refundable storage payment, not deducted from the 2-yocto refund.
        ctx(&buyer,N+2,NOW);c.nft_buy("k1".into());
        assert_eq!(c.get_payout_credit(a(&buyer)).0,2);
        ctx(&buyer,1,NOW);c.nft_transfer(a("alice.near"),"k1".into(),None,None);
        ctx("alice.near",1,NOW);let _=c.claim_payout();let p=c.get_pending_payout(a("alice.near")).unwrap();
        result(PromiseResult::Successful(vec![]),NOW);assert!(c.on_payout(a("alice.near"),p.nonce));
        retained+=4; // buyer excess=2 + gift yocto + claim yocto, all principal/bonds paid back
        assert_eq!(config_required().user_liabilities.0,(i+1)*2);
        let stake=(env::storage_usage()-before) as u128*env::storage_byte_cost().as_yoctonear();
        assert!(retained>=stake+config_required().user_liabilities.0,"each fresh identity prepays its own storage while preserving its full credit");
        println!("after {} dust buyers: storage delta={} bytes, liability={} yocto, retained={} yocto",i+1,env::storage_usage()-before,config_required().user_liabilities.0,retained);
    }
    let cost=(env::storage_usage()-before) as u128*env::storage_byte_cost().as_yoctonear();
    assert!(retained>=cost+config_required().user_liabilities.0,"unbounded refundable dust-credit ledgers consume pre-existing storage backing: new_cost={cost}, retained={retained}");
}


#[test]
fn review4_unregistered_dust_buyer_is_rejected_without_changing_title_or_liabilities() {
    let mut c=setup(); ctx("owner.near",1,NOW);c.set_royalty(a("keys.near"),0);
    ctx("alice.near",LIST_STORAGE_DEPOSIT,NOW);c.nft_list("k1".into(),U128(N));
    let before=env::storage_usage();let liabilities=c.get_pledge_config().unwrap().user_liabilities;
    ctx("fresh.near",N+2,NOW);rejected(||{c.nft_buy("k1".into());});
    assert!(!c.payout_account_registered(a("fresh.near")));
    assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,a("alice.near"));
    assert!(c.nft_listing("k1".into()).is_some());
    assert_eq!(env::storage_usage(),before);assert_eq!(c.get_pledge_config().unwrap().user_liabilities,liabilities);
}

#[test]
fn review4_registration_prepays_maximum_ledger_pending_and_fixed_metadata() {
    ctx("keys.near",0,NOW);
    let mut c=Contract::new(a("owner.near"),a("minter.near"),a("keys.near"),0);
    let who=a(&format!("{}.near","x".repeat(59)));let fee=c.payout_storage_cost().0;
    let before=env::storage_usage();
    for invalid in [0,fee-1,fee+1] {
        ctx("sponsor.near",invalid,NOW);rejected(||{c.register_payout_account(Some(who.clone()));});
        assert!(!c.payout_account_registered(who.clone()));assert_eq!(env::storage_usage(),before);
    }
    ctx("sponsor.near",fee,NOW);assert!(c.register_payout_account(Some(who.clone())));
    let empty_usage=env::storage_usage();let registered=empty_usage-before;
    record_native_credit(&who,7);ctx(who.as_str(),1,NOW);let _=c.claim_payout();
    let pending=c.get_pending_payout(who.clone()).unwrap();let maximum=env::storage_usage()-before;
    assert!(maximum<=PAYOUT_STORAGE_BYTES);assert!(fee>=maximum as u128*env::storage_byte_cost().as_yoctonear());
    assert_eq!(c.get_payout_credit(who.clone()),U128(0));
    // Unknown callback stays pending with already-funded storage, and new credits reuse the same slot.
    let pending_usage=env::storage_usage();record_native_credit(&who,2);assert_eq!(env::storage_usage(),pending_usage);
    ctx("sponsor.near",fee,NOW);rejected(||{c.register_payout_account(Some(who.clone()));});
    assert_eq!(c.get_pending_payout(who.clone()).unwrap().nonce,pending.nonce);
    assert_eq!(c.get_payout_credit(who.clone()),U128(2));
    result(PromiseResult::Failed,NOW);assert!(!c.on_payout(who.clone(),pending.nonce));assert_eq!(c.get_payout_credit(who.clone()),U128(9));
    ctx(who.as_str(),1,NOW);let _=c.claim_payout();let pending=c.get_pending_payout(who.clone()).unwrap();
    result(PromiseResult::Successful(vec![]),NOW);assert!(c.on_payout(who.clone(),pending.nonce));
    assert!(c.payout_account_registered(who.clone()));assert_eq!(c.get_payout_credit(who.clone()),U128(0));
    let reusable=env::storage_usage();record_native_credit(&who,1);assert_eq!(env::storage_usage(),reusable);
    eprintln!("review4 funded maximum account: registration={} bytes, ledger+pending+fixed={} bytes, budget={} bytes, fee={} yocto",registered,maximum,PAYOUT_STORAGE_BYTES,fee);
}
