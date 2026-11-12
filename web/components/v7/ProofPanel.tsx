"use client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "./Card";
import { CopyButton } from "./CopyButton";
import { StatusChip } from "./StatusChip";
import { TxLinkPill } from "./TxLinkPill";

/**
 * The proof card: enclave status, hardware, worker build (short, with copy), the contract on the explorer, the TEE
 * attestation of the last call, the last call id (short, with copy), and "Verify the last call" (the /verify route).
 * It is presentational: the caller reads the enclave health, the build, the attestation and the call id. A value the
 * caller does not have is shown as its honest state ("Checking", "Not read yet", "None yet"), never as a made-up one.
 */
export type ProofPanelProps = {
  title?: string;
  headingId?: string;
  enclave: "checking" | "live" | "down";
  /** Default "Intel TDX". */
  hardware?: string;
  /** The full worker build hash. Shown short, with a copy button. */
  workerBuild?: string | null;
  /** The contract account. Shown as an explorer link. */
  contract?: string;
  attestation: "verified" | "not-verified" | "unread";
  /** The last call id. Null when there is none yet. */
  lastCall?: string | null;
  verifyHref: string;
  verifyTestId?: string;
  testid?: string;
  /** Holder view: only the attestation status and the last call. Hardware, build and contract are on /developers. */
  compact?: boolean;
};

export function ProofPanel({
  title = "Enclave & proof", headingId = "proof-h", enclave, hardware = "Intel TDX", workerBuild, contract, attestation, lastCall,
  verifyHref, verifyTestId, testid, compact = false,
}: ProofPanelProps) {
  const enc = enclave === "live"
    ? { tone: "success" as const, text: "Live" }
    : enclave === "down" ? { tone: "error" as const, text: "Not reachable" } : { tone: "neutral" as const, text: "Not probed" };
  const att = attestation === "verified"
    ? { tone: "success" as const, text: "Verified", icon: "check" as const }
    : attestation === "not-verified" ? { tone: "error" as const, text: "Not verified", icon: "alert" as const }
      : { tone: "neutral" as const, text: "Not read yet", icon: "none" as const };
  return (
    <Card labelledBy={headingId} testid={testid} className="v7-proof">
      <CardHeader
        id={headingId}
        title={title}
        icon="shield"
        action={lastCall
          ? <Button href={verifyHref} variant="secondary" size="sm" testid={verifyTestId}>Verify the last call</Button>
          : <Button variant="secondary" size="sm" disabled title="No call to verify yet. Unlock and read your vault first." testid={verifyTestId}>Verify the last call</Button>}
      />
      <dl className="v7-proof-grid">
        {!compact && <div>
          <dt>Enclave</dt>
          <dd><StatusChip tone={enc.tone}>{enc.text}</StatusChip></dd>
        </div>}
        {!compact && <div>
          <dt>Hardware</dt>
          <dd>{hardware}</dd>
        </div>}
        {!compact && <div>
          <dt>Worker build</dt>
          <dd>
            {workerBuild ? (
              <>
                <span className="v7-mono v7-proof-hash" title={workerBuild}>{`${workerBuild.slice(0, 10)}…`}</span>
                <CopyButton value={workerBuild} label="Copy worker build" />
              </>
            ) : <span className="v7-muted">Not published</span>}
          </dd>
        </div>}
        {!compact && <div>
          <dt>Contract</dt>
          <dd>{contract ? <TxLinkPill account={contract} testid="proof-contract" /> : <span className="v7-muted">Not set</span>}</dd>
        </div>}
        <div>
          <dt>TEE attestation</dt>
          <dd><StatusChip tone={att.tone} icon={att.icon}>{att.text}</StatusChip></dd>
        </div>
        <div>
          <dt>Last call</dt>
          <dd>
            {lastCall ? (
              <>
                <span className="v7-mono v7-proof-hash" title={lastCall}>{`${lastCall.slice(0, 8)}…`}</span>
                <CopyButton value={lastCall} label="Copy call id" />
              </>
            ) : <span className="v7-muted">None yet</span>}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
