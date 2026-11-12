/**
 * The trial budget is per client, so the address has to be one the platform added.
 * Vercel sets x-vercel-forwarded-for and x-real-ip. A caller-supplied x-forwarded-for
 * is not an address: off Vercel, and on Vercel when those platform headers are missing, this returns null.
 * https://vercel.com/docs/headers/request-headers#x-forwarded-for
 */
const IP = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]{2,}$/i;

export function trialClientIp(
  headers: { get(name: string): string | null },
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (env.VERCEL !== "1") return null;
  const platform = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || headers.get("x-real-ip")?.trim()
    || "";
  if (!IP.test(platform) || platform === "0.0.0.0") return null;
  return platform;
}
