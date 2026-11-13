use super::*;
use ed25519_dalek::{Signer,SigningKey};
use near_sdk::{test_utils::{VMContextBuilder,get_created_receipts},testing_env,PromiseResult};
use std::panic::{catch_unwind,AssertUnwindSafe};
const NOW:u64=1_794_000_000_000_000_000;const N:u128=1_000_000_000_000_000_000_000_000;
fn a(s:&str)->AccountId{s.parse().unwrap()}
fn sk()->SigningKey{SigningKey::from_bytes(&[7;32])}
fn context(who:&str,dep:u128,now:u64)->near_sdk::VMContext{VMContextBuilder::new().current_account_id(a("keys.near")).predecessor_account_id(a(who)).signer_account_id(a(who)).account_balance(yocto(1000*N)).attached_deposit(yocto(dep)).prepaid_gas(Gas::from_tgas(300)).block_timestamp(now).storage_usage(env::storage_usage()).build()}
fn ctx(who:&str,dep:u128,now:u64){testing_env!(context(who,dep,now));}
fn result(r:PromiseResult){testing_env!(context("keys.near",0,NOW),near_sdk::test_vm_config(),near_sdk::RuntimeFeesConfig::test(),HashMap::default(),vec![r]);}
fn setup()->Contract{setup_with_registered_seller(true)}
fn setup_with_registered_seller(register_seller:bool)->Contract{
 ctx("keys.near",0,NOW);let mut c=Contract::new(a("owner.near"),a("minter.near"),a("treasury.near"),0);
 crate::test_register_payouts(&mut c,&[a("minter.near")]);if register_seller{crate::test_register_payouts(&mut c,&[a("alice.near")]);}
 ctx("minter.near",N/10,NOW);c.nft_mint("k1".into(),a("alice.near"),2,TokenMetadata{title:Some("Key".into()),..Default::default()});
 env::state_write(&c);ctx("keys.near",0,NOW);let mut c=Contract::migrate_pledge(a("recovery.near"),Base64VecU8(sk().verifying_key().to_bytes().to_vec()),a("custody.near"),"sandbox".into());
 collateral().insert(&"k1".into(),&CollateralBinding{wallet_pubkey:format!("ed25519:{}","ab".repeat(32)),encrypted_policy_hash:Base64VecU8(env::sha256(b"sealed-policy")),policy_version:U64(1),ready:true,policy_generation:U64(0)});
 ctx("owner.near",1,NOW);c.set_protected_sales_enabled(true);c
}
fn terms()->SaleTerms{SaleTerms{buyer:a("buyer.near"),price:U128(N/100),floor_raw:U128(500_000),deadline_ns:U64(NOW+600_000_000_000)}}
fn open(c:&mut Contract){ctx("alice.near",SALE_STORAGE_BOND,NOW);let _=c.open_sale("k1".into(),terms());}
fn policy(frozen:bool)->PromiseResult{PromiseResult::Successful(near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"owner":"keys.near","encrypted_data":"sealed-policy","version":1,"locked":true,"frozen":frozen})).unwrap())}
fn settle(c:&mut Contract,frozen:bool){let s=c.get_sale("k1".into()).unwrap();result(PromiseResult::Successful(vec![]));let _=c.on_sale_policy_action("k1".into(),s.nonce,s.policy_sequence);result(policy(frozen));assert!(c.on_sale_policy_view("k1".into(),s.nonce,s.policy_sequence));}
fn cert(c:&Contract)->SaleCertificate{c.sale_certificate_template("k1".into(),U64(NOW),U64(NOW+30_000_000_000))}
fn signed(v:&SaleCertificate)->Base64VecU8{Base64VecU8(sk().sign(&near_sdk::borsh::to_vec(v).unwrap()).to_bytes().to_vec())}
fn buy(c:&mut Contract){let v=cert(c);let sig=signed(&v);ctx("buyer.near",terms().price.0,NOW);let _=c.buy_sale("k1".into(),U64(1),v,sig);}
fn rejects<F:FnOnce()>(f:F){assert!(catch_unwind(AssertUnwindSafe(f)).is_err());}
#[test] fn paid_title_and_exact_seller_credit_are_atomic_before_thaw(){let mut c=setup();let prior=config_required().user_liabilities.0;open(&mut c);settle(&mut c,true);buy(&mut c);assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,a("buyer.near"));assert_eq!(c.nft_settlement_epoch("k1".into()).0,1);assert_eq!(c.get_payout_credit(a("alice.near")).0,terms().price.0);assert_eq!(c.get_sale("k1".into()).unwrap().state,SaleState::UnlockPending);assert_eq!(config_required().user_liabilities.0,prior+SALE_STORAGE_BOND+terms().price.0);settle(&mut c,false);assert!(c.get_sale("k1".into()).is_none());assert_eq!(c.get_payout_credit(a("alice.near")).0,SALE_STORAGE_BOND+terms().price.0);assert_eq!(config_required().treasury_available.0,0);}
#[test] fn unknown_policy_cannot_be_redispatched_cancelled_or_cleared_by_view(){let mut c=setup();open(&mut c);ctx("alice.near",1,NOW);rejects(||{let _=c.cancel_sale("k1".into(),U64(1));});rejects(||{let _=c.retry_sale_policy("k1".into(),U64(1));});rejects(||{let _=c.reconcile_sale_policy("k1".into(),U64(1));});result(policy(true));assert!(!c.on_sale_policy_view("k1".into(),U64(1),U64(1)));assert_eq!(c.get_sale("k1".into()).unwrap().state,SaleState::Freezing);}
#[test] fn cancelled_reopened_sale_invalidates_old_nonce_and_certificate(){let mut c=setup();open(&mut c);settle(&mut c,true);let old=cert(&c);ctx("alice.near",1,NOW);let _=c.cancel_sale("k1".into(),U64(1));settle(&mut c,false);open(&mut c);settle(&mut c,true);let sig=signed(&old);ctx("buyer.near",terms().price.0,NOW);rejects(||{let _=c.buy_sale("k1".into(),U64(2),old,sig);});assert_eq!(c.get_sale("k1".into()).unwrap().nonce.0,2);}
#[test] fn every_certificate_field_is_bound_even_with_valid_attestor_signature(){let mut c=setup();open(&mut c);settle(&mut c,true);let original=near_sdk::serde_json::to_value(cert(&c)).unwrap();let fields=original.as_object().unwrap().keys().cloned().collect::<Vec<_>>();for field in fields{let mut v=original.clone();match field.as_str(){"terms"=>v["terms"]["price"]=near_sdk::serde_json::json!("1"),"floor_met"|"frozen"=>v[&field]=near_sdk::serde_json::json!(false),"decimals"=>v[&field]=near_sdk::serde_json::json!(8),"royalty_bps"=>v[&field]=near_sdk::serde_json::json!(1),"observed_at_ns"=>{continue;},"expires_at_ns"=>{continue;},"policy_hash"=>v[&field]=near_sdk::serde_json::json!("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),"domain"=>v[&field]=near_sdk::serde_json::json!(pledge::CERTIFICATE_DOMAIN),"seller"|"controller"|"custody_contract"|"contract"=>v[&field]=near_sdk::serde_json::json!("wrong.near"),_=>{let old=v[&field].as_str().unwrap();v[&field]=near_sdk::serde_json::json!(format!("{old}1"));}}let bad:SaleCertificate=near_sdk::serde_json::from_value(v).unwrap();let sig=signed(&bad);ctx("buyer.near",terms().price.0,NOW);rejects(||{let _=c.buy_sale("k1".into(),U64(1),bad,sig);});}assert_eq!(c.nft_settlement_epoch("k1".into()).0,0);}
#[test] fn stale_future_and_overlong_certificates_are_rejected(){let mut c=setup();open(&mut c);settle(&mut c,true);for(observed,expires)in[(NOW-100_000_000_000,NOW-1),(NOW+1,NOW+30_000_000_000),(NOW,NOW+60_000_000_001)]{let v=c.sale_certificate_template("k1".into(),U64(observed),U64(expires));let sig=signed(&v);ctx("buyer.near",terms().price.0,NOW);rejects(||{let _=c.buy_sale("k1".into(),U64(1),v,sig);});}}
#[test] fn all_alternate_transfer_approval_listing_and_value_routes_fail_closed(){let mut c=setup();ctx("alice.near",N/10,NOW);let _=c.nft_approve("k1".into(),a("market.near"),None);open(&mut c);settle(&mut c,true);ctx("alice.near",1,NOW);rejects(||c.nft_transfer(a("buyer.near"),"k1".into(),None,None));rejects(||{let _=c.nft_transfer_call(a("buyer.near"),"k1".into(),None,None,"".into());});rejects(||{let _=c.nft_transfer_payout(a("buyer.near"),"k1".into(),None,None,U128(10),Some(10));});rejects(||{let _=c.nft_approve("k1".into(),a("other.near"),None);});rejects(||c.nft_list("k1".into(),U128(N)));ctx("buyer.near",terms().price.0,NOW);rejects(||c.nft_buy("k1".into()));ctx("minter.near",N/100,NOW);rejects(||c.begin_value_op("k1".into(),U64(0),"1:a".into(),"hash".into(),a("alice.near")));assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,a("alice.near"));}
#[test] fn purchase_clears_prior_approval_and_double_buy_is_refused(){let mut c=setup();let prior=config_required().user_liabilities.0;ctx("alice.near",N/10,NOW);let _=c.nft_approve("k1".into(),a("market.near"),None);open(&mut c);settle(&mut c,true);buy(&mut c);assert!(!c.nft_is_approved("k1".into(),a("market.near"),None));assert_eq!(c.get_payout_credit(a("alice.near")).0,N/10+terms().price.0);assert_eq!(config_required().user_liabilities.0,prior+N/10+SALE_STORAGE_BOND+terms().price.0);let v=cert(&c);let sig=signed(&v);ctx("buyer.near",terms().price.0,NOW);rejects(||{let _=c.buy_sale("k1".into(),U64(1),v,sig);});}
#[test] fn price_buyer_rate_and_control_changes_reject_before_accepting_money(){let mut c=setup();open(&mut c);settle(&mut c,true);let v=cert(&c);ctx("other.near",terms().price.0,NOW);rejects(||{let _=c.buy_sale("k1".into(),U64(1),v.clone(),signed(&v));});ctx("buyer.near",terms().price.0+1,NOW);rejects(||{let _=c.buy_sale("k1".into(),U64(1),v.clone(),signed(&v));});ctx("owner.near",1,NOW);c.set_royalty(a("treasury.near"),1);ctx("buyer.near",terms().price.0,NOW);rejects(||{let _=c.buy_sale("k1".into(),U64(1),v.clone(),signed(&v));});assert_eq!(c.get_payout_credit(a("alice.near")).0,0);}
#[test] fn sale_and_admission_are_serialized_in_both_orders(){let mut c=setup();ctx("minter.near",N/100,NOW);c.begin_value_op("k1".into(),U64(0),"1:a".into(),"hash".into(),a("alice.near"));ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),terms());});}
#[test] fn seller_credit_survives_unknown_native_cashout(){let mut c=setup();let prior=config_required().user_liabilities.0;open(&mut c);settle(&mut c,true);buy(&mut c);ctx("alice.near",1,NOW);let _=c.claim_payout();assert_eq!(c.get_payout_credit(a("alice.near")).0,0);assert_eq!(c.get_pending_payout(a("alice.near")).unwrap().amount.0,terms().price.0);assert_eq!(config_required().user_liabilities.0,prior+SALE_STORAGE_BOND+terms().price.0);}
#[test] fn expiry_anyone_can_cancel_and_late_freeze_view_is_harmless(){let mut c=setup();open(&mut c);settle(&mut c,true);ctx("other.near",1,NOW+601_000_000_000);let _=c.cancel_sale("k1".into(),U64(1));result(policy(true));assert!(!c.on_sale_policy_view("k1".into(),U64(1),U64(1)));assert_eq!(c.get_sale("k1".into()).unwrap().state,SaleState::UnlockPending);settle(&mut c,false);assert!(c.get_sale("k1".into()).is_none());}
#[test] fn storage_bond_is_measured_and_refund_is_pull_credit(){let mut c=setup();let prior=config_required().user_liabilities.0;open(&mut c);let receipt=get_created_receipts();assert!(!receipt.is_empty());assert_eq!(config_required().user_liabilities.0,prior+SALE_STORAGE_BOND);settle(&mut c,true);ctx("alice.near",1,NOW);let _=c.cancel_sale("k1".into(),U64(1));settle(&mut c,false);assert_eq!(c.get_payout_credit(a("alice.near")).0,SALE_STORAGE_BOND);}

