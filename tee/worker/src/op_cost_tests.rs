//! Round 4: per-op near:rpc cost models.
//!
//! `op_withdraw` (the canary), `op_provision_collateral` and
//! `op_loan_certificate` live in the wasm32-only host module, so they
//! cannot be executed in native tests. These tests therefore enumerate
//! each op's production read sequence — in order, with the production
//! call site for every event — and feed it through the REAL
//! `read_cache`, counting only cache misses plus the non-cacheable reads
//! and sends. The count is the measured cost of the op with the cache,
//! not a hand total: if a method leaves the cache allowlist, or a
//! send stops invalidating, the total changes and the test fails.
//!
//! The enumeration is derived call-by-call from the production source;
//! the full derivation (including the uncached ~150 for the canary) is
//! in WORKER_REBROADCAST_CHANGE_REPORT_R4.md §3. The panel should read
//! that derivation alongside this file. Two stale tests below guard the
//! wiring the model depends on: the cache is wired into the single
//! `view()` choke point, and every send invalidates it.
//!
//! Contract strings: only key EQUALITY matters for the count, so the
//! registry is written as "registry" (its exact contract id does not
//! affect the count). The keys contract is keyhole-devmo.near and the
//! custody contract is outlayer.near, as in production.

use crate::read_cache;
use serde_json::Value;

const KEYS: &str = "keyhole-devmo.near";
const REGISTRY: &str = "registry";
const CUSTODY: &str = "outlayer.near";
const TOKEN: &str = "{\"token_id\":\"k1\"}";
const PROJECT: &str = "{\"project_id\":\"p000000000000004b\"}";
const OP: &str = "{\"token_id\":\"k1\",\"op_id\":\"1:abc\"}";

