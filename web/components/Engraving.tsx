/** Eight engraved notches on the key shaft, plus the hash serial. A 1 cuts deep; a 0 is a nick. */
export function Engraving({ bits, serial }: { bits: string; serial: string }) {
  const b = (bits + "00000000").slice(0, 8);
  return (
    <svg className="bit-band" viewBox="0 0 72 26" aria-hidden="true">
      <rect x="1" y="1" width="70" height="14" rx="1.5" fill="currentColor" />
      <rect x="1" y="1" width="70" height="1.2" fill="#fff" opacity="0.45" />
      {b.split("").map((bit, i) => {
        const on = bit === "1";
        return <rect key={i} x={6 + i * 8} y={on ? 3 : 7} width="5" height={on ? 10 : 4} rx="0.4" fill="#1A120C" opacity={on ? 0.9 : 0.55} />;
      })}
      <text x="36" y="23.5" textAnchor="middle" fill="#1A120C" fontSize="6.2" fontFamily="ui-monospace, monospace" letterSpacing="0.4">{serial}</text>
    </svg>
  );
}