#[test] fn every_nested_sale_term_is_bound_with_valid_signature(){
 let mut c=setup();open(&mut c);settle(&mut c,true);
 let original=near_sdk::serde_json::to_value(cert(&c)).unwrap();
 for field in ["buyer","price","floor_raw","deadline_ns"] {
  let mut v=original.clone();v["terms"][field]=near_sdk::serde_json::json!(if field=="buyer" {"wrong.near"}else{"1"});
  let bad:SaleCertificate=near_sdk::serde_json::from_value(v).unwrap();let sig=signed(&bad);
  ctx("buyer.near",terms().price.0,NOW);rejects(||{let _=c.buy_sale("k1".into(),U64(1),bad,sig);});
 }
 assert_eq!(c.get_payout_credit(a("alice.near")).0,0);
}
#[test] fn bad_signature_and_expired_sale_leave_title_and_credit_untouched(){
 let mut c=setup();open(&mut c);settle(&mut c,true);let v=cert(&c);
 ctx("buyer.near",terms().price.0,NOW);rejects(||{let _=c.buy_sale("k1".into(),U64(1),v.clone(),Base64VecU8(vec![0;64]));});
 let ts=terms().deadline_ns.0+1;let v=c.sale_certificate_template("k1".into(),U64(ts),U64(ts+1));let sig=signed(&v);
 ctx("buyer.near",terms().price.0,ts);rejects(||{let _=c.buy_sale("k1".into(),U64(1),v,sig);});
 assert_eq!(c.nft_settlement_epoch("k1".into()).0,0);assert_eq!(c.get_payout_credit(a("alice.near")).0,0);
}
#[test] fn policy_snapshot_must_match_exact_controller_lock_version_and_hash(){
 let mut c=setup();open(&mut c);result(PromiseResult::Successful(vec![]));let _=c.on_sale_policy_action("k1".into(),U64(1),U64(1));
 for(field,value)in [("owner",near_sdk::serde_json::json!("wrong.near")),("locked",near_sdk::serde_json::json!(false)),("version",near_sdk::serde_json::json!(2)),("encrypted_data",near_sdk::serde_json::json!("tampered"))] {
  let mut p=near_sdk::serde_json::json!({"owner":"keys.near","encrypted_data":"sealed-policy","version":1,"locked":true,"frozen":true});p[field]=value;
  result(PromiseResult::Successful(near_sdk::serde_json::to_vec(&p).unwrap()));assert!(!c.on_sale_policy_view("k1".into(),U64(1),U64(1)));
  assert_eq!(c.get_sale("k1".into()).unwrap().state,SaleState::Freezing);
 }
 result(policy(true));assert!(c.on_sale_policy_view("k1".into(),U64(1),U64(1)));
 result(policy(false));assert!(!c.on_sale_policy_view("k1".into(),U64(1),U64(1)));
 assert_eq!(c.get_sale("k1".into()).unwrap().state,SaleState::Offered);
}

