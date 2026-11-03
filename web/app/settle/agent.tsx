"use client";
import { useEffect, useState } from "react";
import { buildPolicy } from "@/lib/agentPolicy";
import { balanceWarnings, policyWarnings, canon } from "@/lib/agentApi";
import { TxLink } from "@/components/TxLink";

type Q = { limits: Record<string, number>; usage: Record<string, number>; observed_at: string };
type Pol = { revision: number; status: string; policy_hash: string; transaction_hash?: string; policy: ReturnType<typeof buildPolicy> };
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** Live Agent API state through /api/agent (server-side key). Swaps here are dry quotes only. */
export function AgentPanel() {
  const [net, setNet] = useState<{ network: string; status: { overall: string } } | null>(null);
  const [q, setQ] = useState<Q | null>(null);
  const [pol, setPol] = useState<Pol | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dry, setDry] = useState<{ usd: string; warn: string[]; bal: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const get = (r: string) => fetch(`/api/agent?r=${r}`).then((x) => x.json()).then((j) => (j.ok ? j.body : Promise.reject(j.error?.code)));
    Promise.all([get("network"), get("quotas"), get("policy")]).then(([n, qq, p]) => { setNet(n); setQ(qq); setPol(p); }).catch((c) => setErr(String(c || "unavailable")));
  }, []);
  async function quote(usdMicro: string) {
    setBusy(true); setDry(null);
    try {
      const j = await (await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin: USDC, dest: "nep141:wrap.near", amount: usdMicro }) })).json();
      if (j.ok) setDry({ usd: j.body.spend?.amount_usd, warn: policyWarnings(j.body), bal: balanceWarnings(j.body) }); else setErr(j.error?.code);
    } finally { setBusy(false); }
  }
  const expect = buildPolicy({ tier: 1 });
  const p = pol?.policy;
  return (
    <section className="card agent" data-testid="agent">
      <h2>Agent API · holder caps as policy</h2>
      <p className="demo-tag" data-testid="agent-demo"><b>Demo</b> · one shared NEAR Intents agent, $0 balance. Dry quotes only: it shows the policy the enclave would install for a holder, nothing is moved.</p>
      <p className="note">KEYHOLE tier caps are written into a NEAR Intents Agent API policy, so the agent&apos;s own wallet refuses what the key would refuse. Demo partner deployment on mainnet; quotes are dry and the agent holds no funds.</p>
      {err && <p className="note" role="alert" data-testid="agent-err">Agent API: {err}</p>}
      {net && <p className="note" data-testid="agent-net">Network <b>{net.network}</b> · status <b>{net.status.overall}</b></p>}
      {q && <p className="note" data-testid="agent-quotas">Quotas: {q.usage.agents_last_24_hours}/{q.limits.daily_agents} agents today · {q.usage.requests_this_minute}/{q.limits.requests_per_minute} requests this minute</p>}
      {p && (
        <table className="ptab" data-testid="agent-policy" data-match={canon({ limits: p.limits, budget: p.budget, actions: p.actions, destinations: p.destinations }) === canon({ limits: expect.limits, budget: expect.budget, actions: expect.actions, destinations: expect.destinations }) ? "1" : "0"}>
          <tbody>
            <tr><th>Per transaction</th><td>${(Number(p.limits.per_transaction[USDC]) / 1e6).toFixed(2)} USDC</td></tr>
            <tr><th>Daily limit</th><td>${(Number(p.limits.daily[USDC]) / 1e6).toFixed(2)} USDC</td></tr>
            <tr><th>USD budget / day</th><td>${p.budget.daily_usd}</td></tr>
            <tr><th>Actions</th><td>{p.actions.join(", ")}</td></tr>
            <tr><th>Destinations</th><td>{p.destinations.mode} · {p.destinations.list.length ? p.destinations.list.length : "none (no withdrawals)"}</td></tr>
            <tr><th>Revision</th><td>{pol!.revision} · {pol!.status}{pol!.transaction_hash && <> · <TxLink hash={pol!.transaction_hash} /></>}</td></tr>
          </tbody>
        </table>
      )}
      <div className="abtn">
        <button className="btn b1" disabled={busy} onClick={() => void quote("500000")} data-testid="agent-dry-ok">Dry quote $0.50</button>
        <button className="btn b1" disabled={busy} onClick={() => void quote("2000000")} data-testid="agent-dry-over">Dry quote $2.00</button>
      </div>
      {dry && <p className="dout" data-testid="agent-dry-out">${Number(dry.usd).toFixed(2)} · {dry.warn.length ? <b>policy would refuse: {dry.warn.join(", ")}</b> : "within policy"}{dry.bal.length ? <> · <span className="warnbal" data-testid="agent-dry-bal">balance warning: {dry.bal.join(", ")} (demo agent holds $0)</span></> : null}</p>}
    </section>
  );
}
