//! Sealed collateral, asynchronous native settlement and immutable treasury-only recovery.
//! New data uses isolated prefixes; the deployed v2.4 Contract layout is untouched.
use crate::*;
use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::Gas;
#[cfg(test)] use near_sdk::PromiseResult;

pub const RECOVERY_UNLOCK_NS: u64 = 1_796_169_600_000_000_000;
pub const LOAN_STORAGE_DEPOSIT: u128 = 50_000_000_000_000_000_000_000;
pub const COLLATERAL_STORAGE_DEPOSIT: u128 = 20_000_000_000_000_000_000_000;
pub const OPERATING_RESERVE: u128 = 100_000_000_000_000_000_000_000;
pub const COLLATERAL_ASSET: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
pub const CERTIFICATE_DOMAIN: &str = "KEYHOLE_SEALED_LOAN_V2_CREDIT";
/// Provisional title only: no economic finality before local resolver acceptance.
pub const TRANSFER_RESTORE_DELAY_NS:u64=300_000_000_000;
pub const CERTIFICATE_MAX_AGE_NS: u64 = 60_000_000_000;
const SECOND: u64 = 1_000_000_000;
const MAX_DURATION: u64 = 30 * 86_400;
const CONFIG_KEY: &[u8] = b"Pg";

#[derive(Clone, Debug)]
#[near(serializers = [borsh, json])]
pub struct PledgeConfig {
    pub recovery_account: AccountId,
    pub recovery_unlock_ns: U64,
    pub attestor_public_key: Base64VecU8,
    pub custody_contract: AccountId,
    pub network: String,
    /// New offers and funding only. Repayments/credits/defaults never depend on this switch.
    pub lending_enabled: bool,
    pub next_loan_nonce: U64,
    pub next_payout_nonce: U64,
    pub treasury_available: U128,
    /// Loan/registration bonds and all available/pending native loan, sale and refund credits.
    pub user_liabilities: U128,
    pub treasury_pending: Option<PendingPayout>,
}

pub(crate) fn pledge_config() -> Option<PledgeConfig> {
    env::storage_read(CONFIG_KEY).map(|v| near_sdk::borsh::from_slice(&v).unwrap_or_else(|_|env::panic_str("pledge config corrupt")))
}
pub(crate) fn save_config(c: &PledgeConfig) {
    env::storage_write(CONFIG_KEY, &near_sdk::borsh::to_vec(c).unwrap_or_else(|_|env::panic_str("config encoding")));
}
pub(crate) fn config_required() -> PledgeConfig { pledge_config().unwrap_or_else(||env::panic_str("pledge migration required")) }
#[derive(Clone, Debug)]
#[near(serializers = [borsh, json])]
pub struct PendingTransfer {
    pub previous_owner: AccountId, pub receiver: AccountId, pub epoch: U64,
    pub approvals: Option<HashMap<AccountId, u64>>,
    pub restore_after_ns:U64,
}
pub(crate) fn transfer_calls() -> LookupMap<TokenId, PendingTransfer> { LookupMap::new(b"Pt".as_slice()) }
/// Inspect result length in the VM register BEFORE copying bytes into WASM or parsing.
/// Some SDK helpers eagerly allocate/deserialize arbitrary receiver-controlled bytes.
pub(crate) fn bounded_result(max_bytes: u64) -> Option<Vec<u8>> {
    const REGISTER: u64 = 12_345;
    if unsafe { near_sdk::sys::promise_result(0, REGISTER) } != 1 { return None; }
    if env::register_len(REGISTER)? > max_bytes { return None; }
    env::read_register(REGISTER)
}
fn result_success() -> bool {
    // Financial callbacks only need terminal success, never arbitrary returned bytes.
    unsafe { near_sdk::sys::promise_result(0, 12_345) == 1 }
}
pub(crate) fn loans() -> LookupMap<TokenId, Loan> { LookupMap::new(b"Pl".as_slice()) }
pub(crate) fn collateral() -> LookupMap<TokenId, CollateralBinding> { LookupMap::new(b"Pb".as_slice()) }
fn bound_wallets() -> LookupMap<String, TokenId> { LookupMap::new(b"Pw".as_slice()) }
#[derive(Clone,Default)]
#[near(serializers=[borsh])]
struct CreditLedger {available:u128,pending:Option<PendingPayout>}
fn credit_ledgers()->LookupMap<AccountId,CreditLedger>{LookupMap::new(b"Pc".as_slice())}
fn save_credit(who:&AccountId,l:&CreditLedger){if l.available==0&&l.pending.is_none(){credit_ledgers().remove(who);}else{credit_ledgers().insert(who,l);}}


