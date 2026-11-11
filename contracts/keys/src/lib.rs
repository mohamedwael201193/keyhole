//! KEYHOLE keys: one NFT contract. Each token is a viewing key for a
//! confidential trading account; `tier` sets what the holder may see/copy.
//! v2: NEP-178 approvals, one key per account enforced on-chain, NEP-330 source metadata.
//! v2.3: at most MAX_APPROVALS approvals per token (NEP-178 gas bound); no state change.
//! v2.4: nft_set_tier (minter only, upward only): a holder can earn a higher tier. No state change.
//! v2.4: built-in key sale. nft_list / nft_unlist / nft_buy sell a key from the contract itself. Listings live under
//! their own storage prefixes (not a field of Contract), so the v2.3 layout is unchanged and no migrate is needed.
//! v2.5: owner epoch, replay-safe admission, token transfer-call lock and sealed bilateral loans.
//! Existing Contract Borsh layout is unchanged; migrate_pledge initializes isolated loan/recovery metadata.
//! Epochs complement the barrier; they do not recall committed external txs (see SECURITY).
//! v2.7: code-only upgrade. Callbacks do not panic on state paths; G1 reclaim of unclaimed principal; tier loan caps;
//! loan/payout/governance events; owner handover (two-step), 24 h timelocked upgrade and a fixed wind-down date.
//! New storage lives only under raw "Q27" keys and "Q27d"/"Q27o" maps. The Contract struct and every stored Borsh layout are unchanged.
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
// Internal JSON objects have only statically named scalar fields. Serialize those
// directly instead of constructing the general-purpose serde_json::Value tree.
// Field sorting preserves the exact bytes emitted by serde_json's BTreeMap-backed
// json! objects; Serde still performs all string escaping and scalar encoding.
fn encode_json_object(fields: &mut [(&str, String)]) -> String {
    fields.sort_unstable_by(|a, b| a.0.cmp(b.0));
    let mut out = String::from("{");
    for (i, (key, value)) in fields.iter().enumerate() {
        if i > 0 { out.push(','); }
        out.push('"'); out.push_str(key); out.push_str("\":"); out.push_str(value);
    }
    out.push('}');
    out
}
macro_rules! json_object {
    ({ $($key:literal : $value:expr),* $(,)? }) => {{
        encode_json_object(&mut [$(($key, near_sdk::serde_json::to_string(&$value).unwrap())),*])
    }};
}

#[allow(clippy::too_many_arguments)] mod pledge; // Flat provider ABI plus required owner/epoch CAS fields.
mod sale;
mod v27;
pub use sale::{Sale, SaleTerms, SaleCertificate, SaleState};
pub use pledge::*;

pub const MAX_TIER: u8 = 3;
pub const MAX_ROYALTY_BPS: u32 = 1_000; // 10% cap
pub const MAX_BEAT_BATCH: usize = 50;
/// NEP-178: approvals one token may hold at once. Bounds nft_revoke_all, the transfer refunds and the
/// marketplace fan-out. Re-approving an account already on the list does not count as a new approval.
pub const MAX_APPROVALS: usize = 10;
pub const ERR_ONE_KEY: &str = "one key per account: receiver already holds a KEYHOLE key";
/// v2.4 key sale. Prices in yoctoNEAR: 0.1 NEAR minimum, 100 000 NEAR cap (keeps price * bps far from u128 overflow).
pub const MIN_LIST_PRICE: u128 = 10u128.pow(23); // 0.1 NEAR
pub const MAX_LIST_PRICE: u128 = 100_000 * 10u128.pow(24); // 100 000 NEAR
/// Held by the contract while a key is listed, returned to the seller when the listing ends. 0.01 NEAR covers the
/// listing's own storage (about 0.005 NEAR even for 64-character ids and account names).
pub const LIST_STORAGE_DEPOSIT: u128 = 10u128.pow(22); // 0.01 NEAR
/// nft_listings page size cap.
pub const MAX_LISTINGS_PAGE: u64 = 100;
const KEYHOLE_EVENT_STANDARD: &str = "keyhole";
const KEYHOLE_EVENT_VERSION: &str = "1.0.0";

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

/// v2.4 key listing. Stored in `listings()` (its own prefix), never as a field of Contract, so the stored layout is unchanged.
#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct Listing {
    pub seller: AccountId,
    pub price: U128,
    /// Storage deposit the contract holds for this listing. Returned to the seller when the listing ends.
    pub deposit: U128,
}

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [json])]
pub struct ListingView {
    pub token_id: TokenId,
    pub seller: AccountId,
    pub price: U128,
}

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [json])]
pub struct ControlState {
    pub token_id: TokenId,
    pub owner_epoch: near_sdk::json_types::U64,
    pub pending_value_ops: near_sdk::json_types::U64,
    pub listed: bool,
    pub transfer_pending: bool,
    pub pledged: bool,
    pub value_op_nonce: near_sdk::json_types::U64,
}

/// Listings by token id: raw keys are b"L" + borsh(token_id). The prefix byte 'L' (0x4C) differs from the Key enum
/// variant bytes (0..=5), from the NEP-178 approval keys (5 + "n"), from the "pending/" markers ('p') and from the
/// index prefix b"M".
fn listings() -> LookupMap<TokenId, Listing> {
    LookupMap::new(b"L")
}

/// Index of listed token ids for nft_listings, kept by hand. A collection's length lives in memory and is only persisted
/// through the struct that owns it, so a collection built on demand (UnorderedSet::new) would always see length 0.
/// Here: the count is a raw key, slots (position -> token id) and positions (token id -> position) are LookupMaps.
/// Removal swaps the last slot into the freed one. Prefixes "Mc", "Ms", "Mq" do not collide with "L" or the others.
const INDEX_COUNT: &[u8] = b"Mc";

fn index_count() -> u64 {
    env::storage_read(INDEX_COUNT).map(|v| u64::from_le_bytes(v.try_into().unwrap_or([0; 8]))).unwrap_or(0)
}

fn index_slots() -> LookupMap<u64, TokenId> {
    LookupMap::new(&b"Ms"[..])
}

fn index_pos() -> LookupMap<TokenId, u64> {
    LookupMap::new(&b"Mq"[..])
}

fn index_add(token_id: &TokenId) {
    let n = index_count();
    index_slots().insert(&n, token_id);
    index_pos().insert(token_id, &n);
    env::storage_write(INDEX_COUNT, &(n + 1).to_le_bytes());
}

fn index_remove(token_id: &TokenId) {
    let Some(p) = index_pos().get(token_id) else { return };
    let last = index_count() - 1;
    if p != last {
        let moved = index_slots().get(&last).unwrap_or_else(|| env::panic_str("inconsistent listing index"));
        index_slots().insert(&p, &moved);
        index_pos().insert(&moved, &p);
    }
    index_slots().remove(&last);
    index_pos().remove(token_id);
    env::storage_write(INDEX_COUNT, &last.to_le_bytes());
}

/// v2.5 owner / settlement epoch per token. Prefix 'E'. Missing = 0.
fn owner_epochs() -> LookupMap<TokenId, u64> {
    LookupMap::new(b"E")
}
fn bump_owner_epoch(token_id: &TokenId) -> u64 {
    let next = owner_epochs().get(token_id).unwrap_or(0).checked_add(1).unwrap_or_else(||env::panic_str("owner epoch overflow"));
    owner_epochs().insert(token_id, &next);
    next
}

/// Admitted value-op before any external custody dispatch. Prefixes 'Vc' (count) and 'Vo' (op records).
/// Ownership changes refuse while count > 0. Epoch alone cannot recall a committed Intents/OutLayer tx.
#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct ValueOp {
    pub epoch: near_sdk::json_types::U64,
    pub action_hash: String,
    /// 0/1 pending; 2 reconciled success; 3 reconciled failure.
    pub state: u8,
    pub nonce: near_sdk::json_types::U64,
    pub op_id: String,
}

fn value_op_counts() -> LookupMap<TokenId, u64> {
    LookupMap::new(&b"Vc"[..])
}
fn value_op_key(token_id: &TokenId, _op_id: &str) -> String {
    // Bounded last operation and monotonic high-water nonce per token.
    token_id.clone()
}
fn value_ops() -> LookupMap<String, ValueOp> {
    LookupMap::new(&b"Vo"[..])
}

fn yocto(v: u128) -> near_sdk::NearToken {
    near_sdk::NearToken::from_yoctonear(v)
}

/// NEP-297 event (standard "keyhole", version "1.0.0"); data holds one object.
fn emit_key_event(event: &str, data: String) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"{KEYHOLE_EVENT_STANDARD}\",\"version\":\"{KEYHOLE_EVENT_VERSION}\",\"event\":\"{event}\",\"data\":[{data}]}}"
    ));
}

#[near(contract_state, contract_metadata(
    version = "2.7.0",
    link = "https://github.com/mohamedwael201193/keyhole",
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

/// Raw storage marker (no change to the stored struct, so no migration): how many
/// nft_transfer_call returns are still pending for an account.
const PENDING_PREFIX: &[u8] = b"pending/";
fn pending_key(a: &AccountId) -> Vec<u8> { [PENDING_PREFIX, a.as_bytes()].concat() }
pub fn pending_returns(a: &AccountId) -> u32 {
    env::storage_read(&pending_key(a)).map(|v| u32::from_le_bytes(v.try_into().unwrap_or([0; 4]))).unwrap_or(0)
}
fn set_pending(a: &AccountId, n: u32) {
    if n == 0 { env::storage_remove(&pending_key(a)); } else { env::storage_write(&pending_key(a), &n.to_le_bytes()); }
}

