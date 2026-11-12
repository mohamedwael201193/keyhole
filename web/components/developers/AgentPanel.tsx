"use client";
import { useEffect, useState } from "react";
import { buildPolicy } from "@/lib/agentPolicy";
import { balanceWarnings, networkBody, policyBody, policyWarnings, quotasBody, canon } from "@/lib/agentApi";
import { TxLink } from "@/components/TxLink";
import { Button } from "@/components/ui";

const AGENT_ERR: Record<string, string> = {
  policy_transaction_limit_exceeded: "Above the per-trade limit, so the policy refused it. That is the cap doing its job.",
  rate_limited: "Too many requests this minute. Wait a few seconds and try again.",
  unavailable: "The Agent API did not answer. Try again later.",
};
/** Codes that mean the demo could not be reached or configured. Shown as one plain "unavailable" state with a retry. */
const DOWN = new Set(["upstream", "config", "unavailable", "timeout", "indexer"]);
export const agentErr = (c: string) => AGENT_ERR[c] ?? "The Agent API could not answer that request. Try again in a moment.";

type Q = { limits: Record<string, number>; usage: Record<string, number>; observed_at: string };
type Pol = { revision: number; status: string; policy_hash: string; transaction_hash?: string; policy: ReturnType<typeof buildPolicy> };
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/**
 * Live Agent API state through /api/agent (server-side key). Swaps here are dry quotes only. Developer material: it lives on
 * /developers, not in the holder's dashboard. The partner status line is shown only when every read answered, so the panel
 * never says "operational" beside "not available": one read failing is one honest "not answering" state with a retry.
 */
