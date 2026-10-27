//! KEYHOLE keys: one NFT contract. Each token is a viewing key for a
//! confidential trading account; `tier` sets what the holder may see/copy.
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::collections::{LazyOption, LookupMap};
use near_sdk::json_types::U128;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, PanicOnDefault, PromiseOrValue,
};
use std::collections::HashMap;

pub const MAX_TIER: u8 = 3;
pub const MAX_ROYALTY_BPS: u32 = 1_000; // 10% cap
pub const MAX_BEAT_BATCH: usize = 50;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Owners,
    TokenMeta,
    Enumeration,
    ContractMeta,
    Tiers,
}

#[near(serializers = [json])]
pub struct Payout {
    pub payout: HashMap<AccountId, U128>,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub minter: AccountId,
    pub treasury: AccountId,
    pub royalty_bps: u32,
    pub beats: near_sdk::json_types::U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    tiers: LookupMap<TokenId, u8>,
    owner: AccountId,
    /// Account whose key is held only inside the OutLayer TEE.
    minter: AccountId,
    treasury: AccountId,
    royalty_bps: u32,
    beats: u64,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, minter: AccountId, treasury: AccountId, royalty_bps: u32) -> Self {
        require!(env::predecessor_account_id() == env::current_account_id(), "init is private");
        require!(royalty_bps <= MAX_ROYALTY_BPS, "royalty too high");
        let meta = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "KEYHOLE".to_string(),
            symbol: "KEY".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        };
        Self {
            tokens: NonFungibleToken::new(
                Key::Owners,
                owner.clone(),
                Some(Key::TokenMeta),
                Some(Key::Enumeration),
                None::<Key>,
            ),
            metadata: LazyOption::new(Key::ContractMeta, Some(&meta)),
            tiers: LookupMap::new(Key::Tiers),
            owner,
            minter,
            treasury,
            royalty_bps,
            beats: 0,
        }
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only owner");
    }
    fn assert_minter(&self) {
        require!(env::predecessor_account_id() == self.minter, "only minter");
    }

    /// Minter only. Attached deposit must cover storage; the excess is refunded.
    #[payable]
    pub fn nft_mint(
        &mut self,
        token_id: TokenId,
        receiver_id: AccountId,
        tier: u8,
        metadata: TokenMetadata,
    ) -> Token {
        self.assert_minter();
        require!(tier >= 1 && tier <= MAX_TIER, "bad tier");
        require!(token_id.len() <= 64, "token_id too long");
        // tier entry (~40 B) is charged to the contract; minter-only, bounded.
        self.tiers.insert(&token_id, &tier);
        // internal_mint measures storage, panics if deposit is short, refunds excess,
        // and emits the NEP-171 nft_mint event.
        self.tokens.internal_mint(token_id, receiver_id, Some(metadata))
    }

    /// Minter only. Signals that the key's public card changed (new attested range).
    pub fn beat(&mut self, token_ids: Vec<TokenId>) -> u64 {
        self.assert_minter();
        require!(!token_ids.is_empty() && token_ids.len() <= MAX_BEAT_BATCH, "bad batch");
        for t in token_ids.iter() {
            require!(self.tokens.owner_by_id.get(t).is_some(), "unknown token");
        }
        self.beats += 1;
        let ids = near_sdk::serde_json::to_string(&token_ids).unwrap();
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nep171\",\"version\":\"1.2.0\",\"event\":\"nft_metadata_update\",\"data\":[{{\"token_ids\":{}}}]}}",
            ids
        ));
        self.beats
    }

    #[payable]
    pub fn set_minter(&mut self, minter: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        self.minter = minter;
    }

    #[payable]
    pub fn set_royalty(&mut self, treasury: AccountId, royalty_bps: u32) {
        assert_one_yocto();
        self.assert_owner();
        require!(royalty_bps <= MAX_ROYALTY_BPS, "royalty too high");
        self.treasury = treasury;
        self.royalty_bps = royalty_bps;
    }

    pub fn nft_tier(&self, token_id: TokenId) -> Option<u8> {
        self.tiers.get(&token_id)
    }

    /// Used by the TEE gate: does `account_id` hold any key, and the best tier.
    pub fn holder_tier(&self, account_id: AccountId) -> Option<u8> {
        let ids = self.tokens.tokens_per_owner.as_ref()?.get(&account_id)?;
        ids.iter().filter_map(|t| self.tiers.get(&t)).max()
    }

    pub fn config(&self) -> Config {
        Config { owner: self.owner.clone(), minter: self.minter.clone(), treasury: self.treasury.clone(), royalty_bps: self.royalty_bps, beats: self.beats.into() }
    }

    // NEP-199 (hand-written)
    pub fn nft_payout(&self, token_id: TokenId, balance: U128, max_len_payout: Option<u32>) -> Payout {
        let owner = self.tokens.owner_by_id.get(&token_id).expect("unknown token");
        let mut payout = HashMap::new();
        let royalty = balance.0 * self.royalty_bps as u128 / 10_000;
        if royalty > 0 && self.treasury != owner {
            require!(max_len_payout.unwrap_or(2) >= 2, "max_len_payout too small");
            payout.insert(self.treasury.clone(), U128(royalty));
            payout.insert(owner, U128(balance.0 - royalty));
        } else {
            require!(max_len_payout.unwrap_or(1) >= 1, "max_len_payout too small");
            payout.insert(owner, balance);
        }
        Payout { payout }
    }

    #[payable]
    pub fn nft_transfer_payout(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        assert_one_yocto();
        let payout = self.nft_payout(token_id.clone(), balance, max_len_payout);
        let sender = env::predecessor_account_id();
        let (prev_owner, _) = self.tokens.internal_transfer(&sender, &receiver_id, &token_id, approval_id, memo.clone());
        near_contract_standards::non_fungible_token::events::NftTransfer {
            old_owner_id: &prev_owner,
            new_owner_id: &receiver_id,
            token_ids: &[&token_id],
            authorized_id: if sender != prev_owner { Some(&sender) } else { None },
            memo: memo.as_deref(),
        }
        .emit();
        payout
    }
}

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        self.tokens.nft_transfer(receiver_id, token_id, approval_id, memo)
    }
    #[payable]
    fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        self.tokens.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }
    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl near_contract_standards::non_fungible_token::core::NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(&mut self, previous_owner_id: AccountId, receiver_id: AccountId, token_id: TokenId, approved_account_ids: Option<HashMap<AccountId, u64>>) -> bool {
        self.tokens.nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 { self.tokens.nft_total_supply() }
    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> { self.tokens.nft_tokens(from_index, limit) }
    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 { self.tokens.nft_supply_for_owner(account_id) }
    fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> { self.tokens.nft_tokens_for_owner(account_id, from_index, limit) }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata { self.metadata.get().unwrap() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::{testing_env, NearToken};

    fn acc(s: &str) -> AccountId { s.parse().unwrap() }
    fn ctx(pred: &str, dep: NearToken) {
        testing_env!(VMContextBuilder::new().current_account_id(acc("keys.near")).predecessor_account_id(acc(pred)).attached_deposit(dep).build());
    }
    fn meta() -> TokenMetadata {
        TokenMetadata { title: Some("Key #1".into()), description: None, media: None, media_hash: None, copies: Some(1), issued_at: None, expires_at: None, starts_at: None, updated_at: None, extra: None, reference: None, reference_hash: None }
    }
    fn setup() -> Contract {
        ctx("keys.near", NearToken::from_yoctonear(0));
        Contract::new(acc("owner.near"), acc("minter.near"), acc("treasury.near"), 500)
    }
    fn mint(c: &mut Contract, id: &str, to: &str, tier: u8) {
        ctx("minter.near", NearToken::from_millinear(100));
        c.nft_mint(id.into(), acc(to), tier, meta());
    }

    #[test]
    #[should_panic(expected = "init is private")]
    fn init_is_private() {
        ctx("attacker.near", NearToken::from_yoctonear(0));
        Contract::new(acc("attacker.near"), acc("attacker.near"), acc("attacker.near"), 0);
    }
    #[test]
    fn mint_and_views() {
        let mut c = setup();
        mint(&mut c, "1", "alice.near", 2);
        assert_eq!(c.nft_token("1".into()).unwrap().owner_id, acc("alice.near"));
        assert_eq!(c.nft_tier("1".into()), Some(2));
        assert_eq!(c.holder_tier(acc("alice.near")), Some(2));
        assert_eq!(c.holder_tier(acc("bob.near")), None);
        assert_eq!(c.nft_total_supply(), U128(1));
        assert!(get_logs().iter().any(|l| l.contains("nft_mint")));
    }
    #[test]
    #[should_panic(expected = "only minter")]
    fn non_minter_cannot_mint() {
        let mut c = setup();
        ctx("alice.near", NearToken::from_millinear(100));
        c.nft_mint("1".into(), acc("alice.near"), 1, meta());
    }
    #[test]
    #[should_panic(expected = "bad tier")]
    fn bad_tier() { let mut c = setup(); mint(&mut c, "1", "a.near", 4); }
    #[test]
    #[should_panic]
    fn mint_needs_storage_deposit() {
        let mut c = setup();
        ctx("minter.near", NearToken::from_yoctonear(0));
        c.nft_mint("1".into(), acc("a.near"), 1, meta());
    }
    #[test]
    fn beat_emits_metadata_update() {
        let mut c = setup();
        mint(&mut c, "1", "a.near", 1);
        ctx("minter.near", NearToken::from_yoctonear(0));
        assert_eq!(c.beat(vec!["1".into()]), 1);
        assert!(get_logs().iter().any(|l| l.contains("\"nft_metadata_update\"") && l.contains("\"1\"")));
    }
    #[test]
    #[should_panic(expected = "only minter")]
    fn beat_only_minter() { let mut c = setup(); mint(&mut c, "1", "a.near", 1); ctx("a.near", NearToken::from_yoctonear(0)); c.beat(vec!["1".into()]); }
    #[test]
    #[should_panic(expected = "unknown token")]
    fn beat_unknown() { let mut c = setup(); ctx("minter.near", NearToken::from_yoctonear(0)); c.beat(vec!["9".into()]); }
    #[test]
    fn payout_split() {
        let mut c = setup();
        mint(&mut c, "1", "a.near", 1);
        let p = c.nft_payout("1".into(), U128(10_000), Some(10)).payout;
        assert_eq!(p[&acc("treasury.near")], U128(500));
        assert_eq!(p[&acc("a.near")], U128(9_500));
    }
    #[test]
    #[should_panic(expected = "max_len_payout too small")]
    fn payout_len() { let mut c = setup(); mint(&mut c, "1", "a.near", 1); c.nft_payout("1".into(), U128(100), Some(1)); }
    #[test]
    fn transfer_payout_moves_token() {
        let mut c = setup();
        mint(&mut c, "1", "a.near", 3);
        ctx("a.near", NearToken::from_yoctonear(1));
        c.nft_transfer_payout(acc("b.near"), "1".into(), None, None, U128(1000), Some(2));
        assert_eq!(c.nft_token("1".into()).unwrap().owner_id, acc("b.near"));
        assert_eq!(c.holder_tier(acc("b.near")), Some(3));
        assert_eq!(c.holder_tier(acc("a.near")), None);
    }
    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn transfer_payout_needs_yocto() { let mut c = setup(); mint(&mut c, "1", "a.near", 1); ctx("a.near", NearToken::from_yoctonear(0)); c.nft_transfer_payout(acc("b.near"), "1".into(), None, None, U128(1), Some(2)); }
    #[test]
    #[should_panic(expected = "only owner")]
    fn set_minter_only_owner() { let mut c = setup(); ctx("minter.near", NearToken::from_yoctonear(1)); c.set_minter(acc("x.near")); }
    #[test]
    fn set_minter_owner() { let mut c = setup(); ctx("owner.near", NearToken::from_yoctonear(1)); c.set_minter(acc("tee.near")); assert_eq!(c.config().minter, acc("tee.near")); }
    #[test]
    #[should_panic(expected = "royalty too high")]
    fn royalty_cap() { let mut c = setup(); ctx("owner.near", NearToken::from_yoctonear(1)); c.set_royalty(acc("t.near"), 1001); }
}
