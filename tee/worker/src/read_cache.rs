//! Per-run read cache (round 4).
//!
//! The worker re-reads the same on-chain values many times within one run:
//! `guard_preflight`, `guard_begin`, `validate_dispatch` and the exact-exit
//! drive each re-fetch the same control / registry / token / binding reads.
//! The host caps `near:rpc` at 100 calls per run, and the uncached canary
//! is ~150 calls (see the round-4 report §3 for the full derivation), so
//! the canary would die mid-flow. This cache memoizes identical reads for
//! the duration of one run and brings the canary to ~52.
//!
//! # Safety
//!
//! Only values that cannot change within a run without a send are cached
//! (see [`is_cacheable`]). The cache is invalidated after EVERY send
//! (`native_send::execute` / `rebroadcast`, and the `send_tx` helper in
//! `native_host.rs`), so a cached value can never survive a state-changing
//! call. A cached read that is stale because of a send is therefore
//! impossible by construction — provided every send goes through one of
//! those three choke points (a stale test enforces this).
//!
//! Never cached, by design:
//!
//! * The exact-exit balance readbacks (`mt_balance_of`, `ft_balance_of`,
//!   `storage_balance_of`, `view_account`): the exact exit proves state
//!   changes through them. A cached value would make before == after and
//!   break the `credit()` check (it would always fail after unshield).
//! * `nft_listing`: policy-critical; the op handler reads it fresh twice.
//! * `view_access_key`: a send changes the nonce. Each nonce is read once
//!   per distinct key anyway, so caching it would save nothing.
//! * `loan_certificate_template`: per-call args; read once.
//!
//! The cached final-block timestamp is at most ~180 s stale (the run
//! length). That is fail-closed for the custody-cooldown check (a stale
//! `now` understates elapsed time, so the cooldown refuses more), and the
//! provision certificate is fresh by construction (the auditor signs it
//! for this provision_id just before the call). The contract is the final
//! authority for value-op validity: a stale cached control / registry read
//! cannot cause an invalid on-chain action, because the contract refuses
//! it.

use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;

/// A cached view call, keyed by (contract, method, args_json).
pub type ViewKey = (String, String, String);

/// A cached final-block read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BlockCache {
    pub hash: [u8; 32],
    pub height: Option<u64>,
    pub timestamp_ms: u64,
}

#[derive(Default)]
struct Cache {
    views: HashMap<ViewKey, Value>,
    block: Option<BlockCache>,
    gas_price: Option<u128>,
    protocol_config: Option<String>,
}

thread_local! {
    static CACHE: RefCell<Cache> = RefCell::new(Cache::default());
}

/// Methods whose values cannot change within a run without a send.
/// Everything else is read fresh every time.
pub fn is_cacheable(method: &str) -> bool {
    matches!(
        method,
        "get_control_state"
            | "get_project"
            | "list_versions"
            | "get_version_count"
            | "get_pledge_config"
            | "nft_token"
            | "nft_settlement_epoch"
            | "get_collateral_binding"
            | "get_loan"
            | "get_value_op"
            | "get_pending_registration"
            | "get_wallet_policy"
            | "payout_account_registered"
            | "estimate_wallet_policy_cost"
            | "collateral_registration_protocol"
            | "storage_balance_bounds"
            | "config"
            | "holder_tier"
            | "nft_supply_for_owner"
            | "nft_tokens_for_owner"
    )
}

/// Look up a cached view. Returns `None` on a miss, or for a method that
/// is never cached (the caller must then read fresh).
pub fn get_view(contract: &str, method: &str, args: &str) -> Option<Value> {
    if !is_cacheable(method) {
        return None;
    }
    CACHE.with(|c| {
        c.borrow()
            .views
            .get(&(contract.to_string(), method.to_string(), args.to_string()))
            .cloned()
    })
}

/// Store a view result. No-op for methods that are never cached.
pub fn put_view(contract: &str, method: &str, args: &str, value: Value) {
    if !is_cacheable(method) {
        return;
    }
    CACHE.with(|c| {
        c.borrow_mut().views.insert(
            (
                contract.to_string(),
                method.to_string(),
                args.to_string(),
            ),
            value,
        );
    });
}

