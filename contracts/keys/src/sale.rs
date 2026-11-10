//! Buyer-bound, sealed-minimum purchase. Exact native consideration, title and seller credit
//! settle locally together. Provider commands are strictly single-flight: unknown stays locked.
use crate::*;
use crate::pledge::{self,collateral,config_required,save_config,add_credit,change_liabilities};
use near_sdk::json_types::{Base64VecU8,U64};
use near_sdk::Gas;
pub const SALE_DOMAIN:&str="KEYHOLE_SEALED_SALE_V1";
pub const SALE_STORAGE_BOND:u128=20_000_000_000_000_000_000_000;
const ENABLED:&[u8]=b"Se";
const NEXT:&[u8]=b"Sn";
#[derive(Clone,Debug,PartialEq)]
#[near(serializers=[borsh,json])]
pub struct SaleTerms {pub buyer:AccountId,pub price:U128,pub floor_raw:U128,pub deadline_ns:U64}
#[derive(Clone,Debug,PartialEq)]
#[near(serializers=[borsh,json])]
pub enum SaleState {Freezing,Offered,UnlockPending}
#[derive(Clone,Debug,PartialEq)]
#[near(serializers=[borsh,json])]
pub struct Sale {
 pub token_id:TokenId,pub nonce:U64,pub seller:AccountId,pub owner_epoch:U64,pub terms:SaleTerms,
 pub state:SaleState,pub sold:bool,pub current_holder:AccountId,pub royalty_bps:u32,pub seller_net:U128,
 pub policy_sequence:U64,pub policy_busy:bool,pub policy_call_complete:bool,
}
#[derive(Clone,Debug,PartialEq)]
#[near(serializers=[borsh,json])]
pub struct SaleCertificate {
 pub domain:String,pub network:String,pub contract:AccountId,pub token_id:TokenId,pub sale_nonce:U64,
 pub seller:AccountId,pub owner_epoch:U64,pub terms:SaleTerms,pub royalty_bps:u32,pub seller_net:U128,
 pub custody_contract:AccountId,pub wallet_pubkey:String,pub asset:String,pub decimals:u8,
 pub controller:AccountId,pub policy_version:U64,pub policy_hash:Base64VecU8,pub policy_sequence:U64,
 pub observed_at_ns:U64,pub expires_at_ns:U64,pub floor_met:bool,pub frozen:bool,pub pending_value_ops:U64,
}
pub(crate) fn sales()->LookupMap<TokenId,Sale>{LookupMap::new(b"Ss".as_slice())}
fn enabled()->bool{env::storage_read(ENABLED).as_deref()==Some(&[1])}
fn load(token:&TokenId,nonce:U64)->Sale{let s=sales().get(token).unwrap_or_else(||env::panic_str("no protected sale"));require!(s.nonce==nonce,"sale nonce mismatch");s}
fn call(target:AccountId,method:&str,args:near_sdk::serde_json::Value,gas:u64)->Promise{Promise::new(target).function_call(method.into(),args.to_string().into_bytes(),yocto(0),Gas::from_tgas(gas))}
fn cb(method:&str,args:near_sdk::serde_json::Value,gas:u64)->Promise{call(env::current_account_id(),method,args,gas)}
fn enough_gas(){require!(env::prepaid_gas()>=Gas::from_tgas(180),"attach at least 180 Tgas");}
#[derive(near_sdk::serde::Deserialize)]
#[serde(crate="near_sdk::serde")]
struct Policy {owner:AccountId,encrypted_data:String,version:u64,locked:bool,frozen:bool}