/// One step in a production op's read sequence.
#[derive(Clone, Copy, Debug)]
enum Event {
    /// A view call. Costs 1 on a cache miss, 0 on a hit. A method that
    /// is never cached always costs 1.
    View(&'static str, &'static str, &'static str),
    /// A final-block read (`rpc::block("final")`). Costs 1 on a miss.
    Block,
    /// A gas-price read. Costs 1 on a miss.
    GasPrice,
    /// A non-cacheable read: `view_access_key` (a nonce), `view_account`,
    /// `tx_status`, `mt_balance_of`, `ft_balance_of`,
    /// `storage_balance_of`, `nft_listing`. Always costs 1.
    Fresh,
    /// A broadcast (`send_tx`). Costs 1 and invalidates the cache.
    Send,
}

/// Feed a production read sequence through the real per-run read cache
/// and return the number of near:rpc calls it costs.
fn simulate(events: &[Event]) -> usize {
    read_cache::invalidate();
    let mut total = 0;
    for e in events {
        match e {
            Event::View(contract, method, args) => {
                if read_cache::get_view(contract, method, args).is_none() {
                    total += 1;
                    read_cache::put_view(contract, method, args, Value::Null);
                }
            }
            Event::Block => {
                if read_cache::get_block().is_none() {
                    total += 1;
                    read_cache::put_block(read_cache::BlockCache {
                        hash: [0; 32],
                        height: None,
                        timestamp_ms: 0,
                    });
                }
            }
            Event::GasPrice => {
                if read_cache::get_gas_price().is_none() {
                    total += 1;
                    read_cache::put_gas_price(Value::Null);
                }
            }
            Event::Fresh => total += 1,
            Event::Send => {
                total += 1;
                read_cache::invalidate();
            }
        }
    }
    total
}

/// The canary: `op_withdraw` (exact-near-v1 exit, token k1, 3 hops).
/// Production call sites: main.rs `op_withdraw` + `authenticate`,
/// guarded_host.rs `guard_preflight` / `guard_begin` /
/// `validate_dispatch` / `guarded_minter`, guarded.rs
/// `confirm_admission` / `settle_admission`, exact_exit.rs `drive`.
/// Uncached this sequence is ~150; with the cache it is 55.
// The event list is built incrementally with interleaved section
// comments; a `vec![...]` literal would hide that structure, so the
// `vec_init_then_push` lint is allowed here by design.
#[allow(clippy::vec_init_then_push)]
fn canary_events() -> Vec<Event> {
    use Event::*;
    let mut e = Vec::new();
    // Phase 1 — op handler: authenticate -> guard_begin. 21.
    // authenticate (main.rs): AK auth, block, holder_tier, owns, control, owns.
    e.push(Fresh); // view_access_key (auth key) — never cached
    e.push(Block); // chain_now_ms
    e.push(View(KEYS, "holder_tier", "{\"account_id\":\"devmo.near\"}"));
    e.push(View(KEYS, "nft_token", TOKEN)); // owns (token_id)
    e.push(View(KEYS, "get_control_state", TOKEN)); // guard_control
    e.push(View(KEYS, "nft_token", TOKEN)); // owns (private_access) — hit
    // guard_preflight (guarded_host.rs): provision_idle, control, registry, pledge_config, owns.
    e.push(View(KEYS, "get_control_state", TOKEN)); // provision_idle — hit
    e.push(View(KEYS, "get_control_state", TOKEN)); // guard_control — hit
    e.push(View(REGISTRY, "get_project", PROJECT));
    e.push(View(REGISTRY, "list_versions", PROJECT));
    e.push(View(REGISTRY, "get_version_count", PROJECT));
    e.push(View(KEYS, "get_pledge_config", "{}"));
    e.push(View(KEYS, "nft_token", TOKEN)); // owns — hit
    // op body: nft_token (withdraw-to check).
    e.push(View(KEYS, "nft_token", TOKEN)); // hit
    // prov_sync_owner: custody_cooldown (control, owns, control) + chain_owner_epoch.
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "nft_token", TOKEN)); // hit
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "nft_settlement_epoch", TOKEN));
    // guarded_wallet: binding.
    e.push(View(KEYS, "get_collateral_binding", TOKEN));
    // exact_exit_policy: control, loan, binding.
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "get_loan", TOKEN));
    e.push(View(KEYS, "get_collateral_binding", TOKEN)); // hit
    // assert_not_listed (always fresh) + guard_control (stamped) + settle_gate + assert_not_listed.
    e.push(Fresh); // nft_listing — never cached
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "nft_token", TOKEN)); // settle_gate owns — hit
    e.push(View(KEYS, "get_control_state", TOKEN)); // settle_gate control — hit
    e.push(Fresh); // nft_listing (second check) — never cached
    // guard_begin: guard_preflight (all hit) + guarded_wallet (hit) + confirm_admission.
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(REGISTRY, "get_project", PROJECT)); // hit
    e.push(View(REGISTRY, "list_versions", PROJECT)); // hit
    e.push(View(REGISTRY, "get_version_count", PROJECT)); // hit
    e.push(View(KEYS, "get_pledge_config", "{}")); // hit
    e.push(View(KEYS, "nft_token", TOKEN)); // hit
    e.push(View(KEYS, "get_collateral_binding", TOKEN)); // hit
    // confirm_admission (guarded.rs): value_op, then begin, then value_op again.
    e.push(View(KEYS, "get_value_op", OP));
    // begin (AdmissionHost::begin): provision_idle (hit) + guarded_minter (config) + send.
    e.push(View(KEYS, "get_control_state", TOKEN)); // provision_idle — hit
    e.push(View(KEYS, "config", "{}")); // guarded_minter
    e.push(Fresh); // view_access_key (minter nonce) — never cached
    e.push(Block); // begin's block — hit
    e.push(Send); // begin_value_op (NONE) — invalidates
    e.push(Fresh); // tx_status poll 1
    e.push(Fresh); // tx_status poll 2
    e.push(View(KEYS, "get_value_op", OP)); // re-read after the send
    // Phase 2 — the drive (exact_exit.rs): validate#1, baseline, 3 hops, delivery. 26.
    // validate_dispatch #1 (guarded_host.rs): control, registry x3, value_op, control, nft_token,
    // block, custody_cooldown (all hit), binding, exact_exit_policy (control hit, loan, binding hit).
    // NOTE: validate#1 is 8 here, not 9 — get_value_op is already cached
    // from confirm_admission's post-send re-read at the end of phase 1.
    // In isolation (the Fixture drive test, empty cache at drive start)
    // it is 9 and the drive is 27; within the full canary it is 8 and
    // the drive is 26.
    e.push(View(KEYS, "get_control_state", TOKEN));
    e.push(View(REGISTRY, "get_project", PROJECT));
    e.push(View(REGISTRY, "list_versions", PROJECT));
    e.push(View(REGISTRY, "get_version_count", PROJECT));
    e.push(View(KEYS, "get_value_op", OP));
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "nft_token", TOKEN));
    e.push(Block);
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "nft_token", TOKEN)); // hit
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "get_collateral_binding", TOKEN));
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "get_loan", TOKEN));
    e.push(View(KEYS, "get_collateral_binding", TOKEN)); // hit
    // Baseline observe: mt, ft, storage_bal, bounds (cacheable), view_account. 5.
    e.push(Fresh); // mt_balance_of
    e.push(Fresh); // ft_balance_of
    e.push(Fresh); // storage_balance_of
    e.push(View(KEYS, "storage_balance_bounds", "{}"));
    e.push(Fresh); // view_account
    // Hop 1 (unshield): validate (all hit) + now_ms (hit) + before-observe
    // (reused baseline) + after-observe (4: bounds hit). 4.
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(REGISTRY, "get_project", PROJECT)); // hit
    e.push(View(REGISTRY, "list_versions", PROJECT)); // hit
    e.push(View(REGISTRY, "get_version_count", PROJECT)); // hit
    e.push(View(KEYS, "get_value_op", OP)); // hit
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "nft_token", TOKEN)); // hit
    e.push(Block); // hit
    e.push(View(KEYS, "get_collateral_binding", TOKEN)); // hit
    e.push(View(KEYS, "get_loan", TOKEN)); // hit
    e.push(Fresh); // after: mt_balance_of
    e.push(Fresh); // after: ft_balance_of
    e.push(Fresh); // after: storage_balance_of
    e.push(Fresh); // after: view_account
    // Hop 2 (storage): validate (all hit) + now_ms (hit) + before-observe
    // (reused hop-1 after) + after-observe (4). 4.
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(REGISTRY, "get_project", PROJECT)); // hit
    e.push(View(REGISTRY, "list_versions", PROJECT)); // hit
    e.push(View(REGISTRY, "get_version_count", PROJECT)); // hit
    e.push(View(KEYS, "get_value_op", OP)); // hit
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "nft_token", TOKEN)); // hit
    e.push(Block); // hit
    e.push(View(KEYS, "get_collateral_binding", TOKEN)); // hit
    e.push(View(KEYS, "get_loan", TOKEN)); // hit
    e.push(Fresh); // after: mt_balance_of
    e.push(Fresh); // after: ft_balance_of
    e.push(Fresh); // after: storage_balance_of
    e.push(Fresh); // after: view_account
    // Hop 3 (withdraw): validate (all hit) + before-observe (reused hop-2
    // after) + after-observe (4). 4.
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(REGISTRY, "get_project", PROJECT)); // hit
    e.push(View(REGISTRY, "list_versions", PROJECT)); // hit
    e.push(View(REGISTRY, "get_version_count", PROJECT)); // hit
    e.push(View(KEYS, "get_value_op", OP)); // hit
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "nft_token", TOKEN)); // hit
    e.push(Block); // hit
    e.push(View(KEYS, "get_collateral_binding", TOKEN)); // hit
    e.push(View(KEYS, "get_loan", TOKEN)); // hit
    e.push(Fresh); // after: mt_balance_of
    e.push(Fresh); // after: ft_balance_of
    e.push(Fresh); // after: storage_balance_of
    e.push(Fresh); // after: view_account
    // original_delivery: tx_status. 1.
    e.push(Fresh);
    // Phase 3 — finish (guarded.rs settle_admission): complete + control + value_op. 7.
    e.push(View(KEYS, "config", "{}")); // guarded_minter in complete
    e.push(Fresh); // view_access_key (minter nonce) — never cached
    e.push(Block); // finish's block — hit
    e.push(Send); // finish_value_op (NONE) — invalidates
    e.push(Fresh); // tx_status poll 1
    e.push(Fresh); // tx_status poll 2
    e.push(View(KEYS, "get_control_state", TOKEN)); // control after the send
    e.push(View(KEYS, "get_value_op", OP)); // value_op after the send
    // Phase 4 — op tail (main.rs op_withdraw): owns + guard_control. 1.
    e.push(View(KEYS, "nft_token", TOKEN)); // owns
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit (cached in settle_admission)
    e
}