/// Exact floor(balance*bps/10000), including u128::MAX without intermediate overflow.
fn royalty_amount(balance:u128,bps:u32)->u128 {
    (balance/10_000)*(bps as u128) + ((balance%10_000)*(bps as u128))/10_000
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
        // A key sent with nft_transfer_call may still come back to its sender until
        // nft_resolve_transfer runs, so the sender counts as a holder until then.
        require!(pending_returns(account_id) == 0, ERR_ONE_KEY);
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.current_owner(), "only owner");
    }
    fn assert_minter(&self) {
        require!(env::predecessor_account_id() == self.minter, "only minter");
    }

    /// NEP-178 cap (v2.3). Runs before the library touches state or schedules nft_on_approve.
    /// A non-owner is left to the library's own "Predecessor must be token owner." panic.
    /// Re-approving an account already on the list replaces its entry, so it stays allowed at the cap.
    fn assert_approval_cap(&self, token_id: &TokenId, account_id: &AccountId) {
        if self.tokens.owner_by_id.get(token_id).as_ref() != Some(&env::predecessor_account_id()) {
            return;
        }
        let approved = self.tokens.approvals_by_id.as_ref().and_then(|m| m.get(token_id)).unwrap_or_default();
        if approved.len() >= MAX_APPROVALS && !approved.contains_key(account_id) {
            env::panic_str(&format!("approval cap reached: a token holds at most {MAX_APPROVALS} approvals"));
        }
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
        v27::assert_not_wound_down();
        require!((1..=MAX_TIER).contains(&tier), "bad tier");
        require!(!token_id.is_empty(), "empty token_id");
        require!(token_id.len() <= 64, "token_id too long");
        self.assert_no_key(&receiver_id);
        require_payout_account(&env::predecessor_account_id());
        // Charge mint storage (including tier) before reserving the minter excess credit.
        let before = env::storage_usage();
        self.tiers.insert(&token_id, &tier);
        let token = self.tokens.internal_mint_with_refund(token_id, receiver_id, Some(metadata), None);
        refund_storage_credit(env::storage_usage().saturating_sub(before));
        near_contract_standards::non_fungible_token::events::NftMint {
            owner_id: &token.owner_id, token_ids: &[&token.token_id], memo: None,
        }.emit();
        token
    }

    /// Minter only. Signals that the key's public card changed (new attested range).
    /// No 1-yocto requirement (v2.7): the beat key on the minter is FunctionCall and cannot attach a deposit.
    /// The minter account also has a full-access enclave key, used for payable mint, collateral and admission.
    pub fn beat(&mut self, token_ids: Vec<TokenId>) -> u64 {
        self.assert_minter();
        require!(!token_ids.is_empty() && token_ids.len() <= MAX_BEAT_BATCH, "bad batch");
        for t in token_ids.iter() {
            require!(self.tokens.owner_by_id.get(t).is_some(), "unknown token");
        }
        self.beats += 1;
        let ids = near_sdk::serde_json::to_string(&token_ids).unwrap_or_else(|_|env::panic_str("event encoding"));
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nep171\",\"version\":\"1.2.0\",\"event\":\"nft_metadata_update\",\"data\":[{{\"token_ids\":{}}}]}}",
            ids
        ));
        self.beats
    }

    /// Minter only. Raises a key's tier (earned tiers): 1..=MAX_TIER, strictly above the current tier, never lowered.
    /// Takes no deposit: the tiers entry already exists, so storage does not grow. Emits NEP-171 1.2.0
    /// `nft_metadata_update` for the token (same event as `beat`). The tier is read from the holder's key,
    /// so holder_tier and the TEE gate see the new tier at once, and it survives nft_transfer.
    /// v2.7 note: no 1-yocto requirement, so a FunctionCall key can call this. The live beat key is FunctionCall
    /// and deposit-free. The minter account also has a full-access enclave key for payable nft_mint,
    /// register_collateral and begin_value_op. Deposit 0 keeps nft_set_tier callable from a scoped key.
    pub fn nft_set_tier(&mut self, token_id: TokenId, tier: u8) {
        self.assert_minter();
        require!(self.tokens.owner_by_id.get(&token_id).is_some(), "no token");
        require!((1..=MAX_TIER).contains(&tier), "bad tier");
        let current = self.tiers.get(&token_id).unwrap_or(0);
        require!(tier > current, "tier only goes up");
        self.tiers.insert(&token_id, &tier);
        let ids = near_sdk::serde_json::to_string(&[&token_id]).unwrap_or_else(|_|env::panic_str("event encoding"));
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"nep171\",\"version\":\"1.2.0\",\"event\":\"nft_metadata_update\",\"data\":[{{\"token_ids\":{}}}]}}",
            ids
        ));
    }

    /// Removes a listing from both maps and returns it. The caller decides where its deposit goes.
    fn take_listing(&mut self, token_id: &TokenId) -> Option<Listing> {
        let listing = listings().get(token_id)?;
        listings().remove(token_id);
        index_remove(token_id);
        Some(listing)
    }

    /// Refuse ownership changes while a value-op is admitted/dispatched for this token (admission barrier).
    fn assert_can_change_owner(&self, token_id: &TokenId) {
        self.assert_token_idle(token_id);
        let n = value_op_counts().get(token_id).unwrap_or(0);
        require!(n == 0, "value-op pending: finish or reconcile before transfer or sale");
    }

    fn pending_ops(&self, token_id: &TokenId) -> u64 {
        value_op_counts().get(token_id).unwrap_or(0)
    }

    /// Ends a token's listing, if any: the deposit goes back to the seller. Every path that moves a key calls this
    /// (transfer_key, nft_transfer, nft_transfer_call, nft_resolve_transfer), so a listing never outlives its owner.
    fn end_listing(&mut self, token_id: &TokenId) {
        if let Some(listing) = self.take_listing(token_id) {
            record_native_credit(&listing.seller, listing.deposit.0);
            emit_key_event("key_unlist", json_object!({"token_id": token_id, "seller": listing.seller}));
        }
    }

    /// After the library's nft_resolve_transfer, a listing whose seller no longer owns the key is stale: the key went
    /// back to the sender of nft_transfer_call while the receiver had listed it. End that listing.
    fn clear_stale_listing(&mut self, token_id: &TokenId) {
        if let Some(listing) = listings().get(token_id) {
            if self.tokens.owner_by_id.get(token_id).as_ref() != Some(&listing.seller) {
                self.end_listing(token_id);
            }
        }
    }

    /// The one place a key changes hands except the library's nft_transfer / nft_transfer_call / nft_resolve_transfer
    /// (their callers end the listing first). Ends the listing, clears approvals (their storage goes back to the
    /// previous owner), moves the key and emits ONE nft_transfer event. Records approval-storage credit; schedules no native payout.
    fn transfer_key(&mut self, token_id: &TokenId, receiver_id: &AccountId, authorized: Option<&AccountId>, memo: Option<&str>) -> AccountId {
        self.assert_can_change_owner(token_id);
        self.transfer_key_unlocked(token_id, receiver_id, authorized, memo)
    }

    fn transfer_key_unlocked(&mut self, token_id: &TokenId, receiver_id: &AccountId, authorized: Option<&AccountId>, memo: Option<&str>) -> AccountId {
        self.end_listing(token_id);
        let prev_owner = self.tokens.owner_by_id.get(token_id).unwrap_or_else(|| env::panic_str("Token not found"));
        require!(prev_owner != *receiver_id, "Current and next owner must differ");
        let approved = self.tokens.approvals_by_id.as_mut().map(|m| m.remove(token_id).unwrap_or_default()).unwrap_or_default();
        self.tokens.internal_transfer_unguarded(token_id, &prev_owner, receiver_id);
        near_contract_standards::non_fungible_token::events::NftTransfer {
            old_owner_id: &prev_owner,
            new_owner_id: receiver_id,
            token_ids: &[token_id.as_str()],
            authorized_id: authorized.map(|v| &**v),
            memo,
        }
        .emit();
        if !approved.is_empty() {
            refund_approval_credit(&prev_owner, &approved);
        }
        bump_owner_epoch(token_id);
        prev_owner
    }

    /// v2.4 key sale. The owner lists a key at a price. The contract holds LIST_STORAGE_DEPOSIT until the listing
    /// ends. A listing's price can be changed by its seller with exactly 1 yoctoNEAR (the deposit stays).
    #[payable]
    pub fn nft_list(&mut self, token_id: TokenId, price: U128) {
        v27::assert_not_wound_down();
        let caller = env::predecessor_account_id();
        let owner = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(|| env::panic_str("unknown token"));
        require!(owner == caller, "only the owner can list");
        require_payout_account(&caller);
        self.assert_token_idle(&token_id);
        require!(self.pending_ops(&token_id) == 0, "value-op pending: finish before listing");
        require!(price.0 >= MIN_LIST_PRICE, "price below the 0.1 NEAR minimum");
        require!(price.0 <= MAX_LIST_PRICE, "price above the 100000 NEAR cap");
        match listings().get(&token_id) {
            Some(mut listing) => {
                require!(listing.seller == caller, "only the seller can change a listing");
                assert_one_yocto();
                listing.price = price;
                listings().insert(&token_id, &listing);
            }
            None => {
                let attached = env::attached_deposit().as_yoctonear();
                require!(attached >= LIST_STORAGE_DEPOSIT, "attach at least 0.01 NEAR for listing storage");
                // State first; reserve excess as pull credit, not a fire-and-forget refund.
                let listing = Listing { seller: caller.clone(), price, deposit: U128(LIST_STORAGE_DEPOSIT) };
                listings().insert(&token_id, &listing);
                index_add(&token_id);
                if attached > LIST_STORAGE_DEPOSIT {
                    record_native_credit(&caller, attached - LIST_STORAGE_DEPOSIT);
                }
            }
        }
        emit_key_event("key_list", json_object!({"token_id": token_id, "seller": caller, "price": price}));
    }

    /// The seller, or the current owner, ends a listing. The deposit goes back to the seller. Requires 1 yoctoNEAR.
    #[payable]
    pub fn nft_unlist(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        let listing = listings().get(&token_id).unwrap_or_else(|| env::panic_str("no listing"));
        let owner = self.tokens.owner_by_id.get(&token_id);
        require!(caller == listing.seller || owner.as_ref() == Some(&caller), "only the seller or the owner can unlist");
        self.end_listing(&token_id);
    }

    /// Buys a listed key. The attached deposit must cover the price (the excess is refunded). The key moves through
    /// transfer_key with memo "sale". The royalty goes to the treasury. The seller gets price - royalty plus the
    /// listing deposit. If the listing is stale (the key no longer belongs to the seller), the listing is removed,
    /// its deposit goes back to the seller, the buyer's attachment is refunded, a "key_listing_stale" event is logged,
    /// and the call returns without panicking (so the stale listing is cleaned up in the same transaction).
    #[payable]
    pub fn nft_buy(&mut self, token_id: TokenId) {
        self.assert_can_change_owner(&token_id);
        let buyer = env::predecessor_account_id();
        let attached = env::attached_deposit().as_yoctonear();
        let listing = listings().get(&token_id).unwrap_or_else(|| env::panic_str("no listing"));
        let owner = self.tokens.owner_by_id.get(&token_id);
        if owner.as_ref() != Some(&listing.seller) {
            require_payout_account(&listing.seller);
            if attached > 0 { require_payout_account(&buyer); }
            self.take_listing(&token_id);
            record_native_credit(&listing.seller, listing.deposit.0);
            if attached > 0 {
                record_native_credit(&buyer, attached);
            }
            emit_key_event(
                "key_listing_stale",
                json_object!({"token_id": token_id, "seller": listing.seller, "owner": owner}),
            );
            return;
        }
        let seller = listing.seller.clone();
        let price = listing.price.0;
        require!(buyer != seller, "the seller cannot buy its own key");
        require!(attached >= price, "attached deposit is below the listing price");
        self.assert_no_key(&buyer);
        require_payout_account(&seller);
        if attached > price { require_payout_account(&buyer); }
        if self.royalty_bps > 0 && self.treasury != env::current_account_id() { require_payout_account(&self.treasury); }
        // State first: the listing is gone, then the key moves. Payout credits are recorded atomically in this receipt.
        self.take_listing(&token_id);
        self.transfer_key(&token_id, &buyer, None, Some("sale"));
        let royalty = royalty_amount(price, self.royalty_bps);
        emit_key_event(
            "key_sale",
            json_object!({"token_id": token_id, "seller": seller, "buyer": buyer, "price": U128(price), "royalty": U128(royalty)}),
        );
        if attached > price {
            record_native_credit(&buyer, attached - price);
        }
        if royalty > 0 && !record_sale_royalty(&self.treasury, royalty) {
            record_native_credit(&self.treasury, royalty);
        }
        record_native_credit(&seller, price - royalty + listing.deposit.0);
    }

    /// The listing of a token, if it is listed.
    pub fn nft_listing(&self, token_id: TokenId) -> Option<ListingView> {
        listings().get(&token_id).map(|l| ListingView { token_id:token_id.clone(), seller: l.seller, price: l.price })
            .or_else(||sale::sales().get(&token_id).map(|s|ListingView{token_id,seller:s.seller,price:s.terms.price}))
    }

    /// Listed keys in index order, paged like NEP-181. limit defaults to MAX_LISTINGS_PAGE and is capped at it.
    pub fn nft_listings(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<ListingView> {
        let from = from_index.map(|v| usize::try_from(v.0).unwrap_or(usize::MAX)).unwrap_or(0);
        let limit = limit.unwrap_or(MAX_LISTINGS_PAGE);
        require!(limit > 0, "limit must be positive");
        let take = limit.min(MAX_LISTINGS_PAGE) as usize;
        let end = (from as u64).saturating_add(take as u64).min(index_count());
        (from as u64..end)
            .filter_map(|i| index_slots().get(&i))
            .filter_map(|t| self.nft_listing(t))
            .collect()
    }

    /// Owner / settlement epoch of a key. Starts at 0; every ownership change bumps it by one.
    pub fn nft_settlement_epoch(&self, token_id: TokenId) -> near_sdk::json_types::U64 {
        near_sdk::json_types::U64(owner_epochs().get(&token_id).unwrap_or(0))
    }

    /// Control plane for handover safety: epoch, pending value-ops, listing flag.
    pub fn get_control_state(&self, token_id: TokenId) -> ControlState {
        require!(self.tokens.owner_by_id.get(&token_id).is_some(), "unknown token");
        ControlState {
            token_id: token_id.clone(),
            owner_epoch: near_sdk::json_types::U64(owner_epochs().get(&token_id).unwrap_or(0)),
            pending_value_ops: near_sdk::json_types::U64(self.pending_ops(&token_id)),
            listed: listings().get(&token_id).is_some() || sale::sales().get(&token_id).is_some(),
            transfer_pending: transfer_calls().get(&token_id).is_some() || pledge::registration_busy(&token_id),
            pledged: loans().get(&token_id).is_some(),
            value_op_nonce: near_sdk::json_types::U64(value_ops().get(&token_id).map(|op| op.nonce.0).unwrap_or(0)),
        }
    }

    pub fn pending_value_op_count(&self, token_id: TokenId) -> near_sdk::json_types::U64 {
        near_sdk::json_types::U64(self.pending_ops(&token_id))
    }

    /// Admit a value-op before external custody dispatch. Minter (TEE settler) only for v1.
    /// Refuses if listed, epoch mismatch, or op_id already present. Does not move funds.
    /// There is no payout receiver argument: owner_id must equal the live NFT owner.
    /// A pending admission blocks ownership changes until terminal reconciliation.
    #[payable]
    pub fn begin_value_op(&mut self, token_id: TokenId, epoch: near_sdk::json_types::U64, op_id: String, action_hash: String, owner_id: AccountId) {
        self.assert_minter();
        require_payout_account(&env::predecessor_account_id());
        require!(!op_id.is_empty() && op_id.len() <= 85, "bad op_id");
        require!(!action_hash.is_empty() && action_hash.len() <= 128, "bad action_hash");
        require!(self.tokens.owner_by_id.get(&token_id).is_some(), "unknown token");
        self.assert_token_idle(&token_id);
        require!(listings().get(&token_id).is_none(), "listed: unlist before value-ops");
        require!(self.pending_ops(&token_id) == 0, "another value-op is pending");
        let current = owner_epochs().get(&token_id).unwrap_or(0);
        require!(current == epoch.0, "epoch mismatch");
        require!(self.tokens.owner_by_id.get(&token_id).as_ref() == Some(&owner_id), "admission owner mismatch");
        let key = value_op_key(&token_id, &op_id);
        let next = value_ops().get(&key).map(|op| op.nonce.0).unwrap_or(0).checked_add(1).unwrap_or_else(||env::panic_str("operation nonce overflow"));
        let prefix = format!("{next}:");
        require!(op_id.starts_with(&prefix) && op_id.len() > prefix.len(), "op_id already admitted or nonce out of order");
        let before = env::storage_usage();
        value_ops().insert(&key, &ValueOp { epoch, action_hash, state: 0, nonce: near_sdk::json_types::U64(next), op_id: op_id.clone() });
        let n = self.pending_ops(&token_id) + 1;
        value_op_counts().insert(&token_id, &n);
        let cost = env::storage_usage().saturating_sub(before) as u128 * env::storage_byte_cost().as_yoctonear();
        require!(env::attached_deposit().as_yoctonear() >= cost, "attach value-op storage deposit");
        let excess = env::attached_deposit().as_yoctonear() - cost;
        if excess > 0 { record_native_credit(&self.minter, excess); }
        emit_key_event("value_op_begin", json_object!({"token_id": token_id, "op_id": op_id, "epoch": epoch}));
    }

    /// Finish ONLY after terminal reconciliation, never HTTP timeout/needs_review.
    /// Completion keeps a bounded high-water nonce, not an unbounded tombstone archive.
    /// v2.7 note: no 1-yocto requirement, same as beat and nft_set_tier, so a FunctionCall key can finish a value-op.
    /// The minter account is not only that key: payable methods use its full-access enclave key.
    pub fn finish_value_op(&mut self, token_id: TokenId, op_id: String, success: bool) {
        self.assert_minter();
        let key = value_op_key(&token_id, &op_id);
        let mut op = value_ops().get(&key).unwrap_or_else(|| env::panic_str("unknown value-op"));
        require!(op.op_id == op_id, "unknown or obsolete value-op");
        require!(op.state < 2, "value-op already finished");
        // Old operation ids cannot unlock a newer pending operation.
        op.state = if success { 2 } else { 3 };
        value_ops().insert(&key, &op);
        let n = self.pending_ops(&token_id).checked_sub(1).unwrap_or_else(||env::panic_str("value-op counter underflow"));
        if n == 0 { value_op_counts().remove(&token_id); } else { value_op_counts().insert(&token_id, &n); }
        emit_key_event("value_op_finish", json_object!({"token_id": token_id, "op_id": op_id, "success": success, "epoch": op.epoch}));
    }

    #[payable]
    pub fn set_minter(&mut self, minter: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        require!(pledge_config().is_none(), "minter is pinned after pledge migration");
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
    /// Pending nft_transfer_call returns for `account_id` (0 when none is in flight).
    pub fn pending_return_count(&self, account_id: AccountId) -> u32 { pending_returns(&account_id) }

    pub fn holder_tier(&self, account_id: AccountId) -> Option<u8> {
        let ids = self.tokens.tokens_per_owner.as_ref()?.get(&account_id)?;
        ids.iter().filter_map(|t| self.tiers.get(&t)).max()
    }

    /// Explicit release-policy transition. Legacy stored rates remain observable until called.
    /// Administration stays mutable; protected offers bind both rate and exact seller net.
    #[payable]
    pub fn adopt_zero_royalty(&mut self) {
        assert_one_yocto(); self.assert_owner(); self.royalty_bps=0;
        emit_key_event("royalty_policy",json_object!({"royalty_bps":0,"treasury":self.treasury}));
    }

    pub fn config(&self) -> Config {
        Config { owner: self.current_owner(), minter: self.minter.clone(), treasury: self.treasury.clone(), royalty_bps: self.royalty_bps, beats: self.beats.into() }
    }

    // NEP-199 (hand-written)
    pub fn nft_payout(&self, token_id: TokenId, balance: U128, max_len_payout: Option<u32>) -> Payout {
        let owner = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(||env::panic_str("unknown token"));
        let mut payout = HashMap::new();
        let royalty = royalty_amount(balance.0, self.royalty_bps);
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
        // Same checks as near-contract-standards' internal_transfer (see transfer_key), with ONE nft_transfer event
        // that names the approved account (the library's own event omits authorized_id).
        let prev_owner = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(|| env::panic_str("Token not found"));
        let authorized = if sender != prev_owner {
            let approved = self.tokens.approvals_by_id.as_ref().and_then(|m| m.get(&token_id)).unwrap_or_default();
            let id = approved.get(&sender).unwrap_or_else(|| env::panic_str("Sender not approved"));
            require!(approval_id.is_none() || approval_id == Some(*id), "approval_id mismatch");
            Some(sender)
        } else {
            None
        };
        self.transfer_key(&token_id, &receiver_id, authorized.as_ref(), memo.as_deref());
        payout
    }
}

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        self.assert_no_key(&receiver_id);
        self.assert_can_change_owner(&token_id);
        // A panic in the library call reverts this too, so a refused transfer keeps its listing.
        self.end_listing(&token_id);
        assert_one_yocto();
        let (owner, approvals) = self.tokens.internal_transfer(&env::predecessor_account_id(), &receiver_id, &token_id, approval_id, memo);
        if let Some(approved) = approvals { refund_approval_credit(&owner, &approved); }
        bump_owner_epoch(&token_id);
    }
    #[payable]
    fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        self.assert_no_key(&receiver_id);
        self.assert_can_change_owner(&token_id);
        assert_one_yocto();
        require!(env::prepaid_gas() >= near_sdk::Gas::from_tgas(100), "attach at least 100 Tgas");
        require!(msg.len() <= 16_384, "receiver message exceeds 16 KiB");
        let sender = env::predecessor_account_id();
        self.end_listing(&token_id);
        let (owner, approvals) = self.tokens.internal_transfer(&sender, &receiver_id, &token_id, approval_id, memo);
        if approvals.as_ref().is_some_and(|a| !a.is_empty()) { require_payout_account(&owner); }
        bump_owner_epoch(&token_id);
        let epoch = self.nft_settlement_epoch(token_id.clone());
        transfer_calls().insert(&token_id, &PendingTransfer { previous_owner: owner.clone(), receiver: receiver_id.clone(), epoch, approvals, restore_after_ns:near_sdk::json_types::U64(env::block_timestamp().checked_add(TRANSFER_RESTORE_DELAY_NS).unwrap_or_else(||env::panic_str("transfer timeout overflow"))) });
        set_pending(&owner, pending_returns(&owner).checked_add(1).unwrap_or_else(||env::panic_str("reservation overflow")));
        // Reserve 50 Tgas for bounded resolution plus 25 Tgas for outbound wrapper/storage.
        Promise::new(receiver_id).function_call("nft_on_transfer".into(), json_object!({
            "sender_id":sender,"previous_owner_id":owner,"token_id":token_id,"msg":msg
        }).into_bytes(), yocto(0), env::prepaid_gas().saturating_sub(near_sdk::Gas::from_tgas(75)))
            .then(Promise::new(env::current_account_id()).function_call("resolve_transfer_call".into(),
                json_object!({"token_id":token_id,"epoch":epoch}).into_bytes(), yocto(0), near_sdk::Gas::from_tgas(50))).into()
    }
    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl Contract {
    #[private]
    pub fn resolve_transfer_call(&mut self, token_id: TokenId, epoch: near_sdk::json_types::U64) -> bool {
        require!(env::predecessor_account_id() == env::current_account_id(), "callback is private");
        pledge::callback_failure_fixture();
        // Unbounded/malformed output is receiver failure, never a partially parsed acceptance.
        let must_return = pledge::bounded_result(32).and_then(|v| near_sdk::serde_json::from_slice::<bool>(&v).ok()).unwrap_or(true);
        self.settle_transfer_call(token_id, epoch, must_return)
    }
    pub fn get_pending_transfer(&self, token_id: TokenId) -> Option<PendingTransfer> { transfer_calls().get(&token_id) }
}
impl Contract {
    fn settle_transfer_call(&mut self, token_id: TokenId, epoch: near_sdk::json_types::U64, must_return: bool) -> bool {
        let Some(p) = transfer_calls().get(&token_id) else { return false; };
        if p.epoch != epoch { return false; } // Stale callbacks neither mutate nor claim acceptance.
        // G2: this settle runs inside a callback. A panic here would revert the whole receipt and keep the token locked
        // with transfer_calls still set, so every state write below is either infallible or reported as an event.
        let mut kept = true;
        if must_return && self.tokens.owner_by_id.get(&token_id).as_ref() == Some(&p.receiver) {
            self.tokens.internal_transfer_unguarded(&token_id, &p.receiver, &p.previous_owner);
            if let Some(by_id) = &mut self.tokens.approvals_by_id {
                if let Some(receiver_approvals) = by_id.remove(&token_id) { refund_approval_credit(&p.receiver, &receiver_approvals); }
                if let Some(old) = p.approvals { by_id.insert(&token_id, &old); }
            }
            near_contract_standards::non_fungible_token::events::NftTransfer {
                old_owner_id: &p.receiver, new_owner_id: &p.previous_owner, token_ids: &[&token_id], authorized_id: None, memo: None
            }.emit();
            bump_owner_epoch(&token_id); kept = false;
        } else if let Some(old) = p.approvals { refund_approval_credit(&p.previous_owner, &old); }
        transfer_calls().remove(&token_id);
        let reserved = pending_returns(&p.previous_owner);
        if reserved > 0 { set_pending(&p.previous_owner, reserved - 1); }
        else { emit_key_event("transfer_reservation_missing", json_object!({"token_id": token_id, "account_id": p.previous_owner})); }
        self.clear_stale_listing(&token_id);
        kept
    }
}

