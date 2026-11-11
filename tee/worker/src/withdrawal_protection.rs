//! Only the explicitly signed exact NEAR exit is executable. Legacy quoted
//! confidential withdrawals stay disabled; preview fields cannot enable them.
use crate::{err, Error};
use serde_json::Value;
pub fn require_bound_execution(p: &Value, now_ms: u64) -> Result<(), Error> {
    for field in ["chain", "to", "token", "amount", "min_amount_out"] {
        if !p[field].as_str().is_some_and(|s| !s.is_empty()) {
            return Err(err("withdraw_minimum_required", "holder-signed destination, asset, amount and minimum required"));
        }
    }
    for field in ["amount", "min_amount_out"] {
        if !p[field].as_str().and_then(|s| s.parse::<u128>().ok()).is_some_and(|n| n > 0) {
            return Err(err("withdraw_minimum_required", "positive holder-signed amount and minimum required"));
        }
    }
    if !p["deadline_ms"].as_u64().is_some_and(|t| t > now_ms && t <= now_ms.saturating_add(300_000)) {
        return Err(err("withdraw_quote_expired", "fresh holder-signed deadline required"));
    }
    if p["exit_mode"] != "exact-near-v1" { return deny_unbound_provider_execution(); }
    if p["chain"] != "near" || p["token"] != crate::guarded::ASSET
        || p["amount"] != p["min_amount_out"] || !p["to"].as_str().is_some_and(crate::is_valid_account_id)
        || !p["amount"].as_str().is_some_and(|s| s.starts_with(|c: char| c.is_ascii_digit() && c != '0') && s.bytes().all(|b| b.is_ascii_digit())) {
        return Err(err("withdraw_exact_policy", "canonical USDC on NEAR and amount equal to signed exact minimum required"));
    }
    Ok(())
}
pub fn deny_unbound_provider_execution() -> Result<(), Error> {
    Err(err("withdraw_execution_unavailable", "provider cannot bind execution to the accepted minimum; preview advisory only; STOP for separately approved slippage/fee policy"))
}
/// Production adapter: every custody lookup, spend reservation, native admission,
/// signature and execution transport is inside `execute`. The same adapter is
/// injected with a recording transport by native and sandbox tests. It cannot
/// be enabled by caller-supplied quote fields or an execution_supported boolean.
/// The refusal predicate and the durable provider denial remain unchanged.
pub fn dispatch<T>(p: &Value, now_ms: u64, execute: impl FnOnce() -> Result<T, Error>) -> Result<T, Error> {
    require_bound_execution(p, now_ms)?;
    execute()
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn preview_changes_never_authorize_an_unbound_execution_post() {
        let p = json!({"chain":"near","to":"holder.near","token":"usdc","amount":"100","min_amount_out":"90","deadline_ms":2000});
        for (field, value) in [("min_amount_out",json!(null)),("min_amount_out",json!("0")),("deadline_ms",json!(999)),("to",json!("wrong.near")),("token",json!("wrong-asset")),("preview_amount_out",json!("1")),("quote_id",json!("changed-quote"))] {
            let mut changed = p.clone(); changed[field] = value;
            let mut posts = 0;
            if require_bound_execution(&changed, 1000).is_ok() { posts += 1; }
            assert_eq!(posts, 0);
        }
        assert_eq!(require_bound_execution(&p,1000).unwrap_err().code,"withdraw_execution_unavailable");
    }
    #[test]
    fn production_gate_precedes_custody_and_spend() {
        let s = include_str!("main.rs").split("fn op_withdraw(").nth(1).unwrap().split("fn load_prov(").next().unwrap();
        let gate = s.find("withdrawal_protection::dispatch").unwrap();
        for after in ["guarded_wallet(", "charge_spend(", "guard_begin(", "guard_provider("] { assert!(gate < s.find(after).unwrap()); }
    }
}