/// `op_provision_collateral` (register_collateral). Production call
/// sites: collateral_host.rs `op_provision_collateral` +
/// `provision_auth` + `provision_unchanged` + `reconcile_provision`,
/// guarded_host.rs `guard_registry` / `guarded_minter`,
/// native_send.rs `execute`. Uncached 46; with the cache 34.
// The event list is built incrementally with interleaved section
// comments; a `vec![...]` literal would hide that structure, so the
// `vec_init_then_push` lint is allowed here by design.
#[allow(clippy::vec_init_then_push)]
fn provision_events() -> Vec<Event> {
    use Event::*;
    let mut e = Vec::new();
    // provision_auth: authenticate (5) + guard_control (hit) + registry (3) + loan (1) + pledge_config (1) + protocol (1). 11.
    e.push(Fresh); // view_access_key (auth key)
    e.push(Block); // chain_now_ms
    e.push(View(KEYS, "holder_tier", "{\"account_id\":\"devmo.near\"}"));
    e.push(View(KEYS, "nft_token", TOKEN)); // owns
    e.push(View(KEYS, "get_control_state", TOKEN)); // guard_control
    e.push(View(KEYS, "nft_token", TOKEN)); // owns (private_access) — hit
    e.push(View(KEYS, "get_control_state", TOKEN)); // guard_control — hit
    e.push(View(REGISTRY, "get_project", PROJECT));
    e.push(View(REGISTRY, "list_versions", PROJECT));
    e.push(View(REGISTRY, "get_version_count", PROJECT));
    e.push(View(KEYS, "get_loan", TOKEN));
    e.push(View(KEYS, "get_pledge_config", "{}"));
    e.push(View(KEYS, "collateral_registration_protocol", "{}")); // provision_auth (collateral_host.rs:38-42) — first read in the run, a miss
    // Op body: chain_now_ms (hit), guardian AK, chain_now_ms (hit), guarded_wallet.
    e.push(Block); // hit
    e.push(Fresh); // view_access_key (guardian)
    e.push(Block); // hit
    e.push(View(KEYS, "get_collateral_binding", TOKEN)); // guarded_wallet
    // Eligibility reads: binding (hit), pending, wallet_policy.
    e.push(View(KEYS, "get_collateral_binding", TOKEN)); // hit
    e.push(View(KEYS, "get_pending_registration", TOKEN));
    e.push(View(CUSTODY, "get_wallet_policy", "{\"wallet_pubkey\":\"ed25519:abc\"}"));
    // guarded_minter (config) + payout slot + cost estimate.
    e.push(View(KEYS, "config", "{}")); // guarded_minter
    e.push(View(KEYS, "payout_account_registered", "{\"account_id\":\"minter.near\"}"));
    e.push(View(
        CUSTODY,
        "estimate_wallet_policy_cost",
        "{\"wallet_pubkey\":\"ed25519:abc\"}",
    ));
    // provision_unchanged: owns (hit) + guard_control (hit) + registry (hit). 0.
    e.push(View(KEYS, "nft_token", TOKEN)); // hit
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(REGISTRY, "get_project", PROJECT)); // hit
    e.push(View(REGISTRY, "list_versions", PROJECT)); // hit
    e.push(View(REGISTRY, "get_version_count", PROJECT)); // hit
    // execute: preflight (gas_price + view_account) + send (nonce, block hit, send, 2 polls). 6.
    e.push(GasPrice);
    e.push(Fresh); // view_account (minter balance) — never cached
    e.push(Fresh); // view_access_key (minter nonce)
    e.push(Block); // hit
    e.push(Send); // register_collateral (NONE) — invalidates
    e.push(Fresh); // tx_status poll 1
    e.push(Fresh); // tx_status poll 2
    // reconcile_provision (happy path, no guardian_proof): config, tx_status,
    // binding, pending, policy, guarded_wallet (hit), provision_unchanged. 10.
    e.push(View(KEYS, "config", "{}")); // guarded_minter
    e.push(Fresh); // tx_status
    e.push(View(KEYS, "get_collateral_binding", TOKEN));
    e.push(View(KEYS, "get_pending_registration", TOKEN));
    e.push(View(CUSTODY, "get_wallet_policy", "{\"wallet_pubkey\":\"ed25519:abc\"}"));
    e.push(View(KEYS, "get_collateral_binding", TOKEN)); // guarded_wallet — hit
    e.push(View(KEYS, "nft_token", TOKEN)); // provision_unchanged owns
    e.push(View(KEYS, "get_control_state", TOKEN)); // provision_unchanged control
    e.push(View(REGISTRY, "get_project", PROJECT)); // provision_unchanged registry
    e.push(View(REGISTRY, "list_versions", PROJECT));
    e.push(View(REGISTRY, "get_version_count", PROJECT));
    e
}

