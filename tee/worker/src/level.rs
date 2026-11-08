//! Earned tiers: the pure rule (boundaries, both thresholds, never a downgrade), progress toward the next tier,
//! counting settled trades, and refusing a provenance chain that does not verify.
use crate::*;
use serde_json::{json, Value};

const USD: u64 = 1_000_000;

fn trade(kind: &str, status: &str, usd: u64) -> Value { json!({"kind": kind, "status": status, "usd_in_micro": usd}) }

fn chain(n: usize) -> Vec<ProvEvent> {
    let mut log = Vec::new();
    for i in 0..n {
        let kind = if i % 2 == 0 { "swap" } else { "copy" };
        append_event(&mut log, kind, "k1", "alice.near", 1000 + i as u64, &format!("swap {i}"));
    }
    log
}

// ---------- the rule ----------

#[test] fn bronze_holds_with_nothing_earned() { assert_eq!(earned_tier(1, 0, 0), 1); }
#[test] fn silver_needs_ten_swaps_and_five_dollars() { assert_eq!(earned_tier(1, 10, 5 * USD), 2); }
#[test] fn nine_swaps_is_not_silver() { assert_eq!(earned_tier(1, 9, 1_000 * USD), 1); }
#[test] fn silver_volume_one_micro_short_is_not_silver() { assert_eq!(earned_tier(1, 10, 5 * USD - 1), 1); }
#[test] fn volume_alone_is_not_enough() { assert_eq!(earned_tier(1, 0, 10_000 * USD), 1); }
#[test] fn gold_needs_forty_swaps_and_fifty_dollars() { assert_eq!(earned_tier(2, 40, 50 * USD), 3); }
#[test] fn thirty_nine_swaps_is_not_gold() { assert_eq!(earned_tier(2, 39, 500 * USD), 2); }
#[test] fn gold_volume_one_micro_short_is_not_gold() { assert_eq!(earned_tier(2, 40, 50 * USD - 1), 2); }
#[test] fn many_swaps_with_little_volume_stay_silver() { assert_eq!(earned_tier(2, 400, 4 * USD), 2); }
#[test] fn bronze_can_jump_straight_to_gold() { assert_eq!(earned_tier(1, 40, 50 * USD), 3); }
#[test] fn a_higher_current_tier_is_never_lowered() { assert_eq!(earned_tier(3, 0, 0), 3); assert_eq!(earned_tier(2, 0, 0), 2); }
#[test] fn gold_stays_gold_when_counts_fall_short() { assert_eq!(earned_tier(3, 1, 1), 3); }
#[test] fn silver_is_not_lowered_by_bronze_counts() { assert_eq!(earned_tier(2, 10, 5 * USD), 2); }
#[test] fn rules_rise_in_tier_threshold_and_volume() {
    assert!(TIER_RULES.windows(2).all(|w| w[0].0 < w[1].0 && w[0].1 < w[1].1 && w[0].2 < w[1].2));
    assert_eq!(TIER_RULES.iter().map(|r| r.0).collect::<Vec<_>>(), vec![2, 3]);
}
#[test] fn every_rule_names_a_tier_the_worker_has_limits_for() {
    for (t, _, _) in TIER_RULES { assert!(limits_for_tier(*t).is_some(), "tier {t}"); }
}
#[test] fn level_up_gas_is_ten_tgas() { assert_eq!(LEVEL_UP_GAS, 10_000_000_000_000); }

// ---------- progress ----------

#[test] fn progress_from_bronze_targets_silver() {
    let p = tier_progress(1, 3, 2 * USD);
    assert_eq!((p.current, p.next, p.swaps_needed, p.volume_needed_usd_micro), (1, Some(2), 10, 5 * USD));
    assert!(!p.swaps_done && !p.volume_done && !p.met);
}
#[test] fn progress_from_silver_targets_gold() {
    let p = tier_progress(2, 0, 0);
    assert_eq!((p.next, p.swaps_needed, p.volume_needed_usd_micro), (Some(3), 40, 50 * USD));
}
#[test] fn progress_at_the_top_has_no_next_tier() {
    let p = tier_progress(3, 999, 999 * USD);
    assert_eq!((p.next, p.swaps_needed, p.volume_needed_usd_micro, p.met), (None, 0, 0, false));
}
#[test] fn progress_marks_each_threshold_on_its_own() {
    let swaps_only = tier_progress(1, 10, 1);
    assert!(swaps_only.swaps_done && !swaps_only.volume_done && !swaps_only.met);
    let volume_only = tier_progress(1, 1, 5 * USD);
    assert!(!volume_only.swaps_done && volume_only.volume_done && !volume_only.met);
}
#[test] fn progress_is_met_when_both_thresholds_are_reached() { assert!(tier_progress(1, 10, 5 * USD).met); }
#[test] fn progress_agrees_with_the_earned_tier_on_a_grid() {
    for current in 1..=3u8 {
        for n in [0u32, 1, 9, 10, 39, 40, 100] {
            for v in [0u64, USD, 5 * USD - 1, 5 * USD, 49 * USD, 50 * USD, 60 * USD] {
                let met = tier_progress(current, n, v).met;
                assert_eq!(met, earned_tier(current, n, v) > current, "current {current}, swaps {n}, volume {v}");
            }
        }
    }
}

