/** The holder's last mint transaction, kept in this browser so /start and /vault can link it on nearblocks. */
const KEY = (account: string) => `kh_mint_tx:${account}`;
export const isTxHash = (h: unknown): h is string => typeof h === "string" && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(h);
export function saveMintTx(account: string | null, hash: unknown) { if (account && isTxHash(hash)) localStorage.setItem(KEY(account), hash); }
export function loadMintTx(account: string | null): string | null { if (!account) return null; const h = localStorage.getItem(KEY(account)); return isTxHash(h) ? h : null; }