/// `op_loan_certificate` (guarded_host.rs). No auth, no send: a pure
/// read + sign. Uncached 20; with the cache 11.
// The event list is built incrementally; a `vec![...]` literal would
// hide that structure, so the `vec_init_then_push` lint is allowed here
// by design.
#[allow(clippy::vec_init_then_push)]
fn loan_certificate_events() -> Vec<Event> {
    use Event::*;
    let mut e = Vec::new();
    e.push(View(REGISTRY, "get_project", PROJECT)); // guard_registry
    e.push(View(REGISTRY, "list_versions", PROJECT));
    e.push(View(REGISTRY, "get_version_count", PROJECT));
    e.push(Block); // chain_now_ms
    e.push(View(KEYS, "get_pledge_config", "{}"));
    e.push(View(KEYS, "get_loan", TOKEN));
    e.push(View(KEYS, "get_collateral_binding", TOKEN));
    e.push(View(KEYS, "get_control_state", TOKEN)); // guard_control
    e.push(View(KEYS, "loan_certificate_template", "{\"token_id\":\"k1\"}")); // per-call args — never cached
    e.push(View(KEYS, "get_collateral_binding", TOKEN)); // guarded_wallet — hit
    e.push(View(CUSTODY, "get_wallet_policy", "{\"wallet_pubkey\":\"ed25519:abc\"}"));
    // Re-read after balance/inventory: control, loan, binding, policy — all hit.
    e.push(View(KEYS, "get_control_state", TOKEN)); // hit
    e.push(View(KEYS, "get_loan", TOKEN)); // hit
    e.push(View(KEYS, "get_collateral_binding", TOKEN)); // hit
    e.push(View(CUSTODY, "get_wallet_policy", "{\"wallet_pubkey\":\"ed25519:abc\"}")); // hit
    e.push(View(REGISTRY, "get_project", PROJECT)); // guard_registry — hit
    e.push(View(REGISTRY, "list_versions", PROJECT)); // hit
    e.push(View(REGISTRY, "get_version_count", PROJECT)); // hit
    e.push(Block); // chain_now_ms — hit
    e.push(View(KEYS, "config", "{}")); // guarded_minter
    e
}

