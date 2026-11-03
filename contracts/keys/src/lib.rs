//! KEYHOLE keys: one NFT contract. Each token is a viewing key for a
//! confidential trading account; `tier` sets what the holder may see/copy.
//! v2: NEP-178 approvals, one key per account enforced on-chain, NEP-330 source metadata.
use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::collections::{LazyOption, LookupMap};
use near_sdk::json_types::U128;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, PanicOnDefault, Promise, PromiseOrValue,
};
use std::collections::HashMap;

pub const MAX_TIER: u8 = 3;
pub const MAX_ROYALTY_BPS: u32 = 1_000; // 10% cap
pub const MAX_BEAT_BATCH: usize = 50;
pub const ERR_ONE_KEY: &str = "one key per account: receiver already holds a KEYHOLE key";

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Owners,
    TokenMeta,
    Enumeration,
    ContractMeta,
    Tiers,
    // v2 (appended, so every v1 prefix is unchanged)
    Approvals,
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

#[near(contract_state, contract_metadata(
    standard(standard = "nep171", version = "1.2.0"),
    standard(standard = "nep177", version = "2.0.0"),
    standard(standard = "nep178", version = "1.0.0"),
    standard(standard = "nep181", version = "1.0.0"),
    standard(standard = "nep199", version = "2.1.0"),
    standard(standard = "nep330", version = "1.2.0"),
))]
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
                Some(Key::Approvals),
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

    /// v1 -> v2. The stored layout is unchanged; v1 kept the two approval maps as `None`,
    /// v2 turns them on under the appended `Key::Approvals` prefix (same keys `new` uses).
    /// Self-call only, runs once (a second call panics), touches no token, owner, tier or metadata.
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        // explicit: #[private] is not applied to #[init] methods by near-sdk
        require!(env::predecessor_account_id() == env::current_account_id(), "migrate is private");
        let mut c: Contract = env::state_read().unwrap_or_else(|| env::panic_str("no state"));
        require!(c.tokens.approvals_by_id.is_none(), "already migrated");
        // Same prefixes NonFungibleToken::new derives (prefix, prefix + "n"). Built directly, NOT via
        // NonFungibleToken::new: that would run its storage probe against the live owner map.
        let prefix: Vec<u8> = near_sdk::IntoStorageKey::into_storage_key(Key::Approvals);
        c.tokens.approvals_by_id = Some(LookupMap::new(prefix.clone()));
        c.tokens.next_approval_id_by_id = Some(LookupMap::new([prefix, b"n".to_vec()].concat()));
        c
    }

    /// Rule: an account holds at most one key. Applies to every way a key can arrive
    /// (mint, nft_transfer, nft_transfer_call, nft_transfer_payout).
    fn assert_no_key(&self, account_id: &AccountId) {
        let n = self.tokens.tokens_per_owner.as_ref().and_then(|m| m.get(account_id)).map(|s| s.len()).unwrap_or(0);
        require!(n == 0, ERR_ONE_KEY);
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
        require!(!token_id.is_empty(), "empty token_id");
        require!(token_id.len() <= 64, "token_id too long");
        self.assert_no_key(&receiver_id);
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
        self.assert_no_key(&receiver_id);
        let payout = self.nft_payout(token_id.clone(), balance, max_len_payout);
        let sender = env::predecessor_account_id();
        // Same checks as near-contract-standards' internal_transfer, but with ONE nft_transfer event
        // that names the approved account (the library's own event omits authorized_id).
        let prev_owner = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(|| env::panic_str("Token not found"));
        let approved = self.tokens.approvals_by_id.as_mut().map(|m| m.remove(&token_id).unwrap_or_default()).unwrap_or_default();
        let authorized = if sender != prev_owner {
            let id = approved.get(&sender).unwrap_or_else(|| env::panic_str("Sender not approved"));
            require!(approval_id.is_none() || approval_id == Some(*id), "approval_id mismatch");
            Some(&sender)
        } else { None };
        require!(prev_owner != receiver_id, "Current and next owner must differ");
        self.tokens.internal_transfer_unguarded(&token_id, &prev_owner, &receiver_id);
        near_contract_standards::non_fungible_token::events::NftTransfer {
            old_owner_id: &prev_owner,
            new_owner_id: &receiver_id,
            token_ids: &[&token_id],
            authorized_id: authorized.map(|v| &**v),
            memo: memo.as_deref(),
        }
        .emit();
        // NEP-178: approvals are cleared by the transfer; their storage goes back to the previous owner.
        if !approved.is_empty() {
            near_contract_standards::non_fungible_token::refund_approved_account_ids(prev_owner.clone(), &approved);
        }
        payout
    }
}

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        self.assert_no_key(&receiver_id);
        self.tokens.nft_transfer(receiver_id, token_id, approval_id, memo)
    }
    #[payable]
    fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        self.assert_no_key(&receiver_id);
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