// NEP-178 approval management (near-contract-standards implementation).
#[near]
impl NonFungibleTokenApproval for Contract {
    #[payable]
    fn nft_approve(&mut self, token_id: TokenId, account_id: AccountId, msg: Option<String>) -> Option<Promise> {
        self.assert_token_idle(&token_id);
        self.assert_approval_cap(&token_id, &account_id);
        require!(env::attached_deposit().as_yoctonear() >= 1, "Requires attached deposit of at least 1 yoctoNEAR");
        let owner = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(|| env::panic_str("Token not found"));
        require!(env::predecessor_account_id() == owner, "Predecessor must be token owner.");
        require_payout_account(&owner);
        let map = self.tokens.approvals_by_id.as_mut().expect("approval management required");
        let mut approved = map.get(&token_id).unwrap_or_default();
        let next = self.tokens.next_approval_id_by_id.as_mut().expect("approval management required");
        let id = next.get(&token_id).unwrap_or(1);
        let replaced = approved.insert(account_id.clone(), id).is_some();
        map.insert(&token_id, &approved);
        next.insert(&token_id, &id.checked_add(1).expect("approval id overflow"));
        refund_storage_credit(if replaced { 0 } else { near_contract_standards::non_fungible_token::bytes_for_approved_account_id(&account_id) });
        msg.map(|msg| near_contract_standards::non_fungible_token::approval::ext_nft_approval_receiver::ext(account_id)
            .with_static_gas(env::prepaid_gas().saturating_sub(near_sdk::Gas::from_tgas(10)))
            .nft_on_approve(token_id, owner, id, msg))
    }
    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        assert_one_yocto();
        let owner = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(|| env::panic_str("Token not found"));
        require!(env::predecessor_account_id() == owner, "Predecessor must be token owner.");
        let map = self.tokens.approvals_by_id.as_mut().expect("approval management required");
        if let Some(mut approved) = map.get(&token_id) {
            if let Some(id) = approved.remove(&account_id) {
                if approved.is_empty() { map.remove(&token_id); } else { map.insert(&token_id, &approved); }
                refund_approval_credit(&owner, &HashMap::from([(account_id, id)]));
            }
        }
    }
    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let owner = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(|| env::panic_str("Token not found"));
        require!(env::predecessor_account_id() == owner, "Predecessor must be token owner.");
        if let Some(approved) = self.tokens.approvals_by_id.as_mut().expect("approval management required").remove(&token_id) {
            refund_approval_credit(&owner, &approved);
        }
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