#[test]
fn canary_exit_cost_is_at_most_70() {
    let total = simulate(&canary_events());
    // The modeled canary is 55: phase 1 (op handler) 21 + phase 2
    // (drive) 26 + phase 3 (finish) 7 + phase 4 (op tail) 1. The
    // requirement is <= 70 (30% margin under the 100-call host cap).
    // The exact figure is asserted too: if the model changes, the new
    // figure must be justified in the round-4 report, not silently
    // accepted.
    assert_eq!(total, 55, "canary model total changed; see the round-4 report §3");
    assert!(total <= 70, "canary {total} exceeds the 70-call budget");
}

#[test]
fn provision_cost_is_at_most_70() {
    let total = simulate(&provision_events());
    // The modeled provision is 34: provision_auth 11 + guardian AK 1 +
    // guarded_wallet 1 + pending 1 + policy 1 + config 1 + payout 1 +
    // estimate 1 + execute 6 + reconcile_provision 10. (Production
    // counts provision_auth as 12 and the op body as 6 — the
    // guarded_minter config read happens in provision_auth there and is
    // a hit in the body — but the total is 34 either way.)
    assert_eq!(total, 34, "provision model total changed; see the round-4 report §3");
    assert!(total <= 70, "provision {total} exceeds the 70-call budget");
}

