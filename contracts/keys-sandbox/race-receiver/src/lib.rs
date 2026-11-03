use near_sdk::{env, near, AccountId, Gas, NearToken, Promise, PromiseOrValue};

#[near(contract_state)]
#[derive(Default)]
pub struct Receiver {}

#[near(serializers = [json])]
pub struct Msg { pub keys: AccountId, pub other_token: String }

#[near]
impl Receiver {
    /// NEP-171 receiver. msg = {"keys": <nft contract>, "other_token": <token this account is approved for>}.
    pub fn nft_on_transfer(&mut self, sender_id: AccountId, previous_owner_id: AccountId, token_id: String, msg: String) -> PromiseOrValue<bool> {
        let _ = (sender_id, token_id);
        let m: Msg = near_sdk::serde_json::from_str(&msg).unwrap();
        let args = near_sdk::serde_json::json!({"receiver_id": previous_owner_id, "token_id": m.other_token}).to_string().into_bytes();
        PromiseOrValue::Promise(
            Promise::new(m.keys)
                .function_call("nft_transfer".into(), args, NearToken::from_yoctonear(1), Gas::from_tgas(20))
                .then(Promise::new(env::current_account_id()).function_call("after".into(), vec![], NearToken::from_yoctonear(0), Gas::from_tgas(5))),
        )
    }
    /// Always asks for the key to be returned, whatever the inner transfer did.
    #[private]
    pub fn after(&mut self) -> bool { true }
}
