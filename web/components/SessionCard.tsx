"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { minutesLeft } from "@/lib/session";
import { ErrorBox } from "./Result";
import { Spinner } from "./ui";

/** Unlock (one wallet signature for 30 minutes) or show the live session with Revoke. */
export function SessionCard({ tokenId }: { tokenId: string }) {
  const { session, startSession, revokeSession } = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 20_000); return () => clearInterval(id); }, []);
  const live = session && session.token_id === tokenId ? session : null;
  if (live) {
    return (
      <div className="sess on" data-testid="session-on">
        <span><b>Unlocked</b> · {minutesLeft(live)} min left · trades and withdrawals up to ${(live.max_usd_micro / 1e6).toFixed(2)} need no more wallet popups.</span>
        <button className="vbtn" type="button" data-testid="session-revoke" onClick={() => void revokeSession()}>Lock now</button>
      </div>
    );
  }
  return (
    <div className="sess" data-testid="session-off">
      <span><b>Unlock for 30 minutes.</b> Sign once; the enclave then accepts your reads, trades and withdrawals (to your own account, up to $5 in total) without another popup. Raising limits, locking and proofs still ask your wallet.</span>
      <button className="vbtn pri" type="button" data-testid="session-unlock" disabled={busy} onClick={async () => { setBusy(true); setErr(null); const r = await startSession(tokenId); setBusy(false); if (!r.ok) setErr(r.code); }}>
        {busy ? <><Spinner label="Waiting for your wallet" /> Confirm in your wallet…</> : "Unlock (1 signature)"}
      </button>
      {err && <ErrorBox code={err} />}
    </div>
  );
}
