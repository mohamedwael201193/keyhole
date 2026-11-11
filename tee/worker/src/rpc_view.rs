//! The WIT RPC host returns decoded view text, not an absence oracle.
use crate::{err, Error};
use serde_json::Value;
pub fn decode(method: &str, raw: &str) -> Result<Value, Error> {
    let v: Value = serde_json::from_str(raw).map_err(|_| err("rpc_unavailable", "invalid RPC view JSON"))?;
    if v.get("error").is_some() || v.get("jsonrpc").is_some() {
        return Err(err("rpc_unavailable", "unexpected RPC envelope"));
    }
    let valid = match method {
        "get_collateral_binding" | "get_pending_registration" | "get_wallet_policy" | "get_loan" => v.is_null() || v.is_object(),
        "get_pledge_config" | "get_control_state" | "config" | "nft_token" => v.is_object(),
        "nft_tokens_for_owner" | "list_versions" => v.is_array(),
        _ => true,
    };
    if !valid { return Err(err("rpc_unavailable", "unexpected RPC view schema")); }
    Ok(v)
}
#[cfg(test)]
mod tests {
    use super::*;
    // This decoder is the exact production view() boundary, before register,
    // policy encryption/signing/funding or any enrollment commit marker.
    #[test]
    fn malformed_transport_never_reaches_provider_or_seal() {
        for raw in ["", "<html>error</html>", "{\"ready\":", "{\"error\":{\"code\":-1}}", "{\"jsonrpc\":\"2.0\",\"result\":null}", "[]", "false", "0", "\"null\""] {
            let mut posts = 0;
            let mut marker = false;
            let result = decode("get_collateral_binding", raw).map(|v| {
                if v.is_null() { posts += 1; marker = true; }
            });
            assert!(result.is_err(), "{raw}"); assert_eq!(posts, 0); assert!(!marker);
        }
    }
    #[test]
    fn only_valid_literal_null_establishes_absence() {
        for method in ["get_collateral_binding", "get_pending_registration", "get_wallet_policy"] {
            assert!(decode(method, "null").unwrap().is_null());
        }
        assert!(decode("config", "null").is_err());
        assert!(decode("get_pledge_config", "[]").is_err());
        assert!(decode("get_control_state", "false").is_err());
        assert!(decode("nft_tokens_for_owner", "{}").is_err());
    }
}

#[cfg(test)]
#[test]
fn production_view_boundary_uses_strict_decoder_before_absence_gates() {
    let main=include_str!("main.rs");
    let view=main.split("fn view(").nth(1).unwrap().split("fn holder_tier(").next().unwrap();
    assert!(view.contains("rpc_view::decode(method, &r)"));
    assert!(!view.contains("unwrap_or"));
    let fresh=include_str!("collateral_evidence_host.rs").split("fn op_create_collateral_wallet(").nth(1).unwrap().split("fn candidate_policy(").next().unwrap();
    assert!(fresh.find("get_pending_registration").unwrap() < fresh.find("evidence::register_fresh").unwrap());
}
