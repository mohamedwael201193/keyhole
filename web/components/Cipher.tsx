/** Eight bars. A 1 is the full height; a 0 is the lower half. Matches the sketch cipher. */
export function Cipher({ bits, width = 64, height = 14 }: { bits: string; width?: number; height?: number }) {
  const b = (bits + "00000000").slice(0, 8);
  return (
    <svg className="cipher" viewBox="0 0 64 14" width={width} height={height} role="img" aria-label={b}>
      {b.split("").map((bit, i) => {
        const on = bit === "1";
        return <rect key={i} x={i * 8} y={on ? 0 : 7} width={6} height={on ? 14 : 7} rx={1} fill="currentColor" />;
      })}
    </svg>
  );
}
