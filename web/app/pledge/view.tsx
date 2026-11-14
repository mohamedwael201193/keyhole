"use client";

import { useMemo } from "react";
import { useKeyStore } from "@/lib/keyStore";
import { PLEDGE_LIVE } from "@/lib/config";
import { createPledgeClient } from "@/lib/pledgeClient";
import { LivePledge } from "./LivePledge";
import { LoansShowcase } from "./LoansShowcase";
import { PayoutCredit } from "@/components/PayoutCredit";

/**
 * /pledge — the Loans showcase.
 * Live (flag ON, staging/sandbox only): the real loan UI for the holder's key.
 * Flag OFF (production): the two settled mainnet loans, read-only. No example terms,
 * no preview copy, no disabled borrow CTA — the page shows what already happened.
 */
export function PledgeView() {
  const keys = useKeyStore();
  const client = useMemo(() => createPledgeClient(), []);
  const live = client.live && PLEDGE_LIVE;

  if (live) return <LivePledge role="borrower" tokenId={keys.primary?.token_id} />;

  return (
    <>
      {/* The payout notice belongs to this page (it owns payout), not site-wide in the shell. */}
      <PayoutCredit />
      <LoansShowcase />
    </>
  );
}