#[derive(Clone, Debug)]
#[near(serializers = [borsh, json])]
pub struct PendingRegistration {
    pub nonce: U64, pub payer: AccountId, pub forwarded: U128, pub store_succeeded: Option<bool>,
}
fn registrations() -> LookupMap<TokenId, PendingRegistration> { LookupMap::new(b"Pr".as_slice()) }
#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct PendingPayout { pub nonce: U64, pub amount: U128 }

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct CollateralBinding {
    /// Canonical ed25519:<lowercase hex>. Its hex part is the confidential wallet's NEAR account.
    pub wallet_pubkey: String,
    pub encrypted_policy_hash: Base64VecU8,
    pub policy_version: U64,
    pub ready: bool,
    pub policy_generation:U64,
}

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct LoanTerms {
    pub lender: AccountId,
    pub principal: U128,
    pub repayment: U128,
    pub duration_sec: U64,
    pub grace_sec: U64,
    pub floor_raw: U128,
    pub funding_deadline_ns: U64,
}

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub enum LoanState { Freezing, Offered, Active, UnlockPending }

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct Loan {
    pub token_id: TokenId,
    pub nonce: U64,
    pub borrower: AccountId,
    pub owner_epoch: U64,
    pub terms: LoanTerms,
    pub state: LoanState,
    pub due_ns: U64,
    pub storage_bond: U128,
    pub policy_sequence: U64,
    pub policy_busy: bool,
    pub policy_call_complete: bool,
    pub resolution: Option<String>,
}

/// Signature covers Borsh of exactly these fields, in declaration order, not caller JSON.
/// No actual balance, invented USD valuation, private block height or fake measured-code hash.
#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh, json])]
pub struct LoanCertificate {
    pub domain: String,
    pub network: String,
    pub contract: AccountId,
    pub token_id: TokenId,
    pub loan_nonce: U64,
    pub borrower: AccountId,
    pub owner_epoch: U64,
    pub terms: LoanTerms,
    pub asset: String,
    pub wallet_pubkey: String,
    pub policy_version: U64,
    pub policy_hash: Base64VecU8,
    pub observed_at_ns: U64,
    pub expires_at_ns: U64,
    pub floor_met: bool,
    pub frozen: bool,
    pub pending_value_ops: U64,
}

#[derive(near_sdk::serde::Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct PolicyView { owner: AccountId, encrypted_data: String, frozen: bool, version: u64, locked: bool, #[serde(default)] generation:u64, #[serde(default)] generation_supported:bool, #[serde(default)] registration_nonce:U64, #[serde(default)] registration_deposit:U128 }

pub(crate) fn callback_failure_fixture() {
    #[cfg(feature = "callback-failure-fixture")]
    env::panic_str("TEST FIXTURE: injected callback failure");
}
fn private_callback() { require!(env::predecessor_account_id() == env::current_account_id(), "callback is private"); }
fn promise_succeeded() -> bool { result_success() }
fn policy_result() -> Option<PolicyView> {
    bounded_result(32_768).and_then(|v| near_sdk::serde_json::from_slice(&v).ok())
}
fn policy_matches(p: &PolicyView, b: &CollateralBinding) -> bool {
    p.owner == env::current_account_id() && p.locked && p.generation_supported && p.version == b.policy_version.0
        && env::sha256(p.encrypted_data.as_bytes()) == b.encrypted_policy_hash.0
}
fn call(target: AccountId, method: &str, args: near_sdk::serde_json::Value, deposit: u128, gas: u64) -> Promise {
    Promise::new(target).function_call(method.into(), args.to_string().into_bytes(), yocto(deposit), Gas::from_tgas(gas))
}
fn callback(method: &str, args: near_sdk::serde_json::Value, gas: u64) -> Promise {
    call(env::current_account_id(), method, args, 0, gas)
}
fn enough_gas() { require!(env::prepaid_gas() >= Gas::from_tgas(180), "attach at least 180 Tgas"); }
pub(crate) fn add_credit(who:&AccountId,amount:u128){if amount>0{let mut l=credit_ledgers().get(who).unwrap_or_default();l.available=l.available.checked_add(amount).unwrap_or_else(||env::panic_str("credit overflow"));save_credit(who,&l);}}
pub(crate) fn change_liabilities(c: &mut PledgeConfig, add: u128, subtract: u128) {
    c.user_liabilities = U128(c.user_liabilities.0.checked_add(add).and_then(|v| v.checked_sub(subtract)).unwrap_or_else(||env::panic_str("liability overflow")));
}
// Sale/refund credits also work before pledge migration. These isolated metadata keys
// are folded into the one-time config initialization; never infer liabilities from balance.
const PRE_CREDIT_TOTAL: &[u8] = b"Pcredit_total";
const PRE_CREDIT_NONCE: &[u8] = b"Pcredit_nonce";
fn pre_total() -> u128 { env::storage_read(PRE_CREDIT_TOTAL).map(|v| u128::from_le_bytes(v.try_into().unwrap())).unwrap_or(0) }
fn pre_nonce() -> u64 { env::storage_read(PRE_CREDIT_NONCE).map(|v| u64::from_le_bytes(v.try_into().unwrap())).unwrap_or(0) }
pub(crate) fn record_native_credit(who: &AccountId, amount: u128) {
    if amount == 0 { return; }
    add_credit(who, amount);
    if let Some(mut c) = pledge_config() { change_liabilities(&mut c, amount, 0); save_config(&c); }
    else { env::storage_write(PRE_CREDIT_TOTAL, &pre_total().checked_add(amount).expect("liability overflow").to_le_bytes()); }
}
pub(crate) fn refund_storage_credit(bytes: u64) {
    let cost = env::storage_byte_cost().as_yoctonear() * bytes as u128;
    let attached = env::attached_deposit().as_yoctonear();
    require!(attached >= cost, "Must attach enough to cover storage");
    if attached - cost > 1 { record_native_credit(&env::predecessor_account_id(), attached - cost); }
}
pub(crate) fn refund_approval_credit(who: &AccountId, approved: &HashMap<AccountId,u64>) {
    let bytes: u64 = approved.keys().map(near_contract_standards::non_fungible_token::bytes_for_approved_account_id).sum();
    record_native_credit(who, env::storage_byte_cost().as_yoctonear() * bytes as u128);
}
pub(crate) fn record_sale_royalty(treasury: &AccountId, amount: u128) -> bool {
    if treasury != &env::current_account_id() { return false; }
    let Some(mut c) = pledge_config() else { return false; };
    c.treasury_available = U128(c.treasury_available.0.checked_add(amount).unwrap_or_else(||env::panic_str("treasury overflow")));
    save_config(&c);
    emit_key_event("treasury_credit", near_sdk::serde_json::json!({"kind":"sale_royalty","amount":U128(amount)}));
    true
}
fn require_lending(c: &PledgeConfig) { require!(c.lending_enabled, "lending disabled: confinement rollout required"); }
fn load_loan(token: &TokenId, nonce: U64) -> Loan {
    let l = loans().get(token).unwrap_or_else(||env::panic_str("no loan")); require!(l.nonce == nonce, "loan nonce mismatch"); l
}

