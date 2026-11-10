import "server-only";

export interface Health {
  at: number;
  /** null means this response did not probe the enclave. */
  online: boolean | null;
  reason: string | null;
  mode: "passive" | "active";
  fresh: boolean;
  payer: string | null;
}

/** Default health. No OutLayer call, no payment key, no compute spend. Not a fresh online pass. */
export function passiveHealth(at = Date.now()): Health {
  return { at, online: null, reason: "not_probed", mode: "passive", fresh: false, payer: null };
}

export async function getHealth(): Promise<Health> {
  return passiveHealth();
}
