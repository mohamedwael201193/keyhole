/** Petals, turn and ring spacing from the token hash. Same seed, same rosette. */
export function guillocheOf(seedHex: string) {
  const b = (i: number) => Number.parseInt(seedHex.slice(i * 2, i * 2 + 2), 16) || 0;
  return { petals: 5 + (b(0) % 8), rot: Math.round((b(1) / 255) * 180), gap: 8 + (b(2) % 6), rings: 4 + (b(3) % 3) };
}

/** A quiet rosette behind the key. Opacity stays in the cream of sketch B. */
export function Guilloche({ seed }: { seed: string }) {
  const g = guillocheOf(seed);
  const cx = 100;
  const cy = 100;
  const marks = [];
  for (let ring = 0; ring < g.rings; ring++) {
    const rad = 22 + ring * g.gap;
    for (let p = 0; p < g.petals; p++) {
      const turn = g.rot + (360 / g.petals) * p + ring * 7;
      marks.push(
        <ellipse key={`${ring}-${p}`} cx={cx} cy={cy - rad * 0.32} rx={rad * 0.38} ry={rad} transform={`rotate(${turn} ${cx} ${cy})`} />,
      );
    }
  }
  return (
    <svg className="guilloche" viewBox="0 0 200 200" aria-hidden="true">
      <g fill="none" stroke="#5C4316" strokeWidth="0.8">{marks}</g>
    </svg>
  );
}

/** Jeweler's plate under the key: deep notches for 1, a fine line for 0, and the serial. */
export function Hallmark({ bits, serial }: { bits: string; serial: string }) {
  const b = (bits + "00000000").slice(0, 8);
  return (
    <div className="hallmark" role="img" aria-label={`Bit cipher ${b}, serial ${serial}`}>
      <span className="notches" aria-hidden="true">
        {b.split("").map((bit, i) => <i key={i} className={bit === "1" ? "on" : "off"} />)}
      </span>
      <span className="serial">{serial}</span>
    </div>
  );
}