#[near]
impl Contract {
    /// One-time, self-call initialization for deployed v2.4. No implicit attribution of existing native balance.
    /// Legacy migrate() remains available for the historical v1 -> v2 approval map migration only.
    #[init(ignore_state)]
    pub fn migrate_pledge(recovery_account: AccountId, attestor_public_key: Base64VecU8, custody_contract: AccountId, network: String) -> Self {
        require!(env::predecessor_account_id() == env::current_account_id(), "migrate is private");
        require!(pledge_config().is_none(), "pledge already migrated");
        require!(attestor_public_key.0.len() == 32, "attestor must be 32-byte Ed25519");
        require!(!network.is_empty() && network.len() <= 32, "bad network domain");
        require!(recovery_account != env::current_account_id(), "recovery must be an external account");
        require!(custody_contract != env::current_account_id(), "invalid custody contract");
        let c: Contract = env::state_read().unwrap_or_else(||env::panic_str("no state"));
        require!(c.tokens.approvals_by_id.is_some(), "run legacy migrate first");
        save_config(&PledgeConfig {
            recovery_account, recovery_unlock_ns: U64(RECOVERY_UNLOCK_NS), attestor_public_key, custody_contract, network,
            lending_enabled: false, next_loan_nonce: U64(0), next_payout_nonce: U64(pre_nonce()),
            treasury_available: U128(0), user_liabilities: U128(pre_total()), treasury_pending: None,
        });
        env::storage_remove(PRE_CREDIT_TOTAL); env::storage_remove(PRE_CREDIT_NONCE);
        c
    }

    pub fn get_pledge_config(&self) -> Option<PledgeConfig> { pledge_config() }
    pub fn get_loan(&self, token_id: TokenId) -> Option<Loan> { loans().get(&token_id) }
    pub fn get_collateral_binding(&self, token_id: TokenId) -> Option<CollateralBinding> { collateral().get(&token_id) }
    pub fn get_payout_credit(&self, account_id: AccountId) -> U128 { U128(credit_ledgers().get(&account_id).map(|l|l.available).unwrap_or(0)) }
    pub fn get_pending_payout(&self, account_id: AccountId) -> Option<PendingPayout> { credit_ledgers().get(&account_id).and_then(|l|l.pending) }
    pub fn get_value_op(&self, token_id: TokenId, op_id: String) -> Option<ValueOp> { value_ops().get(&value_op_key(&token_id, &op_id)).filter(|op| op.op_id == op_id) }

    #[payable]
    pub fn set_lending_enabled(&mut self, enabled: bool) {
        assert_one_yocto(); self.assert_owner();
        let mut c = config_required(); c.lending_enabled = enabled; save_config(&c);
    }

