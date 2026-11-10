//! Refund cashout for the enclave-owned minter. Registration is a separate,
//! explicitly approved operator action; no holder is charged or sponsored here.
//! A submitted transaction is NEVER described as delivered native money.
use crate::Error;
use serde_json::{json, Value};

/// Only the definitive missing-method error identifies a pre-payout contract.
pub fn legacy_missing_method(error: &Error) -> bool {
    error.message.contains("MethodNotFound")
}

pub trait Host {
    fn snapshot(&mut self) -> Result<(Value, Value), Error>;
    fn claim(&mut self) -> Result<String, Error>;
}

/// Mint has already succeeded. Refund failure must not undo its quota or invite
/// a duplicate mint. The contract serializes claim_payout against pending credits.
/// On a later mint, read that state again; NEVER duplicate a pending claim.
pub fn finish(host: &mut impl Host, supported: bool) -> Value {
    if !supported {
        return json!({"status":"not_supported"});
    }
    let Ok((credit, pending)) = host.snapshot() else {
        return json!({"status":"needs_review","reason":"payout_state_unavailable"});
    };
    let Some(amount) = credit
        .as_str()
        .and_then(|s| s.parse::<u128>().ok())
        .filter(|n| credit.as_str() == Some(n.to_string().as_str()))
    else {
        return json!({"status":"needs_review","reason":"invalid_payout_credit"});
    };
    if !pending.is_null() {
        return json!({"status":"pending","credit_yocto":credit,"native_delivery":"UNVERIFIED"});
    }
    if amount == 0 {
        return json!({"status":"no_credit","credit_yocto":"0"});
    }
    match host.claim() {
        Ok(tx) => json!({"status":"cashout_submitted","tx":tx,"native_delivery":"UNVERIFIED"}),
        Err(_) => {
            json!({"status":"needs_review","reason":"cashout_outcome_unverified","native_delivery":"UNVERIFIED"})
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::err;
    struct Fake {
        credit: Value,
        pending: Value,
        read_fail: bool,
        claim_fail: bool,
        reads: u32,
        claims: u32,
    }
    impl Host for Fake {
        fn snapshot(&mut self) -> Result<(Value, Value), Error> {
            self.reads += 1;
            if self.read_fail {
                return Err(err("rpc", "unavailable"));
            }
            Ok((self.credit.clone(), self.pending.clone()))
        }
        fn claim(&mut self) -> Result<String, Error> {
            self.claims += 1;
            if self.claim_fail {
                return Err(err("rpc", "uncertain send"));
            }
            self.pending = json!({"nonce":"1"});
            Ok("unsigned-test-transaction-hash".into())
        }
    }
    #[test]
    fn only_missing_method_allows_legacy_mint_without_payout_methods() {
        assert!(legacy_missing_method(&err(
            "rpc",
            "MethodResolveError(MethodNotFound)"
        )));
        for message in [
            "MethodResolveError(MethodInvalidSignature)",
            "timeout",
            "unavailable",
        ] {
            assert!(!legacy_missing_method(&err("rpc", message)));
        }
    }
    fn fake() -> Fake {
        Fake {
            credit: json!("1000"),
            pending: Value::Null,
            read_fail: false,
            claim_fail: false,
            reads: 0,
            claims: 0,
        }
    }
    #[test]
    fn legacy_mint_never_calls_nonexistent_payout_methods() {
        let mut h = fake();
        assert_eq!(finish(&mut h, false)["status"], "not_supported");
        assert_eq!((h.reads, h.claims), (0, 0));
    }
    #[test]
    fn ready_minter_refund_claim_is_submitted_but_not_labelled_delivered() {
        let mut h = fake();
        let out = finish(&mut h, true);
        assert_eq!(out["status"], "cashout_submitted");
        assert_eq!(out["native_delivery"], "UNVERIFIED");
        assert_eq!(h.claims, 1);
    }
    #[test]
    fn repeated_mint_does_not_redispatch_a_pending_refund() {
        let mut h = fake();
        finish(&mut h, true);
        assert_eq!(finish(&mut h, true)["status"], "pending");
        assert_eq!(h.claims, 1);
    }
    #[test]
    fn no_refund_credit_does_not_spend_cashout_gas() {
        let mut h = fake();
        h.credit = json!("0");
        assert_eq!(finish(&mut h, true)["status"], "no_credit");
        assert_eq!(h.claims, 0);
    }
    #[test]
    fn missing_state_does_not_guess_or_dispatch() {
        let mut h = fake();
        h.read_fail = true;
        assert_eq!(finish(&mut h, true)["status"], "needs_review");
        assert_eq!(h.claims, 0);
    }
    #[test]
    fn malformed_credit_does_not_guess_or_dispatch() {
        for credit in [
            json!(10),
            json!("01"),
            json!("-1"),
            json!("340282366920938463463374607431768211456"),
        ] {
            let mut h = fake();
            h.credit = credit;
            assert_eq!(finish(&mut h, true)["status"], "needs_review");
            assert_eq!(h.claims, 0);
        }
    }
    #[test]
    fn lost_cashout_reply_is_not_mint_failure_or_native_delivery() {
        let mut h = fake();
        h.claim_fail = true;
        let out = finish(&mut h, true);
        assert_eq!(out["status"], "needs_review");
        assert_eq!(out["native_delivery"], "UNVERIFIED");
        assert_eq!(h.claims, 1);
    }
    #[test]
    fn restored_credit_after_definite_callback_failure_can_be_claimed_again() {
        let mut h = fake();
        finish(&mut h, true);
        h.pending = Value::Null;
        assert_eq!(finish(&mut h, true)["status"], "cashout_submitted");
        assert_eq!(h.claims, 2);
    }
}
