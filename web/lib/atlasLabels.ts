import { explorerHost } from "./explorer";
/** The explorer each atlas chain's link opens, and the message key that names it. */
export const EXPLORER_LABEL_KEY: Record<string, string> = {
  near: "atlas.open",
  base: "atlas.openBase",
  sol: "atlas.openSol",
};

/** Host each explorer label must match. The label names the host the href opens. */
export const EXPLORER_HOST: Record<string, string> = {
  near: explorerHost("near"),
  base: explorerHost("base"),
  sol: explorerHost("sol"),
};

export function explorerLabelKey(chain: string): string {
  return EXPLORER_LABEL_KEY[chain] ?? "atlas.open";
}
