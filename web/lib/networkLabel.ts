/** Header network name. Mainnet is named only when this build is actually on mainnet. */
export function networkPillLabel(sandbox: boolean): string {
  return sandbox ? "Sandbox" : "NEAR mainnet";
}

export function networkPillDetail(sandbox: boolean): string {
  return sandbox ? "NEAR sandbox · custody simulated" : "NEAR mainnet";
}
