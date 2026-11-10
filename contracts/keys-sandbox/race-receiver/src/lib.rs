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
        let result=env::promise_result(0);
        if let near_sdk::PromiseResult::Successful(bytes)=&result {env::storage_write(b"attack_result",bytes);}
        let success = matches!(result, near_sdk::PromiseResult::Successful(_));
        env::storage_write(b"attack_success", &[u8::from(success)]); true
    }
    pub fn attack_result(&self)->Option<near_sdk::serde_json::Value>{env::storage_read(b"attack_result").and_then(|b|near_sdk::serde_json::from_slice(&b).ok())}
    pub fn attack_succeeded(&self) -> bool { env::storage_read(b"attack_success").as_deref() == Some(&[1]) }

    // TEST MOCK ONLY: models documented policy controller/freeze metadata and receipt failures.
    // Does NOT implement encryption, keystore signatures, delegates or live provider enforcement.
    #[payable]
    pub fn store_wallet_policy(&mut self, wallet_pubkey: String, encrypted_data: String, wallet_signature: String,
        version: u64, locked: bool, valid_until: u64, storage_refund_to: Option<AccountId>) {
        let _ = storage_refund_to;
        assert!(env::attached_deposit().as_yoctonear() >= 10_000_000_000_000_000_000_000, "mock provider insufficient deposit");
        assert!(!wallet_signature.starts_with("00"), "mock provider rejects invalid artifact");
        assert!(valid_until >= env::block_timestamp()/1_000_000_000, "mock provider expired artifact");
        assert!(env::storage_read(wallet_pubkey.as_bytes()).is_none());
        let p = near_sdk::serde_json::json!({"owner":env::predecessor_account_id(),"encrypted_data":encrypted_data,"version":version,"locked":locked,"frozen":false});
        env::storage_write(wallet_pubkey.as_bytes(), p.to_string().as_bytes());
    }
    pub fn get_wallet_policy(&self, wallet_pubkey: String) -> Option<near_sdk::serde_json::Value> {
        assert!(!env::storage_has_key(b"fail_policy_reads"), "mock policy read unavailable");
        self.read_wallet_policy(wallet_pubkey)
    }
    fn read_wallet_policy(&self, wallet_pubkey: String) -> Option<near_sdk::serde_json::Value> {
        env::storage_read(wallet_pubkey.as_bytes()).map(|v|near_sdk::serde_json::from_slice(&v).unwrap())
    }
    // TEST MOCK ONLY: actual public ABI, with no generation/idempotency argument.
    pub fn freeze_wallet(&mut self, wallet_pubkey: String) { self.mock_set_frozen(wallet_pubkey, true); }
    pub fn unfreeze_wallet(&mut self, wallet_pubkey: String) { self.mock_set_frozen(wallet_pubkey, false); }
    fn mock_set_frozen(&mut self, wallet_pubkey: String, frozen: bool) {
        assert!(!(!frozen && env::storage_has_key(b"refuse_thaw")), "mock provider refuses thaw");
        let mut p=self.read_wallet_policy(wallet_pubkey.clone()).unwrap();
        assert_eq!(p["owner"].as_str().unwrap(),env::predecessor_account_id().as_str(),"only controller");
        assert_ne!(p["frozen"],frozen,"wallet already in requested state");
        p["frozen"]=near_sdk::serde_json::json!(frozen);
        env::storage_write(wallet_pubkey.as_bytes(),p.to_string().as_bytes());
    }
    /// Sandbox-only adversary: delete its own account one receipt before the contract's pull payout arrives.
    pub fn claim_then_delete(&mut self, keys: AccountId, beneficiary: AccountId) {
        let _ = Promise::new(keys).function_call("claim_payout".into(), b"{}".to_vec(), NearToken::from_yoctonear(1), Gas::from_tgas(60));
        let _ = Promise::new(env::current_account_id()).delete_account(beneficiary);
    }
    pub fn mock_fail_policy_reads(&mut self, fail: bool) {
        if fail { env::storage_write(b"fail_policy_reads",&[1]); } else { env::storage_remove(b"fail_policy_reads"); }
    }
    pub fn mock_refuse_thaw(&mut self, refuse: bool) {
        if refuse { env::storage_write(b"refuse_thaw",&[1]); } else { env::storage_remove(b"refuse_thaw"); }
    }
}
