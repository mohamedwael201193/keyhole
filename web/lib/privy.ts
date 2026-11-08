/** Public Privy app values (not secrets). Names follow the privy-near-connect README's Next.js note. */
import type { PrivySigner } from "./privySigner";
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
export const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_APP_CLIENT_ID || process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || "";
export const privyEnabled = () => !!PRIVY_APP_ID;
/** localStorage flag: this browser signed in with Google / email, so restore that path on load. */
export const PRIVY_FLAG = "kh_privy";
export type PrivyNear = { ready: boolean; accountId: string | null; creating: boolean; signer: PrivySigner | null; logout: () => Promise<void> };
/** Privy's OAuth redirect lands back here with these query params; Privy completes the login once its provider is mounted. */
export const PRIVY_OAUTH_PARAMS = ["privy_oauth_state", "privy_oauth_provider", "privy_oauth_code"] as const;
export const hasPrivyOauth = (search: string) => { const q = new URLSearchParams(search); return PRIVY_OAUTH_PARAMS.some((k) => q.has(k)); };
/** Mount Privy on load: an OAuth callback in the URL, our own flag, or Privy's own local state (keys "privy:…"). */
/** Keys a wallet session leaves: the wallet selector's pick and NEAR Connect's (lib/nearConnect.ts NC_WALLET_KEY). */
const WALLET_SESSION_KEYS = ["near-wallet-selector:selectedWalletId", "selected-wallet"];
export function privyResume(search: string, storageKeys: string[]): "oauth" | "restore" | null {
  if (hasPrivyOauth(search)) return "oauth";
  if (storageKeys.includes(PRIVY_FLAG)) return "restore";
  // Privy writes privy:* keys as soon as its SDK loads, even when nobody finished a Google or email sign-in. They mean a
  // Privy session only when no wallet session is stored; otherwise a wallet (Meteor, MyNearWallet, NEAR Connect) restores.
  const walletSession = storageKeys.some((k) => WALLET_SESSION_KEYS.includes(k));
  if (!walletSession && storageKeys.some((k) => k.startsWith("privy:"))) return "restore";
  return null;
}
/** Same URL without the privy_oauth_* params (after the login finished). */
export function stripPrivyOauth(href: string): string {
  const u = new URL(href); PRIVY_OAUTH_PARAMS.forEach((k) => u.searchParams.delete(k)); return u.pathname + u.search + u.hash;
}
