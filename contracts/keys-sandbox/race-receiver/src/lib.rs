use near_sdk::{env, near, AccountId, Gas, NearToken, Promise, PromiseOrValue};

#[near(contract_state)]
#[derive(Default)]
pub struct Receiver {}

#[near(serializers = [json])]
pub struct Msg { pub keys: AccountId, #[serde(default)] pub other_token: String, pub attack_method: Option<String>, pub attack_args: Option<near_sdk::serde_json::Value>, pub attack_deposit: Option<String> }

#[near]
impl Receiver {
    /// NEP-171 receiver. msg = {"keys": <nft contract>, "other_token": <token this account is approved for>}.
    pub fn nft_on_transfer(&mut self, sender_id: AccountId, previous_owner_id: AccountId, token_id: String, msg: String) -> PromiseOrValue<bool> {
        let _ = (sender_id, token_id);
        let m: Msg = near_sdk::serde_json::from_str(&msg).unwrap();
        if let Some(method) = m.attack_method {
            let args = m.attack_args.unwrap_or_default().to_string().into_bytes();
            let deposit = m.attack_deposit.unwrap_or_else(|| "1".into()).parse::<u128>().unwrap();
            return PromiseOrValue::Promise(Promise::new(m.keys).function_call(method, args, NearToken::from_yoctonear(deposit), Gas::from_tgas(185))
                .then(Promise::new(env::current_account_id()).function_call("after".into(), vec![], NearToken::from_yoctonear(0), Gas::from_tgas(10))));
        }
        let args = near_sdk::serde_json::json!({"receiver_id": previous_owner_id, "token_id": m.other_token}).to_string().into_bytes();
        PromiseOrValue::Promise(
            Promise::new(m.keys)
                .function_call("nft_transfer".into(), args, NearToken::from_yoctonear(1), Gas::from_tgas(20))
                .then(Promise::new(env::current_account_id()).function_call("after".into(), vec![], NearToken::from_yoctonear(0), Gas::from_tgas(5))),
        )
    }
    /// Always asks for the key to be returned, whatever the inner transfer did.
    #[private]
    pub fn after(&mut self) -> bool {
        let success = matches!(env::promise_result(0), near_sdk::PromiseResult::Successful(_));
        env::storage_write(b"attack_success", &[u8::from(success)]); true
    }
    pub fn attack_succeeded(&self) -> bool { env::storage_read(b"attack_success").as_deref() == Some(&[1]) }

    // TEST MOCK ONLY: models documented policy controller/freeze metadata and receipt failures.
    // Does NOT implement encryption, keystore signatures, delegates or live provider enforcement.
    #[payable]
    pub fn store_wallet_policy(&mut self, wallet_pubkey: String, encrypted_data: String, wallet_signature: String,
        version: u64, locked: bool, valid_until: u64, storage_refund_to: Option<AccountId>,registration_nonce:near_sdk::json_types::U64) {
        let _ = storage_refund_to;
        assert!(env::attached_deposit().as_yoctonear() >= 10_000_000_000_000_000_000_000, "mock provider insufficient deposit");
        assert!(!wallet_signature.starts_with("00"), "mock provider rejects invalid artifact");
        assert!(valid_until >= env::block_timestamp()/1_000_000_000, "mock provider expired artifact");
        assert!(env::storage_read(wallet_pubkey.as_bytes()).is_none());
        let p = near_sdk::serde_json::json!({"owner":env::predecessor_account_id(),"encrypted_data":encrypted_data,"version":version,"locked":locked,"frozen":false,"generation_supported":true,"generation":0,"registration_nonce":registration_nonce,"registration_deposit":env::attached_deposit().as_yoctonear().to_string()});
        env::storage_write(wallet_pubkey.as_bytes(), p.to_string().as_bytes());
    }
    pub fn get_wallet_policy(&self, wallet_pubkey: String) -> Option<near_sdk::serde_json::Value> {
        env::storage_read(wallet_pubkey.as_bytes()).map(|v|near_sdk::serde_json::from_slice(&v).unwrap())
    }
    // TEST-ONLY fenced provider. Real OutLayer support MUST be separately implemented/audited.
    pub fn set_wallet_frozen(&mut self,wallet_pubkey:String,generation:near_sdk::json_types::U64,frozen:bool){
        assert!(!(!frozen&&env::storage_has_key(b"refuse_thaw")),"mock provider refuses thaw");
        let mut p=self.get_wallet_policy(wallet_pubkey.clone()).unwrap();
        assert_eq!(p["owner"].as_str().unwrap(),env::predecessor_account_id().as_str(),"only controller");
        let old=p["generation"].as_u64().unwrap();assert!(generation.0>=old,"stale policy generation");
        if generation.0==old{assert_eq!(p["frozen"],frozen,"generation conflict");return;}
        p["generation"]=near_sdk::serde_json::json!(generation.0);p["frozen"]=near_sdk::serde_json::json!(frozen);
        env::storage_write(wallet_pubkey.as_bytes(),p.to_string().as_bytes());
    }
    // TEST-ONLY model of the documented single-command ABI, without provider generations.
    pub fn freeze_wallet(&mut self,wallet_pubkey:String){self.legacy_frozen(wallet_pubkey,true);}
    pub fn unfreeze_wallet(&mut self,wallet_pubkey:String){self.legacy_frozen(wallet_pubkey,false);}
    fn legacy_frozen(&mut self,wallet_pubkey:String,frozen:bool){
        assert!(!(!frozen&&env::storage_has_key(b"refuse_thaw")),"mock provider refuses thaw");
        let mut p=self.get_wallet_policy(wallet_pubkey.clone()).unwrap();
        assert_eq!(p["owner"].as_str().unwrap(),env::predecessor_account_id().as_str(),"only controller");
        assert_ne!(p["frozen"].as_bool().unwrap(),frozen,"already in requested state");
        p["frozen"]=near_sdk::serde_json::json!(frozen);env::storage_write(wallet_pubkey.as_bytes(),p.to_string().as_bytes());
    }
    /// Sandbox-only adversary: delete its own account one receipt before the contract's pull payout arrives.
    pub fn claim_then_delete(&mut self, keys: AccountId, beneficiary: AccountId) {
        let _ = Promise::new(keys).function_call("claim_payout".into(), b"{}".to_vec(), NearToken::from_yoctonear(1), Gas::from_tgas(60));
        let _ = Promise::new(env::current_account_id()).delete_account(beneficiary);
    }
    pub fn mock_refuse_thaw(&mut self, refuse: bool) {
        if refuse { env::storage_write(b"refuse_thaw",&[1]); } else { env::storage_remove(b"refuse_thaw"); }
    }
}