#[test] fn delayed_policy_read_blocks_retry_cancel_and_duplicate_action(){
 let mut c=setup();open(&mut c);
 result(PromiseResult::Successful(vec![]));let _=c.on_sale_policy_action("k1".into(),U64(1),U64(1));
 let s=c.get_sale("k1".into()).unwrap();assert!(s.policy_busy&&s.policy_call_complete);
 ctx("alice.near",1,NOW);
 rejects(||{let _=c.retry_sale_policy("k1".into(),U64(1));});
 rejects(||{let _=c.cancel_sale("k1".into(),U64(1));});
 result(PromiseResult::Successful(vec![]));
 assert!(matches!(c.on_sale_policy_action("k1".into(),U64(1),U64(1)),PromiseOrValue::Value(false)));
 assert!(get_created_receipts().is_empty());
 result(PromiseResult::Failed);assert!(!c.on_sale_policy_view("k1".into(),U64(1),U64(1)));
 ctx("alice.near",1,NOW);rejects(||{let _=c.cancel_sale("k1".into(),U64(1));});
 let _=c.reconcile_sale_policy("k1".into(),U64(1));
 result(policy(true));assert!(c.on_sale_policy_view("k1".into(),U64(1),U64(1)));
 ctx("alice.near",1,NOW);let _=c.cancel_sale("k1".into(),U64(1));
 assert_eq!(c.get_sale("k1".into()).unwrap().policy_sequence,U64(2));
 result(policy(true));assert!(!c.on_sale_policy_view("k1".into(),U64(1),U64(1)));
 assert!(c.get_sale("k1".into()).unwrap().policy_busy);
 settle(&mut c,false);assert!(c.get_sale("k1".into()).is_none());
}
#[test] fn verified_failed_direction_allows_retry_but_old_callbacks_cannot_release_new_command(){
 let mut c=setup();open(&mut c);result(PromiseResult::Failed);
 let _=c.on_sale_policy_action("k1".into(),U64(1),U64(1));
 result(policy(false));assert!(c.on_sale_policy_view("k1".into(),U64(1),U64(1)));
 assert!(!c.get_sale("k1".into()).unwrap().policy_busy);
 ctx("alice.near",0,NOW);let _=c.retry_sale_policy("k1".into(),U64(1));
 result(PromiseResult::Successful(vec![]));
 assert!(matches!(c.on_sale_policy_action("k1".into(),U64(1),U64(1)),PromiseOrValue::Value(false)));
 result(policy(true));assert!(!c.on_sale_policy_view("k1".into(),U64(1),U64(1)));
 let s=c.get_sale("k1".into()).unwrap();assert_eq!(s.policy_sequence,U64(2));assert!(s.policy_busy&&!s.policy_call_complete);
 ctx("alice.near",1,NOW);rejects(||{let _=c.cancel_sale("k1".into(),U64(1));});
 settle(&mut c,true);assert_eq!(c.get_sale("k1".into()).unwrap().state,SaleState::Offered);
}

