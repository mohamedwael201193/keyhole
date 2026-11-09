/**
 * The finish of a key as a small solid chip: Bronze, Silver, Gold or Legendary. The name is printed (CSS sets the capitals).
 * Any other text (for example "Tier not readable") is shown on the neutral chip, so an unreadable tier never gets a colour.
 * `testid` goes on the name, so a test can read the tier text.
 */
export type TierChipProps = {
  tier: string;
  testid?: string;
};

const KNOWN = ["bronze", "silver", "gold", "legendary"] as const;

export function TierChip({ tier, testid }: TierChipProps) {
  const key = tier.toLowerCase();
  const known = (KNOWN as readonly string[]).includes(key);
  return (
    <span className={`v7-tier${known ? ` v7-tier--${key}` : " v7-tier--none"}`}>
      <span data-testid={testid}>{tier}</span>
    </span>
  );
}
