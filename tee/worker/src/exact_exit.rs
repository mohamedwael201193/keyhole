//! Three typed custody hops; append-only WAL, one POST claimant per hop, GET-only
//! known-ID recovery. No lost-ID retransmission, invented quote fields or top-ups.
//! Provider terminal status + independent FINAL balance readbacks are required.
use crate::{
    err,
    guarded::{self, Journal, ProviderHost, Terminal},
    Error,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const OP: &str = "exact_near_exit_v1";
pub const MODE: &str = "exact-near-v1";
pub const STORAGE_MAX: u128 = 1_250_000_000_000_000_000_000;
pub const NATIVE_MAX: u128 = 2_500_000_000_000_000_000_000;
pub const TOKEN: &str = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub exit_mode: String,
    pub chain: String,
    pub to: String,
    pub token: String,
    pub amount: String,
    pub min_amount_out: String,
    pub deadline_ms: u64,
}
impl Plan {
    pub fn signed(p: &Value, now: u64, owner: &str) -> Result<Self, Error> {
        crate::withdrawal_protection::require_bound_execution(p, now)?;
        let plan = Self {
            exit_mode: MODE.into(),
            chain: "near".into(),
            to: guarded::text(p, "to")?.into(),
            token: guarded::ASSET.into(),
            amount: guarded::text(p, "amount")?.into(),
            min_amount_out: guarded::text(p, "min_amount_out")?.into(),
            deadline_ms: p["deadline_ms"]
                .as_u64()
                .ok_or_else(|| err("withdraw_exact_policy", "deadline required"))?,
        };
        if plan.to != owner {
            return Err(err(
                "withdraw_exact_policy",
                "only the authenticated current holder is allowlisted",
            ));
        }
        Ok(plan)
    }
    pub fn journal(j: &Journal) -> Result<Self, Error> {
        let p: Self = serde_json::from_value(j.body.clone())
            .map_err(|_| err("withdraw_exact_policy", "invalid immutable exit plan"))?;
        if j.kind != "withdraw"
            || j.auth_scheme != "nep413"
            || !guarded::lower_hash(&j.wallet_id)
            || p.to != j.owner
            || !crate::is_valid_account_id(&p.to)
            || p.exit_mode != MODE
            || p.chain != "near"
            || p.token != guarded::ASSET
            || p.amount != p.min_amount_out
            || p.units()? == 0
            || !p.amount.bytes().all(|b| b.is_ascii_digit())
            || p.amount.starts_with('0')
        {
            return Err(err(
                "withdraw_exact_policy",
                "exit policy/holder/asset/amount binding changed",
            ));
        }
        Ok(p)
    }
    pub fn units(&self) -> Result<u128, Error> {
        self.amount
            .parse()
            .map_err(|_| err("withdraw_exact_policy", "invalid amount"))
    }
    pub fn body(&self) -> Result<Value, Error> {
        serde_json::to_value(self).map_err(|_| err("withdraw_exact_policy", "encode plan"))
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Unshield,
    Storage,
    Withdraw,
}
impl Step {
    pub fn name(self) -> &'static str {
        match self {
            Self::Unshield => "unshield",
            Self::Storage => "storage",
            Self::Withdraw => "withdraw",
        }
    }
    pub fn path(self) -> &'static str {
        match self {
            Self::Unshield => "/wallet/v1/confidential/unshield",
            Self::Storage => "/wallet/v1/storage-deposit",
            Self::Withdraw => "/wallet/v1/intents/withdraw",
        }
    }
    /// Provider row types accepted for this hop. The unshield hop also accepts the
    /// confidential_unshield spelling by analogy with the confidential_swap type observed
    /// live for swaps (NOT yet observed for unshield); any other type refuses and is named.
    pub fn request_types(self) -> &'static [&'static str] {
        match self {
            Self::Unshield => &["confidential", "confidential_unshield"],
            Self::Storage => &["call"],
            Self::Withdraw => &["withdraw"],
        }
    }
    pub fn request_type(self) -> &'static str {
        match self {
            Self::Unshield => "confidential",
            Self::Storage => "call",
            Self::Withdraw => "withdraw",
        }
    }
    pub fn body(self, p: &Plan) -> Value {
        match self {
            Self::Unshield => json!({"token":p.token,"amount":p.amount}),
            Self::Storage => json!({"token":TOKEN,"account_id":p.to}),
            Self::Withdraw => {
                json!({"chain":"near","to":p.to,"amount":p.amount,"token":p.token,"async":true})
            }
        }
    }
    fn valid_status(self, s: &str) -> bool {
        match self {
            Self::Unshield => matches!(
                s,
                "pending_deposit"
                    | "processing"
                    | "success"
                    | "failed"
                    | "refunded"
                    | "pending_approval"
                    | "needs_review"
            ),
            Self::Storage => matches!(
                s,
                "processing"
                    | "success"
                    | "completed"
                    | "failed"
                    | "pending_approval"
                    | "approved"
                    | "rejected"
                    | "needs_review"
            ),
            Self::Withdraw => matches!(
                s,
                "processing"
                    | "success"
                    | "failed"
                    | "pending_approval"
                    | "approved"
                    | "rejected"
                    | "needs_review"
            ),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Observation {
    pub confidential: String,
    pub intents: String,
    pub recipient: String,
    pub native: String,
    pub storage_min: String,
    pub registered: bool,
}
impl Observation {
    fn n(&self, field: &str) -> Result<u128, Error> {
        guarded::decimal(
            &serde_json::to_value(self).map_err(|_| err("exit_readback", "encode"))?,
            field,
        )
    }
    fn validate(&self) -> Result<(), Error> {
        for f in [
            "confidential",
            "intents",
            "recipient",
            "native",
            "storage_min",
        ] {
            self.n(f)?;
        }
        Ok(())
    }
}
/// The same fail-closed decoder is used by WASI and native transport fixtures.
pub struct Readbacks<'a> {
    pub private: &'a Value,
    pub public: &'a Value,
    pub intents: &'a Value,
    pub recipient: &'a Value,
    pub storage: &'a Value,
    pub bounds: &'a Value,
    pub native: &'a Value,
}
pub fn decode_readbacks(wallet_id: &str, r: Readbacks<'_>) -> Result<Observation, Error> {
    for v in [
        r.private,
        r.public,
        r.intents,
        r.recipient,
        r.storage,
        r.bounds,
        r.native,
    ] {
        if v.get("error").is_some() || v.get("jsonrpc").is_some() {
            return Err(err("exit_readback", "provider/RPC error envelope"));
        }
    }
    if !guarded::lower_hash(wallet_id)
        || r.private["account_id"] != wallet_id
        || r.private["token"] != guarded::ASSET
        || r.public["account_id"] != wallet_id
        || r.public["account"] != "executor"
        || r.public["token"] != guarded::ASSET
    {
        return Err(err(
            "exit_readback",
            "wallet/executor/asset binding mismatch",
        ));
    }
    fn number(v: &Value) -> Result<String, Error> {
        let s = v
            .as_str()
            .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
            .ok_or_else(|| err("exit_readback", "invalid FINAL balance"))?;
        Ok(s.parse::<u128>()
            .map_err(|_| err("exit_readback", "balance overflow"))?
            .to_string())
    }
    let intents = number(r.intents)?;
    if intents != guarded::decimal(r.public, "balance")?.to_string() {
        return Err(err("exit_readback", "public/provider Intents disagreement"));
    }
    let registered = if r.storage.is_null() {
        false
    } else {
        if guarded::decimal(r.storage, "total")? == 0 {
            return Err(err("exit_readback", "invalid storage registration"));
        }
        guarded::decimal(r.storage, "available")?;
        true
    };
    Ok(Observation {
        confidential: guarded::decimal(r.private, "balance")?.to_string(),
        intents,
        recipient: number(r.recipient)?,
        native: guarded::decimal(r.native, "amount")?.to_string(),
        storage_min: guarded::decimal(r.bounds, "min")?.to_string(),
        registered,
    })
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct VerifiedStep {
    provider: Value,
    observation: Observation,
}
/// Remaining wall-clock room for this call is asked of the host; below this a new hop is not started.
pub const HOP_MIN_LEFT_MS: u64 = 22_000;
/// Resumable pending result: nothing was lost or resent; a reconcile of the same operation id
/// continues at `step` (a posted hop is polled, never posted again).
fn pause(j: &Journal, step: Step) -> Value {
    json!({"status":"processing","exit_mode":MODE,"step":step.name(),"value_op_id":j.op_id,"request_id":Value::Null,"admission_finished":false,"reason":"time_budget"})
}
pub trait Host: ProviderHost {
    /// Milliseconds left in this call's wall-clock budget (default: unlimited, native tests).
    fn time_left_ms(&mut self) -> u64 {
        u64::MAX
    }
    /// FINAL public intents mt_balance_of and FT balance/storage; confidential ledger
    /// is authenticated provider data. All identities/assets validated by adapter.
    fn observe(&mut self, j: &Journal, key: &str) -> Result<Observation, Error>;
    /// Fetches genuine FINAL RPC result for the original intent. No supplied success flags.
    fn original_delivery(&mut self, j: &Journal, intent: &str) -> Result<Value, Error>;
    fn now_ms(&mut self) -> Result<u64, Error>;
    fn post_step(
        &mut self,
        key: &str,
        idempotency: &str,
        step: Step,
        body: &Value,
    ) -> Result<(u16, Value), Error>;
}
fn save<H: Host, T: Serialize>(h: &mut H, k: &str, v: &T) -> Result<(), Error> {
    guarded::put_once(
        h,
        k,
        &serde_json::to_vec(v).map_err(|_| err("exit_wal", "encode evidence"))?,
    )?;
    Ok(())
}
fn read<H: Host, T: serde::de::DeserializeOwned>(h: &mut H, k: &str) -> Result<Option<T>, Error> {
    let raw = h.read(k)?;
    if raw.is_empty() {
        return Ok(None);
    }
    serde_json::from_slice(&raw)
        .map(Some)
        .map_err(|_| err("exit_wal", "corrupt evidence"))
}
fn review(j: &Journal, step: Step, id: Option<&str>, status: &str) -> Value {
    json!({"status":status,"exit_mode":MODE,"step":step.name(),"value_op_id":j.op_id,"request_id":id,"admission_finished":false})
}
fn row(v: &Value, id: &str, step: Step) -> Result<&'static str, Error> {
    let id_ok = v["request_id"] == id;
    let type_ok = v["type"]
        .as_str()
        .is_some_and(|t| step.request_types().contains(&t));
    let has_error = v.get("error").is_some_and(|e| !e.is_null());
    let approval_ok = !(v.get("approval_id").is_some_and(|a| !a.is_null()) && v["status"] == "success");
    if has_error || !id_ok || !type_ok || !approval_ok {
        let ty: String = v["type"]
            .as_str()
            .unwrap_or("missing")
            .chars()
            .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '_')
            .take(32)
            .collect();
        return Err(err(
            "exit_provider",
            format!(
                "original request identity/type/error mismatch: step={} id_match={id_ok} type={ty} type_ok={type_ok} error_present={has_error}",
                step.name()
            ),
        ));
    }
    let s = guarded::text(v, "status")?;
    if !step.valid_status(s) {
        return Err(err("exit_provider", "unknown operation status"));
    }
    Ok(match s {
        "success" | "completed" => "success",
        "failed" | "refunded" | "rejected" => "failed",
        "needs_review" => "needs_review",
        _ => "processing",
    })
}
fn credit(before: &Observation, after: &Observation, a: u128) -> Result<(), Error> {
    if before
        .n("confidential")?
        .checked_sub(after.n("confidential")?)
        != Some(a)
        || after.n("intents")?.checked_sub(before.n("intents")?) != Some(a)
    {
        return Err(err(
            "exit_readback",
            "unshield exact self-credit/debit not established; no public withdrawal",
        ));
    }
    Ok(())
}
/// Reentrant calls may read and reconcile, but never claim another process's POST.
/// A crash after a dispatch claim and before its ID is durable stays UNKNOWN.
pub fn drive<H: Host>(h: &mut H, j: &Journal, key: &str) -> Result<Value, Error> {
    drive_continued(h,j,key,None)
}
/// Continuation is already fresh NEP-413-authenticated by the host; it authorizes
/// only the immutable operation's named, unsent next hop (never a replacement).
pub fn drive_continued<H:Host>(h:&mut H,j:&Journal,key:&str,continuation:Option<&Value>)->Result<Value,Error>{
    j.validate()?;
    let p = Plan::journal(j)?;
    let a = p.units()?;
    let root = format!("{}/exact", j.key());
    if let Some(t) = read::<_, Terminal>(h, &format!("{}/terminal", j.key()))? {
        let done = h.finish(j, &t)?;
        return Ok(
            json!({"status":if done{if t.success{"success"}else{"failed"}}else{"needs_review"},"exit_mode":MODE,"value_op_id":j.op_id,"request_id":t.provider_id,"admission_finished":done}),
        );
    }
    if h.time_left_ms() < HOP_MIN_LEFT_MS {
        return Ok(pause(j, Step::Unshield));
    }
    h.validate_dispatch(j, key)?;
    let baseline_key = format!("{root}/baseline");
    let baseline = if let Some(o) = read::<_, Observation>(h, &baseline_key)? {
        o
    } else {
        let o = h.observe(j, key)?;
        o.validate()?;
        if o.n("confidential")? < a
            || o.n("storage_min")? == 0
            || o.n("storage_min")? > STORAGE_MAX
            || o.n("native")? < NATIVE_MAX
        {
            return Err(err(
                "exit_budget",
                "insufficient collateral/native reserve or token storage above budget",
            ));
        }
        save(h, &baseline_key, &o)?;
        o
    };
    baseline.validate()?;
    // The immutable plan is separate from hop request bytes. A replay cannot change
    // amount and minimum together while retaining this operation's recovery handle.
    save(h, &format!("{root}/plan"), &p)?;
    if let Some(t) = read::<_, Terminal>(h, &format!("{root}/terminal_candidate"))? {
        if !guarded::uuid(&t.provider_id) || h.read(&format!("{}/settlement", j.key()))?.is_empty()
        {
            return Err(err(
                "exit_wal",
                "terminal candidate missing original settlement",
            ));
        }
        let done = h.finish(j, &t)?;
        return Ok(
            json!({"status":if done{if t.success{"success"}else{"failed"}}else{"needs_review"},"exit_mode":MODE,"value_op_id":j.op_id,"request_id":t.provider_id,"admission_finished":done}),
        );
    }
    for step in [Step::Unshield, Step::Storage, Step::Withdraw] {
        let sk = format!("{root}/{}", step.name());
        let confirmed = format!("{sk}/verified");
        if let Some(proof) = read::<_, VerifiedStep>(h, &confirmed)? {
            let original: String = read(h, &format!("{sk}/provider"))?
                .ok_or_else(|| err("exit_wal", "verified hop lost original provider identity"))?;
            if !guarded::uuid(&original) || row(&proof.provider, &original, step)? != "success" {
                return Err(err(
                    "exit_wal",
                    "verified hop has invalid original terminal state",
                ));
            }
            proof.observation.validate()?;
            credit(&baseline, &proof.observation, a)?;
            if step == Step::Storage && !proof.observation.registered {
                return Err(err("exit_wal", "verified storage is not registered"));
            }
            continue;
        }
        if h.time_left_ms() < HOP_MIN_LEFT_MS {
            return Ok(pause(j, step));
        }
        let id_key = format!("{sk}/provider");
        let id = if let Some(id) = read::<_, String>(h, &id_key)? {
            id
        } else {
            // Never retransmit after lost response, even under the original key.
            if !h.read(&format!("{sk}/dispatch"))?.is_empty() {
                return Ok(review(j, step, None, "needs_review"));
            }
            h.validate_dispatch(j, key)?;
            let now = h.now_ms()?;
            if now >= p.deadline_ms {
                let prev=match step {Step::Unshield=>None,Step::Storage=>Some(Step::Unshield),Step::Withdraw=>Some(Step::Storage)};
                let original:Option<String>=if let Some(prev)=prev {read(h,&format!("{root}/{}/provider",prev.name()))?}else{None};
                let Some(c)=continuation else {
                    return Ok(json!({"status":"awaiting_continuation","exit_mode":MODE,"step":step.name(),"value_op_id":j.op_id,"request_id":original,"admission_finished":false,"continuation":{"step":step.name(),"value_op_id":j.op_id,"action_hash":j.action_hash,"original_provider_id":original}}));
                };
                let deadline=c["deadline_ms"].as_u64().ok_or_else(||err("exit_continue","deadline required"))?;
                if c.as_object().is_none_or(|m|m.len()!=5) || c["step"]!=step.name() || c["value_op_id"]!=j.op_id ||
                   c["action_hash"]!=j.action_hash || c["original_provider_id"]!=json!(original) ||
                   now>=deadline || deadline-now>300_000 {return Err(err("exit_continue","continuation changed immutable operation/next hop or expired"));}
                // Persist exact consent before CAS dispatch. One immutable record per
                // fresh deadline; concurrent holders still contend on original hop CAS.
                save(h,&format!("{sk}/continuations/{deadline}"),c)?;
            }
            let obs = h.observe(j, key)?;
            obs.validate()?;
            if step == Step::Unshield {
                if obs != baseline {
                    return Err(err("exit_readback", "source changed before first send"));
                }
            } else {
                credit(&baseline, &obs, a)?;
                if obs.n("native")? > baseline.n("native")?
                    || baseline
                        .n("native")?
                        .checked_sub(obs.n("native")?)
                        .is_none_or(|n| n > NATIVE_MAX)
                {
                    return Err(err("exit_budget", "native budget mismatch"));
                }
                if step == Step::Storage
                    && (!obs.registered
                        && (obs.n("storage_min")? > STORAGE_MAX || obs.n("native")? < NATIVE_MAX))
                {
                    return Err(err("exit_budget", "registration budget unavailable"));
                }
                if step == Step::Withdraw && !obs.registered {
                    return Err(err("exit_readback", "recipient storage not FINAL"));
                }
            }
            save(h, &format!("{sk}/before"), &obs)?;
            let body = step.body(&p);
            let ik = format!("{}:exact:{}", j.op_id, step.name());
            save(
                h,
                &format!("{sk}/request"),
                &json!({"path":step.path(),"body":body,"idempotency_key":ik}),
            )?;
            if !h.set_if_absent(&format!("{sk}/dispatch"), b"1")? {
                return Ok(review(j, step, None, "needs_review"));
            }
            let reply = h.post_step(key, &ik, step, &body);
            let Some((status, v)) = reply.ok() else {
                return Ok(review(j, step, None, "needs_review"));
            };
            // Store replies, not secrets; unknown/error envelopes never advance the hop.
            save(h, &format!("{sk}/reply"), &v)?;
            let Some(id) = guarded::posted_request_id(status, &v).map(str::to_owned) else {
                return Ok(review(j, step, None, "needs_review"));
            };
            if !step.valid_status(guarded::text(&v, "status")?) {
                return Err(err("exit_provider", "malformed submit status"));
            }
            if v["error"] == "duplicate_idempotency_key" && !v["type"].as_str().is_some_and(|t| step.request_types().contains(&t)) {
                return Err(err("exit_provider", "duplicate refers to wrong operation"));
            }
            if step == Step::Storage
                && v.get("error").is_none()
                && (v["token"] != TOKEN
                    || v["account_id"] != p.to
                    || !v["already_registered"].is_boolean())
            {
                return Err(err(
                    "exit_provider",
                    "registration submit identity malformed",
                ));
            }
            save(h, &id_key, &id)?;
            id
        };
        if !guarded::uuid(&id) {
            return Err(err("exit_wal", "invalid original provider id"));
        }
        let v = match h.fetch(key, &id) {
            Ok((200, v)) => v,
            _ => return Ok(review(j, step, Some(&id), "needs_review")),
        };
        let state = row(&v, &id, step)?;
        if state != "success" {
            if state == "failed" && step == Step::Unshield {
                let obs = h.observe(j, key)?;
                obs.validate()?;
                // A full refund/nonexecution is terminal only with independent original
                // self-balances restored; no fees refunded against spend caps.
                if obs.n("confidential")? == baseline.n("confidential")?
                    && obs.n("intents")? == baseline.n("intents")?
                {
                    save(
                        h,
                        &format!("{}/settlement", j.key()),
                        &json!({"status":"failed","result":{"reason":"unshield_not_filled_balances_restored"},"original_request":v,"readback":obs}),
                    )?;
                    let t = Terminal {
                        success: false,
                        refund_charge: false,
                        provider_id: id.clone(),
                    };
                    save(h, &format!("{root}/terminal_candidate"), &t)?;
                    let done = h.finish(j, &t)?;
                    return Ok(
                        json!({"status":if done{"failed"}else{"needs_review"},"exit_mode":MODE,"value_op_id":j.op_id,"request_id":id,"admission_finished":done}),
                    );
                }
            }
            return Ok(review(
                j,
                step,
                Some(&id),
                if state == "processing" {
                    "processing"
                } else {
                    "needs_review"
                },
            ));
        }
        let obs = h.observe(j, key)?;
        obs.validate()?;
        if step == Step::Unshield {
            credit(&baseline, &obs, a)?;
        }
        if step == Step::Storage {
            credit(&baseline, &obs, a)?;
            if !obs.registered
                || baseline
                    .n("native")?
                    .checked_sub(obs.n("native")?)
                    .is_none_or(|n| n > NATIVE_MAX)
            {
                return Err(err(
                    "exit_readback",
                    "registration or native budget not established",
                ));
            }
        }
        if step == Step::Withdraw {
            let before: Observation = read(h, &format!("{sk}/before"))?
                .ok_or_else(|| err("exit_wal", "missing withdrawal baseline"))?;
            if v.pointer("/result/delivered").and_then(Value::as_str) != Some(guarded::ASSET)
                || !v
                    .pointer("/result/intent_hash")
                    .and_then(Value::as_str)
                    .is_some_and(|s| !s.is_empty())

                || obs.n("confidential")? != before.n("confidential")?
                || baseline
                    .n("native")?
                    .checked_sub(obs.n("native")?)
                    .is_none_or(|n| n > NATIVE_MAX)
            {
                return Err(err("exit_readback","exact canonical FT credit/public debit not established; no success or replacement send"));
            }
            let intent=guarded::text(&v["result"],"intent_hash")?;
            let original=h.original_delivery(j,intent)?;
            let receipt=crate::exact_receipt::verify(j,intent,&original)?;
            let facts = json!({"status":"success","result":{"amount_out":p.amount,"delivered":guarded::ASSET,"intent_hash":v["result"]["intent_hash"]},"exit_mode":MODE,"original_request":v,"baseline":baseline,"before_withdraw":before,"final_readback":obs,"evidence_kind":"original_final_ft_receipt","original_delivery":original,"delivery_proof":receipt});
            save(h, &format!("{}/settlement", j.key()), &facts)?;
            let t = Terminal {
                success: true,
                refund_charge: false,
                provider_id: id.clone(),
            };
            save(h, &format!("{root}/terminal_candidate"), &t)?;
            let done = h.finish(j, &t)?;
            return Ok(
                json!({"status":if done{"success"}else{"needs_review"},"exit_mode":MODE,"value_op_id":j.op_id,"request_id":id,"amount_out":p.amount,"admission_finished":done}),
            );
        }
        save(
            h,
            &confirmed,
            &VerifiedStep {
                provider: v,
                observation: obs,
            },
        )?;
    }
    Err(err("exit_wal", "missing terminal exit evidence"))
}
#[cfg(test)]
#[path = "exact_exit_tests.rs"]
mod tests;