#[test] fn protected_sale_requires_prepaid_seller_slot_before_any_policy_dispatch(){
 let mut c=setup_with_registered_seller(false);let prior=config_required().user_liabilities;
 ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),terms());});
 assert!(c.get_sale("k1".into()).is_none());assert_eq!(config_required().user_liabilities,prior);
 assert!(get_created_receipts().is_empty());
 crate::test_register_payouts(&mut c,&[a("alice.near")]);open(&mut c);settle(&mut c,true);buy(&mut c);
 assert_eq!(c.get_payout_credit(a("alice.near")).0,terms().price.0);
}

#[test] fn cancel_sale_refuses_non_seller_before_expiry(){let mut c=setup();open(&mut c);settle(&mut c,true);ctx("other.near",1,NOW);rejects(||{let _=c.cancel_sale("k1".into(),U64(1));});assert_eq!(c.get_sale("k1".into()).unwrap().state,SaleState::Offered);}
#[test] fn open_sale_refuses_non_seller(){let mut c=setup();ctx("bob.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),terms());});assert!(c.get_sale("k1".into()).is_none());}

// ---------- batch B: protected-sale refusal pins ----------
#[test] fn open_sale_refuses_zero_price(){let mut c=setup();let mut t=terms();t.price=U128(0);ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),t.clone());});assert!(c.get_sale("k1".into()).is_none());}
#[test] fn open_sale_refuses_price_above_max(){let mut c=setup();let mut t=terms();t.price=U128(MAX_LIST_PRICE+1);ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),t.clone());});assert!(c.get_sale("k1".into()).is_none());}
#[test] fn open_sale_refuses_zero_floor(){let mut c=setup();let mut t=terms();t.floor_raw=U128(0);ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),t.clone());});assert!(c.get_sale("k1".into()).is_none());}
#[test] fn open_sale_refuses_deadline_in_past(){let mut c=setup();let mut t=terms();t.deadline_ns=U64(NOW);ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),t.clone());});assert!(c.get_sale("k1".into()).is_none());}
#[test] fn open_sale_refuses_deadline_beyond_seven_days(){let mut c=setup();let mut t=terms();t.deadline_ns=U64(NOW+7u64*86_400_000_000_000u64+1);ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),t.clone());});assert!(c.get_sale("k1".into()).is_none());}
#[test] fn open_sale_refuses_buyer_is_seller(){let mut c=setup();let mut t=terms();t.buyer=a("alice.near");ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),t.clone());});assert!(c.get_sale("k1".into()).is_none());}
#[test] fn open_sale_refuses_buyer_who_holds_a_key(){let mut c=setup();crate::test_register_payouts(&mut c,&[a("buyer.near")]);ctx("minter.near",N/10,NOW);c.nft_mint("k2".into(),a("buyer.near"),2,TokenMetadata{title:Some("Key".into()),..Default::default()});ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),terms());});assert!(c.get_sale("k1".into()).is_none());assert_eq!(c.nft_token("k2".into()).unwrap().owner_id,a("buyer.near"));}
#[test] fn open_sale_refuses_wrong_bond(){let mut c=setup();for bond in [SALE_STORAGE_BOND-1,SALE_STORAGE_BOND+1]{ctx("alice.near",bond,NOW);rejects(||{let _=c.open_sale("k1".into(),terms());});}assert!(c.get_sale("k1".into()).is_none());}
#[test] fn open_sale_refuses_listed_token(){let mut c=setup();ctx("alice.near",LIST_STORAGE_DEPOSIT,NOW);c.nft_list("k1".into(),U128(N));ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),terms());});assert!(c.get_sale("k1".into()).is_none());}
#[test] fn open_sale_refuses_unready_collateral(){let mut c=setup();crate::test_register_payouts(&mut c,&[a("bob.near")]);ctx("minter.near",N/10,NOW);c.nft_mint("k2".into(),a("bob.near"),2,TokenMetadata{title:Some("Key".into()),..Default::default()});ctx("bob.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k2".into(),terms());});assert!(c.get_sale("k2".into()).is_none());}
#[test] fn open_sale_refuses_when_sales_disabled(){let mut c=setup();ctx("owner.near",1,NOW);c.set_protected_sales_enabled(false);assert!(!c.protected_sales_enabled());ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),terms());});assert!(c.get_sale("k1".into()).is_none());}
#[test] fn open_sale_refuses_nonzero_royalty(){let mut c=setup();ctx("owner.near",1,NOW);c.set_royalty(a("treasury.near"),1);ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),terms());});assert!(c.get_sale("k1".into()).is_none());}
#[test] fn buy_sale_refuses_underpayment_by_one_yocto(){let mut c=setup();open(&mut c);settle(&mut c,true);let v=cert(&c);let sig=signed(&v);ctx("buyer.near",terms().price.0-1,NOW);rejects(||{let _=c.buy_sale("k1".into(),U64(1),v,sig);});assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,a("alice.near"));}
#[test] fn buy_sale_succeeds_at_exact_deadline(){let mut c=setup();let d=NOW+600_000_000_000;assert_eq!(terms().deadline_ns.0,d);open(&mut c);settle(&mut c,true);let v=c.sale_certificate_template("k1".into(),U64(d-10_000_000_000),U64(d+20_000_000_000));let sig=signed(&v);ctx("buyer.near",terms().price.0,d);let _=c.buy_sale("k1".into(),U64(1),v,sig);assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,a("buyer.near"));}
#[test] fn buy_sale_refuses_wrong_nonce(){let mut c=setup();open(&mut c);settle(&mut c,true);let v=cert(&c);let sig=signed(&v);ctx("buyer.near",terms().price.0,NOW);rejects(||{let _=c.buy_sale("k1".into(),U64(2),v,sig);});assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,a("alice.near"));}
#[test] fn buy_sale_refuses_when_sales_disabled_after_open(){let mut c=setup();open(&mut c);settle(&mut c,true);ctx("owner.near",1,NOW);c.set_protected_sales_enabled(false);let v=cert(&c);let sig=signed(&v);ctx("buyer.near",terms().price.0,NOW);rejects(||{let _=c.buy_sale("k1".into(),U64(1),v,sig);});assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,a("alice.near"));}
#[test] fn cancel_sale_refuses_after_settled(){let mut c=setup();open(&mut c);settle(&mut c,true);buy(&mut c);assert!(c.get_sale("k1".into()).unwrap().sold);ctx("alice.near",1,NOW);rejects(||{let _=c.cancel_sale("k1".into(),U64(1));});assert_eq!(c.nft_token("k1".into()).unwrap().owner_id,a("buyer.near"));}
#[test] fn on_sale_policy_action_refuses_non_contract(){let mut c=setup();open(&mut c);ctx("evil.near",0,NOW);rejects(||{let _=c.on_sale_policy_action("k1".into(),U64(1),U64(1));});}
#[test] fn on_sale_policy_view_refuses_non_contract(){let mut c=setup();open(&mut c);ctx("evil.near",0,NOW);rejects(||{let _=c.on_sale_policy_view("k1".into(),U64(1),U64(1));});}
#[test] fn open_sale_refuses_second_sale_on_same_token(){let mut c=setup();open(&mut c);ctx("alice.near",SALE_STORAGE_BOND,NOW);rejects(||{let _=c.open_sale("k1".into(),terms());});assert_eq!(c.get_sale("k1".into()).unwrap().nonce.0,1);}
#[test] fn set_protected_sales_enabled_refuses_non_owner(){let mut c=setup();assert!(c.protected_sales_enabled());ctx("evil.near",1,NOW);rejects(||c.set_protected_sales_enabled(false));assert!(c.protected_sales_enabled());}
#[test] fn set_protected_sales_enabled_disables_and_reenables(){let mut c=setup();ctx("owner.near",1,NOW);c.set_protected_sales_enabled(false);assert!(!c.protected_sales_enabled());ctx("owner.near",1,NOW);c.set_protected_sales_enabled(true);assert!(c.protected_sales_enabled());}