    /// Install a wallet-signed locked policy under this contract's controller identity, once per token/wallet.
    /// Payload/ABI follows OutLayer contract/src/wallet.rs store_wallet_policy:v2. No live call is made by tests.
    #[payable]
    pub fn register_collateral(&mut self, token_id: TokenId, wallet_pubkey: String, encrypted_data: String,
        wallet_signature: String, version: u64, valid_until: u64) -> Promise {
        enough_gas(); self.assert_minter(); self.assert_can_change_owner(&token_id);
        let mut c = config_required();
        require!(self.tokens.owner_by_id.get(&token_id).is_some(), "unknown token");
        require!(listings().get(&token_id).is_none(), "unlist first");
        let hex = wallet_pubkey.strip_prefix("ed25519:").unwrap_or_else(||env::panic_str("only Ed25519 collateral"));
        require!(hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "canonical wallet key required");
        require!(!encrypted_data.is_empty() && encrypted_data.len() <= 4096, "bad policy payload");
        require!(wallet_signature.len() == 128 && wallet_signature.bytes().all(|b| b.is_ascii_hexdigit()), "bad wallet signature");
        require!(version > 0 && valid_until >= env::block_timestamp() / SECOND, "stale policy");
        let dep = env::attached_deposit().as_yoctonear();
        require!(dep > COLLATERAL_STORAGE_DEPOSIT, "attach policy deposit plus 0.02 NEAR permanent binding storage");
        if let Some(old) = collateral().get(&token_id) {
            let r = registrations().get(&token_id).unwrap_or_else(||env::panic_str("collateral already bound"));
            require!(!old.ready && old.wallet_pubkey == wallet_pubkey && r.store_succeeded == Some(false), "collateral already bound or receipt unknown");
            // Corrected artifact for SAME not-yet-eligible wallet, only after definite failed action.
            // New global nonce invalidates any old in-flight read. Original bond becomes backed pull credit.
            add_credit(&r.payer, COLLATERAL_STORAGE_DEPOSIT);
            collateral().remove(&token_id); bound_wallets().remove(&wallet_pubkey); registrations().remove(&token_id);
        }
        require!(bound_wallets().get(&wallet_pubkey).is_none(), "wallet already bound");
        let b = CollateralBinding { wallet_pubkey: wallet_pubkey.clone(), encrypted_policy_hash: Base64VecU8(env::sha256(encrypted_data.as_bytes())), policy_version: U64(version), ready: false, policy_generation:U64(0) };
        collateral().insert(&token_id, &b); bound_wallets().insert(&wallet_pubkey, &token_id);
        c.next_payout_nonce = U64(c.next_payout_nonce.0.checked_add(1).unwrap_or_else(||env::panic_str("registration nonce overflow")));
        let nonce = c.next_payout_nonce;
        registrations().insert(&token_id, &PendingRegistration { nonce, payer: env::predecessor_account_id(), forwarded: U128(dep - COLLATERAL_STORAGE_DEPOSIT), store_succeeded: None });
        change_liabilities(&mut c, dep, 0); save_config(&c);
        call(c.custody_contract, "store_wallet_policy", near_sdk::serde_json::json!({
            "wallet_pubkey": wallet_pubkey, "encrypted_data": encrypted_data, "wallet_signature": wallet_signature,
            "version": version, "locked": true, "valid_until": valid_until, "storage_refund_to": self.minter,"registration_nonce":nonce,
        }), dep - COLLATERAL_STORAGE_DEPOSIT, 35)
            .then(callback("on_collateral_stored", near_sdk::serde_json::json!({"token_id": token_id, "nonce": nonce}), 65))
    }

    #[private]
    pub fn on_collateral_stored(&mut self, token_id: TokenId, nonce: U64) -> PromiseOrValue<bool> {
        private_callback(); callback_failure_fixture(); self.settle_collateral_store(token_id, nonce, promise_succeeded())
    }
    pub fn get_pending_registration(&self, token_id: TokenId) -> Option<PendingRegistration> { registrations().get(&token_id) }

    pub fn check_collateral(&self, token_id: TokenId) -> Promise {
        let c = config_required(); let b = collateral().get(&token_id).unwrap_or_else(||env::panic_str("unbound collateral"));
        let nonce = registrations().get(&token_id).map(|r| r.nonce).unwrap_or(U64(0));
        call(c.custody_contract, "get_wallet_policy", near_sdk::serde_json::json!({"wallet_pubkey": b.wallet_pubkey}), 0, 15)
            .then(callback("on_collateral_checked", near_sdk::serde_json::json!({"token_id": token_id, "nonce": nonce}), 30))
    }

    #[private]
    pub fn on_collateral_checked(&mut self, token_id: TokenId, nonce: U64) -> bool {
        private_callback();
        let Some(r) = registrations().get(&token_id) else { return false; };
        if r.nonce != nonce { return false; }
        let Some(mut b) = collateral().get(&token_id) else { return false; };
        let Some(v) = bounded_result(32_768) else { return false; };
        let Ok(policy) = near_sdk::serde_json::from_slice::<Option<PolicyView>>(&v) else { return false; };
        let mut c = config_required();
        if r.store_succeeded.is_none(){
            // Audited provider extension: these fields are written atomically WITH accepting
            // this exact deposit/provisioning call, never inferred from absence or a balance.
            if !policy.as_ref().is_some_and(|p|policy_matches(p,&b)&&p.registration_nonce==nonce&&p.registration_deposit==r.forwarded){return false;}
            change_liabilities(&mut c,0,r.forwarded.0);
        }
        if policy.as_ref().is_some_and(|p| policy_matches(p, &b)) {
            b.ready = true; collateral().insert(&token_id, &b); registrations().remove(&token_id);
            change_liabilities(&mut c, 0, COLLATERAL_STORAGE_DEPOSIT); save_config(&c); return true;
        }
        if policy.is_none() && r.store_succeeded == Some(false) {
            // Both original provider receipt and authoritative absence are known. No unknown action can rebind later.
            collateral().remove(&token_id); bound_wallets().remove(&b.wallet_pubkey); registrations().remove(&token_id);
            add_credit(&r.payer, COLLATERAL_STORAGE_DEPOSIT); // forwarded amount was already restored exactly once
        }
        false
    }

    pub(crate) fn assert_token_idle(&self, token_id: &TokenId) {
        require!(sale::sales().get(token_id).is_none(), "protected sale pending: token locked");
        require!(loans().get(token_id).is_none(), "pledged: ownership and value operations locked");
        require!(transfer_calls().get(token_id).is_none(), "transfer-call pending: token locked");
    }