// NEP-178 approval management (near-contract-standards implementation).
#[near]
impl NonFungibleTokenApproval for Contract {
    #[payable]
    fn nft_approve(&mut self, token_id: TokenId, account_id: AccountId, msg: Option<String>) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }
    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id)
    }
    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id)
    }
    fn nft_is_approved(&self, token_id: TokenId, approved_account_id: AccountId, approval_id: Option<u64>) -> bool {
        self.tokens.nft_is_approved(token_id, approved_account_id, approval_id)
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

    // ---- NEP-171 / 177 / 181 / 199 compliance and edge cases ----
    fn logs() -> Vec<String> { near_sdk::test_utils::get_logs() }

    #[test]
    fn nep177_contract_metadata() {
        let c = setup(); let m = c.nft_metadata();
        assert_eq!(m.spec, NFT_METADATA_SPEC); assert_eq!(m.name, "KEYHOLE"); assert_eq!(m.symbol, "KEY");
    }
    #[test]
    fn nep177_token_metadata_kept() {
        let mut c = setup(); mint(&mut c, "k1", "a.near", 2);
        let t = c.nft_token("k1".into()).unwrap();
        assert_eq!(t.metadata.unwrap().title.as_deref(), Some("Key #1"));
    }
    #[test]
    fn nep171_mint_event() {
        let mut c = setup(); mint(&mut c, "k1", "a.near", 1);
        let l = logs(); assert!(l.iter().any(|x| x.contains("\"standard\":\"nep171\"") && x.contains("\"event\":\"nft_mint\"") && x.contains("a.near")));
    }
    #[test]
    fn nep171_transfer_event_and_owner() {
        let mut c = setup(); mint(&mut c, "k1", "a.near", 1);
        ctx("a.near", NearToken::from_yoctonear(1)); c.nft_transfer(acc("b.near"), "k1".into(), None, Some("gift".into()));
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("b.near"));
        assert!(logs().iter().any(|x| x.contains("\"event\":\"nft_transfer\"") && x.contains("\"old_owner_id\":\"a.near\"") && x.contains("\"new_owner_id\":\"b.near\"") && x.contains("gift")));
    }
    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn nep171_transfer_needs_one_yocto() { let mut c = setup(); mint(&mut c, "k1", "a.near", 1); ctx("a.near", NearToken::from_yoctonear(0)); c.nft_transfer(acc("b.near"), "k1".into(), None, None); }
    #[test]
    #[should_panic]
    fn nep171_only_owner_transfers() { let mut c = setup(); mint(&mut c, "k1", "a.near", 1); ctx("x.near", NearToken::from_yoctonear(1)); c.nft_transfer(acc("x.near"), "k1".into(), None, None); }
    #[test]
    #[should_panic]
    fn nep171_no_self_transfer() { let mut c = setup(); mint(&mut c, "k1", "a.near", 1); ctx("a.near", NearToken::from_yoctonear(1)); c.nft_transfer(acc("a.near"), "k1".into(), None, None); }
    #[test]
    #[should_panic]
    fn nep171_duplicate_token_id() { let mut c = setup(); mint(&mut c, "k1", "a.near", 1); mint(&mut c, "k1", "b.near", 1); }
    #[test]
    fn nep171_unknown_token_is_none() { let c = setup(); assert!(c.nft_token("nope".into()).is_none()); }
    #[test]
    #[should_panic(expected = "token_id too long")]
    fn token_id_length_cap() { let mut c = setup(); mint(&mut c, &"k".repeat(65), "a.near", 1); }
    #[test]
    #[should_panic(expected = "bad tier")]
    fn tier_zero_rejected() { let mut c = setup(); mint(&mut c, "k1", "a.near", 0); }
    #[test]
    fn nep181_enumeration() {
        let mut c = setup();
        mint(&mut c, "k1", "a.near", 1); mint(&mut c, "k2", "c.near", 3); mint(&mut c, "k3", "b.near", 2);
        assert_eq!(c.nft_total_supply().0, 3);
        assert_eq!(c.nft_supply_for_owner(acc("a.near")).0, 1);
        assert_eq!(c.nft_tokens(None, Some(2)).len(), 2);
        assert_eq!(c.nft_tokens(Some(U128(2)), None).len(), 1);
        let ids: Vec<String> = c.nft_tokens_for_owner(acc("a.near"), None, None).into_iter().map(|t| t.token_id).collect();
        assert_eq!(ids, vec!["k1".to_string()]);
        assert_eq!(c.nft_supply_for_owner(acc("nobody.near")).0, 0);
    }
    #[test]
    fn holder_tier_is_best_and_follows_transfer() {
        let mut c = setup();
        mint(&mut c, "k1", "c.near", 1); mint(&mut c, "k2", "a.near", 3);
        assert_eq!(c.holder_tier(acc("a.near")), Some(3));
        ctx("a.near", NearToken::from_yoctonear(1)); c.nft_transfer(acc("b.near"), "k2".into(), None, None);
        assert_eq!(c.holder_tier(acc("a.near")), None);
        assert_eq!(c.holder_tier(acc("c.near")), Some(1));
        assert_eq!(c.holder_tier(acc("b.near")), Some(3));
        assert_eq!(c.holder_tier(acc("nobody.near")), None);
        assert_eq!(c.nft_tier("k2".into()), Some(3));
    }
    #[test]
    fn nep199_payout_conserves_balance() {
        let mut c = setup(); mint(&mut c, "k1", "a.near", 1);
        for bal in [0u128, 1, 19, 20, 21, 9_999, 10_000, 1_000_000_000_000_000_000_000_000, u128::MAX / 10_000] {
            let p = c.nft_payout("k1".into(), U128(bal), Some(10));
            let sum: u128 = p.payout.values().map(|v| v.0).sum();
            assert_eq!(sum, bal, "payout must add up to the balance");
            assert!(p.payout.len() <= 2);
        }
    }
    #[test]
    fn nep199_royalty_rounds_down_for_the_treasury() {
        let mut c = setup(); mint(&mut c, "k1", "a.near", 1);
        let p = c.nft_payout("k1".into(), U128(39), Some(2)); // 5% of 39 = 1.95 -> 1
        assert_eq!(p.payout.get(&acc("treasury.near")).unwrap().0, 1);
        assert_eq!(p.payout.get(&acc("a.near")).unwrap().0, 38);
    }
    #[test]
    fn nep199_treasury_as_owner_gets_all() {
        let mut c = setup(); mint(&mut c, "k1", "treasury.near", 1);
        let p = c.nft_payout("k1".into(), U128(1000), Some(1));
        assert_eq!(p.payout.len(), 1); assert_eq!(p.payout.get(&acc("treasury.near")).unwrap().0, 1000);
    }
    #[test]
    fn nep199_zero_royalty_single_payee() {
        let mut c = setup(); ctx("owner.near", NearToken::from_yoctonear(1)); c.set_royalty(acc("treasury.near"), 0);
        mint(&mut c, "k1", "a.near", 1);
        let p = c.nft_payout("k1".into(), U128(1000), Some(1));
        assert_eq!(p.payout.len(), 1);
    }
    #[test]
    fn nep199_max_royalty_ten_percent() {
        let mut c = setup(); ctx("owner.near", NearToken::from_yoctonear(1)); c.set_royalty(acc("t2.near"), MAX_ROYALTY_BPS);
        mint(&mut c, "k1", "a.near", 1);
        let p = c.nft_payout("k1".into(), U128(1000), None);
        assert_eq!(p.payout.get(&acc("t2.near")).unwrap().0, 100);
    }
    #[test]
    #[should_panic(expected = "unknown token")]
    fn nep199_unknown_token() { let c = setup(); c.nft_payout("nope".into(), U128(1), None); }
    #[test]
    fn nep199_transfer_payout_emits_event_and_splits() {
        let mut c = setup(); mint(&mut c, "k1", "a.near", 1);
        ctx("a.near", NearToken::from_yoctonear(1));
        let p = c.nft_transfer_payout(acc("b.near"), "k1".into(), None, Some("sale".into()), U128(10_000), Some(2));
        assert_eq!(p.payout.get(&acc("treasury.near")).unwrap().0, 500);
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("b.near"));
        assert!(logs().iter().any(|x| x.contains("nft_transfer") && x.contains("sale")));
    }
    #[test]
    #[should_panic(expected = "only owner")]
    fn set_royalty_only_owner() { let mut c = setup(); ctx("a.near", NearToken::from_yoctonear(1)); c.set_royalty(acc("a.near"), 10); }
    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn set_minter_needs_yocto() { let mut c = setup(); ctx("owner.near", NearToken::from_yoctonear(0)); c.set_minter(acc("x.near")); }
    #[test]
    fn old_minter_loses_power() {
        let mut c = setup(); ctx("owner.near", NearToken::from_yoctonear(1)); c.set_minter(acc("tee.near"));
        ctx("tee.near", NearToken::from_millinear(100)); c.nft_mint("k1".into(), acc("a.near"), 1, meta());
        assert_eq!(c.nft_total_supply().0, 1);
    }
    #[test]
    #[should_panic(expected = "only minter")]
    fn old_minter_cannot_mint() { let mut c = setup(); ctx("owner.near", NearToken::from_yoctonear(1)); c.set_minter(acc("tee.near")); mint(&mut c, "k1", "a.near", 1); }
    #[test]
    #[should_panic(expected = "bad batch")]
    fn beat_batch_limit() {
        let mut c = setup(); ctx("minter.near", NearToken::from_yoctonear(0));
        c.beat((0..=MAX_BEAT_BATCH).map(|i| i.to_string()).collect());
    }
    #[test]
    #[should_panic(expected = "bad batch")]
    fn beat_empty() { let mut c = setup(); ctx("minter.near", NearToken::from_yoctonear(0)); c.beat(vec![]); }
    #[test]
    fn beat_counter_increments() {
        let mut c = setup(); mint(&mut c, "k1", "a.near", 1); ctx("minter.near", NearToken::from_yoctonear(0));
        assert_eq!(c.beat(vec!["k1".into()]), 1); assert_eq!(c.beat(vec!["k1".into()]), 2); assert_eq!(c.config().beats.0, 2);
    }
    #[test]
    #[should_panic(expected = "royalty too high")]
    fn init_royalty_cap() { ctx("keys.near", NearToken::from_yoctonear(0)); Contract::new(acc("o.near"), acc("m.near"), acc("t.near"), MAX_ROYALTY_BPS + 1); }

    // NEP-181 pagination table: (from_index, limit) -> ids, over 5 tokens k1..k5.
    #[test]
    fn nep181_pagination_table() {
        let mut c = setup();
        for i in 1..=5 { mint(&mut c, &format!("k{i}"), &format!("o{i}.near"), 1); }
        let ids = |v: Vec<Token>| v.into_iter().map(|t| t.token_id).collect::<Vec<_>>().join(",");
        for (from, lim, want) in [(None, None, "k1,k2,k3,k4,k5"), (Some(0), Some(1), "k1"), (Some(4), None, "k5"), (Some(1), Some(3), "k2,k3,k4"), (Some(3), Some(50), "k4,k5")] {
            assert_eq!(ids(c.nft_tokens(from.map(U128), lim)), want, "from={from:?} limit={lim:?}");
        }
        for i in 1..=5 {
            assert_eq!(ids(c.nft_tokens_for_owner(acc(&format!("o{i}.near")), None, None)), format!("k{i}"));
            assert_eq!(ids(c.nft_tokens_for_owner(acc(&format!("o{i}.near")), Some(U128(0)), Some(1))), format!("k{i}"));
        }
        assert_eq!(ids(c.nft_tokens_for_owner(acc("nobody.near"), None, None)), "");
    }
    #[test]
    #[should_panic]
    fn nep181_from_index_past_end() { let mut c = setup(); mint(&mut c, "k1", "a.near", 1); c.nft_tokens(Some(U128(5)), None); }
    #[test]
    #[should_panic]
    fn nep181_zero_limit() { let mut c = setup(); mint(&mut c, "k1", "a.near", 1); c.nft_tokens(None, Some(0)); }
    #[test]
    fn nep181_counts_follow_transfers() {
        let mut c = setup();
        mint(&mut c, "k1", "a.near", 1); mint(&mut c, "k2", "c.near", 1);
        ctx("a.near", NearToken::from_yoctonear(1)); c.nft_transfer(acc("b.near"), "k1".into(), None, None);
        assert_eq!((c.nft_supply_for_owner(acc("a.near")).0, c.nft_supply_for_owner(acc("b.near")).0, c.nft_total_supply().0), (0, 1, 2));
        let ids: Vec<String> = c.nft_tokens_for_owner(acc("b.near"), None, None).into_iter().map(|t| t.token_id).collect();
        assert_eq!(ids, vec!["k1".to_string()]);
    }
    // NEP-171 resolve table: the receiver keeps the token unless nft_on_transfer asked to return it (and still owns it).
    #[test]
    fn nep171_resolve_transfer_table() {
        use near_sdk::test_utils::VMContextBuilder as B;
        use near_sdk::PromiseResult;
        use near_contract_standards::non_fungible_token::core::NonFungibleTokenResolver;
        for (id, ret, from, to, want_owner, want_bool) in [("r1", b"false".to_vec(), "a.near", "b.near", "b.near", true), ("r2", b"true".to_vec(), "c.near", "d.near", "c.near", false)] {
            let mut c = setup();
            mint(&mut c, id, from, 1);
            ctx(from, NearToken::from_yoctonear(1)); c.nft_transfer(acc(to), id.into(), None, None);
            testing_env!(B::new().current_account_id(acc("keys.near")).predecessor_account_id(acc("keys.near")).build(),
                near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(ret)]);
            assert_eq!(c.nft_resolve_transfer(acc(from), acc(to), id.into(), None), want_bool);
            assert_eq!(c.nft_token(id.into()).unwrap().owner_id.as_str(), want_owner);
        }
    }
    #[test]
    fn nep177_token_carries_nep178_approvals_field() {
        let mut c = setup(); mint(&mut c, "k1", "a.near", 1);
        let t = c.nft_token("k1".into()).unwrap();
        assert_eq!(t.approved_account_ids, Some(HashMap::new()), "v2: NEP-178 on, no approvals yet");
        assert_eq!(c.nft_metadata().spec, "nft-1.0.0");
    }
}

