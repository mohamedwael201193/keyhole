"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { PageHeader, Card, CardHeader, StatusChip } from "@/components/v7";
import type { SignedAuth } from "@/lib/nep413";
import { tierName } from "@/lib/near";
import { holderResume, settleHolderCheck, type HolderView } from "@/lib/holderCheck";
import "../verify/verify.css";

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
  const [check, setCheck] = useState<HolderView>({ status: "idle" });
  const acct = wallet.accountId;
  const acctRef = useRef(acct);
  const seq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    acctRef.current = acct;
    seq.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setCheck({ status: "idle" });
  }, [acct]);

  async function submit(challenge: string, auth: SignedAuth, account: string): Promise<void> {
    const my = ++seq.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setCheck({ status: "checking" });
    const next = await settleHolderCheck({
      requestedAccount: account,
      requestedSeq: my,
      signal: ctrl.signal,
      current: () => ({ account: acctRef.current, seq: seq.current }),
      send: async (signal) => {
        const r = await fetch("/api/gate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge, auth }), cache: "no-store", signal });
        const body = await r.json().catch(() => null);
        return { body };
      },
    });
    if (seq.current === my) setCheck(next);
  }

  async function run() {
    const account = acctRef.current;
    if (!account) return;
    const my = ++seq.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setCheck({ status: "checking" });
    try {
      const c = await fetch(`/api/gate?account_id=${encodeURIComponent(account)}`, { cache: "no-store", signal: ctrl.signal }).then((r) => r.json()) as { challenge?: string };
      if (ctrl.signal.aborted || seq.current !== my || acctRef.current !== account) return;
      if (!c.challenge) { setCheck({ status: "error", accountId: account, message: "Could not start the check. Try again." }); return; }
      const auth = await wallet.sign("holder_gate", { challenge: c.challenge });
      if (ctrl.signal.aborted || seq.current !== my || acctRef.current !== account) return;
      await submit(c.challenge, auth, account);
    } catch (e) {
      if (ctrl.signal.aborted || seq.current !== my || acctRef.current !== account) return;
      const code = e instanceof Error ? e.message : "";
      setCheck({ status: "error", accountId: account, message: code.includes("wallet_rejected") ? "The signature was not given. Nothing was checked." : "The wallet did not sign the check. Nothing was checked." });
    }
  }

  // A redirect wallet returns the signed holder check in `pending`. Submit it only for the account that signed it.
  useEffect(() => {
    const plan = holderResume(wallet.pending, acct);
    if (plan.action !== "submit" || !wallet.pending || !acct) return;
    const auth = wallet.pending;
    wallet.clearPending();
    void submit(plan.challenge, auth, acct);
    // submit reads the latest account from refs; the account effect aborts the previous request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.pending, acct]);

  const shown = !!acct && check.status !== "idle" && (!("accountId" in check) || check.accountId === acct);
  const visible = shown ? check : { status: "idle" as const };

  return (
    <div className="kp-root holders-page" data-testid="holders-page">
      <PageHeader
        eyebrow="Prove you hold a key"
        title={<>Prove you hold a <em>key.</em></>}
        lead="Sign once with the wallet that holds a key. The site checks the chain for that account and shows its tier and key ids. Nothing is stored and no money moves."
        testid="holders-head"
      />
      <Card as="section" labelledBy="holder-check-h" testid="holder-check">
        <CardHeader title="Holder check" id="holder-check-h" meta={<StatusChip tone={visible.status === "granted" ? "success" : visible.status === "denied" || visible.status === "error" ? "error" : "neutral"}>{visible.status === "granted" ? "Holder" : visible.status === "denied" ? "Not a holder" : visible.status === "checking" ? "Checking" : "Not checked"}</StatusChip>} />
        {!acct && (
          <div className="holders-body">
            <p className="kg-note">Connect the wallet that holds the key to check it.</p>
            <button type="button" className="btn b2 vbtn" onClick={() => wallet.connect()} data-testid="holders-connect">Connect wallet</button>
          </div>
        )}
        {acct && (
          <div className="holders-body">
            <p className="kg-note">Signed in as <span className="mono">{acct}</span>.</p>
            <button type="button" className="btn b2 vbtn" onClick={() => void run()} disabled={visible.status === "checking"} data-testid="holders-check">
              {visible.status === "checking" ? "Checking…" : "Check my key with a wallet signature"}
            </button>
          </div>
        )}
        {visible.status === "granted" && (
          <div className="holders-body" data-testid="holders-granted" role="status">
            <p><b>Check passed.</b> Finish: {tierName(visible.tier)}. Keys held: {visible.key_count}.</p>
            {visible.key_count > visible.token_ids.length && <p className="kg-note" data-testid="holders-truncated">showing {visible.token_ids.length} of {visible.key_count} keys</p>}
            <ul>
              {visible.token_ids.map((id) => (
                <li key={id}>
                  <span className="mono">{id}</span> · <Link href={`/key?id=${encodeURIComponent(id)}`}>key history</Link> · <Link href="/vault">vault</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {visible.status === "denied" && <p className="kg-note" role="status" data-testid="holders-denied">{REASON[visible.reason] ?? "Access not granted."}</p>}
        {visible.status === "error" && <p className="kg-note" role="alert" data-testid="holders-error">{visible.message}</p>}
      </Card>
    </div>
  );
}