// ---------- counting ----------

#[test] fn only_successful_swaps_and_copies_count() {
    let rows = vec![
        trade("swap", "success", 5 * USD), trade("copy", "success", 2 * USD),
        trade("swap", "failed", 9 * USD), trade("swap", "pending", 9 * USD), trade("swap", "refunded", 4 * USD),
        trade("withdraw", "success", 7 * USD), trade("deposit", "success", 3 * USD),
    ];
    assert_eq!(level_counts(&rows), (2, 7 * USD));
}
#[test] fn a_row_without_a_kind_does_not_count() { assert_eq!(level_counts(&[json!({"status": "success", "usd_in_micro": 1})]), (0, 0)); }
#[test] fn a_row_without_a_status_does_not_count() { assert_eq!(level_counts(&[json!({"kind": "swap", "usd_in_micro": 1})]), (0, 0)); }
#[test] fn a_success_row_with_no_usd_counts_as_a_swap_at_zero() { assert_eq!(level_counts(&[json!({"kind": "swap", "status": "success"})]), (1, 0)); }
#[test] fn no_rows_count_nothing() { assert_eq!(level_counts(&[]), (0, 0)); }
#[test] fn counting_saturates_instead_of_wrapping() { assert_eq!(level_counts(&[trade("swap", "success", u64::MAX), trade("swap", "success", 5)]).1, u64::MAX); }
#[test] fn ten_settled_swaps_of_fifty_cents_earn_silver() {
    let rows: Vec<Value> = (0..10).map(|_| trade("swap", "success", USD / 2)).collect();
    let (n, v) = level_counts(&rows);
    assert_eq!((n, v), (10, 5 * USD));
    assert_eq!(earned_tier(1, n, v), 2);
}
#[test] fn failed_swaps_alone_never_earn_a_tier() {
    let rows: Vec<Value> = (0..50).map(|_| trade("swap", "failed", 100 * USD)).collect();
    let (n, v) = level_counts(&rows);
    assert_eq!(earned_tier(1, n, v), 1);
}

// ---------- the chain gate ----------

#[test] fn an_empty_record_earns_nothing() {
    let a = assess_level(&[], &[], 1).unwrap();
    assert_eq!((a.earned, a.progress.met), (1, false));
}
#[test] fn a_verified_chain_reports_its_head_and_the_earned_tier() {
    let log = chain(3);
    let trades = vec![trade("swap", "success", 50 * USD); 40];
    let a = assess_level(&log, &trades, 1).unwrap();
    assert_eq!(a.log_head, verify_chain(&log).unwrap());
    assert_eq!(a.earned, 3);
    assert_eq!(a.progress.next, Some(2));
}
#[test] fn a_chain_with_a_changed_event_is_refused_and_nothing_is_counted() {
    let mut log = chain(3);
    log[1].kind = "withdraw".into();
    let trades = vec![trade("swap", "success", 100 * USD); 50];
    assert_eq!(assess_level(&log, &trades, 1).unwrap_err().code, "bad_log");
}
#[test] fn a_chain_with_a_broken_link_is_refused() {
    let mut log = chain(3);
    log[2].prev = "0".repeat(64);
    let trades = vec![trade("swap", "success", 100 * USD); 50];
    assert_eq!(assess_level(&log, &trades, 1).unwrap_err().code, "bad_log");
}
#[test] fn a_chain_with_a_wrong_index_is_refused() {
    let mut log = chain(2);
    log[1].i = 7;
    assert_eq!(assess_level(&log, &[], 1).unwrap_err().code, "bad_log");
}

// ---------- scope ----------

#[test] fn level_up_is_a_session_op() { assert!(SESSION_OPS.contains(&"level_up")); }
#[test] fn withdraw_stays_outside_the_session_ops_with_level_up_added() { assert!(!SESSION_OPS.contains(&"withdraw")); }