/// P2 tables: behaviour the audit asked to pin.
#[cfg(test)]
mod p2 {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken};

    fn acc(s: &str) -> AccountId { s.parse().unwrap() }
    fn ctx(pred: &str, dep: NearToken) {
        testing_env!(VMContextBuilder::new().current_account_id(acc("keys.near")).predecessor_account_id(acc(pred)).attached_deposit(dep).build());
    }
    fn meta() -> TokenMetadata {
        TokenMetadata { title: Some("K".into()), description: None, media: None, media_hash: None, copies: Some(1), issued_at: None, expires_at: None, starts_at: None, updated_at: None, extra: None, reference: None, reference_hash: None }
    }
    fn setup() -> Contract { ctx("keys.near", NearToken::from_yoctonear(0)); Contract::new(acc("owner.near"), acc("minter.near"), acc("treasury.near"), 500) }
    fn mint(c: &mut Contract, id: &str, to: &str, tier: u8) { ctx("minter.near", NearToken::from_millinear(100)); c.nft_mint(id.into(), acc(to), tier, meta()); }
    fn xfer(c: &mut Contract, from: &str, to: &str, id: &str, appr: Option<u64>) { ctx(from, NearToken::from_yoctonear(1)); c.nft_transfer(acc(to), id.into(), appr, None); }

    macro_rules! payout_rows { ($($name:ident: $bal:expr => $tre:expr, $own:expr;)*) => { $(#[test] fn $name() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1);
        let p = c.nft_payout("k1".into(), U128($bal), None).payout;
        assert_eq!(p.get(&acc("treasury.near")).map(|v| v.0), $tre);
        assert_eq!(p.get(&acc("alice.near")).map(|v| v.0), Some($own));
        assert_eq!(p.values().map(|v| v.0).sum::<u128>(), $bal, "payout sums to balance");
    })* } }
    payout_rows! {
        payout_zero: 0 => None, 0;
        payout_19_rounds_to_no_royalty: 19 => None, 19;
        payout_20_first_unit: 20 => Some(1), 19;
        payout_100: 100 => Some(5), 95;
        payout_1_near: 1_000_000_000_000_000_000_000_000 => Some(50_000_000_000_000_000_000_000), 950_000_000_000_000_000_000_000;
        payout_odd: 12_345 => Some(617), 11_728;
    }

    #[test] fn plain_transfer_moves_the_key_and_pays_no_royalty() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1);
        xfer(&mut c, "alice.near", "bob.near", "k1", None);
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("bob.near"));
        // NEP-199 royalty only exists in nft_payout/nft_transfer_payout; a plain transfer has no price to split.
    }
    #[test] fn treasury_as_owner_takes_whole_payout() {
        let mut c = setup(); mint(&mut c, "k1", "treasury.near", 1);
        let p = c.nft_payout("k1".into(), U128(1000), None).payout;
        assert_eq!(p.len(), 1); assert_eq!(p[&acc("treasury.near")].0, 1000);
    }
    #[test] #[should_panic(expected = "max_len_payout too small")] fn payout_needs_two_slots_with_royalty() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1); c.nft_payout("k1".into(), U128(1000), Some(1));
    }
    #[test] #[should_panic(expected = "one key per account")] fn second_mint_to_a_holder_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1); mint(&mut c, "k2", "alice.near", 3);
    }
    #[test] fn holder_tier_moves_with_the_key() {
        let mut c = setup(); mint(&mut c, "k2", "alice.near", 3);
        xfer(&mut c, "alice.near", "bob.near", "k2", None);
        assert_eq!(c.holder_tier(acc("alice.near")), None);
        assert_eq!(c.holder_tier(acc("bob.near")), Some(3));
    }
    #[test] fn former_holder_has_no_tier() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 2);
        xfer(&mut c, "alice.near", "bob.near", "k1", None);
        assert_eq!(c.holder_tier(acc("alice.near")), None);
    }
    #[test] fn beat_keeps_token_metadata() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1);
        let before = c.nft_token("k1".into()).unwrap().metadata;
        ctx("minter.near", NearToken::from_yoctonear(0)); c.beat(vec!["k1".into()]);
        assert_eq!(c.nft_token("k1".into()).unwrap().metadata, before);
    }
    #[test] #[should_panic(expected = "empty token_id")] fn empty_token_id_is_refused() {
        let mut c = setup(); mint(&mut c, "", "alice.near", 1);
    }
    #[test] fn owner_transfer_ignores_approval_id() {
        // near-contract-standards only checks approval_id for a non-owner sender; the owner's transfer goes through.
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1); xfer(&mut c, "alice.near", "bob.near", "k1", Some(1));
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("bob.near"));
    }
    #[test] #[should_panic] fn non_owner_cannot_transfer() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1); xfer(&mut c, "mallory.near", "mallory.near", "k1", None);
    }
    #[test] #[should_panic] fn transfer_without_one_yocto_fails() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1);
        ctx("alice.near", NearToken::from_yoctonear(0)); c.nft_transfer(acc("bob.near"), "k1".into(), None, None);
    }
    #[test] #[should_panic] fn transfer_to_self_fails() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1); xfer(&mut c, "alice.near", "alice.near", "k1", None);
    }
    #[test] #[should_panic(expected = "token_id must be unique")] fn duplicate_id_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1); mint(&mut c, "k1", "bob.near", 1);
    }
    #[test] fn enumeration_after_transfers() {
        let mut c = setup();
        for (i, o) in ["a.near", "b.near", "c.near"].iter().enumerate() { mint(&mut c, &format!("k{i}"), o, 1); }
        xfer(&mut c, "a.near", "d.near", "k0", None);
        assert_eq!(c.nft_total_supply(), U128(3));
        assert_eq!(c.nft_supply_for_owner(acc("d.near")), U128(1));
        assert_eq!(c.nft_supply_for_owner(acc("a.near")), U128(0));
        assert_eq!(c.nft_tokens(None, None).len(), 3);
    }
}

