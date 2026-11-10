//! Shared append-only minter protocol. Every send claims BEFORE nonce/signing.
//! No lock deletion: a stale reconciler cannot erase a later generation's lock.
use crate::{err, Action, Error, Store};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
const HEAD: &str = "w/minter_send_v2/head";
fn root(g: u64) -> String {
    format!("w/minter_send_v2/{g}")
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Ticket {
    pub generation: u64,
    pub id: String,
    pub actor: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Plan {
    pub hash: String,
    pub signer: String,
    pub receiver: String,
    pub transaction: Value,
    pub signed: String,
}
pub trait Rpc {
    fn preflight(&mut self) -> Result<(), Error> {
        Ok(())
    }
    fn prepared(&mut self, _plan: &Plan) -> Result<(), Error> {
        Ok(())
    }
    fn nonce(&mut self, signer: &str, public_key: &str) -> Result<u64, Error>;
    fn block(&mut self) -> Result<[u8; 32], Error>;
    fn broadcast(&mut self, signed: &str) -> Result<Value, Error>;
    fn status(&mut self, hash: &str, signer: &str) -> Result<Value, Error>;
}
fn read<T: serde::de::DeserializeOwned>(st: &mut dyn Store, k: &str) -> Result<T, Error> {
    serde_json::from_slice(&st.read(k)?)
        .map_err(|_| err("native_unknown", "native journal missing or invalid"))
}
fn put(st: &mut dyn Store, k: &str, v: &impl Serialize) -> Result<(), Error> {
    let b = serde_json::to_vec(v).map_err(|_| err("native_unknown", "native journal encoding"))?;
    if !st.set_if_absent(k, &b)? && st.read(k)? != b {
        return Err(err("native_unknown", "native journal conflict"));
    }
    Ok(())
}
pub fn current(st: &mut dyn Store) -> Result<Option<Ticket>, Error> {
    let h = st.incr(HEAD, 0)?;
    if h < 0 {
        return Err(err("native_unknown", "invalid native generation"));
    }
    for g in h as u64..(h as u64).saturating_add(128) {
        let r = root(g);
        if !st.read(&format!("{r}/done"))?.is_empty() {
            continue;
        }
        let raw = st.read(&format!("{r}/claim"))?;
        return if raw.is_empty() {
            Ok(None)
        } else {
            Ok(Some(serde_json::from_slice(&raw).map_err(|_| {
                err("native_unknown", "invalid native claim")
            })?))
        };
    }
    Err(err(
        "native_unknown",
        "native journal head needs reviewed recovery",
    ))
}
pub fn reserve(st: &mut dyn Store, id: &str, actor: &str) -> Result<Ticket, Error> {
    let h = st.incr(HEAD, 0)?;
    if h < 0 {
        return Err(err("native_unknown", "invalid native generation"));
    }
    for g in h as u64..(h as u64).saturating_add(128) {
        let r = root(g);
        if !st.read(&format!("{r}/done"))?.is_empty() {
            continue;
        }
        let t = Ticket {
            generation: g,
            id: id.into(),
            actor: actor.into(),
        };
        if st.set_if_absent(&format!("{r}/claim"), &serde_json::to_vec(&t).unwrap())? {
            return Ok(t);
        }
        return Err(err("native_busy", "another minter send must be reconciled"));
    }
    Err(err("native_unknown", "native generation scan bound"))
}
fn finish(st: &mut dyn Store, t: &Ticket, result: &str) -> Result<(), Error> {
    if st.set_if_absent(&format!("{}/done", root(t.generation)), result.as_bytes())? {
        st.incr(HEAD, 1)?;
    }
    Ok(())
}
pub fn record(st: &mut dyn Store, t: &Ticket, p: &Plan) -> Result<(), Error> {
    put(st, &format!("{}/plan", root(t.generation)), p)
}
pub fn claim_dispatch(st: &mut dyn Store, t: &Ticket) -> Result<(), Error> {
    if !st.set_if_absent(&format!("{}/decision", root(t.generation)), b"dispatch")? {
        return Err(err(
            "native_unknown",
            "native dispatch already claimed or fenced: never rebroadcast",
        ));
    }
    Ok(())
}
/// Atomic abort/dispatch competition. Absence of a dispatch decision proves the
/// host has never been allowed to broadcast; a late signer loses this fence.
pub fn abort_unsent(st: &mut dyn Store, t: &Ticket) -> Result<(), Error> {
    let k = format!("{}/decision", root(t.generation));
    if !st.set_if_absent(&k, b"abort")? && st.read(&k)? != b"abort" {
        return Err(err("native_unknown", "dispatch may exist: cannot abort"));
    }
    finish(st, t, "never_submitted")
}
fn proof(v: &Value, p: &Plan) -> Option<bool> {
    let v = v.get("result").unwrap_or(v);
    for (k, x) in p.transaction.as_object()? {
        if v["transaction"][k] != *x {
            return None;
        }
    }
    match crate::receipts::terminal(v, &p.hash, &p.signer, &p.receiver, None)? {
        crate::receipts::Terminal::Success { .. } => Some(true),
        crate::receipts::Terminal::Failure => Some(false),
    }
}
pub fn reconcile(
    st: &mut dyn Store,
    rpc: &mut dyn Rpc,
    t: &Ticket,
) -> Result<(Plan, Value, bool), Error> {
    let r = root(t.generation);
    if st.read(&format!("{r}/decision"))? != b"dispatch" {
        return Err(err(
            "native_busy",
            "native send is preparing; operator may fence proven unsent work",
        ));
    }
    let p: Plan = read(st, &format!("{r}/plan"))?;
    let v = rpc.status(&p.hash, &p.signer)?;
    let success = proof(&v, &p).ok_or_else(|| {
        err(
            "native_unknown",
            format!("original native transaction unresolved: {}", p.hash),
        )
    })?;
    finish(st, t, if success { "success" } else { "failure" })?;
    Ok((p, v, success))
}
#[allow(clippy::too_many_arguments)]
pub fn execute(
    st: &mut dyn Store,
    rpc: &mut dyn Rpc,
    id: &str,
    actor: &str,
    signer: &str,
    seed: &[u8; 32],
    receiver: &str,
    actions: &[Action],
) -> Result<(String, Value), Error> {
    // Automatically finish an older *accepted* terminal send, never resend it.
    if let Some(t) = current(st)? {
        reconcile(st, rpc, &t)?;
    }
    let t = reserve(st, id, actor)?;
    let p = (|| {
        rpc.preflight()?;
        let pk = ed25519_dalek::SigningKey::from_bytes(seed)
            .verifying_key()
            .to_bytes();
        let pk_s = format!("ed25519:{}", bs58::encode(pk).into_string());
        let nonce = rpc
            .nonce(signer, &pk_s)?
            .checked_add(1)
            .ok_or_else(|| err("native_unknown", "native nonce overflow"))?;
        let block = rpc.block()?;
        let tx = crate::encode_tx(signer, &pk, nonce, receiver, &block, actions);
        let hash = bs58::encode(Sha256::digest(&tx)).into_string();
        let signed = B64.encode(crate::sign_tx(seed, &tx));
        let actions:Vec<Value>=actions.iter().map(|a|match a{
   Action::FunctionCall{method,args,gas,deposit}=>json!({"FunctionCall":{"method_name":method,"args":B64.encode(args),"gas":gas,"deposit":deposit.to_string()}}),
   Action::Transfer{deposit}=>json!({"Transfer":{"deposit":deposit.to_string()}}),
   Action::DeleteKey{pk}=>json!({"DeleteKey":{"public_key":format!("ed25519:{}",bs58::encode(pk).into_string())}}),
   Action::AddFcKey{pk,allowance,receiver,methods}=>json!({"AddKey":{"public_key":format!("ed25519:{}",bs58::encode(pk).into_string()),"access_key":{"nonce":0,"permission":{"FunctionCall":{"allowance":allowance.to_string(),"receiver_id":receiver,"method_names":methods}}}}})
  }).collect();
        Ok(Plan {
            hash: hash.clone(),
            signer: signer.into(),
            receiver: receiver.into(),
            transaction: json!({"hash":hash,"signer_id":signer,"receiver_id":receiver,"nonce":nonce,"public_key":pk_s,"actions":actions}),
            signed,
        })
    })();
    let p = match p {
        Ok(p) => p,
        Err(e) => {
            abort_unsent(st, &t)?;
            return Err(e);
        }
    };
    record(st, &t, &p)?;
    rpc.prepared(&p)?;
    claim_dispatch(st, &t)?;
    // Dispatch is invoked exactly once, even if transport errors or process crashes.
    let response = rpc.broadcast(&p.signed);
    if let Ok(v) = response {
        if let Some(ok) = proof(&v, &p) {
            finish(st, &t, if ok { "success" } else { "failure" })?;
            return if ok {
                Ok((p.hash, v))
            } else {
                Err(err(
                    "tx_failed",
                    format!("original native transaction failed: {}", p.hash),
                ))
            };
        }
    }
    let (_, v, ok) = reconcile(st, rpc, &t)?;
    if ok {
        Ok((p.hash, v))
    } else {
        Err(err(
            "tx_failed",
            format!("original native transaction failed: {}", p.hash),
        ))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::BTreeMap, rc::Rc};
    #[derive(Clone, Default)]
    struct Mem(
        Rc<RefCell<BTreeMap<String, Vec<u8>>>>,
        Rc<RefCell<Option<String>>>,
    );
    impl Store for Mem {
        fn read(&mut self, k: &str) -> Result<Vec<u8>, Error> {
            Ok(self.0.borrow().get(k).cloned().unwrap_or_default())
        }
        fn set_if_absent(&mut self, k: &str, v: &[u8]) -> Result<bool, Error> {
            let mut m = self.0.borrow_mut();
            if m.contains_key(k) {
                return Ok(false);
            }
            m.insert(k.into(), v.into());
            if self.1.borrow().as_ref().is_some_and(|s| k.ends_with(s)) {
                return Err(err("crash", "simulated crash after durable write"));
            }
            Ok(true)
        }
        fn incr(&mut self, k: &str, d: i64) -> Result<i64, Error> {
            let n = String::from_utf8(self.read(k)?)
                .unwrap()
                .parse::<i64>()
                .unwrap_or(0)
                + d;
            self.0
                .borrow_mut()
                .insert(k.into(), n.to_string().into_bytes());
            Ok(n)
        }
        fn list_prefix(&mut self, _: &str) -> Result<Vec<String>, Error> {
            Ok(vec![])
        }
        fn remove(&mut self, _: &str) -> Result<(), Error> {
            panic!("native protocol must never remove a lock")
        }
    }
    struct Wire {
        store: Mem,
        plan: Option<Plan>,
        sends: usize,
        reads: usize,
        pending: bool,
        abort_at_prepare: bool,
    }
    impl Wire {
        fn new(s: &Mem) -> Self {
            Self {
                store: s.clone(),
                plan: None,
                sends: 0,
                reads: 0,
                pending: false,
                abort_at_prepare: false,
            }
        }
        fn outcome(&self) -> Value {
            let p = self.plan.as_ref().unwrap();
            let mut v = crate::receipts::fixture(&p.hash, &p.signer, &p.receiver, "");
            v["transaction"] = p.transaction.clone();
            v
        }
    }
    impl Rpc for Wire {
        fn nonce(&mut self, _: &str, _: &str) -> Result<u64, Error> {
            self.reads += 1;
            assert!(reserve(&mut self.store, "racing-send", "other.near").is_err());
            Ok(10)
        }
        fn block(&mut self) -> Result<[u8; 32], Error> {
            Ok([0; 32])
        }
        fn prepared(&mut self, p: &Plan) -> Result<(), Error> {
            self.plan = Some(p.clone());
            if self.abort_at_prepare {
                let t = current(&mut self.store)?.unwrap();
                abort_unsent(&mut self.store, &t)?;
                let _ = reserve(&mut self.store, "next", "other.near")?;
            }
            Ok(())
        }
        fn broadcast(&mut self, _: &str) -> Result<Value, Error> {
            self.sends += 1;
            if self.pending {
                Err(err("lost", "response lost"))
            } else {
                Ok(self.outcome())
            }
        }
        fn status(&mut self, _: &str, _: &str) -> Result<Value, Error> {
            if self.pending {
                Err(err("pending", "not indexed"))
            } else {
                Ok(self.outcome())
            }
        }
    }
    fn run(s: &mut Mem, w: &mut Wire, id: &str) -> Result<(String, Value), Error> {
        execute(
            s,
            w,
            id,
            "holder.near",
            "minter.near",
            &[7; 32],
            "keys.near",
            &[Action::FunctionCall {
                method: "register_collateral",
                args: b"{}",
                gas: 200_000_000_000_000,
                deposit: 1,
            }],
        )
    }
    #[test]
    fn actual_send_claims_before_nonce_selection_and_signing() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        run(&mut s, &mut w, "provision").unwrap();
        assert_eq!((w.reads, w.sends), (1, 1));
        assert!(current(&mut s).unwrap().is_none());
        run(&mut s, &mut w, "ordinary").unwrap();
        assert_eq!(w.sends, 2);
    }
    #[test]
    fn ordinary_and_provisioning_interleaving_never_share_live_nonce() {
        let mut s = Mem::default();
        let t = reserve(&mut s, "ordinary", "holder.near").unwrap();
        let mut w = Wire::new(&s);
        assert!(run(&mut s, &mut w, "provision").is_err());
        assert_eq!(w.reads, 0);
        abort_unsent(&mut s, &t).unwrap();
        run(&mut s, &mut w, "provision").unwrap();
        assert_eq!(w.sends, 1);
    }
    #[test]
    fn abort_fences_in_flight_signer_before_broadcast() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.abort_at_prepare = true;
        assert!(run(&mut s, &mut w, "old").is_err());
        assert_eq!(w.sends, 0);
        assert_eq!(current(&mut s).unwrap().unwrap().id, "next");
    }
    #[test]
    fn crash_before_dispatch_is_proven_unsent_and_fenced() {
        let mut s = Mem::default();
        *s.1.borrow_mut() = Some("/plan".into());
        let mut w = Wire::new(&s);
        assert!(run(&mut s, &mut w, "old").is_err());
        assert_eq!(w.sends, 0);
        let t = current(&mut s).unwrap().unwrap();
        *s.1.borrow_mut() = None;
        abort_unsent(&mut s, &t).unwrap();
        assert!(claim_dispatch(&mut s, &t).is_err());
        run(&mut s, &mut w, "new").unwrap();
        assert_eq!(w.sends, 1);
    }
    #[test]
    fn crash_after_dispatch_claim_never_becomes_never_submitted() {
        let mut s = Mem::default();
        *s.1.borrow_mut() = Some("/decision".into());
        let mut w = Wire::new(&s);
        assert!(run(&mut s, &mut w, "old").is_err());
        assert_eq!(w.sends, 0);
        let t = current(&mut s).unwrap().unwrap();
        *s.1.borrow_mut() = None;
        assert!(abort_unsent(&mut s, &t).is_err());
        assert!(claim_dispatch(&mut s, &t).is_err());
    }
    #[test]
    fn lost_broadcast_stays_unknown_and_original_is_never_retried() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.pending = true;
        assert!(run(&mut s, &mut w, "old").is_err());
        let t = current(&mut s).unwrap().unwrap();
        assert!(run(&mut s, &mut w, "next").is_err());
        assert_eq!(w.sends, 1);
        assert!(abort_unsent(&mut s, &t).is_err());
        w.pending = false;
        reconcile(&mut s, &mut w, &t).unwrap();
        let h = s.incr(HEAD, 0).unwrap();
        reconcile(&mut s, &mut w, &t).unwrap();
        assert_eq!(s.incr(HEAD, 0).unwrap(), h);
        assert!(current(&mut s).unwrap().is_none());
    }
    #[test]
    fn stale_terminal_reconciler_cannot_unlock_a_new_send_generation() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.pending = true;
        assert!(run(&mut s, &mut w, "old").is_err());
        let old = current(&mut s).unwrap().unwrap();
        w.pending = false;
        reconcile(&mut s, &mut w, &old).unwrap();
        let next = reserve(&mut s, "next", "other.near").unwrap();
        let head = s.incr(HEAD, 0).unwrap();
        reconcile(&mut s, &mut w, &old).unwrap();
        assert_eq!(s.incr(HEAD, 0).unwrap(), head);
        assert_eq!(
            current(&mut s).unwrap().unwrap().generation,
            next.generation
        );
        assert!(abort_unsent(&mut s, &old).is_err());
    }
    #[test]
    fn crash_after_completion_before_head_advance_skips_done_without_losing_mutex() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        *s.1.borrow_mut() = Some("/done".into());
        assert!(run(&mut s, &mut w, "old").is_err());
        assert_eq!(w.sends, 1);
        assert_eq!(s.incr(HEAD, 0).unwrap(), 0);
        *s.1.borrow_mut() = None;
        let old: Ticket = read(&mut s, "w/minter_send_v2/0/claim").unwrap();
        let next = reserve(&mut s, "next", "other.near").unwrap();
        assert_eq!(next.generation, 1);
        reconcile(&mut s, &mut w, &old).unwrap();
        assert_eq!(current(&mut s).unwrap().unwrap().generation, 1);
        assert!(reserve(&mut s, "competing", "holder.near").is_err());
    }
    #[test]
    fn malformed_failure_cannot_release_next_generation() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.pending = true;
        assert!(run(&mut s, &mut w, "old").is_err());
        let t = current(&mut s).unwrap().unwrap();
        let p = w.plan.clone().unwrap();
        let mut v = w.outcome();
        v["status"] = json!({"Failure":{}});
        v["transaction_outcome"] = Value::Null;
        assert_eq!(proof(&v, &p), None);
        assert!(current(&mut s).unwrap().is_some());
        assert!(abort_unsent(&mut s, &t).is_err());
    }
}
#[cfg(test)]
mod stale_tests {
    #[test]
    fn all_production_broadcasts_use_the_shared_transport() {
        let main = include_str!("main.rs");
        let collateral = include_str!("collateral_host.rs");
        let adapter = include_str!("native_host.rs");
        assert!(!main.contains("rpc::send_tx("));
        assert!(!collateral.contains("rpc::send_tx("));
        assert_eq!(adapter.matches("rpc::send_tx(").count(), 1);
        assert!(adapter.contains("native_send::execute("));
        assert!(collateral.contains("native_send::execute("));
        assert!(!adapter.contains("collateral_minter_pending"));
    }
}
