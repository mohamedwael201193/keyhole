"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardHeader, CopyButton, EmptyState, PageHeader, StatusChip } from "@/components/v7";
import { Button } from "@/components/ui";
import { CallVerifier } from "@/components/judge/CallVerifier";
import { useWallet } from "@/lib/wallet";
import { MY_CALLS_EVENT, callsOf, opWord, readMyCalls, type MyCall } from "@/lib/myCalls";
import { CALL_ID } from "@/lib/verify";
import { sectionHref } from "@/lib/dashboardSections";

/**
 * "My proof": the enclave calls this browser made for the holder (balance, activity, quotes, swaps, withdrawals), each one
 * re-checkable in the browser. Nothing here is a sample: with no call yet, the section says so and does not verify anything.
 * The deeper tools (the public evidence pack, tamper tests, build identity, commands) are on /developers.
 */
export function MyProof({ callId }: { callId: string | null }) {
  const { accountId } = useWallet();
  const [all, setAll] = useState<MyCall[]>([]);
  const calls: MyCall[] = callsOf(all, accountId);
  useEffect(() => {
    const read = () => setAll(readMyCalls());
    read();
    addEventListener(MY_CALLS_EVENT, read);
    addEventListener("storage", read);
    return () => { removeEventListener(MY_CALLS_EVENT, read); removeEventListener("storage", read); };
  }, []);
  const picked = callId && CALL_ID.test(callId) ? callId : null;
  const [draft, setDraft] = useState("");
  const draftOk = CALL_ID.test(draft.trim());

  return (
    <div className="page mp" data-testid="my-proof">
      <PageHeader
        eyebrow="My proof"
        title={<>Proof of <em>your own</em> calls</>}
        lead="Every read and trade you make runs inside the enclave, and each call has an attestation. Pick one to re-check it in your browser."
      />
      {!accountId ? (
        <EmptyState title="Sign in to see your calls" body="Your calls are listed here once you have made one in this browser." testid="mp-signed-out" />
      ) : (
        <Card as="section" labelledBy="mp-list-h" testid="mp-list">
          <CardHeader title="Your calls in this browser" id="mp-list-h" icon="shield" meta={calls.length ? `${calls.length}` : undefined} />
          {calls.length === 0 ? (
            <p className="v7-muted" data-testid="mp-empty">No call yet. Unlock your session in Overview or Vault; each read you make appears here with its proof.</p>
          ) : (
            <ul className="mp-calls">
              {calls.map((c) => (
                <li key={c.call_id} className="v7-row mp-call" data-testid="mp-call" data-op={c.op}>
                  <span className="v7-row-body">
                    <span className="v7-row-title">{opWord(c.op)}</span>
                    <span className="v7-row-sub">{new Date(c.ts_ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })} · <code>{c.call_id.slice(0, 8)}</code></span>
                  </span>
                  <span className="v7-row-end">
                    {picked === c.call_id ? <StatusChip tone="info">Shown below</StatusChip> : <Link className="v7-card-link" href={sectionHref("proof", c.call_id)} data-testid="mp-verify">Verify</Link>}
                    <CopyButton value={c.call_id} label="Copy call id" />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form className="mp-paste" onSubmit={(e) => { e.preventDefault(); if (draftOk) location.hash = `#proof/${encodeURIComponent(draft.trim())}`; }}>
            <label htmlFor="mp-id" className="v7-muted">Have a call id from earlier? Paste it.</label>
            <input id="mp-id" className="input" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} placeholder="Paste a call id" data-testid="mp-input" />
            <Button type="submit" variant="secondary" size="sm" disabled={!draftOk} testid="mp-go">Verify this call</Button>
          </form>
        </Card>
      )}
      {picked ? <CallVerifier key={picked} initial={picked} /> : accountId && calls.length > 0 && <p className="v7-muted" data-testid="mp-pick">Choose a call above to re-check it.</p>}
      <p className="v7-muted mp-dev">Looking for the public evidence pack, build identity or the commands? They are on <Link href="/developers">Developers</Link>.</p>
    </div>
  );
}
