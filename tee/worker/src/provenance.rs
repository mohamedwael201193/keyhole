//! Versioned hiding event commitments. Private immutable rows are committed before publication.
//! Legacy v1 bytes are never rehashed or silently repaired. Store is encrypted host storage.
use crate::{err, event_hash, verify_chain, Error, ProvEvent, Store};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub fn legacy_version() -> u8 { 1 }
const DOMAIN: &[u8] = b"KEYHOLE_EVENT_DETAIL_V2\0";
fn field(out: &mut Vec<u8>, s: &[u8]) {
    out.extend_from_slice(&(s.len() as u64).to_le_bytes()); out.extend_from_slice(s);
}
/// Context and exact UTF-8 bytes are length delimited. The nonce is NEVER a public/auth nonce.
pub fn commitment(ev: &ProvEvent, nonce: &[u8;32], detail: &str) -> String {
    let mut bytes = DOMAIN.to_vec();
    field(&mut bytes, ev.contract.as_bytes()); field(&mut bytes, ev.token_id.as_bytes());
    bytes.extend_from_slice(&ev.i.to_le_bytes()); bytes.extend_from_slice(&ev.owner_epoch.to_le_bytes());
    field(&mut bytes, ev.kind.as_bytes()); field(&mut bytes, ev.owner.as_bytes());
    bytes.extend_from_slice(&ev.ts_ms.to_le_bytes()); field(&mut bytes, ev.prev.as_bytes());
    bytes.extend_from_slice(nonce); field(&mut bytes, detail.as_bytes());
    hex::encode(Sha256::digest(&bytes))
}
/// Exact field order shared with the browser and standalone verifier. JSON strings are escaped.
pub fn canonical_v2(ev: &ProvEvent) -> String {
    let q = |s: &str| serde_json::to_string(s).expect("string serialization");
    format!("{{\"contract\":{},\"detail_hash\":{},\"i\":{},\"kind\":{},\"owner\":{},\"owner_epoch\":{},\"prev\":{},\"token_id\":{},\"ts_ms\":{},\"v\":2}}",
        q(&ev.contract),q(&ev.detail_hash),ev.i,q(&ev.kind),q(&ev.owner),ev.owner_epoch,q(&ev.prev),q(&ev.token_id),ev.ts_ms)
}
/// Only encrypted persistence contains these fields. Do not serialize this type to public APIs.
#[derive(Clone, Serialize, Deserialize)]
pub struct PrivateRow {
    #[serde(flatten)] pub event: ProvEvent,
    pub detail: String,
    #[serde(default)] pub blinding_nonce: Option<String>,
    #[serde(default)] event_id: String,
}
impl PrivateRow {
    pub fn opening_valid(&self) -> bool {
        if self.event.v == 1 { return crate::detail_hash(&self.detail) == self.event.detail_hash; }
        let Some(n) = self.blinding_nonce.as_ref().and_then(|s| hex::decode(s).ok()).and_then(|v| <[u8;32]>::try_from(v).ok()) else { return false; };
        self.event.v == 2 && commitment(&self.event,&n,&self.detail) == self.event.detail_hash
    }
    /// Explicit projection: secrets are present only for the authenticated writer's own rows.
    pub fn project(&self, viewer: Option<&str>) -> serde_json::Value {
        let ev=&self.event;
        let mut v=serde_json::json!({"i":ev.i,"hash":event_hash(ev),"kind":ev.kind,"owner":ev.owner,"prev":ev.prev,"ts_ms":ev.ts_ms,"detail_hash":ev.detail_hash});
        if ev.v==2 { v["v"]=2.into(); v["contract"]=ev.contract.clone().into(); v["owner_epoch"]=ev.owner_epoch.into(); }
        if viewer==Some(ev.owner.as_str()) {
            v["detail"]=self.detail.clone().into();
            if ev.v==2 { v["blinding_nonce"]=self.blinding_nonce.clone().into(); }
        }
        v
    }
}
// Host errors may echo a key or value. Never expose private row contents/openings in an API error.
fn read<S:Store>(store:&mut S,key:&str)->Result<Vec<u8>,Error>{
    store.read(key).map_err(|_|err("storage","event storage unavailable; resume original operation"))
}
fn write_once<S:Store>(store:&mut S,key:&str,value:&[u8])->Result<bool,Error>{
    store.set_if_absent(key,value).map_err(|_|err("storage","event persistence unavailable; resume original operation"))
}
fn row_key(contract:&str,token:&str,index:usize)->String { format!("p2/{contract}/{token}/{index:020}") }
fn validate(rows:&[PrivateRow],contract:&str,token:&str)->Result<(),Error> {
    let evs:Vec<_>=rows.iter().map(|r|r.event.clone()).collect(); verify_chain(&evs)?;
    if rows.iter().any(|r|r.event.token_id!=token || (r.event.v==2 && r.event.contract!=contract) || !r.opening_valid()) { return Err(err("bad_log","private event integrity check failed")); }
    Ok(())
}
/// No mutable head/array and no expiring lock. Every index is immutable CAS. A lost write response
/// cannot permit overwrite; a restart discovers the saved opening and deduplicates its private id.
pub fn load<S:Store>(store:&mut S,contract:&str,token:&str)->Result<Vec<PrivateRow>,Error> {
    let pinned=read(store,&format!("p2/{contract}/{token}/legacy"))?;
    let legacy=if pinned.is_empty(){read(store,&format!("p/{token}"))?}else{pinned};
    let mut rows:Vec<PrivateRow>=if legacy.is_empty(){Vec::new()}else{serde_json::from_slice(&legacy).map_err(|_|err("bad_log","legacy event encoding"))?};
    if rows.iter().any(|r|r.event.v!=1) {return Err(err("bad_log","legacy namespace must contain only v1"));}
    loop {
        let bytes=read(store,&row_key(contract,token,rows.len()))?;
        if bytes.is_empty(){break;}
        rows.push(serde_json::from_slice(&bytes).map_err(|_|err("bad_log","private event encoding"))?);
    }
    validate(&rows,contract,token)?; Ok(rows)
}
#[derive(Clone,Copy)]
pub struct EventInput<'a> { pub contract:&'a str,pub token:&'a str,pub kind:&'a str,pub owner:&'a str,pub owner_epoch:u64,pub ts_ms:u64,pub detail:&'a str }
pub fn append<S:Store,F:FnMut(&mut [u8;32])->Result<(),Error>>(store:&mut S,input:EventInput<'_>,mut entropy:F)->Result<String,Error> {
    // Pin the old array once. A still-reachable legacy writer cannot silently replace the
    // prefix of the new chain. Its retirement is separately required for protected finance.
    let key=format!("p2/{}/{}/legacy",input.contract,input.token);
    if read(store,&key)?.is_empty() {
        let old=read(store,&format!("p/{}",input.token))?;
        let old=if old.is_empty(){b"[]".to_vec()}else{old};
        let rows:Vec<PrivateRow>=serde_json::from_slice(&old).map_err(|_|err("bad_log","legacy event encoding"))?;
        validate(&rows,input.contract,input.token)?;
        write_once(store,&key,&old)?;
    }
    // ID stays private; it is NOT a public low-entropy commitment. Its purpose is retry dedup.
    let id=hex::encode(Sha256::digest(serde_json::to_vec(&(input.contract,input.token,input.kind,input.owner,input.owner_epoch,input.ts_ms,input.detail)).map_err(|_|err("bad_log","event id encoding"))?));
    for _ in 0..32 {
        let rows=load(store,input.contract,input.token)?;
        if let Some(r)=rows.iter().find(|r|r.event_id==id) {return Ok(event_hash(&r.event));}
        let mut nonce=[0u8;32]; entropy(&mut nonce)?;
        let mut ev=ProvEvent{i:rows.len() as u64,prev:rows.last().map(|r|event_hash(&r.event)).unwrap_or_else(||"0".repeat(64)),kind:input.kind.into(),token_id:input.token.into(),owner:input.owner.into(),ts_ms:input.ts_ms,detail_hash:String::new(),v:2,contract:input.contract.into(),owner_epoch:input.owner_epoch};
        ev.detail_hash=commitment(&ev,&nonce,input.detail);
        let row=PrivateRow{event:ev,detail:input.detail.into(),blinding_nonce:Some(hex::encode(nonce)),event_id:id.clone()};
        let data=serde_json::to_vec(&row).map_err(|_|err("bad_log","event encoding"))?;
        if write_once(store,&row_key(input.contract,input.token,rows.len()),&data)? {return Ok(event_hash(&row.event));}
    }
    Err(err("storage","event log contention; retry original operation"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    #[derive(Default)] struct Mem {m:HashMap<String,Vec<u8>>,fail:bool,lost:bool}
    impl Store for Mem {
        fn read(&mut self,k:&str)->Result<Vec<u8>,Error>{Ok(self.m.get(k).cloned().unwrap_or_default())}
        fn set_if_absent(&mut self,k:&str,v:&[u8])->Result<bool,Error>{if self.fail{return Err(err("storage","failure"));}
            if self.m.contains_key(k){return Ok(false);}self.m.insert(k.into(),v.to_vec());if self.lost {self.lost=false;return Err(err("storage","lost"));}Ok(true)}
        fn incr(&mut self,_:&str,_:i64)->Result<i64,Error>{unreachable!()} fn remove(&mut self,_:&str)->Result<(),Error>{unreachable!()} fn list_prefix(&mut self,_:&str)->Result<Vec<String>,Error>{unreachable!()}
    }
    fn input<'a>(detail:&'a str)->EventInput<'a>{EventInput{contract:"keys.near",token:"k1",kind:"withdraw",owner:"alice.near",owner_epoch:7,ts_ms:10,detail}}
    fn put(m:&mut Mem,i:EventInput<'_>,n:u8)->String {append(m,i,|b|{*b=[n;32];Ok(())}).unwrap()}
    #[test] fn repeated_plaintext_has_distinct_commitments(){let mut m=Mem::default();put(&mut m,input("1 USDC"),1);let mut i=input("1 USDC");i.ts_ms+=1;put(&mut m,i,2);let r=load(&mut m,"keys.near","k1").unwrap();assert_ne!(r[0].event.detail_hash,r[1].event.detail_hash);assert!(r.iter().all(PrivateRow::opening_valid));}
    #[test] fn authorized_exact_byte_opening_tamper(){let mut m=Mem::default();put(&mut m,input(" \u{00e9}\n"),9);let mut r=load(&mut m,"keys.near","k1").unwrap().remove(0);assert!(r.opening_valid());r.detail.push(' ');assert!(!r.opening_valid());r.detail.pop();r.event.owner_epoch+=1;assert!(!r.opening_valid());}
    #[test] fn public_and_new_holder_projection_has_no_opening(){let mut m=Mem::default();put(&mut m,input("secret amount"),12);let r=load(&mut m,"keys.near","k1").unwrap().remove(0);for viewer in [None,Some("bob.near")] {let v=r.project(viewer).to_string();assert!(!v.contains("blinding_nonce"));assert!(!v.contains("secret amount"));assert!(!v.contains("event_id"));}assert!(r.project(Some("alice.near")).get("blinding_nonce").is_some());}
    #[test] fn restart_dedup_and_lost_write_response(){let mut m=Mem::default();m.m.insert("p2/keys.near/k1/legacy".into(),b"[]".to_vec());m.lost=true;assert!(append(&mut m,input("x"),|b|{*b=[4;32];Ok(())}).is_err());let a=put(&mut m,input("x"),5);let b=put(&mut m,input("x"),6);assert_eq!(a,b);assert_eq!(load(&mut m,"keys.near","k1").unwrap().len(),1);assert_eq!(m.m.len(),2);}
    #[test] fn entropy_and_storage_failure_publish_nothing(){let mut m=Mem::default();assert!(append(&mut m,input("x"),|_|Err(err("entropy","unavailable"))).is_err());assert!(!m.m.keys().any(|k|k.ends_with("00000000000000000000")));m.fail=true;assert!(append(&mut m,input("x"),|b|{*b=[1;32];Ok(())}).is_err());assert!(!m.m.keys().any(|k|k.ends_with("00000000000000000000")));}
    #[test] fn legacy_mixed_chain_keeps_original_bytes(){let mut m=Mem::default();let mut old=Vec::new();crate::append_event(&mut old,"mint","k1","alice.near",1,"mint");let legacy=PrivateRow{event:old[0].clone(),detail:"mint".into(),blinding_nonce:None,event_id:String::new()};m.m.insert("p/k1".into(),serde_json::to_vec(&vec![legacy]).unwrap());put(&mut m,input("x"),1);let r=load(&mut m,"keys.near","k1").unwrap();assert_eq!(r[0].event,old[0]);assert_eq!(r[1].event.prev,event_hash(&old[0]));}
    #[test] fn actual_unversioned_legacy_json_is_pinned_byte_for_byte(){
        let mut m=Mem::default();let mut old=Vec::new();crate::append_event(&mut old,"mint","k1","alice.near",1,"mint");
        let e=&old[0];
        let raw=serde_json::to_vec(&serde_json::json!([{"i":e.i,"prev":e.prev,"kind":e.kind,"token_id":e.token_id,"owner":e.owner,"ts_ms":e.ts_ms,"detail_hash":e.detail_hash,"detail":"mint"}])).unwrap();
        m.m.insert("p/k1".into(),raw.clone());put(&mut m,input("x"),5);
        assert_eq!(m.m["p2/keys.near/k1/legacy"],raw);
        let rows=load(&mut m,"keys.near","k1").unwrap();assert_eq!(rows[0].event,old[0]);assert_eq!(rows[1].event.prev,event_hash(&old[0]));
    }
    #[test] fn corrupt_legacy_fails_instead_of_empty_or_filtered_chain(){let mut m=Mem::default();m.m.insert("p/k1".into(),b"[{}]".to_vec());assert!(load(&mut m,"keys.near","k1").is_err());}
    #[test] fn cross_language_v2_vector(){let mut m=Mem::default();put(&mut m,input("x"),5);let r=load(&mut m,"keys.near","k1").unwrap().remove(0);assert_eq!(r.event.detail_hash,"41c6674c0053cd4edcc933ab251914fbf00b5a0dd72e57343f654d9bcf99a8e9");}
    #[test] fn concurrent_cas_append_never_overwrites_rows_or_openings(){
        #[derive(Clone)] struct Shared(std::sync::Arc<std::sync::Mutex<HashMap<String,Vec<u8>>>>);
        impl Store for Shared {
            fn read(&mut self,k:&str)->Result<Vec<u8>,Error>{Ok(self.0.lock().unwrap().get(k).cloned().unwrap_or_default())}
            fn set_if_absent(&mut self,k:&str,v:&[u8])->Result<bool,Error>{let mut m=self.0.lock().unwrap();if m.contains_key(k){return Ok(false);}m.insert(k.into(),v.to_vec());Ok(true)}
            fn incr(&mut self,_:&str,_:i64)->Result<i64,Error>{unreachable!()} fn remove(&mut self,_:&str)->Result<(),Error>{unreachable!()} fn list_prefix(&mut self,_:&str)->Result<Vec<String>,Error>{unreachable!()}
        }
        let mut shared=Shared(Default::default());let barrier=std::sync::Arc::new(std::sync::Barrier::new(8));
        let handles:Vec<_>=(0..8).map(|n|{let mut st=shared.clone();let b=barrier.clone();std::thread::spawn(move||{b.wait();let mut i=input("same plaintext");i.ts_ms+=n;append(&mut st,i,|out|{*out=[n as u8;32];Ok(())}).unwrap();})}).collect();
        for h in handles{h.join().unwrap();}let rows=load(&mut shared,"keys.near","k1").unwrap();assert_eq!(rows.len(),8);assert!(rows.iter().all(PrivateRow::opening_valid));
    }
    #[test] fn storage_errors_cannot_echo_openings_or_private_row_contents(){
        struct Broken;
        impl Store for Broken {
            fn read(&mut self,_:&str)->Result<Vec<u8>,Error>{Err(err("storage","PRIVATE DETAIL secret salt"))}
            fn set_if_absent(&mut self,_:&str,_:&[u8])->Result<bool,Error>{Err(err("storage","PRIVATE DETAIL secret salt"))}
            fn incr(&mut self,_:&str,_:i64)->Result<i64,Error>{unreachable!()}
            fn remove(&mut self,_:&str)->Result<(),Error>{unreachable!()}
            fn list_prefix(&mut self,_:&str)->Result<Vec<String>,Error>{unreachable!()}
        }
        let mut b=Broken;
        for e in [load(&mut b,"keys.near","k1").err().unwrap(),write_once(&mut b,"row",b"secret").err().unwrap()]{
            assert!(!e.message.contains("PRIVATE"));assert!(!e.message.contains("salt"));assert!(!e.message.contains("secret"));
        }
    }
    #[test] fn version_and_context_are_bound(){let mut m=Mem::default();put(&mut m,input("x"),5);let r=load(&mut m,"keys.near","k1").unwrap().remove(0);let mut e=r.event.clone();for f in 0..3 {match f {0=>e.contract="other.near".into(),1=>e.token_id="k2".into(),_=>e.i+=1};assert_ne!(commitment(&e,&[5;32],"x"),r.event.detail_hash);}let mut e=r.event.clone();e.v=3;assert!(verify_chain(&[e]).is_err());}
}
