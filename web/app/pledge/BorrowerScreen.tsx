"use client";
import { FORFEIT_ACK, FORFEIT_LINE, borrowerNumbers, swapComparisonLine } from "@/lib/pledgeDisclosure";

/**
 * Shown before the open_loan signature. Not behind a Details toggle. The sign button stays disabled until the
 * forfeiture checkbox is ticked (the parent computes `ready` from it). Invalid amounts show a reason, not numbers.
 */
export function BorrowerScreen({ principal, repayment, durationText, graceText, ack, onAck }: {
  /** Yocto strings, or null when the amount inputs are not valid. */
  principal: string | null;
  repayment: string | null;
  durationText: string;
  graceText: string;
  ack: boolean;
  onAck: (next: boolean) => void;
}) {
  let numbers: ReturnType<typeof borrowerNumbers> | null = null;
  try { if (principal && repayment) numbers = borrowerNumbers(principal, repayment); } catch { numbers = null; }
  return (
    <section className="pledge-live-forfeit" data-testid="borrower-screen" aria-label="What a default costs">
      <p className="pledge-live-important" data-testid="forfeit-line">{FORFEIT_LINE}</p>
      {numbers ? (
        <>
          <dl className="pledge-live-facts" data-testid="borrower-numbers">
            <div><dt>Borrow</dt><dd>{numbers.borrow} NEAR</dd></div>
            <div><dt>Repay</dt><dd>{numbers.repay} NEAR</dd></div>
            <div><dt>Total cost (repay minus borrow)</dt><dd>{numbers.cost} NEAR</dd></div>
            <div><dt>Due</dt><dd>{durationText} after the lender&apos;s NEAR is delivered</dd></div>
            <div><dt>Grace after due</dt><dd>{graceText}</dd></div>
          </dl>
          <p className="pledge-live-muted" data-testid="forfeit-compare">{swapComparisonLine(principal!, repayment!)}</p>
        </>
      ) : (
        <p className="pledge-live-muted" data-testid="forfeit-invalid">Enter a borrow and a repayment amount to see the cost and the due time.</p>
      )}
      <label className="pledge-live-forfeit-ack">
        <input type="checkbox" checked={ack} onChange={(e) => onAck(e.target.checked)} data-testid="forfeit-ack" />
        <span>{FORFEIT_ACK}</span>
      </label>
    </section>
  );
}
