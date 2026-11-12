/** Where a check's trust comes from. Shown next to every check on /verify and every step on /verify/path. */
export type TrustSrc = "browser" | "chain" | "outlayer" | "intel" | "us";
export const TRUST_LABEL: Record<TrustSrc, string> = {
  browser: "computed in your browser",
  chain: "read from NEAR mainnet",
  outlayer: "fetched from OutLayer",
  intel: "against Intel's root / PCS",
  us: "data we publish (repo)",
};
export function Trust({ src }: { src: TrustSrc[] }) {
  return (
    <span className="trust" data-testid="trust">
      {src.map((s) => <span key={s} className={`tchip t-${s}`} data-trust={s} title={TRUST_LABEL[s]}>{TRUST_LABEL[s]}</span>)}
    </span>
  );
}
export function TrustLegend() {
  return (
    <p className="trust-legend" data-testid="trust-legend">
      <b>Where each check comes from:</b> <Trust src={["browser", "chain", "outlayer", "intel", "us"]} /> Only the last one is our word; everything else you can re-run without us.
    </p>
  );
}
