/** Official token mark, unaltered, inside the brass medallion. Base's square is scaled to sit in the circle. */
export function Medal({ id, name, labeled = true }: { id: string; name: string; labeled?: boolean }) {
  return (
    <span className="medal">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/logos/${id}.svg`} alt={labeled ? name : ""} data-logo={id} width={38} height={38} />
    </span>
  );
}

export const CHAINS = [
  ["near", "NEAR"], ["usdc", "USDC"], ["eth", "ETH"], ["sol", "SOL"],
  ["btc", "BTC"], ["zec", "ZEC"], ["arb", "ARB"], ["base", "Base"],
] as const;
