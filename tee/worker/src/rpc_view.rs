//! The WIT RPC host returns decoded view text, not an absence oracle.
use crate::{err, Error};
use serde_json::Value;
pub fn decode(method: &str, raw: &str) -> Result<Value, Error> {
    let v: Value =
        serde_json::from_str(raw).map_err(|_| err("rpc_unavailable", "invalid RPC view JSON"))?;
    if v.get("error").is_some() || v.get("jsonrpc").is_some() {
        return Err(err("rpc_unavailable", "unexpected RPC envelope"));
    }
    let valid = match method {
        // Contract Option views: JSON null means absence (unminted token, no loan, no binding).
        "nft_token"
        | "get_collateral_binding"
        | "get_pending_registration"
        | "get_wallet_policy"
        | "get_loan"
        | "get_pending_payout"
        | "get_value_op" => v.is_null() || v.is_object(),
        "holder_tier" | "nft_tier" => v.is_null() || v.is_number(),
        "get_pledge_config"
        | "get_control_state"
        | "config"
        | "get_project"
        | "loan_certificate_template"
        | "storage_balance_bounds" => v.is_object(),
        "nft_tokens_for_owner" | "list_versions" => v.is_array(),
        _ => true,
    };
    if !valid {
        return Err(err("rpc_unavailable", "unexpected RPC view schema"));
    }
    Ok(v)
}
/// The same owner extraction `op_mint` uses after `nft_token`. Null (not minted) is `None`.
pub fn nft_token_owner(existing: &Value) -> Option<&str> {
    existing.get("owner_id").and_then(|o| o.as_str())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::assert_mint_id_free;
    // This decoder is the exact production view() boundary, before register,
    // policy encryption/signing/funding or any enrollment commit marker.
    #[test]
    fn malformed_transport_never_reaches_provider_or_seal() {
        for raw in [
            "",
            "<html>error</html>",
            "{\"ready\":",
            "{\"error\":{\"code\":-1}}",
            "{\"jsonrpc\":\"2.0\",\"result\":null}",
            "[]",
            "false",
            "0",
            "\"null\"",
        ] {
            let mut posts = 0;
            let mut marker = false;
            let result = decode("get_collateral_binding", raw).map(|v| {
                if v.is_null() {
                    posts += 1;
                    marker = true;
                }
            });
            assert!(result.is_err(), "{raw}");
            assert_eq!(posts, 0);
            assert!(!marker);
        }
    }
    #[test]
    fn only_valid_literal_null_establishes_absence() {
        for method in [
            "nft_token",
            "get_collateral_binding",
            "get_pending_registration",
            "get_wallet_policy",
            "get_loan",
            "get_pending_payout",
            "get_value_op",
        ] {
            assert!(decode(method, "null").unwrap().is_null(), "{method}");
            assert!(decode(method, "{}").unwrap().is_object(), "{method}");
            assert!(decode(method, "[]").is_err(), "{method} array");
            assert!(decode(method, "false").is_err(), "{method} bool");
        }
        for method in ["holder_tier", "nft_tier"] {
            assert!(decode(method, "null").unwrap().is_null(), "{method}");
            assert!(decode(method, "1").unwrap().is_number(), "{method}");
            assert!(decode(method, "{}").is_err(), "{method} object");
        }
        assert!(decode("config", "null").is_err());
        assert!(decode("get_pledge_config", "null").is_err());
        assert!(decode("get_pledge_config", "[]").is_err());
        assert!(decode("get_control_state", "null").is_err());
        assert!(decode("get_control_state", "false").is_err());
        assert!(decode("nft_tokens_for_owner", "{}").is_err());
        assert!(decode("nft_tokens_for_owner", "[]").unwrap().is_array());
    }
    #[test]
    fn unminted_nft_token_null_lets_mint_proceed() {
        let existing =
            decode("nft_token", "null").expect("unminted nft_token is JSON null, not an RPC error");
        assert!(existing.is_null());
        assert_eq!(nft_token_owner(&existing), None);
        assert!(assert_mint_id_free(nft_token_owner(&existing)).is_ok());
    }
    #[test]
    fn minted_nft_token_object_still_blocks_reuse() {
        let existing = decode("nft_token", r#"{"token_id":"k1","owner_id":"alice.near"}"#).unwrap();
        assert_eq!(nft_token_owner(&existing), Some("alice.near"));
        assert_eq!(
            assert_mint_id_free(nft_token_owner(&existing))
                .unwrap_err()
                .code,
            "already_minted"
        );
    }
}

#[cfg(test)]
#[test]
fn production_view_boundary_uses_strict_decoder_before_absence_gates() {
    let main = include_str!("main.rs");
    let view = main
        .split("fn view(")
        .nth(1)
        .unwrap()
        .split("fn holder_tier(")
        .next()
        .unwrap();
    assert!(view.contains("rpc_view::decode(method, &r)"));
    assert!(!view.contains("unwrap_or"));
    let fresh = include_str!("collateral_evidence_host.rs")
        .split("fn op_create_collateral_wallet(")
        .nth(1)
        .unwrap()
        .split("fn candidate_policy(")
        .next()
        .unwrap();
    assert!(
        fresh.find("get_pending_registration").unwrap()
            < fresh.find("evidence::register_fresh").unwrap()
    );
}