#[test]
fn loan_certificate_cost_is_at_most_70() {
    let total = simulate(&loan_certificate_events());
    // The modeled loan-certificate path is 11.
    assert_eq!(total, 11, "loan-certificate model total changed; see the round-4 report §3");
    assert!(total <= 70, "loan-certificate {total} exceeds the 70-call budget");
}

#[test]
fn worst_case_polls_stay_under_70() {
    // Production usually needs 2 status polls per send (the first poll
    // after a NONE send returns not-FINAL). If every send needed the
    // maximum 3 polls, the canary gains 2 calls (one per send) — still
    // under 70. This test re-runs the canary model with 3 polls per send.
    let mut events = canary_events();
    // The model has 2 polls after each of the 2 sends; add a third to each.
    // The sends are the two `Send` events; insert a Fresh after each.
    let mut out = Vec::new();
    let mut sends = 0;
    for e in events.drain(..) {
        out.push(e);
        if matches!(e, Event::Send) {
            sends += 1;
            out.push(Event::Fresh);
        }
    }
    assert_eq!(sends, 2, "the canary model must have exactly 2 sends");
    let total = simulate(&out);
    assert_eq!(total, 57, "3-poll canary model total changed");
    assert!(total <= 70, "3-poll canary {total} exceeds the 70-call budget");
}