    /// Borrower-declared immutable floor/terms; lower custody must be frozen before Offered.
    #[payable]
    pub fn open_loan(&mut self, token_id: TokenId, terms: LoanTerms) -> Promise {
        enough_gas(); let mut c = config_required(); require_lending(&c);
        self.assert_can_change_owner(&token_id);
        let borrower = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(||env::panic_str("unknown token"));
        require!(env::predecessor_account_id() == borrower, "only borrower");
        require!(listings().get(&token_id).is_none(), "unlist first");
        require!(collateral().get(&token_id).is_some_and(|b| b.ready), "collateral confinement not ready");
        require!(env::attached_deposit().as_yoctonear() == LOAN_STORAGE_DEPOSIT, "attach exact 0.05 NEAR refundable loan bond");
        require!(terms.lender != borrower && terms.lender != env::current_account_id(), "distinct external lender required");
        require!(terms.principal.0 > 0 && terms.principal.0 <= MAX_LIST_PRICE, "bad principal");
        require!(terms.repayment.0 >= terms.principal.0 && terms.repayment.0 <= MAX_LIST_PRICE, "bad repayment");
        require!(terms.floor_raw.0 > 0, "zero floor");
        require!(terms.duration_sec.0 > 0 && terms.duration_sec.0 <= MAX_DURATION && terms.grace_sec.0 <= 7 * 86_400, "bad term duration");
        let now = env::block_timestamp();
        require!(terms.funding_deadline_ns.0 > now && terms.funding_deadline_ns.0 <= now.checked_add(7 * 86_400 * SECOND).unwrap_or_else(||env::panic_str("time overflow")), "bad funding deadline");
        c.next_loan_nonce = U64(c.next_loan_nonce.0.checked_add(1).unwrap_or_else(||env::panic_str("loan nonce overflow")));
        let storage_before=env::storage_usage();
        change_liabilities(&mut c, LOAN_STORAGE_DEPOSIT, 0); save_config(&c);
        let l = Loan { token_id: token_id.clone(), nonce: c.next_loan_nonce, borrower, owner_epoch: self.nft_settlement_epoch(token_id.clone()),
            terms, state: LoanState::Freezing, due_ns: U64(0), storage_bond: U128(LOAN_STORAGE_DEPOSIT), policy_sequence: U64(0),
            policy_busy: false, policy_call_complete: false, resolution: None };
        loans().insert(&token_id, &l);
        let storage_cost=env::storage_usage().saturating_sub(storage_before) as u128*env::storage_byte_cost().as_yoctonear();
        require!(storage_cost<=LOAN_STORAGE_DEPOSIT,"loan bond does not cover storage");
        emit_key_event("loan_open", near_sdk::serde_json::json!({"token_id": token_id, "nonce": l.nonce}));
        self.start_policy_action(token_id, true)
    }

    fn start_policy_action(&mut self, token:TokenId,freeze:bool)->Promise {
        let c=config_required();let mut l=loans().get(&token).unwrap_or_else(||env::panic_str("no loan"));
        require!((freeze&&l.state==LoanState::Freezing)||(!freeze&&l.state==LoanState::UnlockPending),"wrong custody transition");
        let mut b=collateral().get(&token).unwrap_or_else(||env::panic_str("unbound collateral"));
        if !l.policy_busy {
            b.policy_generation=U64(b.policy_generation.0.checked_add(1).unwrap_or_else(||env::panic_str("policy generation overflow")));
            collateral().insert(&token,&b);l.policy_sequence=b.policy_generation;
        }
        // Unknown action retries are the SAME fenced command, never a new generation.
        l.policy_busy=true;l.policy_call_complete=false;loans().insert(&token,&l);
        call(c.custody_contract,"set_wallet_frozen",near_sdk::serde_json::json!({"wallet_pubkey":b.wallet_pubkey,"generation":l.policy_sequence,"frozen":freeze}),0,20)
            .then(callback("on_policy_action",near_sdk::serde_json::json!({"token_id":token,"nonce":l.nonce,"sequence":l.policy_sequence}),65))
    }

    /// Retry only after the previous provider action AND read callback have completed. No overlapping thaw/freeze.
    pub fn retry_loan_policy(&mut self, token_id: TokenId, nonce: U64) -> Promise {
        enough_gas(); let l = load_loan(&token_id, nonce);
        require!(l.state == LoanState::Freezing || l.state == LoanState::UnlockPending, "no custody transition to retry");
        self.start_policy_action(token_id, l.state == LoanState::Freezing)
    }

    #[private]
    pub fn on_policy_action(&mut self, token_id: TokenId, nonce: U64, sequence: U64) -> PromiseOrValue<bool> {
        private_callback(); callback_failure_fixture(); self.settle_policy_action(token_id, nonce, sequence)
    }

    /// Read-only reconciliation is allowed after the provider receipt callback recorded terminal completion.
    pub fn reconcile_loan_policy(&self, token_id: TokenId, nonce: U64) -> Promise {
        let l = load_loan(&token_id, nonce);
        require!(l.policy_busy, "no pending policy action");
        self.read_loan_policy(token_id, l)
    }
    fn read_loan_policy(&self, token: TokenId, l: Loan) -> Promise {
        let c = config_required(); let b = collateral().get(&token).unwrap_or_else(||env::panic_str("unbound collateral"));
        call(c.custody_contract, "get_wallet_policy", near_sdk::serde_json::json!({"wallet_pubkey": b.wallet_pubkey}), 0, 15)
            .then(callback("on_loan_policy", near_sdk::serde_json::json!({"token_id": token, "nonce": l.nonce, "sequence": l.policy_sequence}), 30))
    }

