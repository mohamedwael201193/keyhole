/** Canonical public origin. A configured NEXT_PUBLIC_SITE_URL may replace it; a bad value falls back here. */
export const CANONICAL_SITE = "https://keyhole-seven.vercel.app";

export function siteUrl(raw: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string {
  if (!raw) return CANONICAL_SITE;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return CANONICAL_SITE;
    return u.origin;
  } catch {
    return CANONICAL_SITE;
  }
}