// Unit fixtures explicitly sponsor real public registration fees before testing other flows.
// Attack regressions below create fresh, unregistered identities separately.
#[cfg(test)]
fn test_register_payouts(c: &mut Contract, accounts: &[AccountId]) {
    use near_sdk::{test_utils::VMContextBuilder, testing_env, Gas, NearToken};
    let previous = VMContextBuilder::new().current_account_id(env::current_account_id())
        .predecessor_account_id(env::predecessor_account_id()).signer_account_id(env::signer_account_id())
        .attached_deposit(env::attached_deposit()).block_timestamp(env::block_timestamp())
        .account_balance(env::account_balance()).prepaid_gas(env::prepaid_gas()).build();
    for who in accounts {
        if c.payout_account_registered(who.clone()) { continue; }
        let mut context = previous.clone(); context.attached_deposit = NearToken::from_yoctonear(c.payout_storage_cost().0);
        context.prepaid_gas = Gas::from_tgas(300); context.account_balance = NearToken::from_near(100);
        context.storage_usage = env::storage_usage(); testing_env!(context);
        assert!(c.register_payout_account(Some(who.clone())));
    }
    let mut context = previous; context.storage_usage = env::storage_usage(); testing_env!(context);
}
#[cfg(test)]
fn test_funded_contract() -> Contract {
    let mut c = Contract::new("owner.near".parse().unwrap(), "minter.near".parse().unwrap(), "treasury.near".parse().unwrap(), 500);
    let ids: Vec<AccountId> = ["keys.near","owner.near","minter.near","treasury.near","alice.near","bob.near","carol.near","lender.near","a.near","b.near","c.near","d.near","e.near"]
        .iter().map(|s|s.parse().unwrap()).collect();
    test_register_payouts(&mut c, &ids); c
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
        test_funded_contract()
    }
    fn mint(c: &mut Contract, id: &str, to: &str, tier: u8) { test_register_payouts(c, &[to.parse().unwrap()]);
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
        test_register_payouts(&mut c,&[acc("tee.near")]);
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
        for (id, ret, from, to, want_owner, want_bool) in [("r1", b"false".to_vec(), "a.near", "b.near", "b.near", true), ("r2", b"true".to_vec(), "c.near", "d.near", "c.near", false)] {
            let mut c = setup();
            mint(&mut c, id, from, 1);
            ctx(from, NearToken::from_yoctonear(1)); let _ = c.nft_transfer_call(acc(to), id.into(), None, None, "".into());
            testing_env!(B::new().current_account_id(acc("keys.near")).predecessor_account_id(acc("keys.near")).build(),
                near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(ret)]);
            assert_eq!(c.resolve_transfer_call(id.into(), c.nft_settlement_epoch(id.into())), want_bool);
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
    fn setup() -> Contract { ctx("keys.near", NearToken::from_yoctonear(0)); test_funded_contract() }
    fn mint(c: &mut Contract, id: &str, to: &str, tier: u8) { test_register_payouts(c, &[to.parse().unwrap()]); ctx("minter.near", NearToken::from_millinear(100)); c.nft_mint(id.into(), acc(to), tier, meta()); }
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
    fn setup() -> Contract { ctx("keys.near", NearToken::from_yoctonear(0)); test_funded_contract() }
    fn mint(c: &mut Contract, id: &str, to: &str) { test_register_payouts(c, &[to.parse().unwrap()]); ctx("minter.near", NearToken::from_millinear(100)); c.nft_mint(id.into(), acc(to), 1, meta()); }
    fn approve(c: &mut Contract, owner: &str, id: &str, who: &str) { test_register_payouts(c,&[acc(owner)]); ctx(owner, NearToken::from_millinear(10)); c.nft_approve(id.into(), acc(who), None); }
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

/// nft_transfer_call race: the sender cannot receive another key while its sent key may come back.
#[cfg(test)]
mod race {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken, PromiseResult};
    fn acc(s: &str) -> AccountId { s.parse().unwrap() }
    fn ctx(pred: &str, dep: NearToken) {
        testing_env!(VMContextBuilder::new().current_account_id(acc("keys.near")).predecessor_account_id(acc(pred)).attached_deposit(dep).build());
    }
    fn meta() -> TokenMetadata {
        TokenMetadata { title: Some("K".into()), description: None, media: None, media_hash: None, copies: Some(1), issued_at: None, expires_at: None, starts_at: None, updated_at: None, extra: None, reference: None, reference_hash: None }
    }
    fn setup() -> Contract { ctx("keys.near", NearToken::from_yoctonear(0)); test_funded_contract() }
    fn mint(c: &mut Contract, id: &str, to: &str) { test_register_payouts(c, &[to.parse().unwrap()]); ctx("minter.near", NearToken::from_millinear(100)); c.nft_mint(id.into(), acc(to), 1, meta()); }
    fn send_call(c: &mut Contract, from: &str, to: &str, id: &str) { ctx(from, NearToken::from_yoctonear(1)); let _ = c.nft_transfer_call(acc(to), id.into(), None, None, "".into()); }
    fn resolve(c: &mut Contract, _from: &str, _to: &str, id: &str, ret: &[u8]) -> bool {
        testing_env!(VMContextBuilder::new().current_account_id(acc("keys.near")).predecessor_account_id(acc("keys.near")).build(),
            near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(ret.to_vec())]);
        c.resolve_transfer_call(id.into(), c.nft_settlement_epoch(id.into()))
    }

    #[test] fn transfer_call_marks_sender_pending_until_resolve() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        send_call(&mut c, "alice.near", "bob.near", "k1");
        assert_eq!(c.pending_return_count(acc("alice.near")), 1);
        resolve(&mut c, "alice.near", "bob.near", "k1", b"false");
        assert_eq!(c.pending_return_count(acc("alice.near")), 0);
    }
    #[test] #[should_panic(expected = "one key per account")] fn mint_to_pending_sender_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); send_call(&mut c, "alice.near", "bob.near", "k1");
        mint(&mut c, "k2", "alice.near");
    }
    #[test] #[should_panic(expected = "one key per account")] fn transfer_to_pending_sender_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); mint(&mut c, "k2", "carol.near");
        send_call(&mut c, "alice.near", "bob.near", "k1");
        ctx("carol.near", NearToken::from_yoctonear(1)); c.nft_transfer(acc("alice.near"), "k2".into(), None, None);
    }
    #[test] #[should_panic(expected = "one key per account")] fn payout_to_pending_sender_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); mint(&mut c, "k2", "carol.near");
        send_call(&mut c, "alice.near", "bob.near", "k1");
        ctx("carol.near", NearToken::from_yoctonear(1)); c.nft_transfer_payout(acc("alice.near"), "k2".into(), None, None, U128(100), None);
    }
    #[test] fn returned_key_lands_on_a_sender_with_no_other_key() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); mint(&mut c, "k2", "carol.near");
        send_call(&mut c, "alice.near", "bob.near", "k1");
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { ctx("carol.near", NearToken::from_yoctonear(1)); c.nft_transfer(acc("alice.near"), "k2".into(), None, None); }));
        assert!(r.is_err(), "race transfer refused");
        assert!(!resolve(&mut c, "alice.near", "bob.near", "k1", b"true"), "receiver asked to return");
        assert_eq!(c.nft_supply_for_owner(acc("alice.near")).0, 1);
        assert_eq!(c.pending_return_count(acc("alice.near")), 0);
        ctx("carol.near", NearToken::from_yoctonear(1)); c.nft_transfer(acc("dave.near"), "k2".into(), None, None);
    }
    #[test] fn after_resolve_sender_can_receive_again() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        send_call(&mut c, "alice.near", "bob.near", "k1");
        resolve(&mut c, "alice.near", "bob.near", "k1", b"false");
        mint(&mut c, "k2", "alice.near");
        assert_eq!(c.nft_supply_for_owner(acc("alice.near")).0, 1);
    }
    #[test] fn failed_receiver_call_returns_key_and_clears_marker() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        send_call(&mut c, "alice.near", "bob.near", "k1");
        testing_env!(VMContextBuilder::new().current_account_id(acc("keys.near")).predecessor_account_id(acc("keys.near")).build(),
            near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
        assert!(!c.resolve_transfer_call("k1".into(), c.nft_settlement_epoch("k1".into())));
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("alice.near"));
        assert_eq!(c.pending_return_count(acc("alice.near")), 0);
    }
    #[test] fn approved_sender_marks_the_owner_not_the_market() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("alice.near", NearToken::from_millinear(10)); c.nft_approve("k1".into(), acc("market.near"), None);
        send_call(&mut c, "market.near", "bob.near", "k1");
        assert_eq!((c.pending_return_count(acc("alice.near")), c.pending_return_count(acc("market.near"))), (1, 0));
    }
    #[test] fn refused_transfer_call_leaves_no_marker() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); mint(&mut c, "k2", "bob.near");
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| send_call(&mut c, "alice.near", "bob.near", "k1")));
        assert!(r.is_err());
        // a panicking call is rolled back on chain; the check runs before the marker is written
        assert_eq!(c.pending_return_count(acc("alice.near")), 0);
    }
}

