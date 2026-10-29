import { ASSETS } from "./assets";

/** An implicit account id (0x + 40 hex). It may not exist on NEAR yet. */
export function isImplicitAccount(id: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(id);
}

/** Integer base units → a decimal string, trimmed, at most `maxFrac` fraction digits. No floating point. */
export function fromBaseUnits(raw: string, decimals: number, maxFrac = 6): string {
  if (!/^\d+$/.test(raw)) return raw;
  const digits = raw.replace(/^0+/, "") || "0";
  if (decimals <= 0) return digits;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, "") || "0";
  const frac = padded.slice(padded.length - decimals).slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export function assetByToken(token: string) {
  const id = token.trim().toLowerCase();
  return Object.values(ASSETS).find((a) => a.id.toLowerCase() === id) ?? null;
}

export function shortTokenId(token: string): string {
  const bare = token.replace(/^nep141:/i, "");
  if (bare.length <= 18) return bare;
  return `${bare.slice(0, 8)}…${bare.slice(-4)}`;
}

export type RawBalance = { token?: string; symbol?: string; amount?: string; balance?: string; usd?: number; usd_micro?: number };

export type AssetRow = {
  key: string;
  known: boolean;
  logo: string | null;
  symbol: string;
  name: string;
  amountLabel: string;
  usdMicro: number | null;
};

/** USD price of one whole token, in millionths of a dollar, plus optional list metadata. */
export type TokenPrice = { priceMicro: number; decimals?: number; symbol?: string };
export type PriceBook = Record<string, TokenPrice>;

/** "2.79" or 2.79 → 2_790_000. More than six fraction digits are dropped. */
export function priceToMicro(price: string | number): number | null {
  const s = typeof price === "number" ? price.toFixed(8).replace(/\.?0+$/, "") : price.trim();
  const m = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const frac = (m[2] || "").slice(0, 6).padEnd(6, "0");
  const n = Number((m[1] + frac).replace(/^0+/, "") || "0");
  return Number.isSafeInteger(n) ? n : null;
}

/** raw base units × price / 10^decimals, in millionths of a dollar. */
export function valueMicro(raw: string, decimals: number, priceMicro: number): number | null {
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(priceMicro)) return null;
  const q = (BigInt(raw) * BigInt(priceMicro)) / (10n ** BigInt(Math.max(0, decimals)));
  return q <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(q) : null;
}

/** Known trade-selector tokens get a symbol, name, logo and human amount. Prices come from the book; USDC is $1 only when the book has no price for it. */
export function assetRows(balances: RawBalance[], prices: PriceBook = {}): AssetRow[] {
  const out: AssetRow[] = [];
  balances.forEach((b, i) => {
    const token = (b.token || b.symbol || "").trim();
    const raw = String(b.amount ?? b.balance ?? "");
    const asset = assetByToken(token);
    const quote = prices[token.toLowerCase()];
    if (!asset) {
      const decimals = quote?.decimals;
      const human = decimals != null ? fromBaseUnits(raw, decimals) : raw;
      const symbol = quote?.symbol || shortTokenId(token || "—");
      const usdMicro = quote && decimals != null ? valueMicro(raw, decimals, quote.priceMicro) : null;
      out.push({
        key: token || String(i), known: false, logo: null, symbol, name: "",
        amountLabel: decimals != null ? `${human} ${symbol}` : raw, usdMicro,
      });
      return;
    }
    const human = fromBaseUnits(raw, asset.decimals);
    const listed = quote ? valueMicro(raw, asset.decimals, quote.priceMicro) : null;
    const usdMicro = listed != null ? listed
      : asset.symbol === "USDC" && /^\d+$/.test(raw) ? Number(raw)
      : typeof b.usd_micro === "number" ? b.usd_micro : null;
    out.push({
      key: asset.id, known: true, logo: asset.logo, symbol: asset.symbol, name: asset.name,
      amountLabel: `${human} ${asset.symbol}`, usdMicro,
    });
  });
  return out;
}

export type Total =
  | { kind: "unread" }
  | { kind: "empty" }
  | { kind: "usd"; micro: number }
  | { kind: "partial"; micro: number; unpriced: string[] }
  | { kind: "amounts"; text: string };

/** A successful read never stays on a dash. An unpriced holding is named, not dropped from the total. */
export function totalOf(rows: AssetRow[] | null): Total {
  if (!rows) return { kind: "unread" };
  if (rows.length === 0) return { kind: "empty" };
  const priced = rows.filter((r) => r.usdMicro != null);
  const unpriced = rows.filter((r) => r.usdMicro == null).map((r) => r.amountLabel);
  if (priced.length === 0) return { kind: "amounts", text: rows.map((r) => r.amountLabel).join(" · ") };
  const micro = priced.reduce((a, r) => a + (r.usdMicro || 0), 0);
  if (unpriced.length === 0) return { kind: "usd", micro };
  return { kind: "partial", micro, unpriced };
}

export function tradeSummary(give: string, amountOut: string, decimals: number, symbol: string): string {
  return `Traded ${give} → ${fromBaseUnits(amountOut, decimals)} ${symbol}`;
}

export function withdrawSummary(amount: string, to: string): string {
  return `Withdrawn ${amount} to ${to}`;
}
