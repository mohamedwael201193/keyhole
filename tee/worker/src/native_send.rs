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
    /// Base58 hash of the referenced NEAR block. Public. Absent on journals
    /// written before this field existed (`#[serde(default)]`).
    #[serde(default)]
    pub block_hash: String,
    /// Height of the referenced block, stored at signing time. Absent on legacy
    /// journals (`#[serde(default)]`); then the fallback proof is used.
    #[serde(default)]
    pub reference_height: Option<u64>,
}
pub trait Rpc {
    fn preflight(&mut self) -> Result<(), Error> {
        Ok(())
    }
    fn prepared(&mut self, _plan: &Plan) -> Result<(), Error> {
        Ok(())
    }
    fn nonce(&mut self, signer: &str, public_key: &str) -> Result<u64, Error>;
    /// Final block hash and, when the response carries it, its height.
    fn block(&mut self) -> Result<([u8; 32], Option<u64>), Error>;
    fn broadcast(&mut self, signed: &str) -> Result<Value, Error>;
    /// Async broadcast: submit the signed bytes and return immediately (NEAR
    /// `broadcast_tx_async`, wait-until "NONE"). A rebroadcast of identical
    /// bytes is idempotent (same hash/nonce). Default: delegate to `broadcast`.
    fn broadcast_async(&mut self, signed: &str) -> Result<Value, Error> {
        self.broadcast(signed)
    }
    fn status(&mut self, hash: &str, signer: &str) -> Result<Value, Error>;
    /// Short wait between status re-polls. Default: none (native tests).
    /// Production pauses ~2 s so a re-poll happens after the tx has had
    /// time to enter a block. Without the pause, MAX_STATUS_POLLS instant
    /// polls all return UNKNOWN_TRANSACTION / not-yet-FINAL before the tx
    /// is indexed, and the in-call recovery gives up to reconcile having
    /// learned nothing. The pause is NOT an RPC call, so it does not count
    /// against the host's 100 near:rpc calls per run.
    fn pause(&mut self) {}
    /// `(reference_block_height, final_height, transaction_validity_period)`.
    /// Defaults to unknown: a missing value must not be treated as expired.
    fn validity_context(&mut self, _plan: &Plan) -> (Option<u64>, Option<u64>, Option<u64>) {
        (None, None, None)
    }
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

/// Official NEAR docs (`EXPERIMENTAL_protocol_config`, Transaction Lifecycle):
/// a transaction is valid for `transaction_validity_period` blocks counted from
/// the height of its referenced `block_hash`. Clearing is safe only when the
/// final height is at least two blocks past the end of that window
/// (`ref + period + 2`), leaving a margin for height skew between RPC nodes.
pub fn reference_expired(final_height: u64, reference_height: u64, validity_period: u64) -> bool {
    final_height >= reference_height.saturating_add(validity_period).saturating_add(2)
}

/// A claimed dispatch is cleared only when ALL hold: structured UNKNOWN_TRANSACTION,
/// the validity window has expired (see `reference_expired`), and the signer key's
/// final nonce is still below the planned transaction nonce (so no transaction with
/// this nonce, or a later one, can have been included).
pub fn can_clear_unknown(
    unknown: bool,
    reference_height: Option<u64>,
    final_height: Option<u64>,
    validity_period: Option<u64>,
    key_nonce: Option<u64>,
    plan_nonce: Option<u64>,
) -> bool {
    match (unknown, reference_height, final_height, validity_period, key_nonce, plan_nonce) {
        (true, Some(r), Some(f), Some(p), Some(kn), Some(pn)) => reference_expired(f, r, p) && kn < pn,
        _ => false,
    }
}

/// Official RPC cause name is `UNKNOWN_TRANSACTION` (`error.cause.name`).
/// Detection is structural only: a bare string must equal the name exactly, and a
/// JSON body must carry it at one of the exact error pointers. There is no
/// substring match, and a body that carries a result/transaction/status is never
/// "unknown" (a success body may merely contain the text, e.g. in an account id).
/// Timeouts and other handler errors must not be treated as unknown.
pub fn is_unknown_transaction_text(raw: &str) -> bool {
    if raw.trim() == "UNKNOWN_TRANSACTION" {
        return true;
    }
    let v = match serde_json::from_str::<Value>(raw) {
        Ok(v) => v,
        Err(_) => return false,
    };
    if ["result", "transaction", "final_execution_status", "status"]
        .iter()
        .any(|k| v.get(k).is_some())
    {
        return false;
    }
    for path in ["/error/cause/name", "/cause/name", "/error/name", "/name"] {
        if v.pointer(path).and_then(|x| x.as_str()) == Some("UNKNOWN_TRANSACTION") {
            return true;
        }
    }
    false
}

/// What the host returned for a tx-status call: `(body, error)`. The marker is
/// inspected only when the call reported an error (non-empty `error` or a JSON
/// body with an `error` member); a success body is never examined for it.
pub fn rpc_reports_unknown(body: &str, error: &str) -> bool {
    let has_error = !error.is_empty()
        || serde_json::from_str::<Value>(body)
            .map(|j| j.get("error").is_some())
            .unwrap_or(false);
    has_error && (is_unknown_transaction_text(error) || is_unknown_transaction_text(body))
}

pub fn is_unknown_transaction_error(e: &Error) -> bool {
    e.code == "unknown_transaction" || is_unknown_transaction_text(e.code) || is_unknown_transaction_text(&e.message)
}

pub fn transaction_validity_period(raw: &str) -> Option<u64> {
    let v: Value = serde_json::from_str(raw).ok()?;
    v.get("transaction_validity_period")
        .or_else(|| v.pointer("/result/transaction_validity_period"))
        .and_then(|x| x.as_u64())
}

pub fn block_height(raw: &str) -> Option<u64> {
    let v: Value = serde_json::from_str(raw).ok()?;
    v.pointer("/header/height")
        .or_else(|| v.pointer("/result/header/height"))
        .and_then(|x| x.as_u64())
}

/// 32-byte referenced block from a KEYHOLE signed tx (encode_tx + sign_tx).
/// Never returns or logs the signature.
pub fn block_hash_from_signed(signed_b64: &str) -> Option<[u8; 32]> {
    let raw = B64.decode(signed_b64).ok()?;
    if raw.len() < 65 {
        return None;
    }
    let tx = &raw[..raw.len() - 65];
    let mut i = 0usize;
    let slen = u32::from_le_bytes(tx.get(i..i + 4)?.try_into().ok()?) as usize;
    i += 4 + slen;
    if *tx.get(i)? != 0 {
        return None;
    }
    i += 1 + 32 + 8;
    let rlen = u32::from_le_bytes(tx.get(i..i + 4)?.try_into().ok()?) as usize;
    i += 4 + rlen;
    tx.get(i..i + 32)?.try_into().ok()
}

pub fn plan_block_hash(p: &Plan) -> Option<[u8; 32]> {
    if !p.block_hash.is_empty() {
        return bs58::decode(&p.block_hash)
            .into_vec()
            .ok()
            .and_then(|b| b.try_into().ok());
    }
    block_hash_from_signed(&p.signed)
}

pub fn unresolved_error(p: &Plan, reference_height: Option<u64>, message: &str) -> Error {
    err(
        "native_unknown",
        format!(
            "{message}; tx_hash={}; reference_block_height={}",
            p.hash,
            reference_height
                .map(|h| h.to_string())
                .unwrap_or_else(|| "unknown".into())
        ),
    )
}

pub fn does_not_exist_body(
    p: &Plan,
    reference_height: Option<u64>,
    final_height: Option<u64>,
    validity_period: Option<u64>,
) -> Value {
    json!({
        "does_not_exist": true,
        "tx_hash": p.hash,
        "reference_block_height": reference_height,
        "final_height": final_height,
        "transaction_validity_period": validity_period,
    })
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
    match rpc.status(&p.hash, &p.signer) {
        Ok(v) => {
            let success = proof(&v, &p).ok_or_else(|| {
                unresolved_error(&p, None, "original native transaction unresolved")
            })?;
            finish(st, t, if success { "success" } else { "failure" })?;
            Ok((p, v, success))
        }
        Err(e) if is_unknown_transaction_error(&e) => {
            // Lazy: heights, period and key nonce are fetched only here.
            let (ctx_ref, final_h, period) = rpc.validity_context(&p);
            // Stored height (new plans) wins; legacy plans rely on the host's lookup of the
            // reference block, and an unretrievable block means no clear (fail closed).
            let ref_h = p.reference_height.or(ctx_ref);
            let expired = matches!((ref_h, final_h, period),
                (Some(r), Some(f), Some(pd)) if reference_expired(f, r, pd));
            let plan_nonce = p.transaction.get("nonce").and_then(Value::as_u64);
            let pk = p.transaction.get("public_key").and_then(Value::as_str).unwrap_or("");
            // Fail closed: read only once the window has expired; a failed read never clears.
            let key_nonce = if expired && !pk.is_empty() {
                rpc.nonce(&p.signer, pk).ok()
            } else {
                None
            };
            if can_clear_unknown(true, ref_h, final_h, period, key_nonce, plan_nonce) {
                finish(st, t, "does_not_exist")?;
                let v = does_not_exist_body(&p, ref_h, final_h, period);
                Ok((p, v, false))
            } else {
                Err(unresolved_error(
                    &p,
                    ref_h,
                    "original send UNKNOWN_TRANSACTION; still within validity window, signer nonce not proven below the plan, or context incomplete",
                ))
            }
        }
        Err(_) => Err(unresolved_error(&p, None, "original send not yet FINAL")),
    }
}

/// Maximum in-call re-broadcast attempts after a transport failure.
/// Each attempt re-submits the SAME signed bytes (idempotent); the loop is
/// bounded so a degraded RPC cannot spin the call forever.
pub const MAX_REBROADCAST_ATTEMPTS: usize = 3;

/// Maximum short status re-polls while a sent tx is not FINAL yet. Each poll
/// is one fast NONE call (no FINAL wait inside one host call, which the host
/// caps at 30 s). The polls are SPACED: a host pause (~2 s, `Rpc::pause`)
/// runs before each re-poll, so the tx has time to enter a block — without
/// the pause the three polls all run in under a second and all return
/// UNKNOWN_TRANSACTION / not-yet-FINAL before the tx is indexed. After this
/// many polls the ticket is left for the normal reconcile, which polls again
/// by hash — never re-signs. Together with the re-broadcast bound, one
/// execute() makes at most ~13 RPC calls, far under the host's 100 near:rpc
/// calls per run. The pauses add no RPC calls.
pub const MAX_STATUS_POLLS: usize = 3;

/// Re-broadcast the exact signed bytes of the current unresolved ticket.
/// Safety: identical signed bytes cannot execute twice (same nonce/hash — NEAR
/// rejects a duplicate); expired => the node rejects as Expired, harmless.
/// Only valid while the validity window is still open (fail closed if the
/// window cannot be proven open). If the tx is FINAL, the ticket is cleared
/// here (same proof + finish as `reconcile`); otherwise the ticket remains
/// and the caller runs the normal `reconcile` once the tx is FINAL.
/// Never re-signs: the bytes come from the stored plan, not a fresh signing.
pub fn rebroadcast(
    st: &mut dyn Store,
    rpc: &mut dyn Rpc,
    t: &Ticket,
) -> Result<Value, Error> {
    let r = root(t.generation);
    if st.read(&format!("{r}/decision"))? != b"dispatch" {
        return Err(err(
            "native_busy",
            "native send is preparing; operator may fence proven unsent work",
        ));
    }
    let p: Plan = read(st, &format!("{r}/plan"))?;
    // Fail closed: only rebroadcast while the validity window is provably open.
    let (ctx_ref, final_h, period) = rpc.validity_context(&p);
    let ref_h = p.reference_height.or(ctx_ref);
    let open = matches!((ref_h, final_h, period), (Some(r), Some(f), Some(pd)) if !reference_expired(f, r, pd));
    if !open {
        return Err(err(
            "rebroadcast_expired",
            format!(
                "validity window expired or unprovable; reconcile instead; tx_hash={}; reference_block_height={}",
                p.hash,
                ref_h.map(|h| h.to_string()).unwrap_or_else(|| "unknown".into())
            ),
        ));
    }
    // Re-submit the EXACT signed bytes (no re-signing, same hash, same nonce).
    let sent = rpc.broadcast_async(&p.signed).is_ok();
    // Round 4: a send changes on-chain state, so the per-run read cache
    // is invalidated after the broadcast (the production transport in
    // native_host.rs invalidates too; this is the shared-code choke point,
    // and the mock path in tests).
    crate::read_cache::invalidate();
    // Poll status once to report the current state.
    match rpc.status(&p.hash, &p.signer) {
        Ok(v) => {
            if let Some(ok) = proof(&v, &p) {
                finish(st, t, if ok { "success" } else { "failure" })?;
                Ok(json!({
                    "ok": true,
                    "status": if ok { "success" } else { "failed" },
                    "tx_hash": p.hash,
                    "rebroadcast": sent,
                    "reconciled": true,
                }))
            } else {
                Ok(json!({
                    "ok": true,
                    "status": "rebroadcast",
                    "tx_hash": p.hash,
                    "rebroadcast": sent,
                    "final": false,
                }))
            }
        }
        Err(e) => Ok(json!({
            "ok": true,
            "status": "rebroadcast",
            "tx_hash": p.hash,
            "rebroadcast": sent,
            "final": false,
            "status_error": e.code,
        })),
    }
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
        // A refusal here happens BEFORE anything was reserved or sent for THIS
        // request: the old ticket is still unresolved, so no new begin can
        // proceed. Name it distinctly from native_unknown — the new op provably
        // sent nothing, so its spend hold must be given back (begin_never_sent).
        // Only native_unknown is remapped: any other code (e.g. native_busy)
        // already proves nothing was sent and keeps its own meaning.
        reconcile(st, rpc, &t).map_err(|e| {
            if e.code == "native_unknown" {
                err("native_blocked", format!("minter journal blocked by unresolved send; nothing was sent for this request; reconcile the minter send, never resend; cause: {}", e.message))
            } else {
                e
            }
        })?;
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
        let (block, block_height) = rpc.block()?;
        // Every new plan must carry its reference height: without it the claim could
        // later only be cleared through a block lookup that may be garbage-collected.
        let block_height =
            block_height.ok_or_else(|| err("rpc", "final block height unavailable"))?;
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
            block_hash: bs58::encode(block).into_string(),
            reference_height: Some(block_height),
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
    // The hash was computed from the signed bytes BEFORE sending (above), so
    // the tx is always recoverable by hash afterwards. The send itself is
    // async (wait-until NONE), never a FINAL wait inside one host call: the
    // OutLayer host caps every near:rpc call at 30 s, so a FINAL wait that
    // outlasts 30 s returns "Failed to send RPC request" even when the tx
    // was accepted — the exact failure that created the lost claim_payout
    // (J5dHg2q…). A tx that is not FINAL yet returns pending WITH the hash.
    let response = rpc.broadcast_async(&p.signed);
    // Round 4: a send changes on-chain state, so the per-run read cache
    // is invalidated after the broadcast (the production transport in
    // native_host.rs invalidates too; this is the shared-code choke point,
    // and the mock path in tests).
    crate::read_cache::invalidate();
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
    // The broadcast failed or its response is unproven: the tx may or may not
    // have reached the node. Poll status by hash with short, SPACED NONE
    // calls — never a FINAL wait inside one host call (30 s host cap). If the tx is
    // genuinely not on-chain (UNKNOWN_TRANSACTION), re-broadcast the SAME
    // bytes (idempotent: same hash/nonce cannot execute twice) up to
    // MAX_REBROADCAST_ATTEMPTS times. If it is not FINAL yet, poll a bounded
    // number of times, then leave the ticket for the normal reconcile (which
    // polls again by hash — never re-signs). A single transport failure must
    // not block the minter journal for the full validity window.
    let mut rebroadcasts = 0;
    let mut polls = 0;
    loop {
        match rpc.status(&p.hash, &p.signer) {
            Ok(v) => {
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
                break;
            }
            Err(e) if is_unknown_transaction_error(&e) => {
                rebroadcasts += 1;
                if rebroadcasts > MAX_REBROADCAST_ATTEMPTS {
                    break;
                }
                // Space the next status poll (host pause, ~2 s): the tx needs
                // that long to enter a block, and an instant re-poll would
                // return UNKNOWN_TRANSACTION again before the tx is indexed.
                // The pause also spaces the re-broadcasts themselves.
                rpc.pause();
                // Async re-broadcast of the SAME bytes; the status poll at the
                // top of the loop tells us whether it landed. Ignore the
                // broadcast result here (a duplicate rejection is harmless).
                let _ = rpc.broadcast_async(&p.signed);
                // Round 4: a (re-)send changes on-chain state; invalidate
                // the per-run read cache after it (see above).
                crate::read_cache::invalidate();
            }
            Err(_) => {
                // Not yet FINAL (or a transport error on the poll): a bounded
                // number of short re-polls, then reconcile polls again.
                polls += 1;
                if polls >= MAX_STATUS_POLLS {
                    break;
                }
                // Space the next status poll (see above): without the pause
                // the three polls all run in under a second, before the tx
                // enters a block, and the in-call recovery learns nothing.
                rpc.pause();
            }
        }
    }
    let (_, v, ok) = reconcile(st, rpc, &t)?;
    if v.get("does_not_exist") == Some(&Value::Bool(true)) {
        return Err(err(
            "native_unknown",
            format!("original native transaction never existed: {}", p.hash),
        ));
    }
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
        unknown: bool,
        key_nonce: Option<u64>,
        nonce_err: bool,
        sign_height: Option<u64>,
        validity: (Option<u64>, Option<u64>, Option<u64>),
        async_sends: usize,
        async_signed: Vec<String>,
        async_lands: bool,
        /// The next broadcast_async call fails with a lost response (the
        /// one-shot model of a transport failure after sending: the tx may or
        /// may not have reached the node, and the mock leaves its on-chain
        /// state untouched). Consumed by that call; later sends behave
        /// normally. This is how a lost initial send is simulated now that
        /// every send is async (wait-until NONE): `pending` alone only makes
        /// status polls report "not indexed".
        send_fail_once: bool,
        /// Every Rpc trait invocation (nonce, block, broadcast,
        /// broadcast_async, status, validity_context). Each is one near:rpc
        /// host call in production, against the host's 100 calls per run.
        rpc_calls: usize,
        /// Host pauses requested between status re-polls (`Rpc::pause`).
        /// Production sleeps ~2 s per pause; the mock only counts, so the
        /// tests stay fast while proving the spacing happens.
        pauses: usize,
        /// When set, `outcome()` returns a genuine FINAL failure body
        /// (the receipt failed) instead of the success fixture.
        fail_outcome: bool,
        /// Set by `broadcast_async` when the journal already holds the
        /// ticket (decision=dispatch, plan with hash + the exact bytes
        /// being broadcast) at broadcast time — the proof that the ticket
        /// is persisted BEFORE broadcast.
        persisted_before_broadcast: bool,
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
                unknown: false,
                key_nonce: None,
                nonce_err: false,
                sign_height: Some(100),
                validity: (None, None, None),
                async_sends: 0,
                async_signed: Vec::new(),
                async_lands: true,
                send_fail_once: false,
                rpc_calls: 0,
                pauses: 0,
                fail_outcome: false,
                persisted_before_broadcast: false,
            }
        }
        fn outcome(&self) -> Value {
            let p = self.plan.as_ref().unwrap();
            let mut v = crate::receipts::fixture(&p.hash, &p.signer, &p.receiver, "");
            if self.fail_outcome {
                // A genuine FINAL failure: the receipt failed and the
                // top-level status carries the same Failure (the shape
                // `receipts::terminal` resolves to Terminal::Failure).
                v["receipts_outcome"][0]["outcome"]["status"] =
                    json!({"Failure":{"ActionError":"failed"}});
                v["status"] = v["receipts_outcome"][0]["outcome"]["status"].clone();
            }
            v["transaction"] = p.transaction.clone();
            v
        }
    }
    impl Rpc for Wire {
        fn nonce(&mut self, _: &str, _: &str) -> Result<u64, Error> {
            self.rpc_calls += 1;
            self.reads += 1;
            if self.nonce_err {
                return Err(err("rpc", "native access key unavailable"));
            }
            assert!(reserve(&mut self.store, "racing-send", "other.near").is_err());
            Ok(self.key_nonce.unwrap_or(10))
        }
        fn block(&mut self) -> Result<([u8; 32], Option<u64>), Error> {
            self.rpc_calls += 1;
            Ok(([0; 32], self.sign_height))
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
            self.rpc_calls += 1;
            self.sends += 1;
            if self.pending {
                Err(err("lost", "response lost"))
            } else {
                Ok(self.outcome())
            }
        }
        fn broadcast_async(&mut self, signed: &str) -> Result<Value, Error> {
            self.rpc_calls += 1;
            self.async_sends += 1;
            self.async_signed.push(signed.to_string());
            // Proof that the ticket is persisted BEFORE broadcast: at the
            // moment of the send, the journal must already hold the ticket
            // with decision=dispatch and the plan carrying the hash and the
            // exact bytes being broadcast.
            if !self.persisted_before_broadcast {
                if let Ok(Some(t)) = current(&mut self.store) {
                    let r = root(t.generation);
                    let decision = self.store.read(&format!("{r}/decision")).unwrap_or_default();
                    if decision.as_slice() == b"dispatch" {
                        if let Ok(p) = read::<Plan>(&mut self.store, &format!("{r}/plan")) {
                            if p.signed == signed && !p.hash.is_empty() {
                                self.persisted_before_broadcast = true;
                            }
                        }
                    }
                }
            }
            if self.send_fail_once {
                // One-shot transport failure after sending: the response is
                // lost and the tx's on-chain state is untouched (it may or
                // may not have reached the node). The caller must poll by
                // hash; it must never assume the tx is or is not on-chain.
                self.send_fail_once = false;
                return Err(err("lost", "response lost"));
            }
            if self.async_lands {
                // The re-broadcast reaches the node: the tx is now known and lands.
                self.unknown = false;
                self.pending = false;
            }
            Ok(Value::Null)
        }
        fn status(&mut self, _: &str, _: &str) -> Result<Value, Error> {
            self.rpc_calls += 1;
            if self.unknown {
                Err(err("unknown_transaction", "UNKNOWN_TRANSACTION"))
            } else if self.pending {
                Err(err("pending", "not indexed"))
            } else {
                Ok(self.outcome())
            }
        }
        fn pause(&mut self) {
            // Counted, not slept: the test proves the production code
            // requests the pause at the right points; the production
            // NativeRpc sleeps ~2 s per pause.
            self.pauses += 1;
        }
        fn validity_context(&mut self, _: &Plan) -> (Option<u64>, Option<u64>, Option<u64>) {
            self.rpc_calls += 1;
            self.validity
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
        assert_eq!((w.reads, w.async_sends), (1, 1));
        assert_eq!(w.sends, 0, "no FINAL broadcast is ever used");
        assert!(current(&mut s).unwrap().is_none());
        run(&mut s, &mut w, "ordinary").unwrap();
        assert_eq!(w.async_sends, 2);
    }
    #[test]
    fn execute_invalidates_the_read_cache_after_broadcast() {
        // Round 4 (d): the cache must never serve a stale value across a
        // broadcast. `execute` invalidates the per-run read cache after
        // every broadcast_async call; this test proves it through the
        // mock: a control value cached before the send is gone after it,
        // so the next read is fresh.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        crate::read_cache::invalidate();
        crate::read_cache::put_view(
            "keys.near",
            "get_control_state",
            "{\"token_id\":\"k1\"}",
            serde_json::json!({"epoch": "0"}),
        );
        assert!(crate::read_cache::get_view(
            "keys.near",
            "get_control_state",
            "{\"token_id\":\"k1\"}"
        )
        .is_some());
        run(&mut s, &mut w, "provision").unwrap();
        assert_eq!(w.async_sends, 1, "the test must have broadcast once");
        assert!(
            crate::read_cache::get_view(
                "keys.near",
                "get_control_state",
                "{\"token_id\":\"k1\"}"
            )
            .is_none(),
            "execute() broadcast but the cached control survived it"
        );
        assert!(crate::read_cache::get_block().is_none());
        assert!(crate::read_cache::get_gas_price().is_none());
        crate::read_cache::invalidate();
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
        assert_eq!(w.async_sends, 1);
    }
    #[test]
    fn abort_fences_in_flight_signer_before_broadcast() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.abort_at_prepare = true;
        assert!(run(&mut s, &mut w, "old").is_err());
        assert_eq!(w.async_sends, 0);
        assert_eq!(current(&mut s).unwrap().unwrap().id, "next");
    }
    #[test]
    fn crash_before_dispatch_is_proven_unsent_and_fenced() {
        let mut s = Mem::default();
        *s.1.borrow_mut() = Some("/plan".into());
        let mut w = Wire::new(&s);
        assert!(run(&mut s, &mut w, "old").is_err());
        assert_eq!(w.async_sends, 0);
        let t = current(&mut s).unwrap().unwrap();
        *s.1.borrow_mut() = None;
        abort_unsent(&mut s, &t).unwrap();
        assert!(claim_dispatch(&mut s, &t).is_err());
        run(&mut s, &mut w, "new").unwrap();
        assert_eq!(w.async_sends, 1);
    }
    #[test]
    fn crash_after_dispatch_claim_never_becomes_never_submitted() {
        let mut s = Mem::default();
        *s.1.borrow_mut() = Some("/decision".into());
        let mut w = Wire::new(&s);
        assert!(run(&mut s, &mut w, "old").is_err());
        assert_eq!(w.async_sends, 0);
        let t = current(&mut s).unwrap().unwrap();
        *s.1.borrow_mut() = None;
        assert!(abort_unsent(&mut s, &t).is_err());
        assert!(claim_dispatch(&mut s, &t).is_err());
    }
    #[test]
    fn lost_broadcast_stays_unknown_and_original_is_never_retried() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        // The initial send's response is lost (one-shot transport failure)
        // AND the tx outcome is not yet indexed: execute() must leave the
        // ticket UNKNOWN with the hash, never resend a fresh signing.
        w.send_fail_once = true;
        w.pending = true;
        assert!(run(&mut s, &mut w, "old").is_err());
        let t = current(&mut s).unwrap().unwrap();
        assert!(run(&mut s, &mut w, "next").is_err());
        assert_eq!(w.async_sends, 1);
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
        w.send_fail_once = true;
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
        assert_eq!(w.async_sends, 1);
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
        w.send_fail_once = true;
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
    fn dispatched(s: &mut Mem, w: &mut Wire) -> Ticket {
        // The initial send's response is lost (one-shot transport failure)
        // and the tx outcome is not yet indexed: the ticket stays dispatch.
        w.send_fail_once = true;
        w.pending = true;
        assert!(run(s, w, "old").is_err());
        current(s).unwrap().unwrap()
    }
    #[test]
    fn unknown_and_expired_reference_clears_as_does_not_exist() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        w.pending = false;
        w.unknown = true;
        w.validity = (Some(100), Some(100 + 86_400 + 2), Some(86_400));
        let (p, v, ok) = reconcile(&mut s, &mut w, &t).unwrap();
        assert!(!ok);
        assert_eq!(v["does_not_exist"], true);
        assert_eq!(v["tx_hash"], p.hash);
        assert_eq!(v["reference_block_height"], 100);
        assert!(!serde_json::to_string(&v).unwrap().contains("signed"));
        assert!(current(&mut s).unwrap().is_none());
        w.unknown = false;
        run(&mut s, &mut w, "new").unwrap();
        assert_eq!(w.async_sends, 2);
    }
    #[test]
    fn unknown_at_window_edge_waits_and_returns_hash_and_height() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        let p = w.plan.clone().unwrap();
        w.pending = false;
        w.unknown = true;
        // Conservative: one block short of ref + period + 2 is not cleared.
        w.validity = (Some(100), Some(100 + 86_400 + 1), Some(86_400));
        let e = reconcile(&mut s, &mut w, &t).unwrap_err();
        assert_eq!(e.code, "native_unknown");
        assert!(e.message.contains(&p.hash), "{}", e.message);
        assert!(e.message.contains("reference_block_height=100"), "{}", e.message);
        assert!(!e.message.contains(&p.signed));
        assert!(!e.message.to_ascii_lowercase().contains("private"));
        assert_eq!(current(&mut s).unwrap().unwrap().generation, t.generation);
        assert!(abort_unsent(&mut s, &t).is_err());
        assert!(run(&mut s, &mut w, "next").is_err());
        assert_eq!(w.async_sends, 1);
    }
    #[test]
    fn gate_refusal_of_unresolved_ticket_is_native_blocked_and_sends_nothing() {
        // The live cap-leak bug (call 21af16a3, Nov 13): a swap refused at the
        // reconcile gate leaked its $0.01 into the daily cap because the gate
        // returned native_unknown, which is NOT in begin_never_sent. The gate
        // now returns the distinct native_blocked code: this request provably
        // sent nothing, so its spend hold must be given back.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        let p = w.plan.clone().unwrap();
        w.pending = false;
        w.unknown = true;
        // Conservative: one block short of ref + period + 2 is not cleared.
        w.validity = (Some(100), Some(100 + 86_400 + 1), Some(86_400));
        let e = run(&mut s, &mut w, "next").unwrap_err();
        assert_eq!(e.code, "native_blocked");
        assert!(e.message.contains(&p.hash), "{}", e.message);
        assert!(e.message.contains("reference_block_height=100"), "{}", e.message);
        assert!(e.message.contains("nothing was sent"), "{}", e.message);
        assert!(!e.message.contains(&p.signed));
        assert!(!e.message.to_ascii_lowercase().contains("private"));
        assert_eq!(w.async_sends, 1, "the old send only; no new send was attempted");
        assert_eq!(current(&mut s).unwrap().unwrap().generation, t.generation);
        assert!(abort_unsent(&mut s, &t).is_err());
    }
    #[test]
    fn reconcile_itself_still_returns_native_unknown() {
        // The distinct code lives ONLY at the execute() gate. reconcile() itself
        // still reports an unresolved ticket as native_unknown — the resolution
        // contexts (post-broadcast, op_reconcile_minter_send, collateral) must
        // keep meaning "outcome unknown", never "refused before send".
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        w.pending = false;
        w.unknown = true;
        w.validity = (Some(100), Some(100 + 86_400 + 1), Some(86_400));
        let e = reconcile(&mut s, &mut w, &t).unwrap_err();
        assert_eq!(e.code, "native_unknown");
        assert_eq!(current(&mut s).unwrap().unwrap().generation, t.generation);
    }
    #[test]
    fn timeout_does_not_clear_even_if_the_reference_is_old() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        let p = w.plan.clone().unwrap();
        w.validity = (Some(1), Some(1_000_000), Some(86_400));
        // pending is still true: status is not UNKNOWN_TRANSACTION.
        let e = reconcile(&mut s, &mut w, &t).unwrap_err();
        assert_eq!(e.code, "native_unknown");
        assert!(e.message.contains(&p.hash), "{}", e.message);
        assert!(e.message.contains("reference_block_height=unknown"), "{}", e.message);
        assert!(!e.message.contains(&p.signed));
        assert!(current(&mut s).unwrap().is_some());
    }
    #[test]
    fn unknown_without_heights_waits() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = legacy(&mut w, &mut s);
        let e = reconcile(&mut s, &mut w, &t).unwrap_err();
        assert!(e.message.contains("reference_block_height=unknown"), "{}", e.message);
        assert!(current(&mut s).unwrap().is_some());
    }
    #[test]
    fn official_unknown_transaction_name_is_required() {
        let official = r#"{"jsonrpc":"2.0","error":{"name":"HANDLER_ERROR","cause":{"name":"UNKNOWN_TRANSACTION","info":{}},"code":-32000,"message":"Server error"},"id":"dontcare"}"#;
        assert!(is_unknown_transaction_text(official));
        assert!(is_unknown_transaction_text("UNKNOWN_TRANSACTION"));
        assert!(is_unknown_transaction_error(&err("unknown_transaction", "UNKNOWN_TRANSACTION")));
        assert!(!is_unknown_transaction_text("TIMEOUT_ERROR"));
        assert!(!is_unknown_transaction_text(r#"{"error":{"name":"HANDLER_ERROR","cause":{"name":"TIMEOUT_ERROR"}}}"#));
        assert!(!is_unknown_transaction_text("original send not yet FINAL"));
        assert!(!is_unknown_transaction_error(&err("native_unknown", "original send not yet FINAL")));
        assert!(!is_unknown_transaction_text("INVALID_TRANSACTION"));
        // No substring match: embedded text, wrong case and partial strings are not unknown.
        assert!(!is_unknown_transaction_text("error: UNKNOWN_TRANSACTION happened"));
        assert!(!is_unknown_transaction_text("unknown_transaction"));
    }
    #[test]
    fn success_body_mentioning_unknown_transaction_is_not_unknown() {
        let body = r#"{"final_execution_status":"FINAL","status":{"SuccessValue":""},"transaction":{"signer_id":"unknown_transaction.near","hash":"h"}}"#;
        assert!(!is_unknown_transaction_text(body));
        assert!(!rpc_reports_unknown(body, ""));
        let wrapped = r#"{"result":{"transaction":{"receiver_id":"unknown_transaction.near"}}}"#;
        assert!(!is_unknown_transaction_text(wrapped));
        assert!(!rpc_reports_unknown(wrapped, ""));
        // Even a structurally "unknown" body is ignored when no error was reported.
        let official = r#"{"error":{"cause":{"name":"UNKNOWN_TRANSACTION"}}}"#;
        assert!(rpc_reports_unknown(official, ""));
        assert!(rpc_reports_unknown("", official));
        assert!(rpc_reports_unknown("", "UNKNOWN_TRANSACTION"));
        assert!(!rpc_reports_unknown("UNKNOWN_TRANSACTION", ""));
        assert!(!rpc_reports_unknown("", "TIMEOUT_ERROR"));
    }
    #[test]
    fn unknown_with_key_nonce_at_or_above_plan_never_clears() {
        for kn in [11u64, 12, 1_000] {
            let mut s = Mem::default();
            let mut w = Wire::new(&s);
            let t = dispatched(&mut s, &mut w);
            let plan_nonce = w.plan.as_ref().unwrap().transaction["nonce"].as_u64().unwrap();
            assert_eq!(plan_nonce, 11);
            w.pending = false;
            w.unknown = true;
            w.validity = (Some(100), Some(100 + 86_400 + 2), Some(86_400));
            w.key_nonce = Some(kn);
            let e = reconcile(&mut s, &mut w, &t).unwrap_err();
            assert_eq!(e.code, "native_unknown");
            assert!(current(&mut s).unwrap().is_some());
            assert_eq!(w.async_sends, 1);
        }
        // Control: below the plan nonce, the same context clears.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        w.pending = false;
        w.unknown = true;
        w.validity = (Some(100), Some(100 + 86_400 + 2), Some(86_400));
        w.key_nonce = Some(10);
        assert!(reconcile(&mut s, &mut w, &t).is_ok());
    }
    // Legacy plan (journal written before reference_height existed).
    fn legacy(w: &mut Wire, s: &mut Mem) -> Ticket {
        let t = dispatched(s, w);
        let mut p = w.plan.clone().unwrap();
        p.reference_height = None;
        s.0.borrow_mut().insert(format!("{}/plan", root(t.generation)), serde_json::to_vec(&p).unwrap());
        w.plan = Some(p);
        w.pending = false;
        w.unknown = true;
        t
    }
    #[test]
    fn legacy_plan_clears_only_when_the_reference_block_is_retrievable_and_expired() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = legacy(&mut w, &mut s);
        // host looked the reference block up: ref 100, one block short, then +2
        w.validity = (Some(100), Some(100 + 86_400 + 1), Some(86_400));
        assert!(reconcile(&mut s, &mut w, &t).is_err());
        w.validity = (Some(100), Some(100 + 86_400 + 2), Some(86_400));
        w.key_nonce = Some(11);
        assert!(reconcile(&mut s, &mut w, &t).is_err());
        w.key_nonce = Some(10);
        assert!(reconcile(&mut s, &mut w, &t).is_ok());
    }
    #[test]
    fn legacy_plan_with_unretrievable_reference_block_never_clears() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = legacy(&mut w, &mut s);
        // lookup failed (garbage-collected, lagging node, any error): no height at all
        w.validity = (None, Some(224_300_000), Some(86_400));
        let e = reconcile(&mut s, &mut w, &t).unwrap_err();
        assert_eq!(e.code, "native_unknown");
        assert!(current(&mut s).unwrap().is_some());
        assert!(abort_unsent(&mut s, &t).is_err());
        assert_eq!(w.async_sends, 1);
    }
    #[test]
    fn signing_without_a_parseable_block_height_aborts_before_signing() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.sign_height = None;
        let e = run(&mut s, &mut w, "no-height").unwrap_err();
        assert_eq!(e.code, "rpc");
        assert_eq!(w.async_sends, 0);
        assert!(w.plan.is_none());
        // the reservation was aborted as never submitted: the next send proceeds
        w.sign_height = Some(100);
        run(&mut s, &mut w, "next").unwrap();
        assert_eq!(w.async_sends, 1);
    }
    #[test]
    fn stored_height_plan_clears_without_any_block_lookup() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.sign_height = Some(100);
        let t = dispatched(&mut s, &mut w);
        assert_eq!(w.plan.as_ref().unwrap().reference_height, Some(100));
        w.pending = false;
        w.unknown = true;
        // validity context has no reference height (host would not look it up)
        w.validity = (None, Some(100 + 86_400 + 2), Some(86_400));
        assert!(reconcile(&mut s, &mut w, &t).is_ok());
        // one block short: waits, still no lookup
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.sign_height = Some(100);
        let t = dispatched(&mut s, &mut w);
        w.pending = false;
        w.unknown = true;
        w.validity = (None, Some(100 + 86_400 + 1), Some(86_400));
        assert!(reconcile(&mut s, &mut w, &t).is_err());
    }
    #[test]
    fn old_journal_json_without_new_fields_deserializes() {
        let old = r#"{"hash":"h","signer":"s.near","receiver":"r.near","transaction":{"nonce":11},"signed":"AAAA"}"#;
        let p: Plan = serde_json::from_str(old).unwrap();
        assert_eq!(p.reference_height, None);
        assert!(p.block_hash.is_empty());
        let new = serde_json::to_string(&Plan { reference_height: Some(7), ..p }).unwrap();
        assert!(serde_json::from_str::<Plan>(&new).unwrap().reference_height == Some(7));
    }
    #[test]
    fn unknown_with_failed_key_nonce_read_never_clears() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        w.pending = false;
        w.unknown = true;
        w.validity = (Some(100), Some(100 + 86_400 + 2), Some(86_400));
        w.nonce_err = true;
        let e = reconcile(&mut s, &mut w, &t).unwrap_err();
        assert_eq!(e.code, "native_unknown");
        assert!(current(&mut s).unwrap().is_some());
        assert!(abort_unsent(&mut s, &t).is_err());
        assert_eq!(w.async_sends, 1);
        // The read recovers: the same ticket can then clear.
        w.nonce_err = false;
        assert!(reconcile(&mut s, &mut w, &t).is_ok());
        assert!(current(&mut s).unwrap().is_none());
    }
    #[test]
    fn unknown_with_ref_and_period_but_no_final_height_waits() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        w.pending = false;
        w.unknown = true;
        w.validity = (Some(100), None, Some(86_400));
        let e = reconcile(&mut s, &mut w, &t).unwrap_err();
        assert_eq!(e.code, "native_unknown");
        assert!(current(&mut s).unwrap().is_some());
    }
    #[test]
    fn reference_expired_is_strictly_older_than_the_official_window() {
        assert!(!reference_expired(100 + 86_400, 100, 86_400));
        assert!(!reference_expired(100 + 86_400 + 1, 100, 86_400));
        assert!(reference_expired(100 + 86_400 + 2, 100, 86_400));
        assert!(!reference_expired(100, 100, 86_400));
        assert!(!reference_expired(50, 100, 86_400));
        let (f, p) = (100 + 86_400 + 2, Some(86_400));
        assert!(!can_clear_unknown(true, Some(100), Some(100 + 86_400 + 1), p, Some(10), Some(11)));
        assert!(can_clear_unknown(true, Some(100), Some(f), p, Some(10), Some(11)));
        assert!(!can_clear_unknown(false, Some(100), Some(f), p, Some(10), Some(11)));
        assert!(!can_clear_unknown(true, None, Some(f), p, Some(10), Some(11)));
        assert!(!can_clear_unknown(true, Some(100), None, p, Some(10), Some(11)));
        assert!(!can_clear_unknown(true, Some(100), Some(f), p, Some(11), Some(11)));
        assert!(!can_clear_unknown(true, Some(100), Some(f), p, None, Some(11)));
    }
    #[test]
    fn protocol_config_and_block_height_accept_official_shapes() {
        assert_eq!(transaction_validity_period(r#"{"transaction_validity_period":86400}"#), Some(86_400));
        assert_eq!(
            transaction_validity_period(r#"{"jsonrpc":"2.0","result":{"transaction_validity_period":86400,"epoch_length":43200}}"#),
            Some(86_400)
        );
        assert_eq!(block_height(r#"{"header":{"height":224165168}}"#), Some(224_165_168));
        assert_eq!(block_height(r#"{"result":{"header":{"height":224165168,"hash":"abc"}}}"#), Some(224_165_168));
        assert_eq!(transaction_validity_period("not-json"), None);
    }
    #[test]
    fn block_hash_is_recovered_from_signed_bytes_without_exposing_them() {
        let seed = [7u8; 32];
        let pk = ed25519_dalek::SigningKey::from_bytes(&seed)
            .verifying_key()
            .to_bytes();
        let block = [9u8; 32];
        let tx = crate::encode_tx(
            "minter.near",
            &pk,
            11,
            "keys.near",
            &block,
            &[Action::Transfer { deposit: 1 }],
        );
        let signed = B64.encode(crate::sign_tx(&seed, &tx));
        assert_eq!(block_hash_from_signed(&signed).as_ref(), Some(&block));
        let p = Plan {
            hash: "h".into(),
            signer: "minter.near".into(),
            receiver: "keys.near".into(),
            transaction: json!({}),
            signed: signed.clone(),
            block_hash: String::new(),
            reference_height: None,
        };
        assert_eq!(plan_block_hash(&p).as_ref(), Some(&block));
        let stored = bs58::encode(block).into_string();
        let p2 = Plan {
            block_hash: stored,
            signed: "not-a-tx".into(),
            ..p.clone()
        };
        assert_eq!(plan_block_hash(&p2).as_ref(), Some(&block));
        let e = unresolved_error(&p, Some(42), "original send not yet FINAL");
        assert!(e.message.contains("tx_hash=h"));
        assert!(e.message.contains("reference_block_height=42"));
        assert!(!e.message.contains(&signed));
    }
    #[test]
    fn rebroadcast_never_resigns_and_uses_stored_bytes() {
        // The lost claim_payout (J5dHg2q…): the journal holds the exact signed
        // bytes; a rebroadcast must re-submit THOSE bytes, never a fresh signing.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        let p = w.plan.clone().unwrap();
        w.pending = false;
        w.unknown = false;
        w.validity = (Some(100), Some(200), Some(86_400));
        let v = rebroadcast(&mut s, &mut w, &t).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["status"], "success");
        assert_eq!(v["tx_hash"], p.hash);
        assert_eq!(v["rebroadcast"], true);
        assert_eq!(v["reconciled"], true);
        assert_eq!(w.async_sends, 2, "the original async broadcast + the rebroadcast");
        assert_eq!(w.async_signed, vec![p.signed.clone(), p.signed.clone()]);
        assert_eq!(w.sends, 0, "no FINAL broadcast is ever used");
        // (c) No sign call: a fresh signing needs a fresh nonce read, and
        // rebroadcast made none (the nonce was read once, by the original
        // execute). The bytes come from the stored plan, never a re-sign.
        assert_eq!(w.reads, 1, "rebroadcast must not read a fresh nonce");
        assert!(current(&mut s).unwrap().is_none());
    }
    #[test]
    fn rebroadcast_refused_after_expiry() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        let p = w.plan.clone().unwrap();
        w.pending = false;
        w.unknown = false;
        // Window expired: final == ref + period + 2.
        w.validity = (Some(100), Some(100 + 86_400 + 2), Some(86_400));
        let sends_before = w.async_sends;
        let e = rebroadcast(&mut s, &mut w, &t).unwrap_err();
        assert_eq!(e.code, "rebroadcast_expired");
        assert!(e.message.contains(&p.hash), "{}", e.message);
        assert_eq!(w.async_sends, sends_before, "no broadcast attempted after expiry");
        assert_eq!(w.async_sends, 1);
        assert!(current(&mut s).unwrap().is_some(), "ticket stays for reconcile");
    }
    #[test]
    fn double_rebroadcast_submits_identical_bytes_and_finishes_once() {
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        let p = w.plan.clone().unwrap();
        w.pending = false;
        w.unknown = false;
        w.validity = (Some(100), Some(200), Some(86_400));
        let v1 = rebroadcast(&mut s, &mut w, &t).unwrap();
        assert_eq!(v1["status"], "success");
        let head_after_first =
            String::from_utf8(s.read(HEAD).unwrap()).unwrap().parse::<i64>().unwrap();
        assert_eq!(head_after_first, 1);
        // A second rebroadcast (e.g. the operator's response was lost) submits
        // the SAME bytes again — the node rejects a duplicate nonce/hash, so the
        // tx can never execute twice — and the journal does not advance again.
        let v2 = rebroadcast(&mut s, &mut w, &t).unwrap();
        assert_eq!(v2["status"], "success");
        // Initial async broadcast + two rebroadcasts, all the SAME bytes.
        assert_eq!(w.async_sends, 3);
        assert_eq!(w.async_signed[0], w.async_signed[1]);
        assert_eq!(w.async_signed[1], w.async_signed[2]);
        assert_eq!(w.async_signed[0], p.signed);
        let head_after_second =
            String::from_utf8(s.read(HEAD).unwrap()).unwrap().parse::<i64>().unwrap();
        assert_eq!(head_after_second, 1, "finish is idempotent; HEAD advances once");
        assert!(current(&mut s).unwrap().is_none());
    }
    #[test]
    fn rebroadcast_not_final_leaves_ticket_for_reconcile() {
        // The rebroadcast was sent but the tx is not FINAL yet: the ticket
        // stays, and the normal reconcile clears it once the tx is FINAL.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        let p = w.plan.clone().unwrap();
        w.pending = true;
        w.unknown = false;
        w.async_lands = false;
        w.validity = (Some(100), Some(200), Some(86_400));
        let v = rebroadcast(&mut s, &mut w, &t).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["status"], "rebroadcast");
        assert_eq!(v["final"], false);
        assert_eq!(v["tx_hash"], p.hash);
        // Initial async broadcast + the one rebroadcast, same bytes.
        assert_eq!(w.async_sends, 2);
        assert_eq!(w.async_signed, vec![p.signed.clone(), p.signed.clone()]);
        assert!(current(&mut s).unwrap().is_some(), "ticket stays until FINAL");
        w.pending = false;
        let (p2, v2, ok) = reconcile(&mut s, &mut w, &t).unwrap();
        assert!(ok);
        assert_eq!(p2.hash, p.hash);
        assert_eq!(v2["transaction"]["hash"], p.hash);
        assert!(current(&mut s).unwrap().is_none());
    }
    #[test]
    fn in_call_retry_rebroadcasts_on_unknown_then_succeeds() {
        // The exact failure mode that created J5dHg2q…: the broadcast response
        // was lost AND the tx was not on-chain. execute() must re-broadcast
        // the SAME bytes inside the call instead of leaving the ticket UNKNOWN.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        // One-shot transport failure on the initial send; the tx is not
        // on-chain, so the in-call retry must re-submit the same bytes.
        w.send_fail_once = true;
        w.pending = true;
        w.unknown = true;
        let (hash, _v) = run(&mut s, &mut w, "id").unwrap();
        let p = w.plan.clone().unwrap();
        assert_eq!(hash, p.hash);
        assert_eq!(w.sends, 0, "no FINAL broadcast is ever used");
        assert_eq!(w.async_sends, 2, "the failed initial send + one in-call re-broadcast");
        assert_eq!(w.async_signed, vec![p.signed.clone(), p.signed.clone()]);
        assert!(current(&mut s).unwrap().is_none());
    }
    #[test]
    fn hash_is_known_before_send_and_poll_recovers_by_it() {
        // The NONE design rests on one property: the tx hash is computable
        // from the signed bytes BEFORE sending, so a tx whose send response
        // was lost is always recoverable by hash. The lost claim_payout
        // (J5dHg2q…) had no hash in its error because the FINAL wait timed
        // out; with NONE the hash is in the plan from the start.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.send_fail_once = true;
        w.pending = true;
        let e = run(&mut s, &mut w, "old").unwrap_err();
        let t = current(&mut s).unwrap().unwrap();
        let p: Plan = read(&mut s, &format!("{}/plan", root(t.generation))).unwrap();
        assert!(e.message.contains(&p.hash), "{}", e.message);
        // Recompute the hash from the signed bytes alone (strip the 65-byte
        // signature suffix, sha256 the tx, bs58) — the same derivation the
        // worker does before sending.
        let raw = B64.decode(&p.signed).unwrap();
        assert!(raw.len() > 65);
        let tx = &raw[..raw.len() - 65];
        let recomputed = bs58::encode(Sha256::digest(tx)).into_string();
        assert_eq!(recomputed, p.hash);
        // The ticket is still dispatch with the plan intact: reconcile polls
        // by that same hash once the tx is indexed.
        assert_eq!(current(&mut s).unwrap().unwrap().generation, t.generation);
        w.pending = false;
        let (p2, _v, ok) = reconcile(&mut s, &mut w, &t).unwrap();
        assert!(ok);
        assert_eq!(p2.hash, p.hash);
    }
    #[test]
    fn lost_broadcast_returns_pending_with_hash_never_unknown_without_hash() {
        // A transport failure after sending must surface as pending WITH the
        // hash — never as an UNKNOWN that carries no hash (that is what made
        // J5dHg2q… unrecoverable except by waiting out the validity window).
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.send_fail_once = true;
        w.pending = true;
        let e = run(&mut s, &mut w, "old").unwrap_err();
        let t = current(&mut s).unwrap().unwrap();
        let p = w.plan.clone().unwrap();
        assert_eq!(e.code, "native_unknown");
        assert!(e.message.contains(&p.hash), "{}", e.message);
        assert!(e.message.contains("tx_hash="), "{}", e.message);
        // A reconcile while the tx is still not indexed reports the same
        // pending state with the hash and the reference height — never a
        // bare unknown.
        let e2 = reconcile(&mut s, &mut w, &t).unwrap_err();
        assert_eq!(e2.code, "native_unknown");
        assert!(e2.message.contains(&p.hash), "{}", e2.message);
        assert!(e2.message.contains("reference_block_height="), "{}", e2.message);
        assert!(current(&mut s).unwrap().is_some(), "ticket stays for reconcile");
    }
    #[test]
    fn rpc_call_counts_stay_far_under_the_host_cap() {
        // The host allows 100 near:rpc calls per run. Every op below logs
        // its count; the mock counts one call per Rpc method (production
        // validity_context makes up to 3 real calls), so the modeled total
        // stays far under the cap and polling can never push a run over it.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        // A successful send: nonce + block + async broadcast + one status poll.
        run(&mut s, &mut w, "ok").unwrap();
        eprintln!("successful execute rpc_calls={}", w.rpc_calls);
        assert!(w.rpc_calls <= 10, "rpc_calls={}", w.rpc_calls);
        assert_eq!(w.sends, 0, "no FINAL broadcast is ever used");
        // A lost send: nonce + block + failed async broadcast + 3 re-polls +
        // one reconcile poll.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.send_fail_once = true;
        w.pending = true;
        assert!(run(&mut s, &mut w, "old").is_err());
        eprintln!("lost-broadcast execute rpc_calls={}", w.rpc_calls);
        assert!(w.rpc_calls <= 10, "rpc_calls={}", w.rpc_calls);
        // A rebroadcast: validity context + async broadcast + one status poll.
        let before = w.rpc_calls;
        w.pending = false;
        w.unknown = false;
        w.validity = (Some(100), Some(200), Some(86_400));
        let t = current(&mut s).unwrap().unwrap();
        rebroadcast(&mut s, &mut w, &t).unwrap();
        let rebroadcast_calls = w.rpc_calls - before;
        eprintln!("rebroadcast rpc_calls={rebroadcast_calls}");
        assert!(rebroadcast_calls <= 10, "rpc_calls={rebroadcast_calls}");
        eprintln!("full minter-send lifecycle rpc_calls={}", w.rpc_calls);
        assert!(w.rpc_calls < 50, "rpc_calls={}", w.rpc_calls);
    }
    #[test]
    fn status_repols_are_spaced_by_the_host_pause() {
        // Round-3 gap 1: MAX_STATUS_POLLS = 3 with no wait between
        // attempts exhausts all three polls in under a second, before the
        // tx enters a block. Each re-poll must be preceded by a host pause
        // (~2 s in production); the mock counts pauses instead of sleeping,
        // so the test stays fast. A pause is not an RPC call.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.send_fail_once = true;
        w.pending = true;
        assert!(run(&mut s, &mut w, "old").is_err());
        // Three bounded re-polls: a pause before the 2nd and the 3rd.
        assert_eq!(w.pauses, 2, "pauses={}", w.pauses);
        // The pause adds no RPC calls: the lost-broadcast execute stays ≤ 10.
        assert!(w.rpc_calls <= 10, "rpc_calls={}", w.rpc_calls);
        // Behavior unchanged: the ticket stays pending WITH the hash.
        assert!(current(&mut s).unwrap().is_some());
        let p = w.plan.clone().unwrap();
        assert!(!p.hash.is_empty());
    }
    #[test]
    fn unknown_repols_are_spaced_and_rebroadcasts_stay_byte_identical() {
        // (b) UNKNOWN_TRANSACTION right after send: execute must return
        // pending WITH the hash, and the ticket must never be
        // UNKNOWN-without-hash. The re-polls are spaced by a host pause
        // before each re-broadcast, so the tx has time to propagate instead
        // of all three polls returning UNKNOWN in under a second.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.send_fail_once = true;
        w.pending = true;
        w.unknown = true;
        w.async_lands = false;
        let e = run(&mut s, &mut w, "old").unwrap_err();
        let p = w.plan.clone().unwrap();
        assert_eq!(e.code, "native_unknown");
        assert!(e.message.contains(&p.hash), "{}", e.message);
        assert!(e.message.contains("tx_hash="), "{}", e.message);
        // 1 initial send + 3 in-call re-broadcasts, all the SAME bytes.
        assert_eq!(w.async_sends, 4, "async_sends={}", w.async_sends);
        assert!(w.async_signed.iter().all(|b| *b == p.signed));
        assert_eq!(w.sends, 0, "no FINAL broadcast is ever used");
        // A pause before each of the 3 re-broadcasts.
        assert_eq!(w.pauses, 3, "pauses={}", w.pauses);
        // No RPC-call inflation from the pauses (worst case ~12 here; the
        // production worst case is ~15-16 once validity_context's up to 3
        // real calls and the expiry nonce read are counted — still far
        // under the host's 100 calls per run).
        eprintln!("unknown-path execute rpc_calls={}", w.rpc_calls);
        assert!(w.rpc_calls <= 15, "rpc_calls={}", w.rpc_calls);
        // The ticket stays dispatch with the hash — never UNKNOWN-without-hash.
        assert!(current(&mut s).unwrap().is_some());
        // And a later reconcile still reports the same pending state with the hash.
        let t = current(&mut s).unwrap().unwrap();
        let e2 = reconcile(&mut s, &mut w, &t).unwrap_err();
        assert!(e2.message.contains(&p.hash), "{}", e2.message);
    }
    #[test]
    fn ticket_persisted_before_broadcast_with_none_send() {
        // (a) The ticket (decision=dispatch, hash, signed bytes) must be
        // persisted in the journal BEFORE the broadcast: the hash is
        // computed from the signed bytes before sending, so a lost send is
        // always recoverable by hash. The mock records whether the journal
        // already held the ticket at broadcast time.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        run(&mut s, &mut w, "ok").unwrap();
        assert!(w.persisted_before_broadcast, "ticket was not persisted before broadcast");
        let p = w.plan.clone().unwrap();
        // The hash is the hash of the signed bytes (recomputed from the
        // bytes alone, the same derivation the worker does before sending).
        let raw = B64.decode(&p.signed).unwrap();
        assert!(raw.len() > 65);
        let tx = &raw[..raw.len() - 65];
        let recomputed = bs58::encode(Sha256::digest(tx)).into_string();
        assert_eq!(recomputed, p.hash);
        // And the send used the async (NONE) transport, never FINAL.
        assert_eq!(w.async_sends, 1);
        assert_eq!(w.sends, 0, "no FINAL broadcast is ever used");
        assert!(current(&mut s).unwrap().is_none());
    }
    #[test]
    fn final_failure_resolves_as_failed_with_no_rebroadcast() {
        // (d) A tx that reaches FINAL with a failed receipt is resolved as
        // failed — the ticket is finished as "failure" and there is NO
        // re-broadcast (a terminal outcome is never retried).
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        w.fail_outcome = true;
        let e = run(&mut s, &mut w, "id").unwrap_err();
        let p = w.plan.clone().unwrap();
        assert_eq!(e.code, "tx_failed");
        assert!(e.message.contains(&p.hash), "{}", e.message);
        assert_eq!(w.async_sends, 1, "the failure was terminal: no re-broadcast");
        assert_eq!(w.sends, 0, "no FINAL broadcast is ever used");
        // The ticket is finished as "failure" (HEAD advanced once, no live ticket).
        assert_eq!(s.incr(HEAD, 0).unwrap(), 1);
        assert!(current(&mut s).unwrap().is_none());
        // A later send proceeds (the journal is not blocked by a failed ticket).
        w.fail_outcome = false;
        run(&mut s, &mut w, "next").unwrap();
        assert_eq!(w.async_sends, 2);
    }
    #[test]
    fn expired_ticket_clears_only_via_the_expiry_nonce_rule() {
        // (e) After the validity window expires, rebroadcast is refused AND
        // the ticket can only be cleared by reconcile with the #222 rule
        // (UNKNOWN + expired + signer nonce below the plan nonce). No other
        // path clears it.
        let mut s = Mem::default();
        let mut w = Wire::new(&s);
        let t = dispatched(&mut s, &mut w);
        let p = w.plan.clone().unwrap();
        w.pending = false;
        w.unknown = true;
        w.validity = (Some(100), Some(100 + 86_400 + 2), Some(86_400));
        // Rebroadcast is refused after expiry (no broadcast attempted).
        let sends_before = w.async_sends;
        let e = rebroadcast(&mut s, &mut w, &t).unwrap_err();
        assert_eq!(e.code, "rebroadcast_expired");
        assert_eq!(w.async_sends, sends_before, "no broadcast attempted after expiry");
        assert!(current(&mut s).unwrap().is_some(), "ticket stays for reconcile");
        // The nonce rule still gates the clear: a nonce at/above the plan
        // never clears (the tx may have executed).
        w.key_nonce = Some(11); // the plan nonce is 11
        assert!(reconcile(&mut s, &mut w, &t).is_err());
        assert!(current(&mut s).unwrap().is_some());
        // A nonce below the plan nonce: the #222 rule clears it as does_not_exist.
        w.key_nonce = Some(10);
        let (p2, v, ok) = reconcile(&mut s, &mut w, &t).unwrap();
        assert!(!ok);
        assert_eq!(v["does_not_exist"], true);
        assert_eq!(v["tx_hash"], p.hash);
        assert_eq!(p2.hash, p.hash);
        assert!(current(&mut s).unwrap().is_none());
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
    #[test]
    fn no_final_wait_in_any_rpc_call() {
        // The OutLayer host caps every near:rpc call at 30 s with no retry,
        // so a FINAL wait that outlasts 30 s errors even when the tx was
        // accepted and gives no hash (the lost claim_payout, J5dHg2q…).
        // No production call site may pass "FINAL" as a wait_until to
        // send_tx or tx_status, and the worker must never use the host's
        // signing call/transfer (it signs in-WASM and sends signed bytes).
        // Finality is always read from the response body instead.
        for (name, src) in [
            ("native_host.rs", include_str!("native_host.rs")),
            ("collateral_host.rs", include_str!("collateral_host.rs")),
            ("collateral_evidence_host.rs", include_str!("collateral_evidence_host.rs")),
            ("exact_exit_host.rs", include_str!("exact_exit_host.rs")),
        ] {
            for (i, line) in src.lines().enumerate() {
                assert!(
                    !(line.contains("tx_status(") && line.contains("\"FINAL\"")),
                    "{name}:{} still waits FINAL: {line}",
                    i + 1
                );
                assert!(
                    !(line.contains("send_tx(") && line.contains("\"FINAL\"")),
                    "{name}:{} still waits FINAL: {line}",
                    i + 1
                );
                assert!(
                    !line.contains("rpc::call(") && !line.contains("rpc::transfer("),
                    "{name}:{} uses the host signing call/transfer: {line}",
                    i + 1
                );
            }
        }
        // (a) The production transport must actually pass "NONE": both
        // NativeRpc send paths (broadcast and broadcast_async) route
        // through the shared send_tx helper with wait-until "NONE".
        let adapter = include_str!("native_host.rs");
        assert_eq!(
            adapter.matches("send_tx(signed, \"NONE\")").count(),
            2,
            "both NativeRpc send paths must use wait-until NONE"
        );
    }
}
