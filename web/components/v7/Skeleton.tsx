/**
 * A shimmering placeholder for a read that has not landed yet: `lines` bars of decreasing width. It announces "Loading"
 * once, politely. Under reduced motion it stops shimmering (v7.css).
 */
export type SkeletonProps = {
  lines?: number;
  label?: string;
  testid?: string;
};

export function Skeleton({ lines = 3, label = "Loading", testid }: SkeletonProps) {
  return (
    <div className="v7-skel" role="status" aria-label={label} data-testid={testid}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}