/// v2.3: NEP-178 approval cap. A token holds at most MAX_APPROVALS approvals; the 11th is refused
/// before any state change or nft_on_approve call.
#[cfg(test)]
mod v23 {
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
    fn setup() -> Contract { ctx("keys.near", NearToken::from_yoctonear(0)); test_funded_contract() }
    fn mint(c: &mut Contract, id: &str, to: &str) { test_register_payouts(c, &[to.parse().unwrap()]); ctx("minter.near", NearToken::from_millinear(100)); c.nft_mint(id.into(), acc(to), 1, meta()); }
    fn approve(c: &mut Contract, owner: &str, id: &str, who: &str) { test_register_payouts(c,&[acc(owner)]); ctx(owner, NearToken::from_millinear(10)); c.nft_approve(id.into(), acc(who), None); }
    fn revoke(c: &mut Contract, owner: &str, id: &str, who: &str) { ctx(owner, NearToken::from_yoctonear(1)); c.nft_revoke(id.into(), acc(who)); }
    fn approved(c: &Contract, id: &str) -> HashMap<AccountId, u64> { c.nft_token(id.into()).unwrap().approved_account_ids.unwrap() }
    fn fill(c: &mut Contract, owner: &str, id: &str, n: usize) { for i in 0..n { approve(c, owner, id, &format!("m{i}.near")); } }

    #[test] fn cap_is_ten() { assert_eq!(MAX_APPROVALS, 10); }
    #[test] fn tenth_approval_is_allowed() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        fill(&mut c, "alice.near", "k1", MAX_APPROVALS);
        assert_eq!(approved(&c, "k1").len(), 10);
        assert!(c.nft_is_approved("k1".into(), acc("m9.near"), Some(10)));
    }
    #[test] #[should_panic(expected = "approval cap reached: a token holds at most 10 approvals")]
    fn eleventh_approval_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        fill(&mut c, "alice.near", "k1", MAX_APPROVALS);
        approve(&mut c, "alice.near", "k1", "m10.near");
    }
    #[test] #[should_panic(expected = "approval cap reached")]
    fn eleventh_approval_with_msg_is_refused_before_the_callback() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        fill(&mut c, "alice.near", "k1", MAX_APPROVALS);
        ctx("alice.near", NearToken::from_millinear(10));
        let _ = c.nft_approve("k1".into(), acc("market.near"), Some("{\"price\":\"1\"}".into()));
    }
    #[test] fn refused_eleventh_changes_nothing_and_takes_no_approval_id() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        fill(&mut c, "alice.near", "k1", MAX_APPROVALS);
        let before = approved(&c, "k1");
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| approve(&mut c, "alice.near", "k1", "m10.near")));
        assert!(r.is_err(), "11th refused");
        assert_eq!(approved(&c, "k1"), before, "approvals unchanged");
        assert!(!c.nft_is_approved("k1".into(), acc("m10.near"), None));
        // the refused call took no id: the next approval after a revoke is still id 11
        revoke(&mut c, "alice.near", "k1", "m0.near");
        approve(&mut c, "alice.near", "k1", "m10.near");
        assert_eq!(approved(&c, "k1")[&acc("m10.near")], 11);
        assert_eq!(approved(&c, "k1").len(), 10);
    }
    #[test] fn reapproving_an_approved_account_at_the_cap_is_allowed() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        fill(&mut c, "alice.near", "k1", MAX_APPROVALS);
        approve(&mut c, "alice.near", "k1", "m3.near");
        let a = approved(&c, "k1");
        assert_eq!(a.len(), 10, "same account, no new slot");
        assert_eq!(a[&acc("m3.near")], 11, "fresh approval id, as before");
    }
    #[test] fn revoke_frees_a_slot() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        fill(&mut c, "alice.near", "k1", MAX_APPROVALS);
        revoke(&mut c, "alice.near", "k1", "m0.near");
        approve(&mut c, "alice.near", "k1", "m10.near");
        assert!(c.nft_is_approved("k1".into(), acc("m10.near"), None));
        assert!(!c.nft_is_approved("k1".into(), acc("m0.near"), None));
        assert_eq!(approved(&c, "k1").len(), 10);
    }
    #[test] #[should_panic(expected = "Predecessor must be token owner.")]
    fn non_owner_gets_the_owner_error_not_the_cap_error() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        fill(&mut c, "alice.near", "k1", MAX_APPROVALS);
        approve(&mut c, "mallory.near", "k1", "mallory.near");
    }
    #[test] fn cap_is_per_holding_transfer_clears_it() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        fill(&mut c, "alice.near", "k1", MAX_APPROVALS);
        revoke(&mut c, "alice.near", "k1", "m0.near"); // leave a slot free so the transfer below is the only change
        ctx("alice.near", NearToken::from_yoctonear(1)); c.nft_transfer(acc("bob.near"), "k1".into(), None, None);
        assert!(approved(&c, "k1").is_empty(), "transfer clears approvals");
        fill(&mut c, "bob.near", "k1", MAX_APPROVALS);
        assert_eq!(approved(&c, "k1").len(), 10);
    }
}

/// v2.4: earned tiers. nft_set_tier raises a key's tier (minter only, 1..=MAX_TIER, strictly up).
#[cfg(test)]
mod v24 {
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
    fn setup() -> Contract { ctx("keys.near", NearToken::from_yoctonear(0)); test_funded_contract() }
    fn mint(c: &mut Contract, id: &str, to: &str, tier: u8) { test_register_payouts(c, &[to.parse().unwrap()]); ctx("minter.near", NearToken::from_millinear(100)); c.nft_mint(id.into(), acc(to), tier, meta()); }
    fn set_tier(c: &mut Contract, id: &str, tier: u8) { ctx("minter.near", NearToken::from_yoctonear(0)); c.nft_set_tier(id.into(), tier); }

