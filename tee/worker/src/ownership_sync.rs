//! Durable epoch-scoped cooldown. Independent of provenance layout and owner-name equality.
//! The host supplies twice-checked final-chain epoch/owner, never caller-selected values.
use crate::{err, Error, Store, TRANSFER_COOLDOWN_MS};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Observation { owner: String, epoch: u64, first_seen_ms: u64 }

fn key(contract: &str, token: &str, epoch: u64) -> String {
    // Length-safe JSON encoding; separate contract/token domains and immutable epoch cells.
    let binding = serde_json::to_vec(&(contract, token, epoch)).expect("string tuple encoding");
    format!("g/cooldown/v1/{}", hex::encode(Sha256::digest(binding)))
}

/// First final-chain observation starts a conservative cooldown after ANY nonzero epoch.
/// A->B->A cannot reuse A's old cell. No mutable last-owner pointer, lost-write fallback,
/// clock timeout lock stealing, list scan or spend-cap reset is involved.
pub fn observe(st: &mut dyn Store, contract: &str, token: &str, owner: &str, epoch: u64, now_ms: u64) -> Result<Option<u64>, Error> {
    let k=key(contract, token, epoch);
    let value=Observation { owner: owner.into(), epoch, first_seen_ms: now_ms };
    let encoded=serde_json::to_vec(&value).map_err(|_|err("cooldown_state", "observation encoding failed"))?;
    // Persistence must succeed BEFORE this observation can authorize any exit.
    let _=st.set_if_absent(&k, &encoded)?;
    let raw=st.read(&k)?;
    let saved:Observation=serde_json::from_slice(&raw).map_err(|_|err("cooldown_state", "durable ownership observation missing/corrupt"))?;
    if saved.owner!=owner || saved.epoch!=epoch || saved.first_seen_ms>now_ms {
        return Err(err("cooldown_state", "final ownership or chain clock disagrees with durable observation"));
    }
    if epoch==0 { return Ok(None); }
    saved.first_seen_ms.checked_add(TRANSFER_COOLDOWN_MS).map(Some).ok_or_else(||err("cooldown_state", "cooldown time overflow"))
}

pub fn require_elapsed(until: Option<u64>, now_ms: u64) -> Result<(), Error> {
    if let Some(until)=until.filter(|u| *u>now_ms) {
        return Err(err("cooldown", format!("this key's ownership epoch changed; self-exit opens at {until} (unix ms)")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    #[derive(Default)] struct Memory { cells:BTreeMap<String,Vec<u8>>, fail_write:bool, lose_reply:bool, fail_read:bool }
    impl Store for Memory {
        fn set_if_absent(&mut self,k:&str,v:&[u8])->Result<bool,Error>{
            if self.fail_write{return Err(err("storage","write unavailable"));}
            let fresh=!self.cells.contains_key(k);if fresh{self.cells.insert(k.into(),v.into());}
            if self.lose_reply{return Err(err("storage","write response lost"));}Ok(fresh)
        }
        fn read(&mut self,k:&str)->Result<Vec<u8>,Error>{if self.fail_read{return Err(err("storage","read unavailable"));}Ok(self.cells.get(k).cloned().unwrap_or_default())}
        fn incr(&mut self,_:&str,_:i64)->Result<i64,Error>{unreachable!("cooldown never touches spent counters")}
        fn list_prefix(&mut self,_:&str)->Result<Vec<String>,Error>{unreachable!("no unbounded list")}
        fn remove(&mut self,_:&str)->Result<(),Error>{unreachable!("immutable epoch records")}
    }
    fn observation(st:&mut Memory,owner:&str,epoch:u64,now:u64)->Result<Option<u64>,Error>{observe(st,"keys.near","k1",owner,epoch,now)}
    #[test]fn initial_epoch_has_no_transfer_cooldown(){let mut s=Memory::default();assert_eq!(observation(&mut s,"alice.near",0,100).unwrap(),None);}
    #[test]fn same_owner_after_unobserved_round_trip_gets_fresh_cooldown(){let mut s=Memory::default();observation(&mut s,"alice.near",0,100).unwrap();let end=observation(&mut s,"alice.near",2,1000).unwrap();assert_eq!(end,Some(1000+TRANSFER_COOLDOWN_MS));assert_eq!(require_elapsed(end,1001).unwrap_err().code,"cooldown");}
    #[test]fn a_b_a_without_intermediate_log_and_a_b_a_with_reads_both_rearm(){for see_b in [false,true]{let mut s=Memory::default();let old=observation(&mut s,"alice.near",4,10).unwrap().unwrap();if see_b{observation(&mut s,"bob.near",5,old+1).unwrap();}let new=observation(&mut s,"alice.near",6,old+2).unwrap().unwrap();assert!(new>old);assert_eq!(new,old+2+TRANSFER_COOLDOWN_MS);}}
    #[test]fn reload_reuses_first_observation_not_current_request_time(){let mut s=Memory::default();let end=observation(&mut s,"alice.near",1,100).unwrap();assert_eq!(observation(&mut s,"alice.near",1,1000).unwrap(),end);assert!(require_elapsed(end,end.unwrap()).is_ok());}
    #[test]fn stale_epoch_request_cannot_overwrite_new_epoch_cell(){let mut s=Memory::default();let new=observation(&mut s,"alice.near",7,1000).unwrap();observation(&mut s,"bob.near",6,1100).unwrap();assert_eq!(observation(&mut s,"alice.near",7,1200).unwrap(),new);}
    #[test]fn same_epoch_different_owner_is_an_error_not_a_reset(){let mut s=Memory::default();observation(&mut s,"alice.near",1,100).unwrap();assert!(observation(&mut s,"bob.near",1,200).is_err());}
    #[test]fn failed_persistence_or_read_never_authorizes_exit(){let mut s=Memory{fail_write:true,..Default::default()};assert!(observation(&mut s,"alice.near",2,100).is_err());s.fail_write=false;s.fail_read=true;assert!(observation(&mut s,"alice.near",2,100).is_err());}
    #[test]fn write_succeeded_reply_lost_is_safe_and_restart_uses_exact_saved_time(){let mut s=Memory{lose_reply:true,..Default::default()};assert!(observation(&mut s,"alice.near",2,100).is_err());s.lose_reply=false;assert_eq!(observation(&mut s,"alice.near",2,200).unwrap(),Some(100+TRANSFER_COOLDOWN_MS));}
    #[test]fn malformed_cell_or_clock_regression_fails_closed(){let mut s=Memory::default();s.cells.insert(key("keys.near","k1",2),b"{}".to_vec());assert!(observation(&mut s,"alice.near",2,100).is_err());s.cells.clear();observation(&mut s,"alice.near",2,200).unwrap();assert!(observation(&mut s,"alice.near",2,100).is_err());}
    #[test]fn contract_token_and_epoch_namespaces_do_not_collide(){let mut s=Memory::default();observe(&mut s,"a","bc","alice",1,100).unwrap();observe(&mut s,"ab","c","bob",1,200).unwrap();observe(&mut s,"a","bc","alice",2,300).unwrap();assert_eq!(s.cells.len(),3);}
    #[test]fn overflow_does_not_turn_cooldown_into_immediate_permission(){let mut s=Memory::default();assert!(observation(&mut s,"alice.near",1,u64::MAX).is_err());}
}