#[near]
impl Contract {
 pub fn protected_sales_enabled(&self)->bool{enabled()}
 #[payable]
 pub fn set_protected_sales_enabled(&mut self,enabled:bool){assert_one_yocto();self.assert_owner();config_required();require!(!enabled||self.royalty_bps==0,"adopt zero royalty first");env::storage_write(ENABLED,&[u8::from(enabled)]);}
 pub fn get_sale(&self,token_id:TokenId)->Option<Sale>{sales().get(&token_id)}
 #[payable]
 pub fn open_sale(&mut self,token_id:TokenId,terms:SaleTerms)->Promise {
  enough_gas();require!(enabled(),"protected sales disabled");require!(self.royalty_bps==0,"zero royalty required");
  self.assert_can_change_owner(&token_id);let mut c=config_required();
  let seller=self.tokens.owner_by_id.get(&token_id).unwrap_or_else(||env::panic_str("unknown token"));
  require!(env::predecessor_account_id()==seller,"only seller");require!(listings().get(&token_id).is_none(),"unlist first");
  require!(terms.buyer!=seller && terms.buyer!=env::current_account_id(),"distinct external buyer required");self.assert_no_key(&terms.buyer);
  require!(terms.price.0>0 && terms.price.0<=MAX_LIST_PRICE,"bad sale price");require!(terms.floor_raw.0>0,"zero floor");
  let now=env::block_timestamp();require!(terms.deadline_ns.0>now && terms.deadline_ns.0<=now.saturating_add(7*86_400_000_000_000),"bad sale deadline");
  require!(collateral().get(&token_id).is_some_and(|b|b.ready),"collateral confinement not ready");
  require!(env::attached_deposit().as_yoctonear()==SALE_STORAGE_BOND,"attach exact sale storage bond");
  let n=env::storage_read(NEXT).map(|b|u64::from_le_bytes(b.try_into().unwrap_or_else(|_|env::panic_str("sale nonce corrupt")))).unwrap_or(0).checked_add(1).unwrap_or_else(||env::panic_str("sale nonce overflow"));
  let before=env::storage_usage();env::storage_write(NEXT,&n.to_le_bytes());
  let s=Sale{token_id:token_id.clone(),nonce:U64(n),seller:seller.clone(),owner_epoch:self.nft_settlement_epoch(token_id.clone()),seller_net:terms.price,terms,state:SaleState::Freezing,sold:false,current_holder:seller,royalty_bps:0,policy_sequence:U64(0),policy_busy:false,policy_call_complete:false};
  sales().insert(&token_id,&s);change_liabilities(&mut c,SALE_STORAGE_BOND,0);save_config(&c);
  // Measured record plus bounded future credit ledger overhead, not a guessed bond reduction.
  let cost=(env::storage_usage().saturating_sub(before)+512) as u128*env::storage_byte_cost().as_yoctonear();require!(cost<=SALE_STORAGE_BOND,"sale bond does not cover storage");
  self.start_sale_policy(token_id,true)
 }
 fn start_sale_policy(&mut self,token:TokenId,freeze:bool)->Promise{
  let mut s=sales().get(&token).unwrap_or_else(||env::panic_str("no protected sale"));
  require!((freeze&&s.state==SaleState::Freezing)||(!freeze&&s.state==SaleState::UnlockPending),"wrong sale custody phase");
  require!(!s.policy_busy,"sale policy action/read pending: no redispatch");
  s.policy_sequence=U64(s.policy_sequence.0.checked_add(1).unwrap_or_else(||env::panic_str("sale policy sequence overflow")));
  s.policy_busy=true;s.policy_call_complete=false;sales().insert(&token,&s);
  let c=config_required();let b=collateral().get(&token).unwrap_or_else(||env::panic_str("unbound collateral"));
  // Exact documented real-provider ABI: terminal receipt callback is the ordering fence.
  call(c.custody_contract,if freeze{"freeze_wallet"}else{"unfreeze_wallet"},near_sdk::serde_json::json!({"wallet_pubkey":b.wallet_pubkey}),20)
   .then(cb("on_sale_policy_action",near_sdk::serde_json::json!({"token_id":token,"nonce":s.nonce,"sequence":s.policy_sequence}),65))
 }
 #[private]
 pub fn on_sale_policy_action(&mut self,token_id:TokenId,nonce:U64,sequence:U64)->PromiseOrValue<bool>{
  require!(env::predecessor_account_id()==env::current_account_id(),"callback is private");pledge::callback_failure_fixture();
  let Some(mut s)=sales().get(&token_id) else{return PromiseOrValue::Value(false);};
  if s.nonce!=nonce || s.policy_sequence!=sequence || !s.policy_busy || s.policy_call_complete{return PromiseOrValue::Value(false);}
  // Terminal action alone is insufficient: keep busy through exact policy verification.
  // Duplicate action callbacks must not enqueue another read or release the command lock.
  let result=unsafe{near_sdk::sys::promise_result(0,12_345)};require!(result==1||result==2,"missing policy result");
  s.policy_call_complete=true;sales().insert(&token_id,&s);
  PromiseOrValue::Promise(self.read_sale_policy(token_id,s))
 }
 fn read_sale_policy(&self,token:TokenId,s:Sale)->Promise{
  require!(s.policy_busy&&s.policy_call_complete,"sale policy outcome unknown: cannot reconcile by view");
  let c=config_required();let b=collateral().get(&token).unwrap_or_else(||env::panic_str("unbound collateral"));
  call(c.custody_contract,"get_wallet_policy",near_sdk::serde_json::json!({"wallet_pubkey":b.wallet_pubkey}),15)
   .then(cb("on_sale_policy_view",near_sdk::serde_json::json!({"token_id":token,"nonce":s.nonce,"sequence":s.policy_sequence}),30))
 }
 pub fn reconcile_sale_policy(&self,token_id:TokenId,nonce:U64)->Promise{let s=load(&token_id,nonce);self.read_sale_policy(token_id,s)}
 pub fn retry_sale_policy(&mut self,token_id:TokenId,nonce:U64)->Promise{enough_gas();let s=load(&token_id,nonce);self.start_sale_policy(token_id,s.state==SaleState::Freezing)}
 #[private]
 pub fn on_sale_policy_view(&mut self,token_id:TokenId,nonce:U64,sequence:U64)->bool{
  require!(env::predecessor_account_id()==env::current_account_id(),"callback is private");
  let Some(mut s)=sales().get(&token_id) else{return false;};
  if s.nonce!=nonce||s.policy_sequence!=sequence||!s.policy_busy||!s.policy_call_complete{return false;}
  let Some(b)=collateral().get(&token_id)else{return false;};
  let Some(v)=pledge::bounded_result(32_768).and_then(|v|near_sdk::serde_json::from_slice::<Option<Policy>>(&v).ok()).flatten()else{return false;};
  if v.owner!=env::current_account_id()||!v.locked||v.version!=b.policy_version.0||env::sha256(v.encrypted_data.as_bytes())!=b.encrypted_policy_hash.0{return false;}
  let holder=self.tokens.owner_by_id.get(&token_id);if holder.as_ref()!=Some(&s.current_holder){return false;}
  if s.state==SaleState::Freezing && v.frozen {s.state=SaleState::Offered;}
  else if s.state==SaleState::UnlockPending && !v.frozen {add_credit(&s.seller,SALE_STORAGE_BOND);sales().remove(&token_id);return true;}
  s.policy_busy=false;s.policy_call_complete=false;sales().insert(&token_id,&s);true
 }
 pub fn sale_certificate_template(&self,token_id:TokenId,observed_at_ns:U64,expires_at_ns:U64)->SaleCertificate{
  let c=config_required();let s=sales().get(&token_id).unwrap_or_else(||env::panic_str("no protected sale"));let b=collateral().get(&token_id).unwrap_or_else(||env::panic_str("unbound collateral"));
  SaleCertificate{domain:SALE_DOMAIN.into(),network:c.network,contract:env::current_account_id(),token_id,sale_nonce:s.nonce,seller:s.seller,owner_epoch:s.owner_epoch,terms:s.terms,royalty_bps:s.royalty_bps,seller_net:s.seller_net,custody_contract:c.custody_contract,wallet_pubkey:b.wallet_pubkey,asset:pledge::COLLATERAL_ASSET.into(),decimals:6,controller:env::current_account_id(),policy_version:b.policy_version,policy_hash:b.encrypted_policy_hash,policy_sequence:s.policy_sequence,observed_at_ns,expires_at_ns,floor_met:true,frozen:true,pending_value_ops:U64(0)}
 }
 #[payable]
 pub fn buy_sale(&mut self,token_id:TokenId,nonce:U64,certificate:SaleCertificate,signature:Base64VecU8)->Promise{
  enough_gas();require!(enabled(),"protected sales disabled");let mut s=load(&token_id,nonce);let mut c=config_required();
  require!(s.state==SaleState::Offered&&!s.policy_busy&&!s.sold,"sale not purchasable");
  require!(env::predecessor_account_id()==s.terms.buyer,"only named buyer");self.assert_no_key(&s.terms.buyer);
  require!(self.royalty_bps==s.royalty_bps&&s.royalty_bps==0&&s.seller_net==s.terms.price,"sale royalty changed");
  require!(env::attached_deposit().as_yoctonear()==s.terms.price.0,"attach exact sale price");
  require!(self.tokens.owner_by_id.get(&token_id).as_ref()==Some(&s.seller)&&self.nft_settlement_epoch(token_id.clone())==s.owner_epoch,"sale owner or epoch changed");
  require!(self.pending_ops(&token_id)==0&&transfer_calls().get(&token_id).is_none()&&loans().get(&token_id).is_none(),"sale control state changed");
  let now=env::block_timestamp();require!(now<=s.terms.deadline_ns.0,"sale expired");
  require!(certificate.observed_at_ns.0<=now&&now<certificate.expires_at_ns.0&&certificate.expires_at_ns.0<=certificate.observed_at_ns.0.saturating_add(pledge::CERTIFICATE_MAX_AGE_NS),"sale certificate expired or future");
  require!(certificate==self.sale_certificate_template(token_id.clone(),certificate.observed_at_ns,certificate.expires_at_ns),"certificate not bound to this exact sale");
  let sig:[u8;64]=signature.0.try_into().unwrap_or_else(|_|env::panic_str("bad sale signature length"));let pk:[u8;32]=c.attestor_public_key.0.clone().try_into().unwrap_or_else(|_|env::panic_str("bad attestor key"));
  require!(env::ed25519_verify(&sig,&near_sdk::borsh::to_vec(&certificate).unwrap_or_else(|_|env::panic_str("sale certificate encoding")),&pk),"invalid sale signature");
  // No fallible seller push. Exactly backed credit + title + epoch + approval clear in this receipt.
  add_credit(&s.seller,s.seller_net.0);change_liabilities(&mut c,s.seller_net.0,0);save_config(&c);
  self.transfer_key_unlocked(&token_id,&s.terms.buyer,None,Some("protected sale"));
  s.sold=true;s.current_holder=s.terms.buyer.clone();s.state=SaleState::UnlockPending;sales().insert(&token_id,&s);
  emit_key_event("protected_sale",near_sdk::serde_json::json!({"token_id":token_id,"nonce":nonce,"seller":s.seller,"buyer":s.terms.buyer,"price":s.terms.price,"seller_net":s.seller_net,"royalty_bps":0}));
  self.start_sale_policy(token_id,false)
 }
 #[payable]
 pub fn cancel_sale(&mut self,token_id:TokenId,nonce:U64)->Promise{
  assert_one_yocto();enough_gas();let mut s=load(&token_id,nonce);
  require!(!s.sold&&s.state!=SaleState::UnlockPending,"sale already settled or cancelling");
  require!(env::predecessor_account_id()==s.seller||env::block_timestamp()>s.terms.deadline_ns.0,"only seller before expiry");
  require!(!s.policy_busy,"sale policy action/read pending: cannot cancel");
  s.state=SaleState::UnlockPending;sales().insert(&token_id,&s);self.start_sale_policy(token_id,false)
 }
}

#[cfg(test)]
#[path="sale_tests.rs"]
mod tests;
