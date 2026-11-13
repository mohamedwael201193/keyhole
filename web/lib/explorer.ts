/**
 * One explorer helper. Every transaction or account link in the product comes from here, so a link always opens the
 * explorer that actually knows the chain: NearBlocks for NEAR, BaseScan for Base, Solscan for Solana (Arbiscan for Arbitrum).
 * URL patterns: nearblocks.io/txns/<hash> and /address/<id>; basescan.org/tx/<hash> and /address/<addr>;
 * solscan.io/tx/<sig> and /account/<addr>; arbiscan.io/tx/<hash> and /address/<addr>.
 */
export type ExplorerChain = "near" | "base" | "sol" | "arb";
export type ExplorerKind = "tx" | "account";

const HOSTS: Record<ExplorerChain, { host: string; name: string; tx: string; account: string }> = {
  near: { host: "nearblocks.io", name: "NearBlocks", tx: "txns", account: "address" },
  base: { host: "basescan.org", name: "BaseScan", tx: "tx", account: "address" },
  sol: { host: "solscan.io", name: "Solscan", tx: "tx", account: "account" },
  arb: { host: "arbiscan.io", name: "Arbiscan", tx: "tx", account: "address" },
};

const SHAPE: Record<ExplorerChain, { tx: RegExp; account: RegExp }> = {
  near: { tx: /^[1-9A-HJ-NP-Za-km-z]{30,60}$/, account: /^[a-z0-9._-]{2,64}$/ },
  base: { tx: /^0x[0-9a-fA-F]{64}$/, account: /^0x[0-9a-fA-F]{40}$/ },
  sol: { tx: /^[1-9A-HJ-NP-Za-km-z]{60,100}$/, account: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ },
  arb: { tx: /^0x[0-9a-fA-F]{64}$/, account: /^0x[0-9a-fA-F]{40}$/ },
};

/** Map the chain words the product uses ("near", "sol", "solana", "base", "eth:base", "arb") to a known chain, or null. */
export function explorerChain(chain: string | null | undefined): ExplorerChain | null {
  const c = (chain ?? "").toLowerCase().replace(/^.*:/, "");
  if (c === "near") return "near";
  if (c === "sol" || c === "solana") return "sol";
  if (c === "base") return "base";
  if (c === "arb" || c === "arbitrum") return "arb";
  return null;
}

/** The explorer's host name, for example "solscan.io". */
export function explorerHost(chain: ExplorerChain): string {
  return HOSTS[chain].host;
}

/** The explorer's display name, for example "BaseScan". Link labels use this, never another chain's explorer. */
export function explorerName(chain: ExplorerChain): string {
  return HOSTS[chain].name;
}

/** Link text such as "Open on Solscan". */
export function explorerLabel(chain: ExplorerChain): string {
  return `Open on ${HOSTS[chain].name}`;
}

/** The public page for a transaction or an account. Null when the id has the wrong shape for that chain (no guessed links). */
export function explorerUrl(chain: ExplorerChain, kind: ExplorerKind, id: string): string | null {
  if (!id || !SHAPE[chain][kind].test(id)) return null;
  const h = HOSTS[chain];
  return `https://${h.host}/${h[kind]}/${id}`;
}

/** NEAR links never return null: ids come from the product's own chain reads. */
export const nearTx = (hash: string) => `https://${HOSTS.near.host}/${HOSTS.near.tx}/${hash}`;
export const nearAccount = (id: string) => `https://${HOSTS.near.host}/${HOSTS.near.account}/${id}`;
