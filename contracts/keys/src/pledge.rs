//! Sealed collateral, asynchronous native settlement and immutable treasury-only recovery.
//! New data uses isolated prefixes; the deployed v2.4 Contract layout is untouched.
use crate::*;
use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::Gas;
#[cfg(test)] use near_sdk::PromiseResult;

pub const RECOVERY_UNLOCK_NS: u64 = 1_796_169_600_000_000_000;
/// 900-byte budget: maximum-ID runtime lifecycle peak 750 bytes + 150 bytes (20%).
/// Refundable liability; code storage/registration/operating capital are separate.
pub const LOAN_STORAGE_DEPOSIT: u128 = 9_000_000_000_000_000_000_000;
pub const COLLATERAL_STORAGE_DEPOSIT: u128 = 20_000_000_000_000_000_000_000;
/// Non-refundable prepaid budget per permanent payout account. Covers the maximum
/// 151-byte ledger (including pending payout) plus <=130 bytes of fixed pre-migration metadata.
pub const PAYOUT_STORAGE_BYTES: u64 = 320;
pub const OPERATING_RESERVE: u128 = 100_000_000_000_000_000_000_000;
pub const COLLATERAL_ASSET: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
pub const CERTIFICATE_DOMAIN: &str = "KEYHOLE_SEALED_LOAN_V3_DELIVERY";
/// Provisional title only: no economic finality before local resolver acceptance.
pub const TRANSFER_RESTORE_DELAY_NS:u64=300_000_000_000;
pub const CERTIFICATE_MAX_AGE_NS: u64 = 60_000_000_000;
/// G1: after funding, the borrower has this long to start the native cashout. Then the named lender may reclaim the principal.
/// Release builds keep 24 h. `sandbox-short-delay` is refused by `contracts/keys/build.sh`.
#[cfg(not(feature = "sandbox-short-delay"))]
pub const DISBURSEMENT_WINDOW_NS: u64 = 86_400_000_000_000;
#[cfg(feature = "sandbox-short-delay")]
pub const DISBURSEMENT_WINDOW_NS: u64 = 30_000_000_000;
#[cfg(not(feature = "sandbox-short-delay"))]
const _: () = assert!(DISBURSEMENT_WINDOW_NS == 86_400_000_000_000);
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
// Empty slots deliberately persist: their storage was paid at registration and remains
// funded even after a delivered native payout whose callback is lost. Never allocate on credit.
fn save_credit(who:&AccountId,l:&CreditLedger){credit_ledgers().insert(who,l);}
pub(crate) fn require_payout_account(who: &AccountId) {
    require!(credit_ledgers().get(who).is_some(), "register payout account storage first");
}


/// Isolated prefix: no deployed Loan/CreditLedger/PendingPayout layout change.
#[derive(Clone, Debug)]
#[near(serializers = [borsh, json])]
pub struct PrincipalDelivery {
    pub token_id: TokenId, pub loan_nonce: U64, pub principal: U128,
    pub payout_nonce: Option<U64>,
}
fn principal_dispatches() -> LookupMap<TokenId, U64> { LookupMap::new(b"Pd".as_slice()) }
/// v2.7 storage (prefixes "Q27d", "Q27o" and raw "Q27/treasury_outcome"; none overlaps an earlier key).
/// Disbursement deadline per token, set by fund_loan and removed on activation or reclaim. Absent = not reclaimable.
fn disbursement_deadlines() -> LookupMap<TokenId, U64> { LookupMap::new(b"Q27d".as_slice()) }
/// Native payout result recorded by the callback (G2). Present only while the result could not be applied.
fn payout_outcomes() -> LookupMap<AccountId, NativeOutcome> { LookupMap::new(b"Q27o".as_slice()) }
const TREASURY_OUTCOME_KEY: &[u8] = b"Q27/treasury_outcome";
#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh])]
pub struct NativeOutcome { pub nonce: u64, pub success: bool }
/// L1: principal cap by tier, in yoctoNEAR. Bronze 0.05 NEAR, Silver 0.5 NEAR, Gold 5 NEAR. Unknown tier = 0 (no loan).
pub fn tier_loan_cap(tier: u8) -> u128 {
    match tier { 1 => 5 * 10u128.pow(22), 2 => 5 * 10u128.pow(23), 3 => 5 * 10u128.pow(24), _ => 0 }
}


#[derive(Clone, Debug)]
#[near(serializers = [borsh, json])]
pub struct PendingRegistration {
    pub nonce: U64, pub payer: AccountId, pub forwarded: U128, pub store_succeeded: Option<bool>,
}
pub(crate) fn registrations() -> LookupMap<TokenId, PendingRegistration> { LookupMap::new(b"Pr".as_slice()) }
fn registration_terminals()->LookupMap<TokenId,U64>{LookupMap::new(b"Pr26t".as_slice())}
pub(crate) fn registration_busy(token:&TokenId)->bool{registrations().get(token).is_some_and(|r|registration_terminals().get(token)!=Some(r.nonce))}
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
    /// Monotonic LOCAL command sequence; the provider does not implement generation fencing.
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
// Append only: preserve historical Borsh discriminants.
pub enum LoanState { Freezing, Offered, Active, UnlockPending, DisbursementPending }

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

