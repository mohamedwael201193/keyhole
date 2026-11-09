import { Card, Icon, type IconName } from "@/components/v7";
import { shareText, type Counts } from "./orders";

/**
 * The four stat tiles. Every figure comes from the real rows (countsOf). A share is a share of the orders whose status is read;
 * before any read it says "Not read yet" instead of a percentage. There is no trend arrow: no earlier period is read.
 */
export function ActivityStats({ counts: c }: { counts: Counts }) {
  const pending = [c.loading ? `${c.loading} reading live` : null, c.unavailable ? `${c.unavailable} unavailable` : null].filter(Boolean);
  const share = (n: number, what: string) => {
    const s = shareText(n, c.read);
    return s === null ? "Not read yet" : `${s} ${what}`;
  };
  return (
    <div className="act-stats" data-testid="act-stats">
      <StatTile tone="total" icon="layers" label="Total orders" value={c.total} sub={pending.length ? pending.join(" · ") : "Every status read"} testid="act-stat-total" />
      <StatTile tone="ok" icon="check" label="Settled" value={c.settled} sub={share(c.settled, "success rate")} testid="act-stat-settled" />
      <StatTile tone="warn" icon="arrow-down" label="Refunded" value={c.refunded} sub={share(c.refunded, "of read orders")} testid="act-stat-refunded" />
      <StatTile tone="bad" icon="x" label="Failed" value={c.failed} sub={share(c.failed, "of read orders")} testid="act-stat-failed" />
    </div>
  );
}

type Tone = "total" | "ok" | "warn" | "bad";
function StatTile({ tone, icon, label, value, sub, testid }: { tone: Tone; icon: IconName; label: string; value: number; sub: string; testid: string }) {
  return (
    <Card as="article" tone={tone === "total" ? "vault" : "raised"} className={`act-stat act-stat--${tone}`} testid={testid}>
      <div className="act-stat-head">
        <span className="act-stat-ico" aria-hidden="true"><Icon name={icon} size={20} /></span>
        <p className="act-stat-label">{label}</p>
      </div>
      <p className="act-stat-value" data-value={value}>{value}</p>
      <p className="act-stat-sub">{sub}</p>
    </Card>
  );
}
