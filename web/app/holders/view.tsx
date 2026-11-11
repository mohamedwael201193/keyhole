"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { PageHeader, Card, CardHeader, StatusChip } from "@/components/v7";
import type { SignedAuth } from "@/lib/nep413";

type Check =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "granted"; tier: number; token_ids: string[]; key_count: number }
  | { status: "denied"; reason: string }
  | { status: "error"; message: string };

const REASON: Record<string, string> = {
  not_holder: "This account holds no key on the KEYHOLE contract.",
  not_full_access: "The signing key is not a full-access key of this account.",
  expired: "The check took too long. Check again.",
  replayed: "This check was already used. Check again.",
  bad_signature: "The signature did not verify. Nothing was granted.",
  bad_challenge: "The check was not issued by this site. Check again.",
  wrong_account: "The check belongs to another account. Check again.",
  bad_intent: "The signed request did not match the check. Check again.",
  rate_limited: "Too many checks from this network. Wait a minute.",
  unavailable: "The chain could not be read right now. Try again shortly.",
};

/** Holders only: the signed-in account gets its key ids and tier after a fresh wallet signature. Nothing is stored. */
export function HoldersView() {
  const wallet = useWallet();
  const [check, setCheck] = useState<Check>({ status: "idle" });
  const acct = wallet.accountId;

  /** Sends one signed intent to the gate. Used both for a fresh signature and for a redirect wallet's returned one. */
  async function submit(challenge: string, auth: SignedAuth): Promise<void> {
    const r = await fetch("/api/gate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge, auth }), cache: "no-store" });
    const j = await r.json().catch(() => null) as { granted?: boolean; tier?: number; token_ids?: string[]; key_count?: number; reason?: string } | null;
    if (j?.granted && typeof j.tier === "number") setCheck({ status: "granted", tier: j.tier, token_ids: j.token_ids ?? [], key_count: j.key_count ?? (j.token_ids ?? []).length });
    else if (j && typeof j.reason === "string") setCheck({ status: "denied", reason: j.reason });
    else setCheck({ status: "error", message: "The gate did not answer. Try again." });
  }

  async function run() {
    if (!acct) return;
    setCheck({ status: "checking" });
    try {
      const c = await fetch(`/api/gate?account_id=${encodeURIComponent(acct)}`, { cache: "no-store" }).then((r) => r.json()) as { challenge?: string };
      if (!c.challenge) { setCheck({ status: "error", message: "Could not start the check. Try again." }); return; }
      const auth = await wallet.sign("holder_gate", { challenge: c.challenge });
      await submit(c.challenge, auth);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setCheck({ status: "error", message: code.includes("wallet_rejected") ? "The signature was not given. Nothing was checked." : "The wallet did not sign the check. Nothing was checked." });
    }
  }

  // A redirect wallet returns the signed holder check in `pending`. Submit it once, then clear it.
  useEffect(() => {
    const p = wallet.pending;
    if (!p) return;
    try {
      const m = JSON.parse(p.message) as { op?: string; params?: { challenge?: string } };
      if (m.op !== "holder_gate" || typeof m.params?.challenge !== "string") return;
      wallet.clearPending();
      setCheck({ status: "checking" });
      void submit(m.params.challenge, p);
    } catch { /* not a holder check: leave it for its own page */ }
    // submit is stable enough for this one-shot resume; the wallet clears pending before it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.pending]);

  return (
    <div className="kp-root holders-page" data-testid="holders-page">
      <PageHeader
        eyebrow="Prove you hold a key"
        title={<>Prove you hold a <em>key.</em></>}
        lead="Sign once with the wallet that holds a key. The site checks the chain for that account and shows its tier and key ids. Nothing is stored and no money moves."
        testid="holders-head"
      />
      <Card as="section" labelledBy="holder-check-h" testid="holder-check">
        <CardHeader title="Holder check" id="holder-check-h" meta={<StatusChip tone={check.status === "granted" ? "success" : check.status === "denied" || check.status === "error" ? "error" : "neutral"}>{check.status === "granted" ? "Holder" : check.status === "denied" ? "Not a holder" : check.status === "checking" ? "Checking" : "Not checked"}</StatusChip>} />
        {!acct && (
          <div className="holders-body">
            <p className="kg-note">Connect the wallet that holds the key to check it.</p>
            <button type="button" className="btn b2 vbtn" onClick={() => wallet.connect()} data-testid="holders-connect">Connect wallet</button>
          </div>
        )}
        {acct && (
          <div className="holders-body">
            <p className="kg-note">Signed in as <span className="mono">{acct}</span>.</p>
            <button type="button" className="btn b2 vbtn" onClick={() => void run()} disabled={check.status === "checking"} data-testid="holders-check">
              {check.status === "checking" ? "Checking…" : "Check my key with a wallet signature"}
            </button>
          </div>
        )}
        {check.status === "granted" && (
          <div className="holders-body" data-testid="holders-granted">
            <p><b>Check passed.</b> Tier {check.tier}. Keys held: {check.key_count}.</p>
            {check.key_count > check.token_ids.length && <p className="kg-note" data-testid="holders-truncated">showing {check.token_ids.length} of {check.key_count} keys</p>}
            <ul>
              {check.token_ids.map((id) => (
                <li key={id}>
                  <span className="mono">{id}</span> · <Link href={`/key?id=${encodeURIComponent(id)}`}>key history</Link> · <Link href="/vault">vault</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {check.status === "denied" && <p className="kg-note" role="status" data-testid="holders-denied">{REASON[check.reason] ?? "Access not granted."}</p>}
        {check.status === "error" && <p className="kg-note" role="alert" data-testid="holders-error">{check.message}</p>}
      </Card>
    </div>
  );
}
