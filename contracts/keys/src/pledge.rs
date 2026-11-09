//! Sealed collateral, asynchronous native settlement and immutable treasury-only recovery.
//! New data uses isolated prefixes; the deployed v2.4 Contract layout is untouched.
use crate::*;
use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{Gas, PromiseResult};

pub const RECOVERY_UNLOCK_NS: u64 = 1_796_169_600_000_000_000;
pub const LOAN_STORAGE_DEPOSIT: u128 = 50_000_000_000_000_000_000_000;
pub const COLLATERAL_STORAGE_DEPOSIT: u128 = 20_000_000_000_000_000_000_000;
pub const OPERATING_RESERVE: u128 = 100_000_000_000_000_000_000_000;
pub const COLLATERAL_ASSET: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
pub const CERTIFICATE_DOMAIN: &str = "KEYHOLE_SEALED_LOAN_V1";
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
    /// Includes loan bonds, undelivered principal, available and pending native user credits.
    pub user_liabilities: U128,
    pub treasury_pending: Option<PendingPayout>,
}

pub(crate) fn pledge_config() -> Option<PledgeConfig> {
    env::storage_read(CONFIG_KEY).map(|v| near_sdk::borsh::from_slice(&v).expect("pledge config corrupt"))
}
fn save_config(c: &PledgeConfig) {
    env::storage_write(CONFIG_KEY, &near_sdk::borsh::to_vec(c).expect("config encoding"));
}
fn config_required() -> PledgeConfig { pledge_config().expect("pledge migration required") }
pub(crate) fn transfer_calls() -> LookupMap<TokenId, (AccountId, AccountId)> { LookupMap::new(b"Pt".as_slice()) }
pub(crate) fn loans() -> LookupMap<TokenId, Loan> { LookupMap::new(b"Pl".as_slice()) }
fn collateral() -> LookupMap<TokenId, CollateralBinding> { LookupMap::new(b"Pb".as_slice()) }
fn bound_wallets() -> LookupMap<String, TokenId> { LookupMap::new(b"Pw".as_slice()) }
fn credits() -> LookupMap<AccountId, u128> { LookupMap::new(b"Pc".as_slice()) }
fn pending_payouts() -> LookupMap<AccountId, PendingPayout> { LookupMap::new(b"Pp".as_slice()) }

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
pub enum LoanState { Freezing, Offered, FundingPending, Active, UnlockPending }

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
struct PolicyView { owner: AccountId, encrypted_data: String, frozen: bool, version: u64, locked: bool }

