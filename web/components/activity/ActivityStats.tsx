import { Card, Icon, type IconName } from "@/components/v7";
import { shareText, type Counts } from "./orders";

/**
 * The four stat tiles. Every figure comes from the real rows (countsOf). A share is a share of the orders whose status is read;
 * before any read it says "Not read yet" instead of a percentage. The settled tile says "success rate of read orders", not just
 * "success rate": at first paint only the recorded vault trade is read (1 of 1), and "100% success rate" would read as if every
 * listed order had settled while the other five are still loading (the total tile names them: "5 reading live"). There is no
 * trend arrow: no earlier period is read.
 * When `ready` is false (the source is not readable yet, for example "Your vault" while locked), no figure is shown: each tile
 * shows a dash and `notReadText` says why, so a locked source never reads as zero trades.
 */
export function ActivityStats({ counts: c, ready = true, notReadText = "Not read yet", totalLabel = "Total orders", totalDetail }: { counts: Counts; ready?: boolean; notReadText?: string; totalLabel?: string; totalDetail?: string }) {
  const pending = [c.loading ? `${c.loading} reading live` : null, c.unavailable ? `${c.unavailable} unavailable` : null].filter(Boolean);
  const share = (n: number, what: string) => {
    const s = shareText(n, c.read);
    return s === null ? "Not read yet" : `${s} ${what}`;
  };
  if (!ready) {
    return (
      <div className="act-stats" data-testid="act-stats" data-ready="0">
        <StatTile tone="total" icon="layers" label={totalLabel} value="—" sub={notReadText} testid="act-stat-total" />
        <StatTile tone="ok" icon="check" label="Settled" value="—" sub={notReadText} testid="act-stat-settled" />
        <StatTile tone="warn" icon="arrow-down" label="Refunded" value="—" sub={notReadText} testid="act-stat-refunded" />
        <StatTile tone="bad" icon="x" label="Failed" value="—" sub={notReadText} testid="act-stat-failed" />
      </div>
    );
  }
  return (
    <div className="act-stats" data-testid="act-stats" data-ready="1">
      <StatTile tone="total" icon="layers" label={totalLabel} value={c.total} sub={pending.length ? pending.join(" · ") : (totalDetail ?? "Every status read")} testid="act-stat-total" />
      <StatTile tone="ok" icon="check" label="Settled" value={c.settled} sub={share(c.settled, "success rate of read orders")} testid="act-stat-settled" />
      <StatTile tone="warn" icon="arrow-down" label="Refunded" value={c.refunded} sub={share(c.refunded, "of read orders")} testid="act-stat-refunded" />
      <StatTile tone="bad" icon="x" label="Failed" value={c.failed} sub={share(c.failed, "of read orders")} testid="act-stat-failed" />
    </div>
  );
}

type Tone = "total" | "ok" | "warn" | "bad";
function StatTile({ tone, icon, label, value, sub, testid }: { tone: Tone; icon: IconName; label: string; value: number | string; sub: string; testid: string }) {
  return (
    <Card as="article" tone={tone === "total" ? "vault" : "raised"} className={`act-stat act-stat--${tone}`} testid={testid}>
      <div className="act-stat-head">
        <span className="act-stat-ico" aria-hidden="true"><Icon name={icon} size={20} /></span>
        <p className="act-stat-label">{label}</p>
      </div>
      <p className="act-stat-value" data-value={typeof value === "number" ? value : undefined}>{value}</p>
      <p className="act-stat-sub">{sub}</p>
    </Card>
  );
}