/// Look up the cached final block, if any.
pub fn get_block() -> Option<BlockCache> {
    CACHE.with(|c| c.borrow().block)
}

/// Store the final block.
pub fn put_block(block: BlockCache) {
    CACHE.with(|c| c.borrow_mut().block = Some(block));
}

/// Clear only the cached final block, so the next `chain_now_ms()` re-reads
/// the live chain. Round 8: the loan certificate must be signed against a
/// fresh block, not the run-start block (the cached re-check was vacuous).
pub fn invalidate_block() {
    CACHE.with(|c| c.borrow_mut().block = None);
}

/// Look up the cached gas price in yocto, if any. Round 8: the cache holds
/// the PARSED u128, not a Value — the host never returns the
/// `{"gas_price":...}` object the old cache stored, so caching the raw
/// response only preserved the wrong shape.
pub fn get_gas_price() -> Option<u128> {
    CACHE.with(|c| c.borrow().gas_price)
}

/// Store the parsed gas price in yocto.
pub fn put_gas_price(value: u128) {
    CACHE.with(|c| c.borrow_mut().gas_price = Some(value));
}

/// Look up the cached protocol-config response, if any.
pub fn get_protocol_config() -> Option<String> {
    CACHE.with(|c| c.borrow().protocol_config.clone())
}

/// Store the protocol-config response.
pub fn put_protocol_config(value: String) {
    CACHE.with(|c| c.borrow_mut().protocol_config = Some(value));
}

