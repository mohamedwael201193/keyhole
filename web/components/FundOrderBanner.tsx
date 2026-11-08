"use client";
import { Button } from "./ui";
import { statusOf } from "@/lib/oneclick";
import { chainName } from "@/lib/tokens";
import type { OrderStatus, SavedOrder } from "@/lib/fundOrder";

/**
 * One line on the vault page while a saved "from another chain" order is not terminal. The wording says "on its way" only
 * once the status shows a deposit has been seen; before that it says it is still waiting for the deposit.
 */
export function FundOrderBanner({ order, status, onOpen }: { order: SavedOrder; status: OrderStatus | null; onOpen: () => void }) {
  const chain = chainName(order.originChain);
  const seen = !!status?.status && status.status !== "PENDING_DEPOSIT";
  const line = seen ? `A deposit from ${chain} is on its way` : `Waiting for your deposit from ${chain}`;
  const label = status ? statusOf(status.status).label : "Checking status";
  return (
    <div className="vlt-banner" data-testid="fund-order-banner" role="status">
      <span>{line} · <b data-testid="fund-order-banner-status">{label}</b></span>
      <Button variant="secondary" size="sm" testid="fund-order-open" onClick={onOpen}>Details</Button>
    </div>
  );
}