/// Public economic limits; clients read the contract rather than guessing deposits.
#[derive(Clone, Debug)]
#[near(serializers = [json])]
pub struct LoanLimits {
    pub storage_bond: U128, pub collateral_binding_deposit: U128,
    pub min_duration_sec: U64, pub max_duration_sec: U64, pub max_grace_sec: U64,
    pub certificate_max_age_ns: U64,
    pub activation: String,
}
/// Public lender projection: no exact balance, history, private nonce or session.
#[derive(Clone, Debug)]
#[near(serializers = [json])]
pub struct LenderOffer {
    pub loan: Loan, pub asset: String, pub decimals: u8,
    pub lender_has_no_key: bool, pub lender_has_no_return_reservation: bool,
    pub lending_enabled: bool, pub owner_current: bool, pub funding_open: bool,
    pub certificate_required: bool,
}

#[derive(near_sdk::serde::Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub(crate) struct PolicyView { pub(crate) owner: AccountId, pub(crate) encrypted_data: String, pub(crate) frozen: bool, pub(crate) version: u64, pub(crate) locked: bool }

pub(crate) fn callback_failure_fixture() {
    #[cfg(feature = "callback-failure-fixture")]
    env::panic_str("TEST FIXTURE: injected callback failure");
}
fn private_callback() { require!(env::predecessor_account_id() == env::current_account_id(), "callback is private"); }
fn promise_succeeded() -> bool { result_success() }
pub(crate) fn policy_result() -> Option<PolicyView> {
    bounded_result(32_768).and_then(|v| near_sdk::serde_json::from_slice(&v).ok())
}
fn policy_matches(p: &PolicyView, b: &CollateralBinding) -> bool {
    p.owner == env::current_account_id() && p.locked && p.version == b.policy_version.0
        && env::sha256(p.encrypted_data.as_bytes()) == b.encrypted_policy_hash.0
}
fn call(target: AccountId, method: &str, args: String, deposit: u128, gas: u64) -> Promise {
    Promise::new(target).function_call(method.into(), args.into_bytes(), yocto(deposit), Gas::from_tgas(gas))
}
fn callback(method: &str, args: String, gas: u64) -> Promise {
    call(env::current_account_id(), method, args, 0, gas)
}
fn enough_gas() { require!(env::prepaid_gas() >= Gas::from_tgas(180), "attach at least 180 Tgas"); }
pub(crate) fn add_credit(who:&AccountId,amount:u128){if amount>0{let mut l=credit_ledgers().get(who).unwrap_or_else(||env::panic_str("register payout account storage first"));l.available=l.available.checked_add(amount).unwrap_or_else(||env::panic_str("credit overflow"));save_credit(who,&l);}}
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
    emit_key_event("treasury_credit", json_object!({"kind":"sale_royalty","amount":U128(amount)}));
    true
}
fn require_lending(c: &PledgeConfig) { require!(c.lending_enabled, "lending disabled: confinement rollout required"); }

/// Applies a native payout result to the ledger and to liabilities. Every check runs before the first write:
/// Err means nothing was written, so the pending marker and any recorded outcome stay for reconcile_payout.
fn apply_payout_outcome(account: &AccountId, nonce: U64, success: bool) -> Result<(), &'static str> {
    let mut ledger = credit_ledgers().get(account).ok_or("no payout account")?;
    let p = ledger.pending.clone().ok_or("no pending payout")?;
    if p.nonce != nonce { return Err("nonce mismatch"); }
    let amount = p.amount.0;
    let config = pledge_config();
    let next_config = match (&config, success) {
        (Some(c), true) => {
            let mut next = c.clone();
            next.user_liabilities = U128(c.user_liabilities.0.checked_sub(amount).ok_or("liability underflow")?);
            Some(next)
        }
        _ => None,
    };
    let next_pre_total = if success && config.is_none() { Some(pre_total().checked_sub(amount).ok_or("liability underflow")?) } else { None };
    let next_available = if success { ledger.available } else { ledger.available.checked_add(amount).ok_or("credit overflow")? };
    if let Some(next) = next_config { save_config(&next); }
    if let Some(total) = next_pre_total { env::storage_write(PRE_CREDIT_TOTAL, &total.to_le_bytes()); }
    ledger.pending = None;
    ledger.available = next_available;
    save_credit(account, &ledger);
    Ok(())
}

