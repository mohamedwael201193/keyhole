//! v2.7 governance: two-step owner handover, a timelocked code-only upgrade and a fixed wind-down date.
//! Every key here is new and sits under the raw prefix "Q27/". No existing key, Borsh struct or migrate call changes.
//! Lazy defaults: an absent key means the v2.6 behaviour (legacy owner field, no staged upgrade, not wound down).
//! wind_down closes new activity; existing obligations and transfers keep working; refused while liabilities > 0.
//! It is not a pause: no method stops transfers, repayments, claims or payouts.
use crate::pledge::{config_required, pledge_config};
use crate::*;
use near_sdk::json_types::U64;
use near_sdk::Promise;

/// Minimum delay between stage_upgrade and apply_upgrade: 24 h.
pub const MIN_UPGRADE_DELAY_NS: u64 = 86_400_000_000_000;
/// wind_down may run from 2027-02-01T00:00:00Z (1 801 440 000 s after the Unix epoch).
pub const WIND_DOWN_NS: u64 = 1_801_440_000_000_000_000;

const OWNER_KEY: &[u8] = b"Q27/owner";
const OWNER_PENDING_KEY: &[u8] = b"Q27/owner_pending";
const UPGRADE_KEY: &[u8] = b"Q27/upgrade";
const WIND_DOWN_KEY: &[u8] = b"Q27/wind_down";

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [borsh])]
pub(crate) struct StagedUpgrade {
    pub hash: [u8; 32],
    pub not_before_ns: u64,
}

/// Public governance view. Additive: no existing JSON shape changes.
#[derive(Clone, Debug)]
#[near(serializers = [json])]
pub struct GovernanceState {
    pub owner: AccountId,
    pub pending_owner: Option<AccountId>,
    pub staged_upgrade_sha256: Option<String>,
    pub staged_upgrade_not_before_ns: Option<U64>,
    pub min_upgrade_delay_ns: U64,
    pub wind_down_ns: U64,
    pub wound_down: bool,
}