    #[test] fn minter_raises_one_to_two_to_three() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1);
        set_tier(&mut c, "k1", 2);
        assert_eq!(c.nft_tier("k1".into()), Some(2));
        assert_eq!(c.holder_tier(acc("alice.near")), Some(2), "holder_tier reflects the raise");
        set_tier(&mut c, "k1", 3);
        assert_eq!(c.nft_tier("k1".into()), Some(3));
        assert_eq!(c.holder_tier(acc("alice.near")), Some(3));
    }
    #[test] #[should_panic(expected = "only minter")]
    fn non_minter_cannot_set_tier() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1);
        ctx("alice.near", NearToken::from_yoctonear(0)); c.nft_set_tier("k1".into(), 2);
    }
    #[test] #[should_panic(expected = "only minter")]
    fn owner_cannot_set_tier() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1);
        ctx("owner.near", NearToken::from_yoctonear(0)); c.nft_set_tier("k1".into(), 2);
    }
    #[test] #[should_panic(expected = "no token")]
    fn unknown_token_refused() { let mut c = setup(); set_tier(&mut c, "nope", 2); }
    #[test] #[should_panic(expected = "tier only goes up")]
    fn same_tier_refused() { let mut c = setup(); mint(&mut c, "k1", "alice.near", 2); set_tier(&mut c, "k1", 2); }
    #[test] #[should_panic(expected = "tier only goes up")]
    fn lower_tier_refused() { let mut c = setup(); mint(&mut c, "k1", "alice.near", 2); set_tier(&mut c, "k1", 1); }
    #[test] #[should_panic(expected = "bad tier")]
    fn tier_zero_refused() { let mut c = setup(); mint(&mut c, "k1", "alice.near", 1); set_tier(&mut c, "k1", 0); }
    #[test] #[should_panic(expected = "bad tier")]
    fn tier_four_refused() { let mut c = setup(); mint(&mut c, "k1", "alice.near", 1); set_tier(&mut c, "k1", MAX_TIER + 1); }
    #[test] fn refused_raise_changes_nothing() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 2);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| set_tier(&mut c, "k1", 2)));
        assert!(r.is_err());
        assert_eq!(c.nft_tier("k1".into()), Some(2));
    }
    #[test] fn emits_metadata_update_with_exact_json() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1);
        set_tier(&mut c, "k1", 2);
        let logs = get_logs();
        assert_eq!(logs, vec![r#"EVENT_JSON:{"standard":"nep171","version":"1.2.0","event":"nft_metadata_update","data":[{"token_ids":["k1"]}]}"#.to_string()]);
    }
    #[test] fn tier_survives_transfer() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1);
        set_tier(&mut c, "k1", 3);
        ctx("alice.near", NearToken::from_yoctonear(1)); c.nft_transfer(acc("bob.near"), "k1".into(), None, None);
        assert_eq!(c.nft_tier("k1".into()), Some(3));
        assert_eq!(c.holder_tier(acc("bob.near")), Some(3));
        assert_eq!(c.holder_tier(acc("alice.near")), None);
    }
    #[test] fn raise_does_not_touch_supply_owner_or_metadata() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near", 1);
        let before = c.nft_token("k1".into()).unwrap();
        set_tier(&mut c, "k1", 2);
        let after = c.nft_token("k1".into()).unwrap();
        assert_eq!((before.owner_id, before.metadata), (after.owner_id, after.metadata));
        assert_eq!(c.nft_total_supply(), U128(1));
        assert_eq!(c.config().beats.0, 0, "a tier raise is not a beat");
    }
}

/// v2.4 key sale: nft_list / nft_unlist / nft_buy, the listing clean-ups on every transfer path, stale listings,
/// the views and the tier rules. Unit tests check backed pull credits and absence of native push receipts.
#[cfg(test)]
mod v24_sale {
    use super::*;
    use near_sdk::mock::MockAction;
    use near_sdk::serde_json::{json, Value};
    use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
    use near_sdk::{testing_env, NearToken, PromiseResult};

    const NEAR: u128 = 10u128.pow(24);
    const LIST: u128 = LIST_STORAGE_DEPOSIT;