/// v2: NEP-178 approvals, one key per account, payout through an approved marketplace, migrate.
#[cfg(test)]
mod v2 {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::{testing_env, NearToken};

    fn acc(s: &str) -> AccountId { s.parse().unwrap() }
    fn ctx(pred: &str, dep: NearToken) {
        testing_env!(VMContextBuilder::new().current_account_id(acc("keys.near")).predecessor_account_id(acc(pred)).attached_deposit(dep).build());
    }
    fn meta() -> TokenMetadata {
        TokenMetadata { title: Some("K".into()), description: None, media: None, media_hash: None, copies: Some(1), issued_at: None, expires_at: None, starts_at: None, updated_at: None, extra: None, reference: None, reference_hash: None }
    }
    fn setup() -> Contract { ctx("keys.near", NearToken::from_yoctonear(0)); Contract::new(acc("owner.near"), acc("minter.near"), acc("treasury.near"), 500) }
    fn mint(c: &mut Contract, id: &str, to: &str) { ctx("minter.near", NearToken::from_millinear(100)); c.nft_mint(id.into(), acc(to), 1, meta()); }
    fn approve(c: &mut Contract, owner: &str, id: &str, who: &str) { ctx(owner, NearToken::from_millinear(10)); c.nft_approve(id.into(), acc(who), None); }
    fn yocto(who: &str) { ctx(who, NearToken::from_yoctonear(1)); }