fn read_account(key: &[u8]) -> Option<AccountId> {
    env::storage_read(key).map(|v| near_sdk::borsh::from_slice::<AccountId>(&v).unwrap_or_else(|_| env::panic_str("governance state corrupt")))
}
fn write_account(key: &[u8], account: &AccountId) {
    env::storage_write(key, &near_sdk::borsh::to_vec(account).unwrap_or_else(|_| env::panic_str("governance encoding")));
}
fn read_staged() -> Option<StagedUpgrade> {
    env::storage_read(UPGRADE_KEY).map(|v| near_sdk::borsh::from_slice::<StagedUpgrade>(&v).unwrap_or_else(|_| env::panic_str("staged upgrade corrupt")))
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
/// Exactly 64 lowercase hex characters. Anything else is refused before any write.
fn parse_sha256(s: &str) -> [u8; 32] {
    require!(s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "code_sha256 must be 64 lowercase hex characters");
    let mut out = [0u8; 32];
    for (i, pair) in s.as_bytes().chunks(2).enumerate() {
        out[i] = std::str::from_utf8(pair).ok().and_then(|h| u8::from_str_radix(h, 16).ok()).unwrap_or_else(|| env::panic_str("bad hex"));
    }
    out
}
/// Refuses every new mint, listing, loan, collateral registration and protected sale once wind_down has run.
pub(crate) fn assert_not_wound_down() {
    require!(env::storage_read(WIND_DOWN_KEY).is_none(), "wound down: new mints, listings, loans, collateral and sales are closed");
}
pub(crate) fn wound_down() -> bool {
    env::storage_read(WIND_DOWN_KEY).is_some()
}

impl Contract {
    /// The handed-over owner when one was accepted, otherwise the legacy owner field (keyhole-devmo.near).
    pub(crate) fn current_owner(&self) -> AccountId {
        read_account(OWNER_KEY).unwrap_or_else(|| self.owner.clone())
    }
}

#[near]
impl Contract {
    /// Step 1 of 2: the current owner names a successor. Overwrites an earlier unaccepted proposal.
    #[payable]
    pub fn propose_owner(&mut self, new_owner: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        require!(new_owner != self.current_owner(), "already the owner");
        write_account(OWNER_PENDING_KEY, &new_owner);
        emit_key_event("owner_proposed", json_object!({"owner": self.current_owner(), "proposed_owner": new_owner}));
    }

    /// Step 2 of 2: only the proposed account can accept, so a mistyped successor never takes effect.
    #[payable]
    pub fn accept_owner(&mut self) {
        assert_one_yocto();
        let proposed = read_account(OWNER_PENDING_KEY).unwrap_or_else(|| env::panic_str("no owner proposal"));
        require!(env::predecessor_account_id() == proposed, "only the proposed owner can accept");
        let previous = self.current_owner();
        write_account(OWNER_KEY, &proposed);
        env::storage_remove(OWNER_PENDING_KEY);
        emit_key_event("owner_changed", json_object!({"previous_owner": previous, "owner": proposed}));
    }

    /// Owner only. Records the hash of a wasm that apply_upgrade may deploy after MIN_UPGRADE_DELAY_NS.
    /// One staged upgrade at a time: cancel it before staging another, so the delay cannot be reset silently.
    #[payable]
    pub fn stage_upgrade(&mut self, code_sha256: String) -> U64 {
        assert_one_yocto();
        self.assert_owner();
        require!(read_staged().is_none(), "an upgrade is already staged: cancel_upgrade first");
        let hash = parse_sha256(&code_sha256);
        let not_before = env::block_timestamp().checked_add(MIN_UPGRADE_DELAY_NS).unwrap_or_else(|| env::panic_str("time overflow"));
        env::storage_write(UPGRADE_KEY, &near_sdk::borsh::to_vec(&StagedUpgrade { hash, not_before_ns: not_before }).unwrap_or_else(|_| env::panic_str("upgrade encoding")));
        emit_key_event("upgrade_staged", json_object!({"code_sha256": code_sha256, "not_before_ns": U64(not_before)}));
        U64(not_before)
    }

    #[payable]
    pub fn cancel_upgrade(&mut self) {
        assert_one_yocto();
        self.assert_owner();
        let staged = read_staged().unwrap_or_else(|| env::panic_str("no upgrade staged"));
        env::storage_remove(UPGRADE_KEY);
        emit_key_event("upgrade_cancelled", json_object!({"code_sha256": hex(&staged.hash)}));
    }

    /// Owner only, after the timelock. The wasm is the RAW input (env::input), not JSON; its sha256 must equal the staged hash.
    /// Code only: the deploy is not followed by any migrate call and no state is rewritten, so the Borsh layout stays as it is.
    /// Pattern follows the Sputnik DAO UpgradeSelf precedent. The staged record is removed on apply: a failed deploy
    /// needs a new stage_upgrade and a new delay.
    /// Not checked here (not observable from one account): in-flight custody or sale callbacks. They are dispatched to
    /// the new code, which keeps every method name and Borsh layout. Refused while a treasury recovery is pending.
    #[payable]
    pub fn apply_upgrade(&mut self) -> Promise {
        assert_one_yocto();
        self.assert_owner();
        let staged = read_staged().unwrap_or_else(|| env::panic_str("no upgrade staged"));
        require!(env::block_timestamp() >= staged.not_before_ns, "upgrade timelock not expired");
        if let Some(c) = pledge_config() {
            require!(c.treasury_pending.is_none(), "treasury recovery pending: upgrade refused");
        }
        let code = env::input().unwrap_or_else(|| env::panic_str("wasm must be the raw input"));
        require!(env::sha256(&code).as_slice() == staged.hash.as_slice(), "wasm sha256 does not match the staged hash");
        env::storage_remove(UPGRADE_KEY);
        emit_key_event("upgrade_applied", json_object!({"code_sha256": hex(&staged.hash), "bytes": code.len() as u64}));
        Promise::new(env::current_account_id()).deploy_contract(code)
    }

    /// Owner only, on or after WIND_DOWN_NS. Closes new activity: mint, list, sale, open_loan and register_collateral refuse.
    /// Existing obligations and transfers keep working. Refused while user liabilities are above zero (loan bonds,
    /// principal, credits and pending payouts all count), while a treasury recovery is pending, or while a key is listed.
    /// Pending value-ops are not visible globally and are not checked here (residual, see the report).
    #[payable]
    pub fn wind_down(&mut self) {
        assert_one_yocto();
        self.assert_owner();
        require!(env::block_timestamp() >= WIND_DOWN_NS, "wind-down date not reached: earliest 2027-02-01T00:00:00Z");
        require!(!wound_down(), "already wound down");
        let c = config_required();
        require!(c.user_liabilities.0 == 0, "wind_down refused: user liabilities outstanding");
        require!(c.treasury_pending.is_none(), "wind_down refused: treasury recovery pending");
        require!(index_count() == 0, "wind_down refused: keys are listed, unlist first");
        env::storage_write(WIND_DOWN_KEY, &[1]);
        emit_key_event("wind_down", json_object!({"at_ns": U64(env::block_timestamp())}));
    }

    pub fn governance_state(&self) -> GovernanceState {
        let staged = read_staged();
        GovernanceState {
            owner: self.current_owner(),
            pending_owner: read_account(OWNER_PENDING_KEY),
            staged_upgrade_sha256: staged.as_ref().map(|s| hex(&s.hash)),
            staged_upgrade_not_before_ns: staged.as_ref().map(|s| U64(s.not_before_ns)),
            min_upgrade_delay_ns: U64(MIN_UPGRADE_DELAY_NS),
            wind_down_ns: U64(WIND_DOWN_NS),
            wound_down: wound_down(),
        }
    }
}

#[cfg(test)]
#[path = "v27_tests.rs"]
mod tests;
