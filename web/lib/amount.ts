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

/** Known trade-selector tokens get a symbol, name, logo and human amount. USDC prices at one dollar. */
export function assetRows(accountId: string, balances: RawBalance[]): AssetRow[] {
  const implicit = isImplicitAccount(accountId);
  const out: AssetRow[] = [];
  balances.forEach((b, i) => {
    const token = (b.token || b.symbol || "").trim();
    if (implicit && /^(near|native)$/i.test(token)) return;
    const raw = String(b.amount ?? b.balance ?? "");
    const asset = assetByToken(token);
    if (!asset) {
      out.push({ key: token || String(i), known: false, logo: null, symbol: shortTokenId(token || "—"), name: "", amountLabel: raw, usdMicro: null });
      return;
    }
    const human = fromBaseUnits(raw, asset.decimals);
    const usdMicro = asset.symbol === "USDC" && /^\d+$/.test(raw) ? Number(raw)
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
  | { kind: "amounts"; text: string };

/** A successful read never stays on a dash. $0.00 only when the list is empty. */
export function totalOf(rows: AssetRow[] | null): Total {
  if (!rows) return { kind: "unread" };
  if (rows.length === 0) return { kind: "empty" };
  const priced = rows.filter((r) => r.usdMicro != null);
  if (priced.length > 0) return { kind: "usd", micro: priced.reduce((a, r) => a + (r.usdMicro || 0), 0) };
  return { kind: "amounts", text: rows.map((r) => r.amountLabel).join(" · ") };
}

export function tradeSummary(give: string, amountOut: string, decimals: number, symbol: string): string {
  return `Traded ${give} → ${fromBaseUnits(amountOut, decimals)} ${symbol}`;
}

export function withdrawSummary(amount: string, to: string): string {
  return `Withdrawn ${amount} to ${to}`;
}
