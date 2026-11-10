//! Holder-only, complete bounded inventory projection. No prices or implicit zeroes.
use crate::{err,Error};
use serde_json::{json,Value};
fn text<'a>(v:&'a Value,k:&str)->Result<&'a str,Error>{v[k].as_str().filter(|s|!s.is_empty()&&s.len()<=512).ok_or_else(||err("inventory_unavailable",format!("missing {k}")))}
fn rows(pages:&[Value])->Result<Vec<Value>,Error>{
 let mut total=None;let mut out=Vec::new();let mut ids=std::collections::HashSet::new();
 for p in pages {let n=p["total"].as_u64().filter(|n|*n<=1000).ok_or_else(||err("inventory_unavailable","unbounded or missing obligation total"))?;
 if total.is_some_and(|x|x!=n){return Err(err("inventory_changed","obligation inventory changed"));}total=Some(n);
 let a=p["requests"].as_array().ok_or_else(||err("inventory_unavailable","missing requests page"))?;
 for r in a {let id=text(r,"request_id").or_else(|_|text(r,"id"))?;if !ids.insert(id.to_owned()){return Err(err("inventory_unavailable","duplicate request"));}out.push(r.clone());}}
 if total!=Some(out.len() as u64){return Err(err("inventory_unavailable","incomplete obligation inventory"));}Ok(out)
}
fn obligation(r:&Value,kind:&str)->Result<Value,Error>{
 let id=text(r,"request_id").or_else(|_|text(r,"id"))?;
 let mut v=json!({"id":id,"kind":kind,"status":r["status"].as_str().unwrap_or("UNKNOWN")});
 for key in ["token","amount","chain"] {if let Some(x)=r[key].as_str(){if x.len()>512{return Err(err("inventory_unavailable","oversized obligation"));}v[key]=json!(x);}}
 Ok(v)
}
pub fn project(balances:&Value,pages:&[Value],orders:&Value,approvals:&Value)->Result<Value,Error>{
 let raw=balances["balances"].as_array().filter(|a|a.len()<=256).ok_or_else(||err("inventory_unavailable","complete asset inventory unavailable"))?;
 if balances.get("has_more").is_some_and(|v|v!=false)||balances.get("next_cursor").is_some_and(|v|!v.is_null()&&v!="")||balances.get("total").is_some_and(|v|v.as_u64()!=Some(raw.len() as u64)){return Err(err("inventory_unavailable","asset inventory is paginated or incomplete"));}
 let mut assets=Vec::new();let mut tokens=std::collections::HashSet::new();
 for r in raw {let token=text(r,"token")?;if !tokens.insert(token.to_owned()){return Err(err("inventory_unavailable","duplicate asset"));}
 let amount=r["amount"].as_str().or_else(||r["balance"].as_str()).filter(|s|!s.is_empty()&&s.len()<=78&&s.bytes().all(|b|b.is_ascii_digit())).ok_or_else(||err("inventory_unavailable","asset amount unavailable"))?;
 let mut a=json!({"token":token,"amount":amount,"priced":false});if let Some(s)=r["symbol"].as_str().filter(|s|s.len()<=24){a["symbol"]=json!(s);}
 if let Some(d)=r["decimals"].as_u64().filter(|n|*n<=38){a["decimals"]=json!(d);}assets.push(a);}
 if orders["complete"]!=true{return Err(err("inventory_unavailable","incomplete open orders"));}
 let mut pending=Vec::new();for r in rows(pages)? {if crate::guarded::settled_inventory(&[json!({"total":1,"requests":[r.clone()]})]).is_err(){pending.push(obligation(&r,"request")?);}}
 let mut obligation_ids=std::collections::HashSet::new();
 for (array,kind) in [(orders["items"].as_array(),"open_order"),(approvals["approvals"].as_array(),"approval")] {let array=array.filter(|a|a.len()<=1000).ok_or_else(||err("inventory_unavailable","unbounded/missing orders or approvals"))?;for r in array{let item=obligation(r,kind)?;if !obligation_ids.insert(format!("{kind}:{}",item["id"])){return Err(err("inventory_unavailable","duplicate obligation"));}pending.push(item);}}
 Ok(json!({"complete":true,"assets":assets,"obligations":pending,"eligible_pending_zero":pending.is_empty(),"whole_account_at_risk":true,"includes_unpriced_assets":true,"later_deposits_also_at_risk":true}))
}
#[cfg(test)] mod tests {
 use super::*;
 fn balances()->Value{json!({"balances":[{"token":"nep141:usdc","amount":"500000","decimals":6},{"token":"unknown:asset","balance":"123"}]})}
 #[test]fn all_assets_including_unpriced_and_pending_obligations_are_preserved(){let v=project(&balances(),&[json!({"total":1,"requests":[{"id":"r1","status":"pending","amount":"1"}]})],&json!({"items":[],"complete":true}),&json!({"approvals":[]})).unwrap();assert_eq!(v["assets"].as_array().unwrap().len(),2);assert_eq!(v["obligations"].as_array().unwrap().len(),1);assert_eq!(v["eligible_pending_zero"],false);}
 #[test]fn failed_without_never_executed_proof_is_still_an_obligation(){for row in [json!({"id":"x","status":"failed"}),json!({"id":"x","status":"cancelled"})]{let v=project(&balances(),&[json!({"total":1,"requests":[row]})],&json!({"items":[],"complete":true}),&json!({"approvals":[]})).unwrap();assert_eq!(v["eligible_pending_zero"],false);}}
 #[test]fn malformed_pagination_metadata_never_becomes_complete(){for b in [json!({"balances":[],"has_more":"false"}),json!({"balances":[],"total":"0"}),json!({"balances":[],"next_cursor":123})]{assert!(project(&b,&[json!({"total":0,"requests":[]})],&json!({"items":[],"complete":true}),&json!({"approvals":[]})).is_err());}}
 #[test]fn duplicate_open_orders_and_incomplete_pages_are_rejected(){for orders in [json!({"items":[],"complete":false}),json!({"items":[{"id":"x"},{"id":"x"}],"complete":true})]{assert!(project(&balances(),&[json!({"total":0,"requests":[]})],&orders,&json!({"approvals":[]})).is_err());}}
 #[test]fn missing_or_partial_assets_are_never_an_empty_balance(){for b in [json!({}),json!({"balances":[],"has_more":true}),json!({"balances":[],"total":1}),json!({"balances":[{"token":"x","amount":123}]})]{assert!(project(&b,&[json!({"total":0,"requests":[]})],&json!({"items":[],"complete":true}),&json!({"approvals":[]})).is_err());}}
 #[test]fn all_request_pages_must_match_total_and_have_unique_ids(){for pages in [vec![],vec![json!({"total":1,"requests":[]})],vec![json!({"total":2,"requests":[{"id":"x"},{"id":"x"}]})],vec![json!({"total":1001,"requests":[]})]]{assert!(project(&balances(),&pages,&json!({"items":[],"complete":true}),&json!({"approvals":[]})).is_err());}}
 #[test]fn settled_requests_are_not_obligations_and_private_extras_are_not_echoed(){let mut b=balances();b["balances"][0]["api_key"]=json!("NEVER_ECHO");let v=project(&b,&[json!({"total":1,"requests":[{"request_id":"00000000-0000-4000-8000-000000000001","status":"success"}]})],&json!({"items":[],"complete":true}),&json!({"approvals":[]})).unwrap();assert_eq!(v["eligible_pending_zero"],true);assert!(!v.to_string().contains("NEVER_ECHO"));}
}
