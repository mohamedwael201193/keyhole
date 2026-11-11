//! Original same-chain FT delivery, not balance-delta inference.
//! Locator (relay or signed holder hint) is untrusted; FINAL RPC graph/events bind it.
use crate::{err, exact_exit::{Plan,TOKEN}, guarded::Journal, receipts, Error};
use serde_json::{json,Value};

fn event(node: &Value, name: &str, standard: &str) -> Vec<Value> {
    node["outcome"]["logs"].as_array().into_iter().flatten().filter_map(|s| {
        let v:Value=serde_json::from_str(s.as_str()?.strip_prefix("EVENT_JSON:")?).ok()?;
        let version=v["version"].as_str()?;
        if v["standard"]!=standard || v["event"]!=name ||
           (standard=="dip4" && !["0.3.0","0.4.0","0.4.1","0.4.2","0.4.3"].contains(&version)) ||
           (standard=="nep141" && version!="1.0.0") {return None;}
        v["data"].as_array().cloned()
    }).flatten().collect()
}
/// Validates the entire closed original graph and every descendant outcome before
/// accepting a unique exact intent and its unique direct FT transfer child.
/// Batching/ambiguous equal transfers fail closed rather than guessing attribution.
pub fn verify(j:&Journal,intent:&str,tx:&Value)->Result<Value,Error>{
    let bad=||err("exit_receipt","original FINAL intent/FT receipt proof missing or ambiguous");
    let p=Plan::journal(j)?;
    if bs58::decode(intent).into_vec().ok().is_none_or(|b|b.len()!=32){return Err(bad());}
    let v=tx.get("result").unwrap_or(tx);
    let hash=v["transaction"]["hash"].as_str().ok_or_else(bad)?;
    let signer=v["transaction"]["signer_id"].as_str().ok_or_else(bad)?;
    if bs58::decode(hash).into_vec().ok().is_none_or(|b|b.len()!=32) ||
       !matches!(receipts::terminal(v,hash,signer,"intents.near",None),Some(receipts::Terminal::Success{..})) || receipts::has_failure(v){return Err(bad());}
    let nodes=v["receipts_outcome"].as_array().ok_or_else(bad)?;
    if nodes.iter().filter(|n|n["outcome"]["executor_id"]==TOKEN).any(|n|event(n,"ft_transfer","nep141").iter().any(|e|e["old_owner_id"]==p.to && e["new_owner_id"]=="intents.near")){return Err(bad());}
    let mut originals=Vec::new();
    for n in nodes.iter().filter(|n|n["outcome"]["executor_id"]=="intents.near") {
        for e in event(n,"ft_withdraw","dip4").into_iter().filter(|e|e["intent_hash"]==intent) {
            if e["account_id"]!=j.wallet_id || e["token"]!=TOKEN || e["receiver_id"]!=p.to || e["amount"]!=p.amount ||
               e.get("msg").is_some_and(|m|!m.is_null()) || e.get("storage_deposit").is_some_and(|m|!m.is_null()) {return Err(bad());}
            originals.push(n);
        }
    }
    if originals.len()!=1 {return Err(bad());}
    let original=originals[0];
    let mut deliveries=Vec::new();
    // NEP-141 ft_transfer is a direct promise from the original verifier action.
    for n in nodes.iter().filter(|n|n["outcome"]["executor_id"]==TOKEN && original["outcome"]["receipt_ids"].as_array().is_some_and(|ids|ids.contains(&n["id"]))) {
        for e in event(n,"ft_transfer","nep141") {
            if e["old_owner_id"]=="intents.near" && e["new_owner_id"]==p.to && e["amount"]==p.amount {deliveries.push(n["id"].clone());}
        }
    }
    // A batched receipt containing another indistinguishable withdrawal must not
    // steal this intent's delivery. Require only this matching withdrawal in root.
    let same=event(original,"ft_withdraw","dip4").into_iter().filter(|e|e["token"]==TOKEN && e["receiver_id"]==p.to && e["amount"]==p.amount).count();
    if deliveries.len()!=1 || same!=1 {return Err(bad());}
    Ok(json!({"evidence_kind":"original_final_ft_receipt","intent_hash":intent,"tx_hash":hash,"signer_id":signer,"intent_receipt_id":original["id"],"ft_receipt_id":deliveries[0],"wallet_id":j.wallet_id,"token":p.token,"to":p.to,"amount":p.amount}))
}