/// Applies a native treasury-recovery result. Same rule: all checks before the first write.
fn apply_treasury_outcome(nonce: U64, success: bool) -> Result<(), &'static str> {
    let mut c = pledge_config().ok_or("pledge config missing")?;
    let p = c.treasury_pending.clone().ok_or("no pending treasury recovery")?;
    if p.nonce != nonce { return Err("nonce mismatch"); }
    let restored = if success { None } else { Some(c.treasury_available.0.checked_add(p.amount.0).ok_or("treasury overflow")?) };
    c.treasury_pending = None;
    if let Some(v) = restored { c.treasury_available = U128(v); }
    save_config(&c);
    Ok(())
}
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

    /// Explicit, non-refundable storage purchase; not a NEP-145 refundable bond.
    /// Anyone may sponsor an account. No native refund/credit is created from this fee.
    #[payable]
    pub fn register_payout_account(&mut self, account_id: Option<AccountId>) -> bool {
        let who = account_id.unwrap_or_else(env::predecessor_account_id);
        require!(credit_ledgers().get(&who).is_none(), "payout account already registered");
        let cost = self.payout_storage_cost().0;
        require!(env::attached_deposit().as_yoctonear() == cost, "attach exact payout storage cost");
        let before = env::storage_usage();
        save_credit(&who, &CreditLedger::default());
        // Borsh Option<PendingPayout> may later grow by exactly 24 bytes. Fixed raw
        // aggregate+nonce keys add at most 130 bytes once, not once per account.
        require!(env::storage_usage().saturating_sub(before) + 24 + 130 <= PAYOUT_STORAGE_BYTES,
            "payout storage budget insufficient");
        emit_key_event("payout_storage_register", json_object!({"account_id":who,"paid":U128(cost),"budget_bytes":PAYOUT_STORAGE_BYTES}));
        true
    }
    pub fn payout_storage_cost(&self) -> U128 { U128(env::storage_byte_cost().as_yoctonear() * PAYOUT_STORAGE_BYTES as u128) }
    pub fn payout_account_registered(&self, account_id: AccountId) -> bool { credit_ledgers().get(&account_id).is_some() }

    pub fn get_pledge_config(&self) -> Option<PledgeConfig> { pledge_config() }
    pub fn get_loan(&self, token_id: TokenId) -> Option<Loan> { loans().get(&token_id) }
    pub fn get_collateral_binding(&self, token_id: TokenId) -> Option<CollateralBinding> { collateral().get(&token_id) }
    pub fn get_payout_credit(&self, account_id: AccountId) -> U128 { U128(credit_ledgers().get(&account_id).map(|l|l.available).unwrap_or(0)) }
    pub fn get_principal_delivery(&self, account_id: AccountId) -> Option<PrincipalDelivery> {
        let ids=self.tokens.tokens_per_owner.as_ref()?.get(&account_id)?;
        if ids.len()!=1 { return None; }
        let token=ids.iter().next()?;let loan=loans().get(&token)?;
        if loan.borrower!=account_id || loan.state!=LoanState::DisbursementPending { return None; }
        Some(PrincipalDelivery { token_id:token.clone(), loan_nonce:loan.nonce, principal:loan.terms.principal, payout_nonce:principal_dispatches().get(&token) })
    }
    pub fn get_pending_payout(&self, account_id: AccountId) -> Option<PendingPayout> { credit_ledgers().get(&account_id).and_then(|l|l.pending) }
    pub fn get_value_op(&self, token_id: TokenId, op_id: String) -> Option<ValueOp> { value_ops().get(&value_op_key(&token_id, &op_id)).filter(|op| op.op_id == op_id) }

    pub fn get_loan_limits(&self) -> LoanLimits {
        LoanLimits { storage_bond: U128(LOAN_STORAGE_DEPOSIT), collateral_binding_deposit: U128(COLLATERAL_STORAGE_DEPOSIT),
            min_duration_sec: U64(1), max_duration_sec: U64(MAX_DURATION), max_grace_sec: U64(7 * 86_400),
            certificate_max_age_ns: U64(CERTIFICATE_MAX_AGE_NS), activation: "successful_native_principal_cashout_callback".into() }
    }

    /// Snapshot only. fund_loan repeats checks and verifies a fresh signed certificate.
    pub fn get_lender_offer(&self, token_id: TokenId) -> Option<LenderOffer> {
        let l = loans().get(&token_id)?;
        let lender_has_no_key = self.tokens.tokens_per_owner.as_ref().and_then(|m|m.get(&l.terms.lender)).map(|s|s.is_empty()).unwrap_or(true);
        let lender_has_no_return_reservation = pending_returns(&l.terms.lender) == 0;
        let owner_current = self.tokens.owner_by_id.get(&token_id).as_ref() == Some(&l.borrower)
            && self.nft_settlement_epoch(token_id.clone()) == l.owner_epoch;
        let lending_enabled = config_required().lending_enabled;
        let funding_open = lending_enabled && owner_current && lender_has_no_key && lender_has_no_return_reservation
            && l.state == LoanState::Offered && !l.policy_busy && env::block_timestamp() <= l.terms.funding_deadline_ns.0
            && self.pending_ops(&token_id) == 0 && transfer_calls().get(&token_id).is_none();
        Some(LenderOffer { loan:l, asset:COLLATERAL_ASSET.into(), decimals:6, lender_has_no_key,
            lender_has_no_return_reservation, lending_enabled, owner_current, funding_open, certificate_required:true })
    }

    #[payable]
    pub fn set_lending_enabled(&mut self, enabled: bool) {
        assert_one_yocto(); self.assert_owner();
        let mut c = config_required(); c.lending_enabled = enabled; save_config(&c);
        emit_key_event("lending_toggle", json_object!({"enabled": enabled}));
    }

    /// Install a wallet-signed locked policy under this contract's controller identity, once per token/wallet.
    /// Payload/ABI follows OutLayer contract/src/wallet.rs store_wallet_policy:v2. No live call is made by tests.
    #[payable]
    /// v2.7 note: `version` and `valid_until` stay u64 on purpose. The worker sends them as JSON numbers
    /// (tee/worker/src/collateral_host.rs), and U64 would be a string and break that call. expected_owner_epoch is already U64.
    pub fn register_collateral(&mut self, token_id: TokenId, wallet_pubkey: String, encrypted_data: String,
        wallet_signature: String, version: u64, valid_until: u64, expected_owner_id: AccountId, expected_owner_epoch: U64) -> Promise {
        enough_gas(); self.assert_minter(); crate::v27::assert_not_wound_down(); self.assert_can_change_owner(&token_id);
        require_payout_account(&env::predecessor_account_id());
        let mut c = config_required();
        require!(self.tokens.owner_by_id.get(&token_id).as_ref() == Some(&expected_owner_id), "collateral owner CAS mismatch");
        require!(self.nft_settlement_epoch(token_id.clone()) == expected_owner_epoch, "collateral epoch CAS mismatch");
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
            collateral().remove(&token_id); bound_wallets().remove(&wallet_pubkey); registrations().remove(&token_id); registration_terminals().remove(&token_id);
        }
        require!(bound_wallets().get(&wallet_pubkey).is_none(), "wallet already bound");
        let b = CollateralBinding { wallet_pubkey: wallet_pubkey.clone(), encrypted_policy_hash: Base64VecU8(env::sha256(encrypted_data.as_bytes())), policy_version: U64(version), ready: false, policy_generation:U64(0) };
        collateral().insert(&token_id, &b); bound_wallets().insert(&wallet_pubkey, &token_id);
        c.next_payout_nonce = U64(c.next_payout_nonce.0.checked_add(1).unwrap_or_else(||env::panic_str("registration nonce overflow")));
        let nonce = c.next_payout_nonce;
        registrations().insert(&token_id, &PendingRegistration { nonce, payer: env::predecessor_account_id(), forwarded: U128(dep - COLLATERAL_STORAGE_DEPOSIT), store_succeeded: None });
        change_liabilities(&mut c, dep, 0); save_config(&c);
        call(c.custody_contract, "store_wallet_policy", json_object!({
            "wallet_pubkey": wallet_pubkey, "encrypted_data": encrypted_data, "wallet_signature": wallet_signature,
            "version": version, "locked": true, "valid_until": valid_until, "storage_refund_to": self.minter,
        }), dep - COLLATERAL_STORAGE_DEPOSIT, 35)
            .then(callback("on_collateral_stored", json_object!({"token_id": token_id, "nonce": nonce}), 65))
    }

    #[private]
    pub fn on_collateral_stored(&mut self, token_id: TokenId, nonce: U64) -> PromiseOrValue<bool> {
        private_callback(); callback_failure_fixture(); self.settle_collateral_store(token_id, nonce, promise_succeeded())
    }
    pub fn get_pending_registration(&self, token_id: TokenId) -> Option<PendingRegistration> { registrations().get(&token_id) }

    pub fn check_collateral(&self, token_id: TokenId) -> Promise {
        let c = config_required(); let b = collateral().get(&token_id).unwrap_or_else(||env::panic_str("unbound collateral"));
        let nonce = registrations().get(&token_id).map(|r| r.nonce).unwrap_or(U64(0));
        call(c.custody_contract, "get_wallet_policy", json_object!({"wallet_pubkey": b.wallet_pubkey}), 0, 15)
            .then(callback("on_collateral_checked", json_object!({"token_id": token_id, "nonce": nonce}), 30))
    }

    #[private]
    pub fn on_collateral_checked(&mut self, token_id: TokenId, nonce: U64) -> bool {
        private_callback();
        let Some(r) = registrations().get(&token_id) else { return false; };
        if r.nonce != nonce { return false; }
        if r.store_succeeded.is_none() { return false; }
        registration_terminals().insert(&token_id,&nonce);
        let Some(mut b) = collateral().get(&token_id) else { return false; };
        let Some(v) = bounded_result(32_768) else { return false; };
        let Ok(policy) = near_sdk::serde_json::from_slice::<Option<PolicyView>>(&v) else { return false; };
        let mut c = config_required();
        // Terminal marker is nonce-scoped; stale callbacks cannot unlock a new install.
        if policy.as_ref().is_some_and(|p| policy_matches(p, &b)) {
            b.ready = true; collateral().insert(&token_id, &b); registrations().remove(&token_id); registration_terminals().remove(&token_id);
            change_liabilities(&mut c, 0, COLLATERAL_STORAGE_DEPOSIT); save_config(&c);
            emit_key_event("collateral_ready", json_object!({"token_id": token_id, "wallet_pubkey": b.wallet_pubkey}));
            return true;
        }
        if policy.is_none() && r.store_succeeded == Some(false) {
            // Both original provider receipt and authoritative absence are known. No unknown action can rebind later.
            collateral().remove(&token_id); bound_wallets().remove(&b.wallet_pubkey); registrations().remove(&token_id); registration_terminals().remove(&token_id);
            add_credit(&r.payer, COLLATERAL_STORAGE_DEPOSIT); // forwarded amount was already restored exactly once
        }
        false
    }

    pub fn collateral_registration_protocol(&self) -> u32 { 2 }

    pub(crate) fn assert_token_idle(&self, token_id: &TokenId) {
        require!(!registration_busy(token_id), "collateral provisioning pending: token locked");
        require!(sale::sales().get(token_id).is_none(), "protected sale pending: token locked");
        require!(loans().get(token_id).is_none(), "pledged: ownership and value operations locked");
        require!(transfer_calls().get(token_id).is_none(), "transfer-call pending: token locked");
    }

    /// Borrower-declared immutable floor/terms; lower custody must be frozen before Offered.
    #[payable]
    pub fn open_loan(&mut self, token_id: TokenId, terms: LoanTerms) -> Promise {
        enough_gas(); crate::v27::assert_not_wound_down(); let mut c = config_required(); require_lending(&c);
        self.assert_can_change_owner(&token_id);
        let borrower = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(||env::panic_str("unknown token"));
        require!(env::predecessor_account_id() == borrower, "only borrower");
        require_payout_account(&borrower);
        require!(listings().get(&token_id).is_none(), "unlist first");
        require!(collateral().get(&token_id).is_some_and(|b| b.ready), "collateral confinement not ready");
        require!(env::attached_deposit().as_yoctonear() == LOAN_STORAGE_DEPOSIT, "attach exact 0.009 NEAR refundable loan bond");
        require!(terms.lender != borrower && terms.lender != env::current_account_id(), "distinct external lender required");
        require!(terms.principal.0 > 0 && terms.principal.0 <= MAX_LIST_PRICE, "bad principal");
        // L1: the tier of the key sets the borrow cap (Bronze 0.05, Silver 0.5, Gold 5 NEAR).
        require!(terms.principal.0 <= self.tiers.get(&token_id).map(tier_loan_cap).unwrap_or(0), "principal above this key's tier cap (Bronze 0.05, Silver 0.5, Gold 5 NEAR)");
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
        // Reserve the G1 deadline key while the bond is measured. fund_loan overwrites the same key.
        disbursement_deadlines().insert(&token_id, &U64(0));
        let storage_cost=env::storage_usage().saturating_sub(storage_before) as u128*env::storage_byte_cost().as_yoctonear();
        require!(storage_cost<=LOAN_STORAGE_DEPOSIT,"loan bond does not cover storage");
        emit_key_event("loan_open", json_object!({"token_id": token_id, "nonce": l.nonce}));
        self.start_policy_action(token_id, true)
    }

    fn start_policy_action(&mut self, token:TokenId,freeze:bool)->Promise {
        let c=config_required();let mut l=loans().get(&token).unwrap_or_else(||env::panic_str("no loan"));
        require!((freeze&&l.state==LoanState::Freezing)||(!freeze&&l.state==LoanState::UnlockPending),"wrong custody transition");
        let mut b=collateral().get(&token).unwrap_or_else(||env::panic_str("unbound collateral"));
        // The upstream provider has no generation/idempotency fence. Never redispatch
        // an unknown command, even in the same direction. Persist BEFORE dispatch;
        // a lost action callback keeps this lock until reviewed incident repair.
        require!(!l.policy_busy, "custody command UNKNOWN/pending: do not redispatch");
        b.policy_generation=U64(b.policy_generation.0.checked_add(1).unwrap_or_else(||env::panic_str("policy sequence overflow")));
        collateral().insert(&token,&b);l.policy_sequence=b.policy_generation;
        l.policy_busy=true;l.policy_call_complete=false;loans().insert(&token,&l);
        call(c.custody_contract,if freeze {"freeze_wallet"} else {"unfreeze_wallet"},json_object!({"wallet_pubkey":b.wallet_pubkey}),0,20)
            .then(callback("on_policy_action",json_object!({"token_id":token,"nonce":l.nonce,"sequence":l.policy_sequence}),65))
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
        require!(l.policy_busy && l.policy_call_complete, "custody command UNKNOWN: exact terminal callback required");
        self.read_loan_policy(token_id, l)
    }
    fn read_loan_policy(&self, token: TokenId, l: Loan) -> Promise {
        let c = config_required(); let b = collateral().get(&token).unwrap_or_else(||env::panic_str("unbound collateral"));
        call(c.custody_contract, "get_wallet_policy", json_object!({"wallet_pubkey": b.wallet_pubkey}), 0, 15)
            .then(callback("on_loan_policy", json_object!({"token_id": token, "nonce": l.nonce, "sequence": l.policy_sequence}), 30))
    }

    #[private]
    pub fn on_loan_policy(&mut self, token_id: TokenId, nonce: U64, sequence: U64) -> bool {
        private_callback();
        let Some(mut l) = loans().get(&token_id) else { return false; };
        if l.nonce != nonce || l.policy_sequence != sequence || !l.policy_busy || !l.policy_call_complete { return false; }
        let Some(b) = collateral().get(&token_id) else { return false; };
        let Some(p) = policy_result() else { return false; };
        if !policy_matches(&p, &b) { return false; }
        l.policy_busy = false; l.policy_call_complete = false;
        if l.state == LoanState::Freezing && p.frozen { l.state = LoanState::Offered; }
        if l.state == LoanState::UnlockPending && !p.frozen {
            // Loan bond remains a user liability until a successful pull payout; no treasury attribution.
            add_credit(&l.borrower, l.storage_bond.0); loans().remove(&token_id); disbursement_deadlines().remove(&token_id);
            emit_key_event("loan_closed", json_object!({"token_id": token_id, "nonce": nonce, "resolution": l.resolution}));
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
        enough_gas(); crate::v27::assert_not_wound_down(); let mut c = config_required(); require_lending(&c);
        let mut l = load_loan(&token_id, nonce);
        require!(l.state == LoanState::Offered && !l.policy_busy, "loan not fundable");
        require!(env::predecessor_account_id() == l.terms.lender, "only named lender");
        require_payout_account(&l.terms.lender);
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
        // Funding locks lender principal as a backed borrower credit, but does NOT start debt.
        // Only the exact native cashout's genuine success callback activates the clock.
        require!(self.tokens.tokens_per_owner.as_ref().and_then(|m|m.get(&l.borrower)).is_some_and(|ids|ids.len()==1), "borrower must own exactly one key");
        require!(principal_dispatches().get(&token_id).is_none(), "principal dispatch already pending");
        add_credit(&l.borrower,l.terms.principal.0);
        change_liabilities(&mut c,l.terms.principal.0,0);save_config(&c);
        l.state=LoanState::DisbursementPending;l.due_ns=U64(0);
        // G1: the named lender can take the principal back after this deadline if no cashout has started.
        let deadline=env::block_timestamp().checked_add(DISBURSEMENT_WINDOW_NS).unwrap_or_else(||env::panic_str("time overflow"));
        disbursement_deadlines().insert(&token_id,&U64(deadline));
        loans().insert(&token_id,&l);
        emit_key_event("loan_fund",json_object!({"token_id":token_id,"nonce":l.nonce,"lender":l.terms.lender,"principal":l.terms.principal,"disbursement_deadline_ns":U64(deadline)}));
        true
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
        emit_key_event("loan_repay", json_object!({"token_id": token_id, "nonce": l.nonce, "repayment": l.terms.repayment}));
        self.start_policy_action(token_id, false)
    }

    #[payable]
    pub fn cancel_loan(&mut self, token_id: TokenId, nonce: U64) -> Promise {
        assert_one_yocto(); enough_gas(); let mut l = load_loan(&token_id, nonce);
        require!(!l.policy_busy && (l.state == LoanState::Offered || l.state == LoanState::Freezing), "cannot cancel pending/funded loan");
        require!(env::predecessor_account_id() == l.borrower || env::block_timestamp() > l.terms.funding_deadline_ns.0, "only borrower before expiry");
        l.state = LoanState::UnlockPending; l.resolution = Some("canceled".into()); loans().insert(&token_id, &l);
        emit_key_event("loan_cancel", json_object!({"token_id": token_id, "nonce": l.nonce}));
        self.start_policy_action(token_id, false)
    }

    /// Executes only the borrower-signed loan terms fixed at open_loan: the lender, the due time and the grace period.
    /// The caller must be the named lender, after due + grace; receiver_id only chooses where the title goes (external,
    /// holds no key). Nothing else about the loan can be changed here.
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
        emit_key_event("loan_default", json_object!({"token_id": token_id, "nonce": l.nonce, "receiver_id": receiver_id}));
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
        if let Some(delivery)=self.get_principal_delivery(who.clone()) {
            require!(delivery.payout_nonce.is_none() && amount>=delivery.principal.0, "principal delivery invariant");
            let loan=load_loan(&delivery.token_id,delivery.loan_nonce);
            require!(loan.borrower==who && loan.state==LoanState::DisbursementPending && loan.due_ns.0==0, "principal loan changed");
            principal_dispatches().insert(&delivery.token_id,&p.nonce);
        }
        ledger.available=0;ledger.pending=Some(p.clone());save_credit(&who,&ledger);
        emit_key_event("payout_claim",json_object!({"account_id":who,"amount":U128(amount),"nonce":nonce}));
        Promise::new(who.clone()).transfer(yocto(amount))
            .then(callback("on_payout", json_object!({"account_id": who, "nonce": p.nonce}), 30))
    }

    #[private]
    pub fn on_payout(&mut self, account_id: AccountId, nonce: U64) -> bool {
        private_callback(); callback_failure_fixture(); self.settle_payout(account_id, nonce, promise_succeeded())
    }

    /// L1: largest principal a key may borrow, by tier. None for an unknown token.
    pub fn loan_cap(&self, token_id: TokenId) -> Option<U128> { self.tiers.get(&token_id).map(|t| U128(tier_loan_cap(t))) }

    /// G1: the lender takes back principal the borrower never claimed. Allowed only when:
    /// the named lender calls, the loan is DisbursementPending, the 24 h window after funding has passed, no cashout is
    /// in flight (dispatch marker) and the borrower's credit still holds at least the principal.
    /// Race rule: claim_payout and this call cannot both win. A claim sets the dispatch marker and drains the credit, so this
    /// call refuses. A reclaim moves the credit away and leaves the loan UnlockPending, so claim_payout then pays only the remainder.
    /// Unlock follows the same custody path as cancel_loan.
    #[payable]
    pub fn reclaim_unclaimed_principal(&mut self, token_id: TokenId, nonce: U64) -> Promise {
        assert_one_yocto(); enough_gas();
        let mut l = load_loan(&token_id, nonce);
        require!(env::predecessor_account_id() == l.terms.lender, "only named lender");
        require!(l.state == LoanState::DisbursementPending && !l.policy_busy, "principal not in disbursement");
        let deadline = disbursement_deadlines().get(&token_id).unwrap_or_else(|| env::panic_str("no disbursement deadline recorded"));
        require!(deadline.0 > 0, "disbursement deadline not started");
        require!(env::block_timestamp() > deadline.0, "disbursement window still open");
        require!(principal_dispatches().get(&token_id).is_none(), "principal cashout in flight or unresolved");
        let principal = l.terms.principal.0;
        let mut ledger = credit_ledgers().get(&l.borrower).unwrap_or_else(|| env::panic_str("borrower payout account missing"));
        require!(ledger.available >= principal, "principal already claimed");
        ledger.available = ledger.available.checked_sub(principal).unwrap_or_else(|| env::panic_str("credit underflow"));
        save_credit(&l.borrower, &ledger);
        // Liabilities already count this principal; the credit only changes owner, so no liability change here.
        add_credit(&l.terms.lender, principal);
        disbursement_deadlines().remove(&token_id);
        l.state = LoanState::UnlockPending; l.resolution = Some("unclaimed_principal_reclaimed".into()); loans().insert(&token_id, &l);
        emit_key_event("loan_reclaim", json_object!({"token_id": token_id, "nonce": nonce, "lender": l.terms.lender, "principal": U128(principal)}));
        self.start_policy_action(token_id, false)
    }

    /// G2, permissionless. Applies a native payout result that the callback RECORDED but could not apply. The outcome is
    /// the one the callback observed, never a guess. With no record (for example a callback that never ran), this returns
    /// false and the marker stays locked for review: the chain cannot recover that result.
    pub fn reconcile_payout(&mut self, account_id: AccountId) -> bool {
        let Some(o) = payout_outcomes().get(&account_id) else { return false; };
        let amount = credit_ledgers().get(&account_id).and_then(|l| l.pending).map(|p| p.amount.0).unwrap_or(0);
        match apply_payout_outcome(&account_id, U64(o.nonce), o.success) {
            Ok(()) => {
                payout_outcomes().remove(&account_id);
                self.settle_principal(&account_id, U64(o.nonce), o.success, amount);
                emit_key_event("payout_reconciled", json_object!({"account_id": account_id, "nonce": U64(o.nonce), "success": o.success}));
                o.success
            }
            Err(reason) => {
                emit_key_event("payout_reconcile_refused", json_object!({"account_id": account_id, "reason": reason}));
                false
            }
        }
    }

    /// G2, permissionless. Same rule as reconcile_payout for a recorded treasury-recovery result.
    pub fn reconcile_treasury(&mut self) -> bool {
        let Some(raw) = env::storage_read(TREASURY_OUTCOME_KEY) else { return false; };
        let o: NativeOutcome = near_sdk::borsh::from_slice(&raw).unwrap_or_else(|_| env::panic_str("treasury outcome corrupt"));
        match apply_treasury_outcome(U64(o.nonce), o.success) {
            Ok(()) => {
                env::storage_remove(TREASURY_OUTCOME_KEY);
                emit_key_event("treasury_reconciled", json_object!({"nonce": U64(o.nonce), "success": o.success}));
                o.success
            }
            Err(reason) => {
                emit_key_event("treasury_reconcile_refused", json_object!({"reason": reason}));
                false
            }
        }
    }

    /// Explicit new operational capital. Old balance/user bonds never reclassified; future self-royalties are tracked separately.
    #[payable]
    pub fn fund_treasury(&mut self) {
        let mut c = config_required(); let amount = env::attached_deposit().as_yoctonear(); require!(amount > 0, "zero treasury funding");
        c.treasury_available = U128(c.treasury_available.0.checked_add(amount).unwrap_or_else(||env::panic_str("treasury overflow"))); save_config(&c);
        emit_key_event("treasury_credit", json_object!({"kind":"explicit_funding","from":env::predecessor_account_id(),"amount":U128(amount)}));
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
        emit_key_event("treasury_recover",json_object!({"amount":amount,"nonce":p.nonce}));
        Promise::new(c.recovery_account).transfer(yocto(amount.0))
            .then(callback("on_treasury_recovered", json_object!({"nonce": p.nonce}), 30))
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
        if l.nonce != nonce || l.policy_sequence != sequence || !l.policy_busy || l.policy_call_complete { return PromiseOrValue::Value(false); }
        // A failed action may mean it was already frozen/thawed. Its receipt is now terminal; verify exact state.
        l.policy_call_complete = true; loans().insert(&token_id, &l);
        PromiseOrValue::Promise(self.read_loan_policy(token_id, l))
    }
    /// G2: runs inside a callback and never panics on a state path. The native result is recorded BEFORE any state write:
    /// if applying it fails, the pending marker and the record stay for reconcile_payout (same result, no guess).
    fn settle_payout(&mut self,account_id:AccountId,nonce:U64,success:bool)->bool{
        let Some(l)=credit_ledgers().get(&account_id) else{return false;};
        let Some(p)=l.pending.clone() else{return false;};
        if p.nonce!=nonce{return false;}
        payout_outcomes().insert(&account_id,&NativeOutcome{nonce:nonce.0,success});
        match apply_payout_outcome(&account_id,nonce,success){
            Ok(())=>{
                payout_outcomes().remove(&account_id);
                self.settle_principal(&account_id,nonce,success,p.amount.0);
                success
            }
            Err(reason)=>{
                emit_key_event("payout_apply_failed",json_object!({"account_id":account_id,"nonce":nonce,"reason":reason}));
                false
            }
        }
    }
    /// Principal activation for a payout whose nonce matches the dispatch marker. Never panics; invariant breaks are events.
    /// Success starts the loan clock exactly once. Failure removes the marker, so the same credit may be claimed again.
    /// A success whose loan state no longer matches keeps the dispatch marker: reclaim stays blocked, so nothing is paid twice.
    fn settle_principal(&mut self,account_id:&AccountId,nonce:U64,success:bool,amount:u128){
        let Some(delivery)=self.get_principal_delivery(account_id.clone()) else{return;};
        if delivery.payout_nonce!=Some(nonce){return;}
        if !success{
            principal_dispatches().remove(&delivery.token_id);
            emit_key_event("principal_cashout_failed",json_object!({"token_id":delivery.token_id,"payout_nonce":nonce}));
            return;
        }
        let Some(mut loan)=loans().get(&delivery.token_id) else{
            emit_key_event("principal_activation_refused",json_object!({"token_id":delivery.token_id,"reason":"no loan"}));return;};
        let delivered_at=env::block_timestamp();
        let due=loan.terms.duration_sec.0.checked_mul(SECOND).and_then(|d|delivered_at.checked_add(d));
        let valid=loan.nonce==delivery.loan_nonce&&loan.borrower==*account_id&&loan.state==LoanState::DisbursementPending&&loan.due_ns.0==0&&amount>=delivery.principal.0;
        let Some(due)=due.filter(|_|valid)else{
            emit_key_event("principal_activation_refused",json_object!({"token_id":delivery.token_id,"nonce":loan.nonce,"reason":"loan state or amount"}));return;};
        loan.due_ns=U64(due);
        loan.state=LoanState::Active;loans().insert(&delivery.token_id,&loan);
        principal_dispatches().remove(&delivery.token_id);
        disbursement_deadlines().remove(&delivery.token_id);
        emit_key_event("loan_principal_delivered",json_object!({"token_id":delivery.token_id,"nonce":loan.nonce,"payout_nonce":nonce,"activated_at_ns":U64(delivered_at),"due_ns":loan.due_ns}));
    }
    /// G2: never panics. Same record-then-apply rule as settle_payout.
    fn settle_treasury(&mut self, nonce: U64, success: bool) -> bool {
        let Some(c) = pledge_config() else { return false; };
        let Some(p) = c.treasury_pending.clone() else { return false; };
        if p.nonce != nonce { return false; }
        env::storage_write(TREASURY_OUTCOME_KEY,&near_sdk::borsh::to_vec(&NativeOutcome{nonce:nonce.0,success}).unwrap_or_else(|_|env::panic_str("outcome encoding")));
        match apply_treasury_outcome(nonce, success) {
            Ok(()) => { env::storage_remove(TREASURY_OUTCOME_KEY); success }
            Err(reason) => {
                emit_key_event("treasury_apply_failed", json_object!({"nonce": nonce, "reason": reason}));
                false
            }
        }
    }
}

#[cfg(test)]
#[path = "pledge_tests.rs"]
mod tests;
