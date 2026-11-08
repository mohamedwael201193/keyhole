"use client";
import { CopyButton } from "./motion";
import { Button } from "./ui";
import { statusOf } from "@/lib/oneclick";
import { chainName } from "@/lib/tokens";
import type { OrderStatus, SavedOrder } from "@/lib/fundOrder";

/**
 * Compact card at the top of the Deposit sheet for a saved "from another chain" order. Clear is offered only once the status
 * is terminal, so an order that can still receive funds is never dropped from view.
 */
export function FundOrderCard({ order, status, statusErr, terminal, onClear }: {
  order: SavedOrder;
  status: OrderStatus | null;
  statusErr: boolean;
  terminal: boolean;
  onClear: () => void;
}) {
  const chain = chainName(order.originChain);
  const statusText = !status
    ? (statusErr ? "Status unavailable right now. Retrying every 10 seconds." : "Checking status…")
    : `${statusOf(status.status).label}. ${statusOf(status.status).where}`;
  return (
    <section className="vlt-order" data-testid="fund-order-card" aria-label={terminal ? "Deposit finished" : "Deposit in progress"}>
      <div className="vlt-cardhead">
        <b>{terminal ? "Deposit finished" : "Deposit in progress"}</b>
        <span className="vlt-sub" data-testid="fund-order-status">{statusText}</span>
      </div>
      <p className="vlt-sub">Send <b>{order.amountIn ?? "—"} {order.originSymbol}</b> on {chain} to the deposit address below. The vault receives about {order.amountOut ?? "—"} {order.destSymbol}.</p>
      <div className="vlt-box ro"><span className="v addr" data-testid="fund-order-address">{order.depositAddress}</span><CopyButton value={order.depositAddress} label="Copy address" /></div>
      {order.amountIn && <div className="vlt-actions"><span className="vlt-sub">Amount: <b>{order.amountIn} {order.originSymbol}</b></span><CopyButton value={order.amountIn} label="Copy amount" /></div>}
      {order.depositMemo && <div className="vlt-box ro"><span className="v">Memo: {order.depositMemo}</span><CopyButton value={order.depositMemo} label="Copy memo" /></div>}
      {terminal && <div className="vlt-actions"><Button variant="secondary" size="sm" testid="fund-order-clear" onClick={onClear}>Clear</Button></div>}
    </section>
  );
}