    #[private]
    pub fn on_loan_policy(&mut self, token_id: TokenId, nonce: U64, sequence: U64) -> bool {
        private_callback();
        let Some(mut l) = loans().get(&token_id) else { return false; };
        if l.nonce != nonce || l.policy_sequence != sequence || !l.policy_busy { return false; }
        let Some(b) = collateral().get(&token_id) else { return false; };
        let Some(p) = policy_result() else { return false; };
        if !policy_matches(&p, &b) || p.generation!=l.policy_sequence.0 { return false; }
        l.policy_busy = false; l.policy_call_complete = false;
        if l.state == LoanState::Freezing && p.frozen { l.state = LoanState::Offered; }
        if l.state == LoanState::UnlockPending && !p.frozen {
            // Loan bond remains a user liability until a successful pull payout; no treasury attribution.
            add_credit(&l.borrower, l.storage_bond.0); loans().remove(&token_id);
            emit_key_event("loan_closed", near_sdk::serde_json::json!({"token_id": token_id, "nonce": nonce, "resolution": l.resolution}));
            return true;
        }
        loans().insert(&token_id, &l); true
    }

    pub fn loan_certificate_template(&self, token_id: TokenId, observed_at_ns: U64, expires_at_ns: U64) -> LoanCertificate {
        let c = config_required(); let l = loans().get(&token_id).unwrap_or_else(||env::panic_str("no loan")); let b = collateral().get(&token_id).unwrap_or_else(||env::panic_str("unbound collateral"));
        LoanCertificate { domain: CERTIFICATE_DOMAIN.into(), network: c.network, contract: env::current_account_id(), token_id,
            loan_nonce: l.nonce, borrower: l.borrower, owner_epoch: l.owner_epoch, terms: l.terms, asset: COLLATERAL_ASSET.into(),
            wallet_pubkey: b.wallet_pubkey, policy_version: b.policy_version, policy_hash: b.encrypted_policy_hash,
            observed_at_ns, expires_at_ns, floor_met: true, frozen: true, pending_value_ops: U64(0) }
    }

    #[payable]
    pub fn fund_loan(&mut self, token_id: TokenId, nonce: U64, certificate: LoanCertificate, signature: Base64VecU8) -> bool {
        enough_gas(); let mut c = config_required(); require_lending(&c);
        let mut l = load_loan(&token_id, nonce);
        require!(l.state == LoanState::Offered && !l.policy_busy, "loan not fundable");
        require!(env::predecessor_account_id() == l.terms.lender, "only named lender");
        // The certificate-bound lender is the initial default receiver; seizure may redirect and rechecks eligibility.
        self.assert_no_key(&l.terms.lender);
        require!(env::attached_deposit().as_yoctonear() == l.terms.principal.0, "attach exact principal");
        require!(self.tokens.owner_by_id.get(&token_id).as_ref() == Some(&l.borrower), "borrower no longer owner");
        require!(self.nft_settlement_epoch(token_id.clone()) == l.owner_epoch && self.pending_ops(&token_id) == 0 && transfer_calls().get(&token_id).is_none(), "control state changed");
        let now = env::block_timestamp();
        require!(now <= l.terms.funding_deadline_ns.0, "funding expired");
        require!(certificate.observed_at_ns.0 <= now && now < certificate.expires_at_ns.0 && certificate.expires_at_ns.0 <= certificate.observed_at_ns.0.saturating_add(CERTIFICATE_MAX_AGE_NS), "certificate expired or future observation");
        let expected = self.loan_certificate_template(token_id.clone(), certificate.observed_at_ns, certificate.expires_at_ns);
        require!(certificate == expected, "certificate not bound to this exact loan");
        let sig: [u8; 64] = signature.0.try_into().unwrap_or_else(|_| env::panic_str("bad signature length"));
        let pk: [u8; 32] = c.attestor_public_key.0.clone().try_into().unwrap_or_else(|_|env::panic_str("bad attestor key"));
        require!(env::ed25519_verify(&sig, &near_sdk::borsh::to_vec(&certificate).unwrap_or_else(|_|env::panic_str("certificate encoding")), &pk), "invalid attestor signature");
        // Principal is an immediately backed pull credit. This receipt atomically creates
        // both the borrower's legal claim and debt; no fallible push selects principal truth.
        add_credit(&l.borrower,l.terms.principal.0);
        change_liabilities(&mut c,l.terms.principal.0,0);save_config(&c);
        l.state=LoanState::Active;l.due_ns=U64(now.checked_add(l.terms.duration_sec.0*SECOND).unwrap_or_else(||env::panic_str("due overflow")));
        loans().insert(&token_id,&l);true
    }