    // ---- NEP-178 ----
    #[test] fn approve_sets_id_one_and_is_approved() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "market.near");
        assert!(c.nft_is_approved("k1".into(), acc("market.near"), None));
        assert!(c.nft_is_approved("k1".into(), acc("market.near"), Some(1)));
        assert!(!c.nft_is_approved("k1".into(), acc("market.near"), Some(2)));
        assert!(!c.nft_is_approved("k1".into(), acc("other.near"), None));
        assert_eq!(c.nft_token("k1".into()).unwrap().approved_account_ids.unwrap()[&acc("market.near")], 1);
    }
    #[test] fn approval_ids_increase_per_token() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        approve(&mut c, "alice.near", "k1", "m1.near"); approve(&mut c, "alice.near", "k1", "m2.near"); approve(&mut c, "alice.near", "k1", "m1.near");
        let a = c.nft_token("k1".into()).unwrap().approved_account_ids.unwrap();
        assert_eq!((a[&acc("m2.near")], a[&acc("m1.near")]), (2, 3), "re-approve gets a fresh id");
    }
    #[test] #[should_panic(expected = "Predecessor must be token owner.")] fn only_owner_can_approve() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "mallory.near", "k1", "mallory.near");
    }
    #[test] #[should_panic(expected = "Requires attached deposit of at least 1 yoctoNEAR")] fn approve_needs_deposit() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); ctx("alice.near", NearToken::from_yoctonear(0)); c.nft_approve("k1".into(), acc("m.near"), None);
    }
    #[test] #[should_panic(expected = "Must attach")] fn approve_deposit_must_cover_storage() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); ctx("alice.near", NearToken::from_yoctonear(1)); c.nft_approve("k1".into(), acc("m.near"), None);
    }
    #[test] #[should_panic(expected = "Token not found")] fn approve_unknown_token() {
        let mut c = setup(); approve(&mut c, "alice.near", "nope", "m.near");
    }
    #[test] fn approve_with_msg_schedules_nft_on_approve() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("alice.near", NearToken::from_millinear(10));
        assert!(c.nft_approve("k1".into(), acc("market.near"), Some("{\"price\":\"1\"}".into())).is_some(), "msg => nft_on_approve XCC");
        ctx("alice.near", NearToken::from_millinear(10));
        assert!(c.nft_approve("k1".into(), acc("m2.near"), None).is_none(), "no msg => no XCC");
    }
    #[test] fn revoke_removes_one() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        approve(&mut c, "alice.near", "k1", "m1.near"); approve(&mut c, "alice.near", "k1", "m2.near");
        yocto("alice.near"); c.nft_revoke("k1".into(), acc("m1.near"));
        assert!(!c.nft_is_approved("k1".into(), acc("m1.near"), None));
        assert!(c.nft_is_approved("k1".into(), acc("m2.near"), None));
    }
    #[test] fn revoke_all_clears() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        approve(&mut c, "alice.near", "k1", "m1.near"); approve(&mut c, "alice.near", "k1", "m2.near");
        yocto("alice.near"); c.nft_revoke_all("k1".into());
        assert!(c.nft_token("k1".into()).unwrap().approved_account_ids.unwrap().is_empty());
    }
    #[test] #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")] fn revoke_needs_one_yocto() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "m.near");
        ctx("alice.near", NearToken::from_yoctonear(0)); c.nft_revoke("k1".into(), acc("m.near"));
    }
    #[test] #[should_panic(expected = "Predecessor must be token owner.")] fn revoke_only_owner() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "m.near");
        yocto("m.near"); c.nft_revoke("k1".into(), acc("m.near"));
    }
    #[test] #[should_panic(expected = "Predecessor must be token owner.")] fn revoke_all_only_owner() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); yocto("m.near"); c.nft_revoke_all("k1".into());
    }
    #[test] fn approved_account_can_transfer_and_approvals_clear() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "market.near"); approve(&mut c, "alice.near", "k1", "m2.near");
        yocto("market.near"); c.nft_transfer(acc("bob.near"), "k1".into(), Some(1), None);
        let t = c.nft_token("k1".into()).unwrap();
        assert_eq!(t.owner_id, acc("bob.near"));
        assert!(t.approved_account_ids.unwrap().is_empty(), "approvals cleared on transfer");
        assert!(!c.nft_is_approved("k1".into(), acc("m2.near"), None));
        let logs = get_logs(); assert!(logs.iter().any(|l| l.contains("\"nft_transfer\"") && l.contains("bob.near")), "{logs:?}");
    }
    #[test] #[should_panic(expected = "Sender not approved")] fn unapproved_account_cannot_transfer() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "market.near");
        yocto("mallory.near"); c.nft_transfer(acc("mallory.near"), "k1".into(), None, None);
    }
    #[test] #[should_panic(expected = "is different from the given approval_id")] fn stale_approval_id_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "market.near");
        yocto("market.near"); c.nft_transfer(acc("bob.near"), "k1".into(), Some(7), None);
    }
    #[test] #[should_panic(expected = "Sender not approved")] fn revoked_market_cannot_transfer() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "market.near");
        yocto("alice.near"); c.nft_revoke("k1".into(), acc("market.near"));
        yocto("market.near"); c.nft_transfer(acc("bob.near"), "k1".into(), None, None);
    }
    #[test] #[should_panic(expected = "Sender not approved")] fn old_approval_dies_after_resale() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "market.near");
        yocto("alice.near"); c.nft_transfer(acc("bob.near"), "k1".into(), None, None);
        yocto("market.near"); c.nft_transfer(acc("carol.near"), "k1".into(), None, None);
    }
    #[test] fn approved_transfer_call_is_allowed() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "market.near");
        yocto("market.near"); let _ = c.nft_transfer_call(acc("bob.near"), "k1".into(), Some(1), None, "".into());
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("bob.near"));
    }

    // ---- NEP-199 through an approved marketplace ----
    #[test] fn marketplace_transfer_payout_pays_treasury_five_percent() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "market.near");
        yocto("market.near");
        let p = c.nft_transfer_payout(acc("bob.near"), "k1".into(), Some(1), None, U128(10_000_000), Some(10)).payout;
        assert_eq!(p[&acc("treasury.near")].0, 500_000);
        assert_eq!(p[&acc("alice.near")].0, 9_500_000, "seller is the owner before the transfer");
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("bob.near"));
        assert!(c.nft_token("k1".into()).unwrap().approved_account_ids.unwrap().is_empty());
        let ev: Vec<String> = get_logs().into_iter().filter(|l| l.contains("\"nft_transfer\"")).collect();
        assert_eq!(ev.len(), 1, "exactly one nft_transfer event: {ev:?}");
        assert!(ev[0].contains("\"authorized_id\":\"market.near\""), "event names the marketplace");
    }
    #[test] fn migrate_matches_new_prefixes() {
        let fresh = setup();
        let prefix: Vec<u8> = near_sdk::IntoStorageKey::into_storage_key(Key::Approvals);
        // write through the migrate-style maps, read through `new`'s maps: same storage
        let mut m: near_sdk::collections::LookupMap<TokenId, u64> = LookupMap::new([prefix, b"n".to_vec()].concat());
        m.insert(&"x".to_string(), &42);
        assert_eq!(fresh.tokens.next_approval_id_by_id.as_ref().unwrap().get(&"x".to_string()), Some(42));
    }
    #[test] fn owner_transfer_payout_emits_one_event_without_authorized_id() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); yocto("alice.near");
        c.nft_transfer_payout(acc("bob.near"), "k1".into(), None, Some("m".into()), U128(100), None);
        let ev: Vec<String> = get_logs().into_iter().filter(|l| l.contains("\"nft_transfer\"")).collect();
        assert_eq!(ev.len(), 1); assert!(!ev[0].contains("authorized_id")); assert!(ev[0].contains("\"memo\":\"m\""));
    }
    #[test] #[should_panic(expected = "approval_id mismatch")] fn transfer_payout_stale_approval_id() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "market.near");
        yocto("market.near"); c.nft_transfer_payout(acc("bob.near"), "k1".into(), Some(5), None, U128(100), None);
    }
    #[test] #[should_panic(expected = "one key per account")] fn transfer_payout_back_to_the_owner_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "market.near");
        yocto("market.near"); c.nft_transfer_payout(acc("alice.near"), "k1".into(), None, None, U128(100), None);
    }
    #[test] fn approved_market_can_buy_for_itself() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); approve(&mut c, "alice.near", "k1", "market.near");
        yocto("market.near"); c.nft_transfer_payout(acc("market.near"), "k1".into(), Some(1), None, U128(100), None);
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("market.near"));
    }
    #[test] #[should_panic(expected = "unknown token")] fn transfer_payout_unknown_token() {
        let mut c = setup(); yocto("alice.near"); c.nft_transfer_payout(acc("bob.near"), "nope".into(), None, None, U128(100), None);
    }
    #[test] #[should_panic(expected = "Sender not approved")] fn transfer_payout_needs_approval() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        yocto("market.near"); c.nft_transfer_payout(acc("bob.near"), "k1".into(), None, None, U128(100), None);
    }
    #[test] #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")] fn transfer_payout_needs_one_yocto() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); ctx("alice.near", NearToken::from_yoctonear(0));
        c.nft_transfer_payout(acc("bob.near"), "k1".into(), None, None, U128(100), None);
    }
    #[test] #[should_panic(expected = "max_len_payout too small")] fn transfer_payout_respects_max_len() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); yocto("alice.near");
        c.nft_transfer_payout(acc("bob.near"), "k1".into(), None, None, U128(100), Some(1));
    }
    #[test] fn payout_follows_set_royalty() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        yocto("owner.near"); c.set_royalty(acc("t2.near"), 250);
        let p = c.nft_payout("k1".into(), U128(10_000), None).payout;
        assert_eq!((p[&acc("t2.near")].0, p[&acc("alice.near")].0), (250, 9_750));
    }

    // ---- one key per account ----
    #[test] #[should_panic(expected = "one key per account")] fn transfer_to_holder_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); mint(&mut c, "k2", "bob.near");
        yocto("alice.near"); c.nft_transfer(acc("bob.near"), "k1".into(), None, None);
    }
    #[test] #[should_panic(expected = "one key per account")] fn transfer_call_to_holder_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); mint(&mut c, "k2", "bob.near");
        yocto("alice.near"); let _ = c.nft_transfer_call(acc("bob.near"), "k1".into(), None, None, "".into());
    }
    #[test] #[should_panic(expected = "one key per account")] fn transfer_payout_to_holder_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); mint(&mut c, "k2", "bob.near");
        yocto("alice.near"); c.nft_transfer_payout(acc("bob.near"), "k1".into(), None, None, U128(100), None);
    }
    #[test] #[should_panic(expected = "one key per account")] fn approved_market_cannot_deliver_to_holder() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); mint(&mut c, "k2", "bob.near"); approve(&mut c, "alice.near", "k1", "market.near");
        yocto("market.near"); c.nft_transfer(acc("bob.near"), "k1".into(), Some(1), None);
    }
    #[test] fn former_holder_can_receive_again() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        yocto("alice.near"); c.nft_transfer(acc("bob.near"), "k1".into(), None, None);
        yocto("bob.near"); c.nft_transfer(acc("alice.near"), "k1".into(), None, None);
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("alice.near"));
        mint(&mut c, "k2", "bob.near");
        assert_eq!(c.nft_supply_for_owner(acc("bob.near")).0, 1);
    }
    #[test] fn refused_transfer_leaves_state_untouched_in_a_fresh_call() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); mint(&mut c, "k2", "bob.near");
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { yocto("alice.near"); c.nft_transfer(acc("bob.near"), "k1".into(), None, None); }));
        assert!(r.is_err());
    }
    #[test] fn every_holder_has_exactly_one_key_after_many_moves() {
        let mut c = setup();
        for i in 0..6 { mint(&mut c, &format!("k{i}"), &format!("h{i}.near")); }
        for i in 0..6 { yocto(&format!("h{i}.near")); c.nft_transfer(acc(&format!("n{i}.near")), format!("k{i}"), None, None); }
        for i in 0..6 { assert_eq!(c.nft_supply_for_owner(acc(&format!("n{i}.near"))).0, 1); assert_eq!(c.nft_supply_for_owner(acc(&format!("h{i}.near"))).0, 0); }
    }

    // ---- migrate (v1 layout = approvals off) ----
    fn v1_state() -> Contract {
        // exactly what v1 `new` built: approvals off
        ctx("keys.near", NearToken::from_yoctonear(0));
        let mut c = Contract {
            tokens: NonFungibleToken::new(Key::Owners, acc("owner.near"), Some(Key::TokenMeta), Some(Key::Enumeration), None::<Key>),
            metadata: LazyOption::new(Key::ContractMeta, Some(&NFTContractMetadata { spec: NFT_METADATA_SPEC.into(), name: "KEYHOLE".into(), symbol: "KEY".into(), icon: None, base_uri: None, reference: None, reference_hash: None })),
            tiers: LookupMap::new(Key::Tiers),
            owner: acc("owner.near"), minter: acc("minter.near"), treasury: acc("treasury.near"), royalty_bps: 500, beats: 0,
        };
        for (i, o) in ["a.near", "b.near", "c.near", "d.near", "e.near"].iter().enumerate() {
            ctx("minter.near", NearToken::from_millinear(100));
            c.tiers.insert(&format!("k{i}"), &1);
            c.tokens.internal_mint(format!("k{i}"), acc(o), Some(meta()));
        }
        c.beats = 2;
        c
    }
    #[test] fn migrate_turns_on_approvals_and_keeps_everything() {
        let c = v1_state();
        let before: Vec<Token> = c.nft_tokens(None, None);
        let cfg = near_sdk::serde_json::to_string(&c.config()).unwrap();
        assert!(before.iter().all(|t| t.approved_account_ids.is_none()));
        env::state_write(&c);
        ctx("keys.near", NearToken::from_yoctonear(0));
        let mut m = Contract::migrate();
        let after = m.nft_tokens(None, None);
        assert_eq!(after.len(), 5);
        for (b, a) in before.iter().zip(after.iter()) {
            assert_eq!((&b.token_id, &b.owner_id, &b.metadata), (&a.token_id, &a.owner_id, &a.metadata));
            assert_eq!(a.approved_account_ids, Some(HashMap::new()));
            assert_eq!(m.nft_tier(a.token_id.clone()), Some(1));
        }
        assert_eq!(near_sdk::serde_json::to_string(&m.config()).unwrap(), cfg);
        assert_eq!(m.nft_metadata().symbol, "KEY");
        approve(&mut m, "a.near", "k0", "market.near");
        assert!(m.nft_is_approved("k0".into(), acc("market.near"), Some(1)));
    }
    #[test] #[should_panic(expected = "already migrated")] fn migrate_twice_fails() {
        let c = setup(); env::state_write(&c); ctx("keys.near", NearToken::from_yoctonear(0)); Contract::migrate();
    }
    #[test] #[should_panic(expected = "migrate is private")] fn migrate_is_self_only() {
        let c = v1_state(); env::state_write(&c); ctx("owner.near", NearToken::from_yoctonear(0)); Contract::migrate();
    }
    #[test] #[should_panic(expected = "no state")] fn migrate_without_state_fails() {
        ctx("keys.near", NearToken::from_yoctonear(0)); Contract::migrate();
    }
    #[test] fn new_uses_same_approval_prefix_as_migrate() {
        let c = setup(); assert!(c.tokens.approvals_by_id.is_some() && c.tokens.next_approval_id_by_id.is_some());
    }
}