    fn acc(s: &str) -> AccountId { s.parse().unwrap() }
    fn y(v: u128) -> NearToken { NearToken::from_yoctonear(v) }
    fn ctx(pred: &str, dep: NearToken) {
        testing_env!(VMContextBuilder::new().current_account_id(acc("keys.near")).predecessor_account_id(acc(pred)).attached_deposit(dep).build());
    }
    fn meta() -> TokenMetadata {
        TokenMetadata { title: Some("K".into()), description: None, media: None, media_hash: None, copies: Some(1), issued_at: None, expires_at: None, starts_at: None, updated_at: None, extra: None, reference: None, reference_hash: None }
    }
    fn setup() -> Contract { ctx("keys.near", y(0)); test_funded_contract() }
    fn mint_tier(c: &mut Contract, id: &str, to: &str, tier: u8) { test_register_payouts(c, &[to.parse().unwrap()]); ctx("minter.near", NearToken::from_millinear(100)); c.nft_mint(id.into(), acc(to), tier, meta()); }
    fn mint(c: &mut Contract, id: &str, to: &str) { test_register_payouts(c, &[to.parse().unwrap()]); mint_tier(c, id, to, 2) }
    fn list(c: &mut Contract, who: &str, id: &str, price: u128, dep: u128) { ctx(who, y(dep)); c.nft_list(id.into(), U128(price)); }
    fn buy(c: &mut Contract, who: &str, id: &str, dep: u128) { ctx(who, y(dep)); c.nft_buy(id.into()); }
    fn listing(c: &Contract, id: &str) -> Option<ListingView> { c.nft_listing(id.into()) }
    fn index_len() -> u64 { index_count() }
    /// Every (receiver, yocto) transfer the last call scheduled, in creation order.
    fn transfers() -> Vec<(String, u128)> {
        let mut out = vec![];
        for r in get_created_receipts() {
            for a in r.actions.iter() {
                if let MockAction::Transfer { deposit, .. } = a { out.push((r.receiver_id.to_string(), deposit.as_yoctonear())); }
            }
        }
        out
    }
    fn credited(c: &Contract, to: &str) -> u128 { c.get_payout_credit(acc(to)).0 }
    /// The EVENT_JSON payloads of the last call with this event name.
    fn events(name: &str) -> Vec<Value> {
        get_logs().iter().filter_map(|l| l.strip_prefix("EVENT_JSON:"))
            .map(|j| near_sdk::serde_json::from_str::<Value>(j).unwrap())
            .filter(|v| v["event"] == name).collect()
    }
    fn keyhole(event: &str, data: Value) -> Value {
        json!({"standard": "keyhole", "version": "1.0.0", "event": event, "data": [data]})
    }
    fn resolve(c: &mut Contract, _from: &str, _to: &str, id: &str, ret: &[u8]) -> bool {
        testing_env!(VMContextBuilder::new().current_account_id(acc("keys.near")).predecessor_account_id(acc("keys.near")).build(),
            near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(ret.to_vec())]);
        c.resolve_transfer_call(id.into(), c.nft_settlement_epoch(id.into()))
    }

    // ---- nft_list ----
    #[test] fn list_by_owner_stores_the_listing_and_emits_key_list() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        assert_eq!(listing(&c, "k1"), Some(ListingView { token_id: "k1".into(), seller: acc("alice.near"), price: U128(NEAR) }));
        assert_eq!(listings().get(&"k1".to_string()), Some(Listing { seller: acc("alice.near"), price: U128(NEAR), deposit: U128(LIST) }));
        assert_eq!(index_len(), 1);
        assert_eq!(events("key_list"), vec![keyhole("key_list", json!({"token_id": "k1", "seller": "alice.near", "price": NEAR.to_string()}))]);
        assert_eq!(c.nft_tier("k1".into()), Some(2), "listing does not touch the tier");
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("alice.near"), "listing does not move the key");
    }
    #[test] #[should_panic(expected = "only the owner can list")]
    fn list_by_non_owner_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "mallory.near", "k1", NEAR, LIST);
    }
    #[test] #[should_panic(expected = "unknown token")]
    fn list_unknown_token_is_refused() {
        let mut c = setup(); list(&mut c, "alice.near", "nope", NEAR, LIST);
    }
    #[test] #[should_panic(expected = "price below the 0.1 NEAR minimum")]
    fn price_below_minimum_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", MIN_LIST_PRICE - 1, LIST);
    }
    #[test]
    fn minimum_price_is_accepted() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", MIN_LIST_PRICE, LIST);
        assert_eq!(listing(&c, "k1").unwrap().price, U128(MIN_LIST_PRICE));
        assert_eq!(MIN_LIST_PRICE, 10u128.pow(23));
    }
    #[test] #[should_panic(expected = "price above the 100000 NEAR cap")]
    fn price_above_cap_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", MAX_LIST_PRICE + 1, LIST);
    }
    #[test] #[should_panic(expected = "attach at least 0.01 NEAR for listing storage")]
    fn new_listing_needs_the_storage_deposit() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST - 1);
    }
    #[test]
    fn excess_storage_deposit_is_refunded_and_only_the_storage_amount_is_kept() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, 5 * LIST);
        assert!(transfers().is_empty()); assert_eq!(credited(&c, "alice.near"), 4 * LIST, "excess is backed pull credit");
        assert_eq!(listings().get(&"k1".to_string()).unwrap().deposit, U128(LIST), "the stored deposit is the storage amount, not the attachment");
    }
    #[test]
    fn price_update_with_one_yocto_keeps_the_deposit() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        list(&mut c, "alice.near", "k1", 2 * NEAR, 1);
        assert_eq!(listings().get(&"k1".to_string()), Some(Listing { seller: acc("alice.near"), price: U128(2 * NEAR), deposit: U128(LIST) }));
        assert!(transfers().is_empty(), "no refund and no second deposit");
        assert_eq!(events("key_list"), vec![keyhole("key_list", json!({"token_id": "k1", "seller": "alice.near", "price": (2 * NEAR).to_string()}))]);
        assert_eq!(index_len(), 1);
    }
    #[test] #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn price_update_without_one_yocto_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        list(&mut c, "alice.near", "k1", 2 * NEAR, 0);
    }

    // ---- nft_unlist ----
    #[test] fn unlist_refunds_the_deposit_and_clears_the_index() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        ctx("alice.near", y(1)); c.nft_unlist("k1".into());
        assert_eq!(listing(&c, "k1"), None);
        assert_eq!(index_len(), 0);
        assert!(transfers().is_empty()); assert_eq!(credited(&c, "alice.near"), LIST);
        assert_eq!(events("key_unlist"), vec![keyhole("key_unlist", json!({"token_id": "k1", "seller": "alice.near"}))]);
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("alice.near"));
    }
    #[test] #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn unlist_needs_one_yocto() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        ctx("alice.near", y(0)); c.nft_unlist("k1".into());
    }
    #[test] #[should_panic(expected = "only the seller or the owner can unlist")]
    fn unlist_by_a_stranger_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        ctx("mallory.near", y(1)); c.nft_unlist("k1".into());
    }
    #[test] #[should_panic(expected = "no listing")]
    fn unlist_without_a_listing_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("alice.near", y(1)); c.nft_unlist("k1".into());
    }

    // ---- nft_buy ----
    #[test] fn buy_moves_the_key_pays_the_split_and_refunds_the_excess() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        buy(&mut c, "bob.near", "k1", NEAR + NEAR / 5);
        // key and listing
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("bob.near"));
        assert_eq!(listing(&c, "k1"), None);
        assert_eq!(index_len(), 0);
        assert_eq!(c.holder_tier(acc("bob.near")), Some(2));
        assert_eq!(c.holder_tier(acc("alice.near")), None);
        // money: treasury 5 %, seller price - royalty + the listing deposit, buyer the 0.2 NEAR excess
        assert!(transfers().is_empty(), "sale records credits, never fire-and-forget pushes");
        assert_eq!(credited(&c, "treasury.near"), NEAR / 20);
        assert_eq!(credited(&c, "alice.near"), NEAR - NEAR / 20 + LIST);
        assert_eq!(credited(&c, "bob.near"), NEAR / 5);
        // one nft_transfer, memo sale, no authorized_id (the owner listed it, nobody was approved)
        let tr = events("nft_transfer");
        assert_eq!(tr.len(), 1);
        assert_eq!(tr[0]["data"][0]["memo"], "sale");
        assert_eq!(tr[0]["data"][0]["old_owner_id"], "alice.near");
        assert_eq!(tr[0]["data"][0]["new_owner_id"], "bob.near");
        assert!(tr[0]["data"][0].get("authorized_id").is_none());
        assert!(events("key_unlist").is_empty(), "a sale ends the listing inside key_sale");
        // the sale event, exact content
        assert_eq!(events("key_sale"), vec![keyhole("key_sale", json!({
            "token_id": "k1", "seller": "alice.near", "buyer": "bob.near",
            "price": NEAR.to_string(), "royalty": (NEAR / 20).to_string(),
        }))]);
    }
    #[test] fn exact_price_sends_no_refund_and_no_royalty_when_royalty_is_zero() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("owner.near", y(1)); c.set_royalty(acc("treasury.near"), 0);
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        buy(&mut c, "bob.near", "k1", NEAR);
        assert!(transfers().is_empty()); assert_eq!(credited(&c, "alice.near"), NEAR + LIST, "seller gets whole price and deposit as credit");
    }
    #[test] fn buy_clears_approvals_and_refunds_their_storage_to_the_seller() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("alice.near", NearToken::from_millinear(10)); c.nft_approve("k1".into(), acc("market.near"), None);
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        buy(&mut c, "bob.near", "k1", NEAR);
        let tok = c.nft_token("k1".into()).unwrap();
        assert_eq!(tok.approved_account_ids, Some(HashMap::new()), "approvals cleared");
        assert!(!c.nft_is_approved("k1".into(), acc("market.near"), None));
        assert!(credited(&c, "alice.near") > NEAR - NEAR / 20 + LIST, "the seller also gets the approval storage back");
        assert_eq!(events("nft_transfer")[0]["data"][0].get("authorized_id"), None);
    }
    #[test] #[should_panic(expected = "attached deposit is below the listing price")]
    fn buy_with_too_little_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        buy(&mut c, "bob.near", "k1", NEAR - 1);
    }
    #[test] #[should_panic(expected = "the seller cannot buy its own key")]
    fn seller_cannot_buy_its_own_key() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        buy(&mut c, "alice.near", "k1", NEAR);
    }
    #[test] #[should_panic(expected = "one key per account")]
    fn a_buyer_who_already_holds_a_key_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); mint(&mut c, "k2", "bob.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        buy(&mut c, "bob.near", "k1", NEAR);
    }
    #[test] #[should_panic(expected = "no listing")]
    fn buy_without_a_listing_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        buy(&mut c, "bob.near", "k1", NEAR);
    }
    #[test] fn stale_listing_is_removed_refunded_and_the_buyer_gets_the_attachment_back() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        // The key leaves alice without the listing ending. No public path does this (every path ends the listing),
        // so the test moves the key with the library's raw transfer.
        c.tokens.internal_transfer_unguarded(&"k1".to_string(), &acc("alice.near"), &acc("bob.near"));
        buy(&mut c, "carol.near", "k1", NEAR);
        assert_eq!(listing(&c, "k1"), None);
        assert_eq!(index_len(), 0);
        assert!(transfers().is_empty()); assert_eq!(credited(&c, "alice.near"), LIST); assert_eq!(credited(&c, "carol.near"), NEAR);
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("bob.near"), "no transfer happened");
        assert!(events("key_sale").is_empty());
        assert!(events("nft_transfer").is_empty());
        assert_eq!(events("key_listing_stale"), vec![keyhole("key_listing_stale", json!({"token_id": "k1", "seller": "alice.near", "owner": "bob.near"}))]);
    }

    // ---- every other transfer path ends the listing ----
    #[test] fn plain_transfer_ends_the_listing_and_refunds_the_deposit() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        ctx("alice.near", y(1)); c.nft_transfer(acc("bob.near"), "k1".into(), None, Some("gift".into()));
        assert_eq!(listing(&c, "k1"), None);
        assert_eq!(index_len(), 0);
        assert!(transfers().is_empty()); assert_eq!(credited(&c, "alice.near"), LIST);
        assert_eq!(events("key_unlist").len(), 1);
        assert_eq!(events("nft_transfer").len(), 1, "still exactly one nft_transfer");
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("bob.near"));
    }
    #[test] fn transfer_call_ends_the_listing_and_refunds_the_deposit() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        ctx("alice.near", y(1)); let _ = c.nft_transfer_call(acc("bob.near"), "k1".into(), None, None, "".into());
        assert_eq!(listing(&c, "k1"), None);
        assert_eq!(index_len(), 0);
        assert_eq!(credited(&c, "alice.near"), LIST);
        assert_eq!(c.pending_return_count(acc("alice.near")), 1);
    }
    #[test] fn approved_market_transfer_payout_ends_the_listing() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("alice.near", NearToken::from_millinear(10)); c.nft_approve("k1".into(), acc("market.near"), None);
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        ctx("market.near", y(1));
        let p = c.nft_transfer_payout(acc("bob.near"), "k1".into(), Some(1), Some("sale".into()), U128(NEAR), Some(10)).payout;
        assert_eq!(p[&acc("treasury.near")], U128(NEAR / 20));
        assert_eq!(listing(&c, "k1"), None);
        assert_eq!(index_len(), 0);
        assert!(credited(&c, "alice.near") >= LIST, "the listing deposit goes back to the seller");
        assert_eq!(events("key_unlist").len(), 1);
        let tr = events("nft_transfer");
        assert_eq!(tr.len(), 1, "one nft_transfer for the payout transfer");
        assert_eq!(tr[0]["data"][0]["authorized_id"], "market.near");
    }
    #[test] #[should_panic(expected = "transfer-call pending")]
    fn key_returned_by_resolve_ends_a_listing_the_receiver_made() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("alice.near", y(1)); let _ = c.nft_transfer_call(acc("bob.near"), "k1".into(), None, None, "".into());
        // bob owns k1 while the call is in flight, and lists it
        list(&mut c, "bob.near", "k1", NEAR, LIST);
        assert_eq!(listing(&c, "k1").unwrap().seller, acc("bob.near"));
        // nft_on_transfer asked for the key back: resolve returns it to alice (resolve gives false)
        assert!(!resolve(&mut c, "alice.near", "bob.near", "k1", b"true"));
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("alice.near"));
        assert_eq!(listing(&c, "k1"), None, "the listing ended with the move");
        assert_eq!(index_len(), 0);
        assert_eq!(credited(&c, "bob.near"), LIST, "bob gets his listing deposit back");
        assert_eq!(c.pending_return_count(acc("alice.near")), 0);
    }
    #[test] #[should_panic(expected = "transfer-call pending")]
    fn resolve_that_keeps_the_key_keeps_the_listing() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("alice.near", y(1)); let _ = c.nft_transfer_call(acc("bob.near"), "k1".into(), None, None, "".into());
        list(&mut c, "bob.near", "k1", NEAR, LIST);
        assert!(resolve(&mut c, "alice.near", "bob.near", "k1", b"false"));
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("bob.near"));
        assert_eq!(listing(&c, "k1").unwrap().seller, acc("bob.near"));
        assert_eq!(index_len(), 1);
    }

    // ---- views ----
    #[test] fn nft_listings_pages_and_follows_every_exit() {
        let mut c = setup();
        for i in 0..5 { mint(&mut c, &format!("k{i}"), &format!("o{i}.near")); }
        for i in 0..5 { list(&mut c, &format!("o{i}.near"), &format!("k{i}"), NEAR, LIST); }
        let ids = |v: Vec<ListingView>| v.into_iter().map(|l| l.token_id).collect::<Vec<_>>().join(",");
        assert_eq!(ids(c.nft_listings(None, None)), "k0,k1,k2,k3,k4");
        assert_eq!(ids(c.nft_listings(Some(U128(1)), Some(2))), "k1,k2");
        assert_eq!(ids(c.nft_listings(Some(U128(5)), None)), "", "past the end is empty");
        assert_eq!(ids(c.nft_listings(None, Some(1))), "k0");
        // unlist k1, sell k2, transfer k3 away
        ctx("o1.near", y(1)); c.nft_unlist("k1".into());
        buy(&mut c, "buyer.near", "k2", NEAR);
        ctx("o3.near", y(1)); c.nft_transfer(acc("new.near"), "k3".into(), None, None);
        let mut left: Vec<ListingView> = c.nft_listings(None, None);
        left.sort_by(|a, b| a.token_id.cmp(&b.token_id));
        assert_eq!(left.iter().map(|l| l.token_id.as_str()).collect::<Vec<_>>(), vec!["k0", "k4"]);
        for l in left {
            assert_eq!(c.nft_token(l.token_id.clone()).unwrap().owner_id, l.seller, "every listing's seller owns its key");
            assert_eq!(c.nft_listing(l.token_id.clone()), Some(l));
        }
        assert_eq!(index_len(), 2);
        assert_eq!(listing(&c, "k2"), None);
    }
    #[test] #[should_panic(expected = "limit must be positive")]
    fn zero_page_is_refused() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near"); list(&mut c, "alice.near", "k1", NEAR, LIST);
        c.nft_listings(None, Some(0));
    }
    #[test] fn views_for_an_unlisted_key_are_empty() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        assert_eq!(listing(&c, "k1"), None);
        assert!(c.nft_listings(None, None).is_empty());
    }

    // ---- tiers and the rest of v2.4 ----
    #[test] fn a_listed_key_can_still_earn_a_tier_and_the_buyer_holds_it() {
        let mut c = setup(); mint_tier(&mut c, "k1", "alice.near", 1);
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        ctx("minter.near", y(0)); c.nft_set_tier("k1".into(), 3);
        assert_eq!(c.holder_tier(acc("alice.near")), Some(3));
        assert_eq!(listing(&c, "k1").unwrap().price, U128(NEAR), "a raise does not change the listing");
        buy(&mut c, "bob.near", "k1", NEAR);
        assert_eq!(c.holder_tier(acc("bob.near")), Some(3));
        assert_eq!(c.nft_tier("k1".into()), Some(3));
    }
    #[test] #[should_panic(expected = "only minter")]
    fn the_seller_cannot_raise_a_listed_tier() {
        let mut c = setup(); mint_tier(&mut c, "k1", "alice.near", 1);
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        ctx("alice.near", y(0)); c.nft_set_tier("k1".into(), 2);
    }
    #[test] fn sale_leaves_supply_and_config_alone() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        let cfg = near_sdk::serde_json::to_string(&c.config()).unwrap();
        list(&mut c, "alice.near", "k1", NEAR, LIST);
        buy(&mut c, "bob.near", "k1", NEAR);
        assert_eq!(c.nft_total_supply(), U128(1));
        assert_eq!(near_sdk::serde_json::to_string(&c.config()).unwrap(), cfg);
    }
}