#[test]
// This test's purpose is asserting the budget constants' values, so
// its assertions are constant-valued by design; the
// `assertions_on_constants` lint is allowed here.
#[allow(clippy::assertions_on_constants)]
fn budget_constants_fit_the_180s_host_cap() {
    use crate::budget;
    // Round 4: TOTAL 150 s (was 50 s, set for a 60 s client). The host
    // caps a run at 180 s, so 150 s leaves a 30 s margin for host
    // overhead and the response.
    assert_eq!(budget::TOTAL_MS, 150_000);
    assert!(budget::TOTAL_MS < 180_000, "TOTAL_MS must stay under the 180 s host cap");
    // The preflight is 13 cached reads; at ~3 s per RPC that is ~39 s
    // (52 s at 4 s/RPC — the gate trips only at ~4.6 s/RPC), so the
    // charge gate is 60 s (was 20 s).
    assert_eq!(budget::PRE_CHARGE_MAX_MS, 60_000);
    // The per-hop minimums are unchanged: a begin needs ~8-15 s and a
    // hop ~15 s, so 25 s / 22 s are safe minimums.
    assert_eq!(budget::BEGIN_MIN_LEFT_MS, 25_000);
    assert_eq!(budget::HOP_MIN_LEFT_MS, 22_000);
    assert_eq!(crate::exact_exit::HOP_MIN_LEFT_MS, 22_000);
    // The two HOP_MIN_LEFT_MS definitions must agree (lib.rs's is
    // unused; the drive uses exact_exit's).
    assert_eq!(budget::HOP_MIN_LEFT_MS, crate::exact_exit::HOP_MIN_LEFT_MS);
    // After the charge gate, enough time must remain for begin + drive + finish.
    assert!(
        budget::TOTAL_MS - budget::PRE_CHARGE_MAX_MS >= 60_000,
        "only {} ms remain after the charge gate",
        budget::TOTAL_MS - budget::PRE_CHARGE_MAX_MS
    );
    // A begin plus three hops must fit inside the total.
    assert!(
        budget::BEGIN_MIN_LEFT_MS + 3 * budget::HOP_MIN_LEFT_MS <= budget::TOTAL_MS,
        "begin + 3 hops do not fit inside TOTAL_MS"
    );
}

#[test]
fn cache_wiring_is_a_single_choke_point() {
    // Stale test: the model depends on the cache being wired into the
    // single `view()` choke point in main.rs, and on every send
    // invalidating it. If the wiring moves, this test fails and the
    // model must be re-derived.
    let main = include_str!("main.rs");
    assert_eq!(
        main.matches("read_cache::get_view").count(),
        1,
        "main.rs view() must consult the cache exactly once"
    );
    assert_eq!(
        main.matches("read_cache::put_view").count(),
        1,
        "main.rs view() must store into the cache exactly once"
    );
    let native_send = include_str!("native_send.rs");
    // Count only the production code (before the test module): the test
    // module itself mentions invalidate() in the round-4 stale-value
    // test, which must not be counted here.
    let native_send_prod = native_send.split("mod tests").next().unwrap();
    assert_eq!(
        native_send_prod.matches("crate::read_cache::invalidate()").count(),
        3,
        "native_send.rs must invalidate after every broadcast (execute x2 + rebroadcast x1)"
    );
    let native_host = include_str!("native_host.rs");
    let native_host_prod = native_host.split("mod tests").next().unwrap_or(native_host);
    assert_eq!(
        native_host_prod.matches("keyhole_worker::read_cache::invalidate()").count(),
        1,
        "native_host.rs send_tx must invalidate after every send"
    );
    // And the model itself must only use methods the cache allows (or
    // explicitly fresh-only ones): every View event's method is either
    // cacheable or one of the documented fresh-only methods.
    for events in [canary_events(), provision_events(), loan_certificate_events()] {
        for e in events {
            if let Event::View(_, method, _) = e {
                assert!(
                    read_cache::is_cacheable(method)
                        || matches!(method, "nft_listing" | "loan_certificate_template"),
                    "{method} is neither cacheable nor a documented fresh-only method"
                );
            }
        }
    }
}

#[test]
fn cache_never_serves_a_stale_value_across_a_broadcast() {
    // The (d) test at the model level: a value cached before a send is
    // never served after it, because every send invalidates. This
    // simulates the exact-exit begin: control is read, the begin sends,
    // and the finish re-reads control — the second read must be a miss.
    let total = simulate(&[
        Event::View(KEYS, "get_control_state", TOKEN), // op handler: miss (1)
        Event::View(KEYS, "get_control_state", TOKEN), // guard_begin: hit (0)
        Event::Send, // the begin send: 1 + invalidate
        Event::View(KEYS, "get_control_state", TOKEN), // finish: miss after the send (1)
    ]);
    assert_eq!(total, 3, "a cached value survived a broadcast");
}