/// Clear the whole cache. Called after EVERY send, so no cached value can
/// survive a state-changing call. Also the test reset.
pub fn invalidate() {
    CACHE.with(|c| *c.borrow_mut() = Cache::default());
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn reset() {
        invalidate();
    }

    #[test]
    fn view_put_get_roundtrip() {
        reset();
        let key = ("keys.near", "get_control_state", "{\"token_id\":\"k1\"}");
        assert!(get_view(key.0, key.1, key.2).is_none());
        put_view(key.0, key.1, key.2, json!({"epoch": "0"}));
        assert_eq!(
            get_view(key.0, key.1, key.2),
            Some(json!({"epoch": "0"}))
        );
        // A second put for the same key overwrites (the value cannot change
        // within a run, so this only happens in tests).
        put_view(key.0, key.1, key.2, json!({"epoch": "1"}));
        assert_eq!(
            get_view(key.0, key.1, key.2),
            Some(json!({"epoch": "1"}))
        );
    }

    #[test]
    fn view_key_is_contract_method_and_args() {
        reset();
        put_view("keys.near", "nft_token", "{\"token_id\":\"k1\"}", json!({"a": 1}));
        // Different args: miss.
        assert!(get_view("keys.near", "nft_token", "{\"token_id\":\"k2\"}").is_none());
        // Different method: miss.
        assert!(get_view("keys.near", "get_control_state", "{\"token_id\":\"k1\"}").is_none());
        // Different contract: miss.
        assert!(get_view("other.near", "nft_token", "{\"token_id\":\"k1\"}").is_none());
        // Exact key: hit.
        assert_eq!(
            get_view("keys.near", "nft_token", "{\"token_id\":\"k1\"}"),
            Some(json!({"a": 1}))
        );
    }

    #[test]
    fn never_cached_methods_are_never_stored() {
        reset();
        // The exact-exit readbacks and the policy-critical listing check
        // must NEVER be cached: a stale value there breaks the exit proof.
        for method in [
            "mt_balance_of",
            "ft_balance_of",
            "storage_balance_of",
            "view_account",
            "nft_listing",
            "view_access_key",
            "loan_certificate_template",
        ] {
            assert!(!is_cacheable(method), "{method} must not be cacheable");
            put_view("c.near", method, "{}", json!({"x": 1}));
            assert!(
                get_view("c.near", method, "{}").is_none(),
                "{method} was stored despite being non-cacheable"
            );
        }
        // And the allowlist itself is exactly the intended set.
        for method in [
            "get_control_state",
            "get_project",
            "list_versions",
            "get_version_count",
            "get_pledge_config",
            "nft_token",
            "nft_settlement_epoch",
            "get_collateral_binding",
            "get_loan",
            "get_value_op",
            "get_pending_registration",
            "get_wallet_policy",
            "payout_account_registered",
            "estimate_wallet_policy_cost",
            "collateral_registration_protocol",
            "storage_balance_bounds",
            "config",
            "holder_tier",
            "nft_supply_for_owner",
            "nft_tokens_for_owner",
        ] {
            assert!(is_cacheable(method), "{method} must be cacheable");
        }
    }

    #[test]
    fn block_gas_price_and_protocol_config_roundtrip() {
        reset();
        assert!(get_block().is_none());
        assert!(get_gas_price().is_none());
        assert!(get_protocol_config().is_none());
        put_block(BlockCache {
            hash: [7u8; 32],
            height: Some(224_400_000),
            timestamp_ms: 1_793_000_000_000,
        });
        put_gas_price(100_000_000);
        // Round 8: the protocol-config body carries transaction_validity_period
        // TOP-LEVEL in result, not under a genesis_config wrapper (the old
        // test string used a shape the live RPC never returns).
        put_protocol_config(
            "{\"jsonrpc\":\"2.0\",\"result\":{\"transaction_validity_period\":86400},\"id\":\"1\"}"
                .into(),
        );
        assert_eq!(
            get_block(),
            Some(BlockCache {
                hash: [7u8; 32],
                height: Some(224_400_000),
                timestamp_ms: 1_793_000_000_000,
            })
        );
        assert_eq!(get_gas_price(), Some(100_000_000));
        assert_eq!(
            get_protocol_config(),
            Some(
                "{\"jsonrpc\":\"2.0\",\"result\":{\"transaction_validity_period\":86400},\"id\":\"1\"}"
                    .into()
            )
        );
    }

    #[test]
    fn invalidate_clears_everything() {
        reset();
        put_view("keys.near", "nft_token", "{}", json!({"a": 1}));
        put_block(BlockCache {
            hash: [1u8; 32],
            height: None,
            timestamp_ms: 1,
        });
        put_gas_price(1);
        put_protocol_config("{}".into());
        invalidate();
        assert!(get_view("keys.near", "nft_token", "{}").is_none());
        assert!(get_block().is_none());
        assert!(get_gas_price().is_none());
        assert!(get_protocol_config().is_none());
    }

    #[test]
    fn invalidate_block_clears_only_the_block() {
        // Round 8: the loan certificate invalidates just the block so the
        // next chain_now_ms() re-reads the live FINAL block, while the gas
        // price and views stay cached.
        reset();
        put_block(BlockCache {
            hash: [1u8; 32],
            height: Some(100),
            timestamp_ms: 1,
        });
        put_gas_price(100_000_000);
        put_view("keys.near", "nft_token", "{}", json!({"a": 1}));
        invalidate_block();
        assert!(get_block().is_none());
        assert_eq!(get_gas_price(), Some(100_000_000));
        assert!(get_view("keys.near", "nft_token", "{}").is_some());
    }

    #[test]
    fn invalidate_is_the_stale_value_guard() {
        // The (d) test at the component level: a value cached before a
        // send must never be served after it. `execute` / `rebroadcast`
        // and the `send_tx` helper all call `invalidate()` after every
        // broadcast; here we prove the cache itself honours it.
        reset();
        put_view("keys.near", "get_value_op", "{\"id\":\"1:abc\"}", json!({"status": "admission"}));
        assert!(get_view("keys.near", "get_value_op", "{\"id\":\"1:abc\"}").is_some());
        // A send happens (the caller invalidates after the broadcast).
        invalidate();
        // The old value is gone: the next read is fresh.
        assert!(get_view("keys.near", "get_value_op", "{\"id\":\"1:abc\"}").is_none());
    }
}