fn private_callback() { require!(env::predecessor_account_id() == env::current_account_id(), "callback is private"); }
fn promise_succeeded() -> bool { matches!(env::promise_result(0), PromiseResult::Successful(_)) }
fn policy_result() -> Option<PolicyView> {
    match env::promise_result(0) {
        PromiseResult::Successful(v) => near_sdk::serde_json::from_slice(&v).ok(),
        _ => None,
    }
}
fn policy_matches(p: &PolicyView, b: &CollateralBinding) -> bool {
    p.owner == env::current_account_id() && p.locked && p.version == b.policy_version.0
        && env::sha256(p.encrypted_data.as_bytes()) == b.encrypted_policy_hash.0
}
fn call(target: AccountId, method: &str, args: near_sdk::serde_json::Value, deposit: u128, gas: u64) -> Promise {
    Promise::new(target).function_call(method.into(), args.to_string().into_bytes(), yocto(deposit), Gas::from_tgas(gas))
}
fn callback(method: &str, args: near_sdk::serde_json::Value, gas: u64) -> Promise {
    call(env::current_account_id(), method, args, 0, gas)
}
fn enough_gas() { require!(env::prepaid_gas() >= Gas::from_tgas(180), "attach at least 180 Tgas"); }
fn add_credit(who: &AccountId, amount: u128) {
    if amount != 0 { credits().insert(who, &credits().get(who).unwrap_or(0).checked_add(amount).expect("credit overflow")); }
}
fn change_liabilities(c: &mut PledgeConfig, add: u128, subtract: u128) {
    c.user_liabilities = U128(c.user_liabilities.0.checked_add(add).and_then(|v| v.checked_sub(subtract)).expect("liability overflow"));
}
pub(crate) fn record_sale_royalty(treasury: &AccountId, amount: u128) -> bool {
    if treasury != &env::current_account_id() { return false; }
    let Some(mut c) = pledge_config() else { return false; };
    c.treasury_available = U128(c.treasury_available.0.checked_add(amount).expect("treasury overflow"));
    save_config(&c);
    emit_key_event("treasury_credit", near_sdk::serde_json::json!({"kind":"sale_royalty","amount":U128(amount)}));
    true
}
fn require_lending(c: &PledgeConfig) { require!(c.lending_enabled, "lending disabled: confinement rollout required"); }
fn load_loan(token: &TokenId, nonce: U64) -> Loan {
    let l = loans().get(token).expect("no loan"); require!(l.nonce == nonce, "loan nonce mismatch"); l
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
        let c: Contract = env::state_read().expect("no state");
        require!(c.tokens.approvals_by_id.is_some(), "run legacy migrate first");
        save_config(&PledgeConfig {
            recovery_account, recovery_unlock_ns: U64(RECOVERY_UNLOCK_NS), attestor_public_key, custody_contract, network,
            lending_enabled: false, next_loan_nonce: U64(0), next_payout_nonce: U64(0),
            treasury_available: U128(0), user_liabilities: U128(0), treasury_pending: None,
        });
        c
    }

    pub fn get_pledge_config(&self) -> Option<PledgeConfig> { pledge_config() }
    pub fn get_loan(&self, token_id: TokenId) -> Option<Loan> { loans().get(&token_id) }
    pub fn get_collateral_binding(&self, token_id: TokenId) -> Option<CollateralBinding> { collateral().get(&token_id) }
    pub fn get_payout_credit(&self, account_id: AccountId) -> U128 { U128(credits().get(&account_id).unwrap_or(0)) }
    pub fn get_pending_payout(&self, account_id: AccountId) -> Option<PendingPayout> { pending_payouts().get(&account_id) }
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
        let c = config_required();
        require!(self.tokens.owner_by_id.get(&token_id).is_some(), "unknown token");
        require!(listings().get(&token_id).is_none(), "unlist first");
        let hex = wallet_pubkey.strip_prefix("ed25519:").expect("only Ed25519 collateral");
        require!(hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "canonical wallet key required");
        require!(collateral().get(&token_id).is_none() && bound_wallets().get(&wallet_pubkey).is_none(), "collateral already bound");
        require!(!encrypted_data.is_empty() && encrypted_data.len() <= 4096, "bad policy payload");
        require!(wallet_signature.len() == 128 && wallet_signature.bytes().all(|b| b.is_ascii_hexdigit()), "bad wallet signature");
        require!(version > 0 && valid_until >= env::block_timestamp() / SECOND, "stale policy");
        let dep = env::attached_deposit().as_yoctonear();
        require!(dep > COLLATERAL_STORAGE_DEPOSIT, "attach policy deposit plus 0.02 NEAR permanent binding storage");
        let b = CollateralBinding { wallet_pubkey: wallet_pubkey.clone(), encrypted_policy_hash: Base64VecU8(env::sha256(encrypted_data.as_bytes())), policy_version: U64(version), ready: false };
        collateral().insert(&token_id, &b); bound_wallets().insert(&wallet_pubkey, &token_id);
        call(c.custody_contract, "store_wallet_policy", near_sdk::serde_json::json!({
            "wallet_pubkey": wallet_pubkey, "encrypted_data": encrypted_data, "wallet_signature": wallet_signature,
            "version": version, "locked": true, "valid_until": valid_until, "storage_refund_to": self.minter,
        }), dep - COLLATERAL_STORAGE_DEPOSIT, 35)
            .then(callback("on_collateral_stored", near_sdk::serde_json::json!({"token_id": token_id}), 65))
    }

    #[private]
    pub fn on_collateral_stored(&mut self, token_id: TokenId) -> Promise {
        private_callback();
        // Even failure may mean a pre-existing matching policy: read, never infer state from HTTP/UI.
        self.check_collateral(token_id)
    }

    pub fn check_collateral(&self, token_id: TokenId) -> Promise {
        let c = config_required(); let b = collateral().get(&token_id).expect("unbound collateral");
        call(c.custody_contract, "get_wallet_policy", near_sdk::serde_json::json!({"wallet_pubkey": b.wallet_pubkey}), 0, 15)
            .then(callback("on_collateral_checked", near_sdk::serde_json::json!({"token_id": token_id}), 30))
    }

    #[private]
    pub fn on_collateral_checked(&mut self, token_id: TokenId) -> bool {
        private_callback();
        let Some(mut b) = collateral().get(&token_id) else { return false; };
        if let Some(p) = policy_result() {
            // Never overwrite an established ready binding from a stale callback; funding still checks signed state.
            if policy_matches(&p, &b) { b.ready = true; collateral().insert(&token_id, &b); return true; }
        }
        false
    }

    pub(crate) fn assert_token_idle(&self, token_id: &TokenId) {
        require!(loans().get(token_id).is_none(), "pledged: ownership and value operations locked");
        require!(transfer_calls().get(token_id).is_none(), "transfer-call pending: token locked");
    }

    /// Borrower-declared immutable floor/terms; lower custody must be frozen before Offered.
    #[payable]
    pub fn open_loan(&mut self, token_id: TokenId, terms: LoanTerms) -> Promise {
        enough_gas(); let mut c = config_required(); require_lending(&c);
        self.assert_can_change_owner(&token_id);
        let borrower = self.tokens.owner_by_id.get(&token_id).expect("unknown token");
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
        require!(terms.funding_deadline_ns.0 > now && terms.funding_deadline_ns.0 <= now.checked_add(7 * 86_400 * SECOND).expect("time overflow"), "bad funding deadline");
        c.next_loan_nonce = U64(c.next_loan_nonce.0.checked_add(1).expect("loan nonce overflow"));
        change_liabilities(&mut c, LOAN_STORAGE_DEPOSIT, 0); save_config(&c);
        let l = Loan { token_id: token_id.clone(), nonce: c.next_loan_nonce, borrower, owner_epoch: self.nft_settlement_epoch(token_id.clone()),
            terms, state: LoanState::Freezing, due_ns: U64(0), storage_bond: U128(LOAN_STORAGE_DEPOSIT), policy_sequence: U64(0),
            policy_busy: false, policy_call_complete: false, resolution: None };
        loans().insert(&token_id, &l);
        emit_key_event("loan_open", near_sdk::serde_json::json!({"token_id": token_id, "nonce": l.nonce}));
        self.start_policy_action(token_id, true)
    }

    fn start_policy_action(&mut self, token: TokenId, freeze: bool) -> Promise {
        let c = config_required(); let mut l = loans().get(&token).expect("no loan");
        require!(!l.policy_busy, "custody action still pending");
        require!((freeze && l.state == LoanState::Freezing) || (!freeze && l.state == LoanState::UnlockPending), "wrong custody transition");
        l.policy_busy = true; l.policy_call_complete = false;
        l.policy_sequence = U64(l.policy_sequence.0.checked_add(1).expect("policy sequence overflow"));
        loans().insert(&token, &l);
        let b = collateral().get(&token).expect("unbound collateral");
        call(c.custody_contract, if freeze { "freeze_wallet" } else { "unfreeze_wallet" }, near_sdk::serde_json::json!({"wallet_pubkey": b.wallet_pubkey}), 0, 20)
            .then(callback("on_policy_action", near_sdk::serde_json::json!({"token_id": token, "nonce": l.nonce, "sequence": l.policy_sequence}), 65))
    }

    /// Retry only after the previous provider action AND read callback have completed. No overlapping thaw/freeze.
    pub fn retry_loan_policy(&mut self, token_id: TokenId, nonce: U64) -> Promise {
        enough_gas(); let l = load_loan(&token_id, nonce);
        require!(l.state == LoanState::Freezing || l.state == LoanState::UnlockPending, "no custody transition to retry");
        self.start_policy_action(token_id, l.state == LoanState::Freezing)
    }

    #[private]
    pub fn on_policy_action(&mut self, token_id: TokenId, nonce: U64, sequence: U64) -> PromiseOrValue<bool> {
        private_callback();
        let Some(mut l) = loans().get(&token_id) else { return PromiseOrValue::Value(false); };
        if l.nonce != nonce || l.policy_sequence != sequence || !l.policy_busy { return PromiseOrValue::Value(false); }
        // A failed action may mean it was already frozen/thawed. Its receipt is now terminal; verify exact state.
        l.policy_call_complete = true; loans().insert(&token_id, &l);
        PromiseOrValue::Promise(self.read_loan_policy(token_id, l))
    }

    /// Read-only reconciliation is allowed after the provider receipt callback recorded terminal completion.
    pub fn reconcile_loan_policy(&self, token_id: TokenId, nonce: U64) -> Promise {
        let l = load_loan(&token_id, nonce);
        require!(l.policy_busy && l.policy_call_complete, "provider receipt still unknown");
        self.read_loan_policy(token_id, l)
    }
    fn read_loan_policy(&self, token: TokenId, l: Loan) -> Promise {
        let c = config_required(); let b = collateral().get(&token).expect("unbound collateral");
        call(c.custody_contract, "get_wallet_policy", near_sdk::serde_json::json!({"wallet_pubkey": b.wallet_pubkey}), 0, 15)
            .then(callback("on_loan_policy", near_sdk::serde_json::json!({"token_id": token, "nonce": l.nonce, "sequence": l.policy_sequence}), 30))
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
            add_credit(&l.borrower, l.storage_bond.0); loans().remove(&token_id);
            emit_key_event("loan_closed", near_sdk::serde_json::json!({"token_id": token_id, "nonce": nonce, "resolution": l.resolution}));
            return true;
        }
        loans().insert(&token_id, &l); true
    }

    pub fn loan_certificate_template(&self, token_id: TokenId, observed_at_ns: U64, expires_at_ns: U64) -> LoanCertificate {
        let c = config_required(); let l = loans().get(&token_id).expect("no loan"); let b = collateral().get(&token_id).expect("unbound collateral");
        LoanCertificate { domain: CERTIFICATE_DOMAIN.into(), network: c.network, contract: env::current_account_id(), token_id,
            loan_nonce: l.nonce, borrower: l.borrower, owner_epoch: l.owner_epoch, terms: l.terms, asset: COLLATERAL_ASSET.into(),
            wallet_pubkey: b.wallet_pubkey, policy_version: b.policy_version, policy_hash: b.encrypted_policy_hash,
            observed_at_ns, expires_at_ns, floor_met: true, frozen: true, pending_value_ops: U64(0) }
    }

    #[payable]
    pub fn fund_loan(&mut self, token_id: TokenId, nonce: U64, certificate: LoanCertificate, signature: Base64VecU8) -> Promise {
        enough_gas(); let mut c = config_required(); require_lending(&c);
        let mut l = load_loan(&token_id, nonce);
        require!(l.state == LoanState::Offered && !l.policy_busy, "loan not fundable");
        require!(env::predecessor_account_id() == l.terms.lender, "only named lender");
        require!(env::attached_deposit().as_yoctonear() == l.terms.principal.0, "attach exact principal");
        require!(self.tokens.owner_by_id.get(&token_id).as_ref() == Some(&l.borrower), "borrower no longer owner");
        require!(self.nft_settlement_epoch(token_id.clone()) == l.owner_epoch && self.pending_ops(&token_id) == 0 && transfer_calls().get(&token_id).is_none(), "control state changed");
        let now = env::block_timestamp();
        require!(now <= l.terms.funding_deadline_ns.0, "funding expired");
        require!(certificate.observed_at_ns.0 <= now && now < certificate.expires_at_ns.0 && certificate.expires_at_ns.0 <= certificate.observed_at_ns.0.saturating_add(CERTIFICATE_MAX_AGE_NS), "certificate expired or future observation");
        let expected = self.loan_certificate_template(token_id.clone(), certificate.observed_at_ns, certificate.expires_at_ns);
        require!(certificate == expected, "certificate not bound to this exact loan");
        let sig: [u8; 64] = signature.0.try_into().unwrap_or_else(|_| env::panic_str("bad signature length"));
        let pk: [u8; 32] = c.attestor_public_key.0.clone().try_into().expect("bad attestor key");
        require!(env::ed25519_verify(&sig, &near_sdk::borsh::to_vec(&certificate).expect("certificate encoding"), &pk), "invalid attestor signature");
        l.state = LoanState::FundingPending; loans().insert(&token_id, &l);
        change_liabilities(&mut c, l.terms.principal.0, 0); save_config(&c);
        Promise::new(l.borrower).transfer(yocto(l.terms.principal.0))
            .then(callback("on_principal_paid", near_sdk::serde_json::json!({"token_id": token_id, "nonce": nonce}), 110))
    }

    #[private]
    pub fn on_principal_paid(&mut self, token_id: TokenId, nonce: U64) -> PromiseOrValue<bool> {
        private_callback();
        let Some(mut l) = loans().get(&token_id) else { return PromiseOrValue::Value(false); };
        if l.nonce != nonce || l.state != LoanState::FundingPending { return PromiseOrValue::Value(false); }
        let mut c = config_required();
        if promise_succeeded() {
            change_liabilities(&mut c, 0, l.terms.principal.0); save_config(&c);
            l.state = LoanState::Active;
            l.due_ns = U64(env::block_timestamp().checked_add(l.terms.duration_sec.0 * SECOND).expect("due overflow"));
            loans().insert(&token_id, &l); PromiseOrValue::Value(true)
        } else {
            // Native transfer refund is backed; no debt was created for the borrower.
            add_credit(&l.terms.lender, l.terms.principal.0);
            l.state = LoanState::UnlockPending; l.resolution = Some("principal_failed".into()); loans().insert(&token_id, &l);
            PromiseOrValue::Promise(self.start_policy_action(token_id, false))
        }
    }

    #[payable]
    pub fn repay_loan(&mut self, token_id: TokenId, nonce: U64) -> Promise {
        enough_gas(); let mut l = load_loan(&token_id, nonce);
        require!(env::predecessor_account_id() == l.borrower, "only borrower");
        require!(l.state == LoanState::Active && !l.policy_busy, "loan not active");
        require!(env::block_timestamp() <= l.due_ns.0.checked_add(l.terms.grace_sec.0 * SECOND).expect("grace overflow"), "default claim period");
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
        require!(env::block_timestamp() > l.due_ns.0.checked_add(l.terms.grace_sec.0 * SECOND).expect("grace overflow"), "default not due");
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
        let who = env::predecessor_account_id(); require!(pending_payouts().get(&who).is_none(), "payout already pending");
        let amount = credits().get(&who).unwrap_or(0); require!(amount > 0, "no payout credit");
        let mut c = config_required(); c.next_payout_nonce = U64(c.next_payout_nonce.0.checked_add(1).expect("payout nonce overflow"));
        let p = PendingPayout { nonce: c.next_payout_nonce, amount: U128(amount) };
        credits().remove(&who); pending_payouts().insert(&who, &p); save_config(&c);
        Promise::new(who.clone()).transfer(yocto(amount))
            .then(callback("on_payout", near_sdk::serde_json::json!({"account_id": who, "nonce": p.nonce}), 30))
    }

    #[private]
    pub fn on_payout(&mut self, account_id: AccountId, nonce: U64) -> bool {
        private_callback();
        let Some(p) = pending_payouts().get(&account_id) else { return false; };
        if p.nonce != nonce { return false; }
        pending_payouts().remove(&account_id);
        if promise_succeeded() {
            let mut c = config_required(); change_liabilities(&mut c, 0, p.amount.0); save_config(&c); true
        } else { add_credit(&account_id, p.amount.0); false }
    }

    /// Explicit new operational capital. Old balance/user bonds never reclassified; future self-royalties are tracked separately.
    #[payable]
    pub fn fund_treasury(&mut self) {
        let mut c = config_required(); let amount = env::attached_deposit().as_yoctonear(); require!(amount > 0, "zero treasury funding");
        c.treasury_available = U128(c.treasury_available.0.checked_add(amount).expect("treasury overflow")); save_config(&c);
        emit_key_event("treasury_credit", near_sdk::serde_json::json!({"kind":"explicit_funding","from":env::predecessor_account_id(),"amount":U128(amount)}));
    }

    pub fn treasury_recoverable(&self) -> U128 {
        let c = config_required();
        let storage = env::storage_byte_cost().as_yoctonear().checked_mul(env::storage_usage() as u128).expect("storage reserve overflow");
        let legacy_listings = (index_count() as u128).checked_mul(LIST_STORAGE_DEPOSIT).expect("listing reserve overflow");
        let reserve = storage.checked_add(OPERATING_RESERVE).and_then(|v| v.checked_add(legacy_listings))
            .and_then(|v| v.checked_add(c.user_liabilities.0)).and_then(|v| v.checked_add(c.treasury_pending.as_ref().map(|p| p.amount.0).unwrap_or(0))).expect("reserve overflow");
        U128(c.treasury_available.0.min(env::account_balance().as_yoctonear().saturating_sub(reserve)))
    }

    #[payable]
    pub fn recover_treasury(&mut self, amount: U128) -> Promise {
        assert_one_yocto(); let mut c = config_required();
        require!(env::predecessor_account_id() == c.recovery_account, "only fixed recovery account");
        require!(env::block_timestamp() >= c.recovery_unlock_ns.0, "treasury recovery timelocked");
        require!(c.treasury_pending.is_none(), "treasury recovery pending");
        require!(amount.0 > 0 && amount.0 <= self.treasury_recoverable().0, "amount exceeds attributed free treasury");
        c.next_payout_nonce = U64(c.next_payout_nonce.0.checked_add(1).expect("payout nonce overflow"));
        let p = PendingPayout { nonce: c.next_payout_nonce, amount };
        c.treasury_available = U128(c.treasury_available.0 - amount.0); c.treasury_pending = Some(p.clone()); save_config(&c);
        // Destination cannot be supplied or changed. No upgrade, DeleteAccount, custody signing or NFT operation.
        Promise::new(c.recovery_account).transfer(yocto(amount.0))
            .then(callback("on_treasury_recovered", near_sdk::serde_json::json!({"nonce": p.nonce}), 30))
    }

    #[private]
    pub fn on_treasury_recovered(&mut self, nonce: U64) -> bool {
        private_callback();
        let mut c = config_required(); let Some(p) = c.treasury_pending.clone() else { return false; };
        if p.nonce != nonce { return false; }
        let success = promise_succeeded(); c.treasury_pending = None;
        if !success { c.treasury_available = U128(c.treasury_available.0.checked_add(p.amount.0).expect("treasury overflow")); }
        save_config(&c); success
    }
}

#[cfg(test)]
#[path = "pledge_tests.rs"]
mod tests;
