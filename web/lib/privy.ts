/** Public Privy app values (not secrets). Names follow the privy-near-connect README's Next.js note. */
import type { PrivySigner } from "./privySigner";
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
export const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_APP_CLIENT_ID || process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || "";
export const privyEnabled = () => !!PRIVY_APP_ID;
/** localStorage flag: this browser signed in with Google / email, so restore that path on load. */
export const PRIVY_FLAG = "kh_privy";
export type PrivyNear = { ready: boolean; accountId: string | null; creating: boolean; signer: PrivySigner | null; logout: () => Promise<void> };