export function AgentPanel() {
  const [net, setNet] = useState<{ network: string; status: { overall: string } } | null>(null);
  const [q, setQ] = useState<Q | null>(null);
  const [pol, setPol] = useState<Pol | null>(null);
  const [quotaNote, setQuotaNote] = useState<string | null>(null);
  const [policyNote, setPolicyNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [down, setDown] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dry, setDry] = useState<{ usd: string; warn: string[]; bal: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const get = (r: string) => fetch(`/api/agent?r=${r}`).then((x) => x.json()).catch(() => ({ ok: false, error: { code: "upstream" } }));
    setDown(false); setErr(null); setNet(null); setQ(null); setPol(null); setQuotaNote(null); setPolicyNote(null);
    Promise.all([get("network"), get("quotas"), get("policy")])
      .then(([n, qq, p]) => {
        if (!live) return;
        const netOk = n?.ok ? networkBody(n.body) : null;
        const quotaOk = qq?.ok ? quotasBody(qq.body) : null;
        const polOk = p?.ok ? policyBody(p.body) : null;
        if (netOk) setNet(netOk); else setDown(true);
        if (quotaOk) setQ({ ...quotaOk, observed_at: "" }); else setQuotaNote("Quotas did not answer.");
        if (polOk) setPol(polOk as unknown as Pol); else setPolicyNote("The holder-cap policy did not answer.");
      })
      .catch(() => { if (live) setDown(true); });
    return () => { live = false; };
  }, [attempt]);
  async function quote(usdMicro: string) {
    setBusy(true); setDry(null); setErr(null);
    try {
      const j = await (await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin: USDC, dest: "nep141:wrap.near", amount: usdMicro }) })).json();
      if (j.ok) setDry({ usd: j.body.spend?.amount_usd, warn: policyWarnings(j.body), bal: balanceWarnings(j.body) });
      else if (DOWN.has(j.error?.code)) setDown(true);
      else setErr(j.error?.code ?? "unavailable");
    } catch { setDown(true); } finally { setBusy(false); }
  }
  const expect = buildPolicy({ tier: 1 });
  const p = pol?.policy;
  const partial = !!(quotaNote || policyNote);
  const notAnswering = down || partial;
  return (
    <section className="card agent" data-testid="agent">
      <h2>Agent API · holder caps as policy</h2>
      <p className="demo-tag" data-testid="agent-demo"><b>Demo</b> · one shared NEAR Intents agent, $0 balance. Dry quotes only: it shows the policy the enclave would install for a holder, nothing is moved.</p>
      <p className="note">KEYHOLE tier caps are written into a NEAR Intents Agent API policy, so the agent&apos;s own wallet refuses what the key would refuse. Demo partner deployment on mainnet; quotes are dry and the agent holds no funds.</p>
      {down && (
        <p className="note" role="status" data-testid="agent-down">
          The Agent API demo is not answering right now, so no partner status is shown. Nothing here affects your account.{" "}
          <button type="button" className="linkbtn" onClick={() => setAttempt((n) => n + 1)} data-testid="agent-retry">Retry</button>
        </p>
      )}
      {!down && partial && (
        <p className="note" role="status" data-testid="agent-partial">
          Some Agent API reads did not answer, so the partner status is not shown. Retry in a moment.{" "}
          <button type="button" className="linkbtn" onClick={() => setAttempt((n) => n + 1)} data-testid="agent-retry">Retry</button>
        </p>
      )}
      {err && <p className="note" role="status" data-testid="agent-err">{agentErr(err)}</p>}
      {net && !notAnswering && <p className="note" data-testid="agent-net">Network <b>{net.network}</b> · status <b>{net.status.overall}</b></p>}
      {q && [q.usage.agents_last_24_hours, q.limits.daily_agents, q.usage.requests_this_minute, q.limits.requests_per_minute].every((n) => Number.isSafeInteger(n) && n >= 0) && <p className="note" data-testid="agent-quotas">Quotas: {q.usage.agents_last_24_hours}/{q.limits.daily_agents} agents today · {q.usage.requests_this_minute}/{q.limits.requests_per_minute} requests this minute</p>}
      {quotaNote && <p className="note" role="status" data-testid="agent-quotas-down">{quotaNote}</p>}
      {policyNote && <p className="note" role="status" data-testid="agent-policy-down">{policyNote}</p>}
      {p && [Number(p.limits.per_transaction[USDC]), Number(p.limits.daily[USDC]), Number(p.budget.daily_usd)].every((n) => Number.isFinite(n) && n >= 0) && (
        <table className="ptab" data-testid="agent-policy" data-match={canon({ limits: p.limits, budget: p.budget, actions: p.actions, destinations: p.destinations }) === canon({ limits: expect.limits, budget: expect.budget, actions: expect.actions, destinations: expect.destinations }) ? "1" : "0"}>
          <tbody>
            <tr><th>Per transaction</th><td>${(Number(p.limits.per_transaction[USDC]) / 1e6).toFixed(2)} USDC</td></tr>
            <tr><th>Daily limit</th><td>${(Number(p.limits.daily[USDC]) / 1e6).toFixed(2)} USDC</td></tr>
            <tr><th>USD budget / day</th><td>${p.budget.daily_usd}</td></tr>
            <tr><th>Actions</th><td>{p.actions.join(", ")}</td></tr>
            <tr><th>Destinations</th><td>{p.destinations.mode} · {p.destinations.list.length ? p.destinations.list.length : "none (no withdrawals)"}</td></tr>
            <tr><th>Revision</th><td>{pol!.revision} · {pol!.status}{pol!.transaction_hash ? <> · <TxLink hash={pol!.transaction_hash} /></> : <> · not yet written on chain</>}</td></tr>
          </tbody>
        </table>
      )}
      <div className="abtn">
        <Button variant="secondary" disabled={down} loading={busy} loadingLabel="Quoting" onClick={() => void quote("500000")} testid="agent-dry-ok">Dry quote $0.50</Button>
        <Button variant="secondary" disabled={down} loading={busy} loadingLabel="Quoting" onClick={() => void quote("2000000")} testid="agent-dry-over">Dry quote $2.00</Button>
      </div>
      {dry && <p className="dout" data-testid="agent-dry-out">${Number(dry.usd).toFixed(2)} · {dry.warn.length ? <b>The policy would refuse this: {dry.warn.map(agentErr).join(" ")}</b> : "within policy"}{dry.bal.length ? <> · <span className="warnbal" data-testid="agent-dry-bal">balance warning: {dry.bal.join(", ")} (demo agent holds $0)</span></> : null}</p>}
    </section>
  );
}