    #[payable]
    pub fn repay_loan(&mut self, token_id: TokenId, nonce: U64) -> Promise {
        enough_gas(); let mut l = load_loan(&token_id, nonce);
        require!(env::predecessor_account_id() == l.borrower, "only borrower");
        require!(l.state == LoanState::Active && !l.policy_busy, "loan not active");
        require!(env::block_timestamp() <= l.due_ns.0.checked_add(l.terms.grace_sec.0 * SECOND).unwrap_or_else(||env::panic_str("grace overflow")), "default claim period");
        require!(env::attached_deposit().as_yoctonear() == l.terms.repayment.0, "attach exact repayment");
        let mut c = config_required(); change_liabilities(&mut c, l.terms.repayment.0, 0); save_config(&c);
        // Repayment is final as funded lender CREDIT, not a fallible push transfer.
        add_credit(&l.terms.lender, l.terms.repayment.0);
        l.state = LoanState::UnlockPending; l.resolution = Some("repaid".into()); loans().insert(&token_id, &l);
        self.start_policy_action(token_id, false)
    }

    #[payable]
    pub fn cancel_loan(&mut self, token_id: TokenId, nonce: U64) -> Promise {
        assert_one_yocto(); enough_gas(); let mut l = load_loan(&token_id, nonce);
        require!(!l.policy_busy && (l.state == LoanState::Offered || l.state == LoanState::Freezing), "cannot cancel pending/funded loan");
        require!(env::predecessor_account_id() == l.borrower || env::block_timestamp() > l.terms.funding_deadline_ns.0, "only borrower before expiry");
        l.state = LoanState::UnlockPending; l.resolution = Some("canceled".into()); loans().insert(&token_id, &l);
        self.start_policy_action(token_id, false)
    }

    #[payable]
    pub fn claim_default(&mut self, token_id: TokenId, nonce: U64, receiver_id: AccountId) -> Promise {
        assert_one_yocto(); enough_gas(); let mut l = load_loan(&token_id, nonce);
        require!(env::predecessor_account_id() == l.terms.lender, "only lender");
        require!(l.state == LoanState::Active && !l.policy_busy, "loan not active");
        require!(env::block_timestamp() > l.due_ns.0.checked_add(l.terms.grace_sec.0 * SECOND).unwrap_or_else(||env::panic_str("grace overflow")), "default not due");
        require!(receiver_id != l.borrower && receiver_id != env::current_account_id(), "distinct external receiver required");
        self.assert_no_key(&receiver_id);
        require!(self.pending_ops(&token_id) == 0 && transfer_calls().get(&token_id).is_none(), "control busy");
        require!(self.tokens.owner_by_id.get(&token_id).as_ref() == Some(&l.borrower), "collateral title changed");
        // Special seizure path has validated exact active loan and receiver BEFORE title or loan mutation.
        self.transfer_key_unlocked(&token_id, &receiver_id, None, Some("loan default"));
        l.state = LoanState::UnlockPending; l.resolution = Some("default_claimed".into()); loans().insert(&token_id, &l);
        self.start_policy_action(token_id, false)
    }

    #[payable]
    pub fn claim_payout(&mut self) -> Promise {
        assert_one_yocto();
        let who=env::predecessor_account_id();let mut ledger=credit_ledgers().get(&who).unwrap_or_default();require!(ledger.pending.is_none(),"payout already pending");
        let amount=ledger.available;require!(amount>0,"no payout credit");
        let nonce = if let Some(mut c) = pledge_config() {
            c.next_payout_nonce = U64(c.next_payout_nonce.0.checked_add(1).expect("payout nonce overflow"));
            save_config(&c); c.next_payout_nonce
        } else {
            let n = pre_nonce().checked_add(1).expect("payout nonce overflow");
            env::storage_write(PRE_CREDIT_NONCE, &n.to_le_bytes()); U64(n)
        };
        let p = PendingPayout { nonce, amount: U128(amount) };
        ledger.available=0;ledger.pending=Some(p.clone());save_credit(&who,&ledger);
        Promise::new(who.clone()).transfer(yocto(amount))
            .then(callback("on_payout", near_sdk::serde_json::json!({"account_id": who, "nonce": p.nonce}), 30))
    }

    #[private]
    pub fn on_payout(&mut self, account_id: AccountId, nonce: U64) -> bool {
        private_callback(); callback_failure_fixture(); self.settle_payout(account_id, nonce, promise_succeeded())
    }

    /// Explicit new operational capital. Old balance/user bonds never reclassified; future self-royalties are tracked separately.
    #[payable]
    pub fn fund_treasury(&mut self) {
        let mut c = config_required(); let amount = env::attached_deposit().as_yoctonear(); require!(amount > 0, "zero treasury funding");
        c.treasury_available = U128(c.treasury_available.0.checked_add(amount).unwrap_or_else(||env::panic_str("treasury overflow"))); save_config(&c);
        emit_key_event("treasury_credit", near_sdk::serde_json::json!({"kind":"explicit_funding","from":env::predecessor_account_id(),"amount":U128(amount)}));
    }

    pub fn treasury_recoverable(&self) -> U128 {
        let c = config_required();
        let storage = env::storage_byte_cost().as_yoctonear().checked_mul(env::storage_usage() as u128).unwrap_or_else(||env::panic_str("storage reserve overflow"));
        let legacy_listings = (index_count() as u128).checked_mul(LIST_STORAGE_DEPOSIT).unwrap_or_else(||env::panic_str("listing reserve overflow"));
        let reserve = storage.checked_add(OPERATING_RESERVE).and_then(|v| v.checked_add(legacy_listings))
            .and_then(|v| v.checked_add(c.user_liabilities.0)).and_then(|v| v.checked_add(c.treasury_pending.as_ref().map(|p| p.amount.0).unwrap_or(0))).unwrap_or_else(||env::panic_str("reserve overflow"));
        U128(c.treasury_available.0.min(env::account_balance().as_yoctonear().saturating_sub(reserve)))
    }