/// v2.5 replay-safe admission barrier and owner epoch.
#[cfg(test)]
mod v25_admission {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken};

    const NEAR: u128 = 10u128.pow(24);
    const LIST: u128 = LIST_STORAGE_DEPOSIT;

    fn acc(s: &str) -> AccountId { s.parse().unwrap() }
    fn y(v: u128) -> NearToken { NearToken::from_yoctonear(v) }
    fn ctx(pred: &str, dep: NearToken) {
        testing_env!(VMContextBuilder::new().current_account_id(acc("keys.near")).predecessor_account_id(acc(pred)).attached_deposit(dep).build());
    }
    fn meta() -> TokenMetadata {
        TokenMetadata { title: Some("K".into()), description: None, media: None, media_hash: None, copies: Some(1), issued_at: None, expires_at: None, starts_at: None, updated_at: None, extra: None, reference: None, reference_hash: None }
    }
    fn setup() -> Contract { ctx("keys.near", y(0)); test_funded_contract() }
    fn mint(c: &mut Contract, id: &str, to: &str) { test_register_payouts(c, &[to.parse().unwrap()]);
        ctx("minter.near", NearToken::from_millinear(100));
        c.nft_mint(id.into(), acc(to), 2, meta());
    }

    #[test] fn mint_starts_at_epoch_zero() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        assert_eq!(c.nft_settlement_epoch("k1".into()).0, 0);
        assert_eq!(c.pending_value_op_count("k1".into()).0, 0);
        assert!(!c.get_control_state("k1".into()).listed);
    }

    #[test] fn transfer_bumps_epoch() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("alice.near", y(1)); c.nft_transfer(acc("bob.near"), "k1".into(), None, None);
        assert_eq!(c.nft_settlement_epoch("k1".into()).0, 1);
        assert_eq!(c.get_control_state("k1".into()).owner_epoch.0, 1);
    }

    #[test] fn finish_clears_barrier_and_transfer_succeeds() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("minter.near", NearToken::from_millinear(10));
        c.begin_value_op("k1".into(), near_sdk::json_types::U64(0), "1:op1".into(), "ah".into(), acc("alice.near"));
        assert_eq!(c.pending_value_op_count("k1".into()).0, 1);
        ctx("minter.near", y(0));
        c.finish_value_op("k1".into(), "1:op1".into(), true);
        assert_eq!(c.pending_value_op_count("k1".into()).0, 0);
        ctx("alice.near", y(1)); c.nft_transfer(acc("bob.near"), "k1".into(), None, None);
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("bob.near"));
        assert_eq!(c.nft_settlement_epoch("k1".into()).0, 1);
    }

    #[test] #[should_panic(expected = "value-op pending: finish or reconcile before transfer or sale")]
    fn transfer_refused_while_value_op_pending() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("minter.near", NearToken::from_millinear(10));
        c.begin_value_op("k1".into(), near_sdk::json_types::U64(0), "1:op1".into(), "ah".into(), acc("alice.near"));
        ctx("alice.near", y(1)); c.nft_transfer(acc("bob.near"), "k1".into(), None, None);
    }

    #[test] #[should_panic(expected = "value-op pending: finish before listing")]
    fn list_refused_while_value_op_pending() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("minter.near", NearToken::from_millinear(10));
        c.begin_value_op("k1".into(), near_sdk::json_types::U64(0), "1:op1".into(), "ah".into(), acc("alice.near"));
        ctx("alice.near", y(LIST)); c.nft_list("k1".into(), U128(NEAR));
    }

    #[test] #[should_panic(expected = "listed: unlist before value-ops")]
    fn begin_refused_while_listed() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("alice.near", y(LIST)); c.nft_list("k1".into(), U128(NEAR));
        ctx("minter.near", NearToken::from_millinear(10));
        c.begin_value_op("k1".into(), near_sdk::json_types::U64(0), "1:op1".into(), "ah".into(), acc("alice.near"));
    }

    #[test] #[should_panic(expected = "epoch mismatch")]
    fn begin_refuses_stale_epoch() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("alice.near", y(1)); c.nft_transfer(acc("bob.near"), "k1".into(), None, None);
        // epoch is now 1
        ctx("minter.near", NearToken::from_millinear(10));
        c.begin_value_op("k1".into(), near_sdk::json_types::U64(0), "1:op1".into(), "ah".into(), acc("alice.near"));
    }

    #[test] #[should_panic(expected = "only minter")]
    fn begin_is_minter_only() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("alice.near", y(0));
        c.begin_value_op("k1".into(), near_sdk::json_types::U64(0), "1:op1".into(), "ah".into(), acc("alice.near"));
    }

    #[test] fn sale_bumps_epoch_when_no_pending_ops() {
        let mut c = setup(); mint(&mut c, "k1", "alice.near");
        ctx("alice.near", y(LIST)); c.nft_list("k1".into(), U128(NEAR));
        ctx("bob.near", y(NEAR)); c.nft_buy("k1".into());
        assert_eq!(c.nft_settlement_epoch("k1".into()).0, 1);
        assert_eq!(c.nft_token("k1".into()).unwrap().owner_id, acc("bob.near"));
    }
}

#[cfg(test)]
mod zero_royalty_tests {
 use super::*;
 use near_sdk::{test_utils::VMContextBuilder,testing_env};
 fn a(s:&str)->AccountId{s.parse().unwrap()}
 fn ctx(who:&str,dep:u128){testing_env!(VMContextBuilder::new().current_account_id(a("keys.near")).predecessor_account_id(a(who)).signer_account_id(a(who)).attached_deposit(yocto(dep)).build());}
 fn setup()->Contract {ctx("keys.near",0);let mut c=Contract::new(a("owner.near"),a("minter.near"),a("treasury.near"),500);crate::test_register_payouts(&mut c,&[a("minter.near")]);ctx("minter.near",10u128.pow(24));c.nft_mint("k1".into(),a("alice.near"),1,TokenMetadata{title:Some("Key".into()),..Default::default()});c}
 #[test] fn zero_policy_legacy_to_zero_and_every_unit_goes_to_seller(){let mut c=setup();ctx("owner.near",1);c.adopt_zero_royalty();assert_eq!(c.config().royalty_bps,0);for b in [0,1,9_999,10_000,u128::MAX]{let p=c.nft_payout("k1".into(),U128(b),Some(1)).payout;assert_eq!(p.len(),1);assert_eq!(p[&a("alice.near")].0,b);}}
 #[test] fn legacy_payout_u128_max_conserves_without_overflow(){let mut c=setup();for rate in [0,1,500,1000]{c.royalty_bps=rate;for b in [0,1,19,39,10_000,u128::MAX]{let p=c.nft_payout("k1".into(),U128(b),Some(10)).payout;assert_eq!(p.values().try_fold(0u128,|a,b|a.checked_add(b.0)),Some(b));assert!(p.len()<=2);}}}
 #[test] fn treasury_seller_collision_is_single_full_balance(){let mut c=setup();c.treasury=a("alice.near");let p=c.nft_payout("k1".into(),U128(u128::MAX),Some(1)).payout;assert_eq!(p.len(),1);assert_eq!(p[&a("alice.near")].0,u128::MAX);}
 #[test] #[should_panic(expected="only owner")] fn zero_policy_requires_owner(){let mut c=setup();ctx("alice.near",1);c.adopt_zero_royalty();}
 #[test] #[should_panic] fn zero_policy_requires_one_yocto(){let mut c=setup();ctx("owner.near",0);c.adopt_zero_royalty();}
 #[test] #[should_panic(expected="max_len_payout too small")] fn zero_policy_honors_zero_payout_limit(){let mut c=setup();ctx("owner.near",1);c.adopt_zero_royalty();c.nft_payout("k1".into(),U128(0),Some(0));}
}

#[cfg(test)]
mod compact_json_tests {
    use super::*;
    use near_sdk::json_types::{Base64VecU8, U64};

    #[test]
    fn compact_objects_preserve_legacy_json_bytes_and_borrow_inputs() {
        let text = "quote\" slash\\ newline\n nul\0 utf8: 🔑 ".to_string();
        let account: AccountId = "holder.near".parse().unwrap();
        macro_rules! same {
            ($($key:literal : $value:expr),* $(,)?) => {
                assert_eq!(json_object!({$($key: $value),*}),
                    near_sdk::serde_json::json!({$($key: $value),*}).to_string());
            };
        }
        same!("wallet_pubkey": text);
        same!("token_id": text, "nonce": U64(u64::MAX));
        same!("token_id": text, "nonce": U64(0), "sequence": U64(u64::MAX));
        same!("token_id": text, "op_id": text, "success": true, "epoch": U64(0));
        same!("token_id": text, "seller": account, "buyer": account,
            "price": U128(u128::MAX), "royalty": U128(0));
        same!("token_id": text, "nonce": U64(0), "seller": account, "buyer": account,
            "price": U128(u128::MAX), "seller_net": U128(0), "royalty_bps": 0);
        same!("wallet_pubkey": text, "encrypted_data": text,
            "wallet_signature": Base64VecU8(vec![0, 255, 128]), "version": 42u64,
            "locked": true, "valid_until": 123u64, "storage_refund_to": account);
        same!("account_id": account, "paid": U128(u128::MAX), "budget_bytes": 320u64);
        same!("token_id": text, "nonce": U64(0), "resolution": Some(text.clone()));
        same!("token_id": text, "nonce": U64(0), "resolution": None::<String>);
        same!("kind": "explicit_funding", "from": account, "amount": U128(0));
        same!("token_id": text, "nonce": U64(0), "payout_nonce": U64(2),
            "activated_at_ns": U64(u64::MAX), "due_ns": U64(u64::MAX));
        same!("sender_id": account, "previous_owner_id": account, "token_id": text, "msg": text);
        assert!(text.ends_with("🔑 "));
        assert_eq!(account.as_str(), "holder.near");
    }
}