    #[payable]
    pub fn recover_treasury(&mut self, amount: U128) -> Promise {
        assert_one_yocto(); let mut c = config_required();
        require!(env::predecessor_account_id() == c.recovery_account, "only fixed recovery account");
        require!(env::block_timestamp() >= c.recovery_unlock_ns.0, "treasury recovery timelocked");
        require!(c.treasury_pending.is_none(), "treasury recovery pending");
        require!(amount.0 > 0 && amount.0 <= self.treasury_recoverable().0, "amount exceeds attributed free treasury");
        c.next_payout_nonce = U64(c.next_payout_nonce.0.checked_add(1).unwrap_or_else(||env::panic_str("payout nonce overflow")));
        let p = PendingPayout { nonce: c.next_payout_nonce, amount };
        c.treasury_available = U128(c.treasury_available.0 - amount.0); c.treasury_pending = Some(p.clone()); save_config(&c);
        // Destination cannot be supplied or changed. No upgrade, DeleteAccount, custody signing or NFT operation.
        Promise::new(c.recovery_account).transfer(yocto(amount.0))
            .then(callback("on_treasury_recovered", near_sdk::serde_json::json!({"nonce": p.nonce}), 30))
    }

    #[private]
    pub fn on_treasury_recovered(&mut self, nonce: U64) -> bool {
        private_callback(); callback_failure_fixture(); self.settle_treasury(nonce, promise_succeeded())
    }
    /// Signerless restoration of EXPLICITLY PROVISIONAL title only. Not receipt evidence.
    pub fn restore_expired_transfer(&mut self,token_id:TokenId,epoch:U64)->bool{
        let p=transfer_calls().get(&token_id).unwrap_or_else(||env::panic_str("no provisional transfer"));
        require!(p.epoch==epoch&&env::block_timestamp()>=p.restore_after_ns.0,"not expired or stale epoch");
        require!(self.tokens.owner_by_id.get(&token_id).as_ref()==Some(&p.receiver),"provisional receiver changed");
        require!(loans().get(&token_id).is_none()&&self.pending_ops(&token_id)==0,"control busy");
        require!(pending_returns(&p.previous_owner)>0,"missing return reservation");
        self.settle_transfer_call(token_id,epoch,true)
    }


}

impl Contract {
    fn settle_collateral_store(&mut self, token_id: TokenId, nonce: U64, success: bool) -> PromiseOrValue<bool> {
        let Some(mut r) = registrations().get(&token_id) else { return PromiseOrValue::Value(false); };
        if r.nonce != nonce || r.store_succeeded.is_some() { return PromiseOrValue::Value(false); }
        let mut c = config_required(); r.store_succeeded = Some(success);
        if success { change_liabilities(&mut c, 0, r.forwarded.0); }
        else { add_credit(&r.payer, r.forwarded.0); }
        registrations().insert(&token_id, &r); save_config(&c);
        PromiseOrValue::Promise(self.check_collateral(token_id))
    }
    fn settle_policy_action(&mut self, token_id: TokenId, nonce: U64, sequence: U64) -> PromiseOrValue<bool> {
        let Some(mut l) = loans().get(&token_id) else { return PromiseOrValue::Value(false); };
        if l.nonce != nonce || l.policy_sequence != sequence || !l.policy_busy { return PromiseOrValue::Value(false); }
        // A failed action may mean it was already frozen/thawed. Its receipt is now terminal; verify exact state.
        l.policy_call_complete = true; loans().insert(&token_id, &l);
        PromiseOrValue::Promise(self.read_loan_policy(token_id, l))
    }
    fn settle_payout(&mut self,account_id:AccountId,nonce:U64,success:bool)->bool{
        let Some(mut l)=credit_ledgers().get(&account_id) else{return false;};
        let Some(p)=l.pending.as_ref() else{return false;};if p.nonce!=nonce{return false;}
        let amount=p.amount.0;l.pending=None;
        if success{
            if let Some(mut c)=pledge_config(){change_liabilities(&mut c,0,amount);save_config(&c);}
            else {env::storage_write(PRE_CREDIT_TOTAL,&pre_total().checked_sub(amount).expect("liability underflow").to_le_bytes());}
        }
        else{l.available=l.available.checked_add(amount).unwrap_or_else(||env::panic_str("credit overflow"));}
        save_credit(&account_id,&l);success
    }
    fn settle_treasury(&mut self, nonce: U64, success: bool) -> bool {
        let mut c = config_required(); let Some(p) = c.treasury_pending.clone() else { return false; };
        if p.nonce != nonce { return false; }
        c.treasury_pending = None;
        if !success { c.treasury_available = U128(c.treasury_available.0.checked_add(p.amount.0).unwrap_or_else(||env::panic_str("treasury overflow"))); }
        save_config(&c); success
    }
}

#[cfg(test)]
#[path = "pledge_tests.rs"]
mod tests;
